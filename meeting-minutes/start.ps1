# Mahdar (meeting minutes) for Windows: set up the first time, start, and open it in the browser.
#
#   start.bat     double-click it (in this meeting-minutes folder); needs Docker Desktop, running
#   stop.bat      stops Mahdar; meetings and settings stay saved
#
# The first time, it creates .env.docker with new random secrets (on this computer only, readable by
# you only), asks for a Claude API key (optional: without one, recordings are transcribed and the
# speakers separated, but no minutes are written), builds and starts the containers, creates the
# first administrator and opens http://localhost:8080. Later runs keep every value in .env.docker.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 [options]
#     -SettingsOnly      create or complete .env.docker, then stop (no Docker)
#     -ClaudeKey KEY     use this Claude API key without asking
#     -SkipClaudeKey     do not ask for a Claude API key
#     -NoBrowser         do not open the browser at the end
#
# Notes for maintainers: this file stays ASCII (Windows PowerShell 5.1 misreads other characters in
# a file without a byte order mark) and runs on Windows PowerShell 5.1 and PowerShell 7. The helpers
# follow ops/midad.ps1. Tested by backend/tests/test_start_script.py where PowerShell is installed.
param(
  [switch]$SettingsOnly,
  [string]$ClaudeKey = '',
  [switch]$SkipClaudeKey,
  [switch]$NoBrowser
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$OnWindows = (-not (Test-Path variable:IsWindows)) -or $IsWindows
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
# .NET file calls resolve relative paths against the process's directory, not Set-Location's.
[Environment]::CurrentDirectory = $Root
$EnvFile = Join-Path $Root '.env.docker'
$Example = Join-Path $Root '.env.docker.example'
$script:Code = 0

function Say([string]$m) { Write-Host $m }
function Step([string]$m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host "Note: $m" -ForegroundColor Yellow }
function Die([string]$m) { Write-Host ''; Write-Host "Error: $m" -ForegroundColor Red; exit 1 }

# Runs a program. Sets $script:Code; stops the script on failure unless -AllowFail. Error records from
# a program's error output never stop the script. -Interactive leaves the console to the program (for
# a password prompt), -Capture returns its output (one string per line).
function Native([string[]]$Argv, [switch]$Quiet, [switch]$Capture, [switch]$AllowFail, [switch]$Interactive) {
  $exe = $Argv[0]
  $rest = @()
  if ($Argv.Count -gt 1) { $rest = @($Argv[1..($Argv.Count - 1)]) }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = $null
  try {
    if ($Capture) { $out = & $exe @rest 2>$null }
    elseif ($Quiet) { & $exe @rest *> $null }
    elseif ($Interactive) { & $exe @rest }
    else { & $exe @rest | Out-Host }
    $script:Code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($script:Code -ne 0 -and -not $AllowFail) { Die "this step failed (exit code $($script:Code)): $exe $(($rest | Select-Object -First 4) -join ' ')" }
  if ($Capture) { return , @($out | ForEach-Object { [string]$_ }) }
}
function DC([string[]]$A, [switch]$Capture, [switch]$AllowFail, [switch]$Interactive) {
  $all = @('docker', 'compose', '--env-file', $EnvFile) + $A
  if ($Capture) { return , (Native $all -Capture -AllowFail:$AllowFail) }
  Native $all -AllowFail:$AllowFail -Interactive:$Interactive
}

function Test-Tty { try { return (-not [Console]::IsInputRedirected) } catch { return $true } }
function Ask([string]$Question, [string]$Default = '') {
  if (-not (Test-Tty)) { Die "no window to ask `"$Question`": double-click start.bat instead" }
  if ($Default) { $ans = Read-Host "$Question [$Default]" } else { $ans = Read-Host $Question }
  if ([string]::IsNullOrEmpty($ans)) { return $Default }
  return $ans
}
function Ask-Secret([string]$Question) { # '' when there is no window to ask in
  if (-not (Test-Tty)) { return '' }
  $sec = Read-Host $Question -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Protect-Path([string]$Path) { # readable by you only
  if ($OnWindows) {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Native @('icacls', $Path, '/inheritance:r', '/grant:r', "${me}:F", '*S-1-5-18:F') -Quiet -AllowFail
  } else {
    Native @('chmod', '600', $Path) -Quiet -AllowFail
  }
}
function Get-KV([string]$File, [string]$Key) { # the value without surrounding quotes, or ''
  if (-not (Test-Path -LiteralPath $File)) { return '' }
  $v = ''
  $re = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
  foreach ($line in [IO.File]::ReadAllLines($File)) { if ($line -match $re) { $v = $Matches[1].Trim() } }
  if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
  return $v
}
function Set-KV([string]$File, [string]$Key, [string]$Value) { # replaces the line or appends it, keeping the file private
  $lines = New-Object System.Collections.Generic.List[string]
  $done = $false
  $re = '^\s*' + [regex]::Escape($Key) + '='
  if (Test-Path -LiteralPath $File) {
    foreach ($line in [IO.File]::ReadAllLines($File)) {
      if ($line -match $re) { if (-not $done) { $lines.Add("$Key=$Value"); $done = $true } } else { $lines.Add($line) }
    }
  }
  if (-not $done) { $lines.Add("$Key=$Value") }
  $tmp = "$File.tmp"
  [IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n")) # UTF-8 without a byte order mark
  Protect-Path $tmp
  Move-Item -LiteralPath $tmp -Destination $File -Force
}

function New-RandomBytes([int]$Count) {
  $bytes = New-Object byte[] $Count
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return , $bytes
}
# Database passwords are hexadecimal: they go into connection URLs, where + / = would need escaping.
function New-Hex([int]$Count) { $b = New-RandomBytes $Count; return ([BitConverter]::ToString($b) -replace '-', '').ToLower() }
function New-Base64([int]$Count) { $b = New-RandomBytes $Count; return [Convert]::ToBase64String($b) }

# ------------------------------------------------------------------ settings
function Initialize-Settings {
  Step 'Settings (.env.docker)'
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    if (-not (Test-Path -LiteralPath $Example)) { Die '.env.docker.example is missing: run start.bat from the meeting-minutes folder of the project.' }
    [IO.File]::WriteAllText($EnvFile, ([IO.File]::ReadAllText($Example) -replace "`r", ''))
    Protect-Path $EnvFile
    Say 'Created .env.docker from .env.docker.example.'
  }
  $script:NewSecrets = @()
  $generate = [ordered]@{
    'POSTGRES_PASSWORD'      = { New-Hex 24 }
    'MAHDAR_APP_DB_PASSWORD' = { New-Hex 24 }
    'MAHDAR_SECRET_KEY'      = { New-Base64 48 }
    'MAHDAR_DATA_KEY'        = { New-Base64 32 }
  }
  foreach ($key in @($generate.Keys)) {
    if (-not (Get-KV $EnvFile $key)) { Set-KV $EnvFile $key (& $generate[$key]); $script:NewSecrets += $key }
  }
  if ($script:NewSecrets.Count -gt 0) {
    Say ('Generated new random values for ' + ($script:NewSecrets -join ', ') + '.')
  } else {
    Say 'The secrets are already set and are kept as they are.'
  }
  if ($script:NewSecrets -contains 'MAHDAR_DATA_KEY') {
    Warn 'MAHDAR_DATA_KEY in .env.docker encrypts your recordings and documents. Keep a private copy of .env.docker somewhere safe: without it, saved meetings cannot be read.'
  }
  Protect-Path $EnvFile

  if (Get-KV $EnvFile 'ANTHROPIC_API_KEY') { Say 'A Claude API key is set.'; return }
  $key = $ClaudeKey.Trim()
  if (-not $key -and -not $SkipClaudeKey) {
    Say ''
    Say 'Mahdar writes the minutes with Claude. Without a Claude API key, recordings are transcribed and'
    Say 'the speakers separated, but no minutes are written. A key comes from the Claude Console'
    Say '(console.anthropic.com). Nothing appears on the screen while you paste it.'
    $key = (Ask-Secret 'Paste your Claude API key, or press Enter to skip').Trim()
  }
  if (-not $key) { Warn 'No Claude API key: run start.bat again later to add one.'; return }
  if ($key -notmatch '^sk-ant-') { Warn 'This does not look like a Claude API key (they start with sk-ant-); it is saved anyway.' }
  Set-KV $EnvFile 'ANTHROPIC_API_KEY' $key
  $allowed = @((Get-KV $EnvFile 'MAHDAR_ALLOWED_EXTERNAL_PROVIDERS') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($allowed -notcontains 'anthropic') { Set-KV $EnvFile 'MAHDAR_ALLOWED_EXTERNAL_PROVIDERS' (@($allowed + 'anthropic') -join ',') }
  Say 'Saved the Claude API key in .env.docker.'
}

# ------------------------------------------------------------------ Docker
function Start-Mahdar {
  Step 'Checking Docker Desktop'
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Die 'Docker was not found. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then double-click start.bat again.'
  }
  Native @('docker', 'info') -Quiet -AllowFail
  if ($script:Code -ne 0) {
    Die 'Docker Desktop is not running. Open Docker Desktop, wait until it shows that the engine is running, then double-click start.bat again.'
  }
  # A database kept from an earlier installation was set up with that installation's passwords.
  if ($script:NewSecrets -contains 'POSTGRES_PASSWORD') {
    $volumes = Native @('docker', 'volume', 'ls', '-q', '--filter', 'name=mahdar_pgdata') -Capture -AllowFail
    if (@($volumes | Where-Object { $_ -eq 'mahdar_pgdata' }).Count -gt 0) {
      Die ('.env.docker is new, but a Mahdar database from an earlier installation exists. Put back the .env.docker of that installation; ' +
        'or, only to start over and DELETE all its meetings: docker compose --env-file .env.docker down -v')
    }
  }
  Step 'Building and starting Mahdar (the first time takes 10 to 20 minutes)'
  DC @('up', '--build', '-d')
  Step 'Waiting until Mahdar is ready'
  $port = Get-KV $EnvFile 'MAHDAR_PORT'
  if (-not $port) { $port = '8080' }
  for ($i = 0; $i -lt 72; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/readyz" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return "http://localhost:$port" }
    } catch { }
    Start-Sleep -Seconds 5
  }
  Die 'Mahdar did not become ready within 6 minutes. To see why: docker compose --env-file .env.docker logs api'
}

# Called as a statement, never captured: a captured function's programs lose the console, and the
# password prompt of create-admin would not appear. The administrator's e-mail goes to $script:Admin.
function Initialize-Admin {
  $script:Admin = ''
  $out = DC @('exec', '-T', 'api', 'python3', '-m', 'mahdar.cli', 'org-count') -Capture
  $count = @($out | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -Last 1)
  if ($count.Count -eq 0) { Die "could not read the number of organizations: $($out -join ' ')" }
  if ([int]$count[0] -gt 0) { Say 'An administrator already exists: sign in with that account.'; return }

  Step 'Creating the first administrator (the account you sign in with)'
  $org = Ask 'Name of your organization (the Arabic name printed on documents is set later in Settings)' 'My organization'
  do { $email = (Ask 'Your e-mail address (used to sign in)').Trim() } while ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  Say 'Now choose a password of at least 12 characters. Nothing appears on the screen while you type it.'
  for ($try = 1; $try -le 3; $try++) {
    DC @('exec', 'api', 'python3', '-m', 'mahdar.cli', 'create-admin', '--org', $org, '--email', $email) -Interactive -AllowFail
    if ($script:Code -eq 0) { Say "Administrator created: $email"; $script:Admin = $email; return }
    Warn 'The administrator was not created (a password needs at least 12 characters). Try again.'
  }
  Die 'the administrator could not be created. Run start.bat again to retry.'
}

# ------------------------------------------------------------------ main
Initialize-Settings
if ($SettingsOnly) { Say ''; Say 'Settings are ready (-SettingsOnly: Docker was not started).'; exit 0 }
$url = Start-Mahdar
Initialize-Admin

Step 'Mahdar is running'
if ($script:Admin) { Say "Open $url in your browser and sign in as $($script:Admin)." } else { Say "Open $url in your browser." }
Say ''
Say 'In Mahdar, as administrator, open Settings:'
Say ' - privacy and external processing: tick anthropic under transcripts, so that Claude may write the'
Say '   minutes (only if you added a Claude API key), then save;'
Say ' - document identity: the organization name printed on the minutes.'
Say 'Then create a meeting and upload a recording. The first recording also downloads the speech models'
Say '(about 3 GB). On a computer without a graphics card, transcription takes about as long as the recording.'
Say ''
Say 'To stop Mahdar: double-click stop.bat (meetings stay saved). To start it again: start.bat.'
if (-not $NoBrowser) { Start-Process $url }
exit 0
