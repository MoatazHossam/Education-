# Curriculum Scope operations for Windows: start, stop, status, back up, restore and test a backup,
# for the development stack (docker-compose.yml + .env.docker) or production
# (+ docker-compose.prod.yml + .env.production). Needs Docker Desktop and the PowerShell built into
# Windows (5.1) or PowerShell 7. Linux: the same commands as ops/cs.sh. Guide: docs/DEPLOYMENT_GUIDE.md section 8.
#
#   ops\cs.bat                      a menu (double-click it)
#   ops\start.bat, stop.bat, status.bat, backup.bat, restore.bat   [options]
#   powershell -NoProfile -ExecutionPolicy Bypass -File ops\cs.ps1 <command> [options]
#   commands: start | stop | status | backup | restore | verify | destinations | menu
#
# Options
#   --env dev|prod      which installation (asked when missing)
#   --env-file FILE     another settings file than .env.docker / .env.production
#   --yes               no questions: saved choices and defaults (for Task Scheduler); needs --env
#   backup:  --to folder,server,bucket|none   copies besides the backup folder (default: saved choice)
#            --no-encrypt                     leave the archive unencrypted (not with the settings file)
#   restore: --from local|folder|server|bucket   --file NAME   --only-verify (= verify)
#
# Backup copy settings (folder, server, bucket, encryption, retention) are kept in .env.backup,
# readable only by you. The passphrase is never saved there: it is asked, or read from
# CS_BACKUP_PASSPHRASE or the file named by BACKUP_PASSPHRASE_FILE.

# Notes for maintainers: this file stays ASCII (Windows PowerShell 5.1 misreads other characters in
# a file without a byte order mark). Binary data never passes through PowerShell, which would change
# it: dumps, archives and encryption are written by containers into the mounted backup folder. Shell
# snippets given to containers contain no double quotes, which Windows PowerShell 5.1 drops from
# arguments; values reach them as environment variables, and secrets never appear on a command line.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # no progress bars for file copies

$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$ConfFile = Join-Path $Root '.env.backup'
$RcloneImage = 'rclone/rclone:1.71'
$PgImage = 'postgres:16-alpine'
$ToolImage = 'caddy:2.10-alpine'
$OnWindows = (-not (Test-Path variable:IsWindows)) -or $IsWindows

$script:Cmd = ''; $script:EnvName = ''; $script:EnvFile = ''; $script:Yes = $false; $script:To = ''; $script:From = ''
$script:Pick = ''; $script:NoEncrypt = $false; $script:OnlyVerify = $false
$script:Files = @(); $script:Project = ''; $script:Managed = $false; $script:NoEnv = $false; $script:Image = ''
$script:LockDir = ''; $script:Failed = @(); $script:Copies = @(); $script:Code = 0; $script:RestoreUrl = ''
$script:Cleanup = New-Object System.Collections.Generic.List[string]

function Say([string]$m) { Write-Host $m }
function Step([string]$m) { Write-Host ''; Write-Host "== $m" }
function Warn([string]$m) { Write-Host "Warning: $m" -ForegroundColor Yellow }
function Invoke-Cleanup {
  foreach ($p in $script:Cleanup) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue } }
  $script:Cleanup.Clear()
  if ($script:LockDir -and (Test-Path -LiteralPath $script:LockDir)) { Remove-Item -LiteralPath $script:LockDir -Recurse -Force -ErrorAction SilentlyContinue }
  $script:LockDir = ''
}
function Die([string]$m) { Write-Host "Error: $m" -ForegroundColor Red; Invoke-Cleanup; exit 1 }
function Show-Usage {
  foreach ($l in (Get-Content -LiteralPath $PSCommandPath)) {
    if (-not $l.StartsWith('#')) { break }
    Write-Host ($l -replace '^# ?', '')
  }
}

$argv = @($args)
for ($i = 0; $i -lt $argv.Count; $i++) {
  $a = [string]$argv[$i]
  $hasNext = ($i + 1) -lt $argv.Count
  switch -Regex ($a) {
    '^(start|stop|status|backup|restore|verify|destinations|menu)$' { $script:Cmd = $a.ToLower(); break }
    '^--?env$' { if (-not $hasNext) { Die '--env needs dev or prod' }; $i++; $script:EnvName = [string]$argv[$i]; break }
    '^--?env-file$' { if (-not $hasNext) { Die '--env-file needs a file' }; $i++; $script:EnvFile = [string]$argv[$i]; break }
    '^(--?yes|-y)$' { $script:Yes = $true; break }
    '^--?to$' { if (-not $hasNext) { Die '--to needs a list' }; $i++; $script:To = [string]$argv[$i]; break }
    '^--?from$' { if (-not $hasNext) { Die '--from needs local, folder, server or bucket' }; $i++; $script:From = [string]$argv[$i]; break }
    '^--?file$' { if (-not $hasNext) { Die '--file needs a name' }; $i++; $script:Pick = [string]$argv[$i]; break }
    '^--?no-encrypt$' { $script:NoEncrypt = $true; break }
    '^--?only-verify$' { $script:OnlyVerify = $true; break }
    '^(-h|--help|/\?)$' { Show-Usage; exit 0 }
    default { Die "unknown option $a (ops\cs.bat --help)" }
  }
}

# ------------------------------------------------------------------ running programs
# Native ARGV [-Quiet] [-Capture] [-AllowFail]: runs a program; its output goes to the screen, or is
# returned with -Capture (one string per line). Sets $script:Code; stops the script on failure unless
# -AllowFail. Error records from programs' error output never stop the script.
function Native([string[]]$Argv, [switch]$Quiet, [switch]$Capture, [switch]$AllowFail) {
  $exe = $Argv[0]
  $rest = @()
  if ($Argv.Count -gt 1) { $rest = @($Argv[1..($Argv.Count - 1)]) }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = $null
  try {
    if ($Capture) { $out = & $exe @rest }
    elseif ($Quiet) { & $exe @rest *> $null }
    else { & $exe @rest | Out-Host }
    $script:Code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($script:Code -ne 0 -and -not $AllowFail) { Die "this step failed (exit code $($script:Code)): $exe $(($rest | Select-Object -First 3) -join ' ')" }
  if ($Capture) { return , @($out | ForEach-Object { [string]$_ }) }
}
function DC([string[]]$A, [switch]$Quiet, [switch]$Capture, [switch]$AllowFail) {
  $all = @('docker', 'compose') + $script:Files + @('--env-file', $script:EnvFile) + $A
  if ($Capture) { return , (Native $all -Capture -AllowFail:$AllowFail) }
  Native $all -Quiet:$Quiet -AllowFail:$AllowFail
}
function Tool-User { # containers that write into the backup folder: as root on Linux (the folder is private)
  if ($OnWindows) { return , @() }
  return , @('--user', '0:0')
}
function Pg-Tool([string[]]$DockerOpts, [string[]]$Command, [switch]$Capture, [switch]$AllowFail) {
  # PostgreSQL client tools for a managed database; BACKUP_PG_IMAGE must be as new as the server
  $all = @('docker', 'run', '--rm')
  $net = Conf 'BACKUP_DOCKER_NETWORK'
  if ($net) { $all += @('--network', $net) }
  $img = Conf 'BACKUP_PG_IMAGE'
  if (-not $img) { $img = $PgImage }
  $all += $DockerOpts + @($img) + $Command
  if ($Capture) { return , (Native $all -Capture -AllowFail:$AllowFail) }
  Native $all -AllowFail:$AllowFail
}
function Clean-Script([string]$s) { return ($s -replace "`r", '') } # a shell script, whatever this file's line endings

# ------------------------------------------------------------------ questions
function Test-Tty { try { return (-not [Console]::IsInputRedirected) } catch { return $true } }
function Ask([string]$Question, [string]$Default = '') {
  if ($script:Yes) { return $Default }
  if (-not (Test-Tty)) { Die "no terminal to ask `"$Question`"; run with --yes to use the saved choices" }
  if ($Default) { $ans = Read-Host "$Question [$Default]" } else { $ans = Read-Host $Question }
  if ([string]::IsNullOrEmpty($ans)) { return $Default }
  return $ans
}
function Ask-Secret([string]$Question) {
  if ($script:Yes) { Die "$Question is needed, and --yes cannot ask for it (see BACKUP_PASSPHRASE_FILE in docs/DEPLOYMENT_GUIDE.md section 8)" }
  if (-not (Test-Tty)) { Die "no terminal to ask for $Question" }
  $sec = Read-Host $Question -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Confirm-Yes([string]$Question, [string]$Default = 'n') {
  $ans = Ask "$Question (y/n)" $Default
  return ($ans -match '^[Yy]')
}
function YN([bool]$b) { if ($b) { return 'y' } return 'n' }
function Choose([string]$Title, [int]$Default, [string[]]$Options) {
  if ($script:Yes) { return $Default }
  if (-not (Test-Tty)) { Die "no terminal to ask `"$Title`"" }
  Write-Host $Title
  for ($k = 0; $k -lt $Options.Count; $k++) { Write-Host ('  {0}) {1}' -f ($k + 1), $Options[$k]) }
  while ($true) {
    $ans = Ask 'Choose' "$Default"
    $n = 0
    if ([int]::TryParse($ans, [ref]$n) -and $n -ge 1 -and $n -le $Options.Count) { return $n }
    Write-Host "Type a number from 1 to $($Options.Count)."
  }
}

# ------------------------------------------------------------------ settings files
function Protect-Path([string]$Path, [switch]$Dir) { # readable by you only (and SYSTEM, for Task Scheduler)
  if ($OnWindows) {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $perm = 'F'
    if ($Dir) { $perm = '(OI)(CI)F' }
    Native @('icacls', $Path, '/inheritance:r', '/grant:r', "${me}:$perm", "*S-1-5-18:$perm") -Quiet -AllowFail
  } else {
    $mode = '600'
    if ($Dir) { $mode = '700' }
    Native @('chmod', $mode, $Path) -Quiet -AllowFail
  }
}
function Test-OpenToOthers([string]$Path) {
  if ($OnWindows) {
    $open = (Get-Acl -LiteralPath $Path).Access | Where-Object { $_.IdentityReference.Value -match '(^|\\)(Users|Everyone|Authenticated Users)$' }
    return [bool]$open
  }
  $mode = Native @('stat', '-c', '%a', $Path) -Capture -AllowFail
  return ($mode -notcontains '600' -and $mode -notcontains '400')
}
function Get-KV([string]$File, [string]$Key) { # the value without surrounding quotes, or ''
  if (-not (Test-Path -LiteralPath $File)) { return '' }
  $v = ''
  $re = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
  foreach ($line in [IO.File]::ReadAllLines($File)) { if ($line -match $re) { $v = $Matches[1] } }
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
  [IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n"))
  Protect-Path $tmp
  Move-Item -LiteralPath $tmp -Destination $File -Force
}
function Write-Lines([string]$Path, [string[]]$Lines) { [IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n")) }
function EnvGet([string]$Key) { return (Get-KV $script:EnvFile $Key) }
function Conf([string]$Key) { return (Get-KV $ConfFile $Key) }
function Save([string]$Key, [string]$Value) { Set-KV $ConfFile $Key $Value }
function Url-WithDb([string]$Url, [string]$Db) { return ($Url -replace '(://[^/]*/)[^?]*', ('${1}' + $Db)) }
function Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower() }
function Test-Sha256([string]$Path) { # the file against the .sha256 file next to it
  $want = ((([IO.File]::ReadAllText("$Path.sha256")).Trim()) -split '\s+')[0].ToLower()
  return ($want -eq (Sha256 $Path))
}
function Write-Sha256([string]$Path) { [IO.File]::WriteAllText("$Path.sha256", "$(Sha256 $Path)  $(Split-Path -Leaf $Path)`n") }
function Size([string]$Path) { return ('{0:N0} KB' -f [math]::Ceiling((Get-Item -LiteralPath $Path).Length / 1KB)) }

# ------------------------------------------------------------------ the installation
function Pick-Env([switch]$MissingOk) { # a restore onto a new server may start without the settings file
  if (-not $script:EnvName) {
    if ($script:Yes) { Die '--yes needs --env dev or --env prod' }
    $def = 1
    if ((Test-Path '.env.production') -and -not (Test-Path '.env.docker')) { $def = 2 }
    $c = Choose 'Which installation?' $def @('Development (docker-compose.yml, .env.docker)', 'Production (docker-compose.yml + docker-compose.prod.yml, .env.production)')
    $script:EnvName = @('dev', 'prod')[$c - 1]
  }
  switch ($script:EnvName) {
    'dev' { if (-not $script:EnvFile) { $script:EnvFile = '.env.docker' }; $script:Files = @('-f', 'docker-compose.yml') }
    'prod' { if (-not $script:EnvFile) { $script:EnvFile = '.env.production' }; $script:Files = @('-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml') }
    default { Die '--env must be dev or prod' }
  }
  $script:NoEnv = $false
  if (-not (Test-Path -LiteralPath $script:EnvFile)) {
    if (-not $MissingOk) { Die "$($script:EnvFile) not found: copy .env.docker.example to $($script:EnvFile) and fill it in (docs/DEPLOYMENT_GUIDE.md section 3.2)" }
    $script:NoEnv = $true
  }
  $script:Project = $env:COMPOSE_PROJECT_NAME
  if (-not $script:Project) { $script:Project = EnvGet 'COMPOSE_PROJECT_NAME' }
  if (-not $script:Project) { $script:Project = 'curriculum-scope' }
  $script:Managed = [bool](EnvGet 'DATABASE_URL')
  $tag = EnvGet 'APP_IMAGE_TAG'
  if (-not $tag) { $tag = 'local' }
  $script:Image = "curriculum-scope:$tag"
}
function Scale-Args { if ($script:Managed) { return , @('--scale', 'postgres=0') } return , @() }
function Apps { if ($script:EnvName -eq 'prod') { return , @('app', 'app2') } return , @('app') }
function Get-DbName { # DB_NAME, or the database named in DATABASE_URL (managed database)
  $n = EnvGet 'DB_NAME'
  if (-not $n -and $script:Managed -and (EnvGet 'DATABASE_URL') -match '^[^/]*//[^/]*/([^?]*)') { $n = $Matches[1] }
  return $n
}
function Check-Env {
  $keys = @('SESSION_SECRET', 'DATA_ENCRYPTION_KEY')
  if ($script:Managed) { $keys += 'MIGRATION_DATABASE_URL' }
  else { $keys += @('POSTGRES_SUPERUSER_PASSWORD', 'DB_NAME', 'DB_OWNER_USER', 'DB_OWNER_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD', 'DB_BACKUP_PASSWORD') }
  if ($script:EnvName -eq 'prod') { $keys += @('APP_URL', 'DOMAIN', 'ACME_EMAIL') }
  $missing = @($keys | Where-Object { -not (EnvGet $_) })
  if ($missing.Count) { Die "set these in $($script:EnvFile) first: $($missing -join ' ')" }
  if ($script:EnvName -eq 'prod') {
    if (Select-String -LiteralPath $script:EnvFile -Pattern '=change-me' -Quiet) { Die "$($script:EnvFile) still has change-me values: replace every password (docs/DEPLOYMENT_GUIDE.md section 3.2)" }
    if (-not (EnvGet 'APP_URL').StartsWith('https://')) { Die 'APP_URL must start with https:// in production' }
    if (Test-OpenToOthers $script:EnvFile) {
      Warn "$($script:EnvFile) can be read by other users of this computer"
      if (Confirm-Yes 'Make it readable by you only?' 'y') { Protect-Path $script:EnvFile }
    }
  }
}
function Test-Running([string]$Service) { return ((DC @('ps', '--status', 'running', '--services') -Capture -AllowFail) -contains $Service) }
function Test-Ready([string]$Service) {
  DC @('exec', '-T', $Service, 'node', '-e', "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))") -Quiet -AllowFail
  return ($script:Code -eq 0)
}
function Wait-Ready([string]$Service) {
  for ($k = 0; $k -lt 90; $k++) {
    if (Test-Ready $Service) { Say "  $Service is ready"; return $true }
    Start-Sleep -Seconds 2
  }
  Warn "$Service is not ready after 3 minutes: see the logs of $Service (docker compose logs $Service)"
  return $false
}
function Wait-Postgres {
  for ($k = 0; $k -lt 60; $k++) {
    DC @('exec', '-T', 'postgres', 'pg_isready', '-q') -Quiet -AllowFail
    if ($script:Code -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  Die 'the database did not start: see the postgres logs'
}
function Test-Image { Native @('docker', 'image', 'inspect', $script:Image) -Quiet -AllowFail; return ($script:Code -eq 0) }
function Ensure-Image {
  if (Test-Image) { return }
  if ($script:Image -ne 'curriculum-scope:local') { Die "image $($script:Image) not found (APP_IMAGE_TAG in $($script:EnvFile))" }
  Step 'Building the app image (needed once; a few minutes)'
  Native @('docker', 'build', '-t', $script:Image, $Root)
}

# ------------------------------------------------------------------ start, stop, status
function Cmd-Start {
  Pick-Env
  Check-Env
  $a = @('up', '-d') + (Scale-Args)
  $build = $false
  if (-not (Test-Image)) {
    if ($script:Image -ne 'curriculum-scope:local') { Die "image $($script:Image) not found (APP_IMAGE_TAG in $($script:EnvFile))" }
    Say 'The app image is not built yet: it is built first (a few minutes).'
    $build = $true
  } elseif ($script:Image -eq 'curriculum-scope:local' -and (Confirm-Yes 'Rebuild the app image first (after updating the code)?' 'n')) { $build = $true }
  if ($build) {
    $a += '--build'
    # The image being replaced stays as :previous, for a rollback (docs/DEPLOYMENT_GUIDE.md section 4).
    if (Test-Image) { Native @('docker', 'tag', $script:Image, 'curriculum-scope:previous') -Quiet }
  }
  Step "Starting the $($script:EnvName) installation ($($script:Project))"
  DC $a
  Step 'Waiting for the app'
  foreach ($s in (Apps)) { [void](Wait-Ready $s) }
  Show-Status
}
function Cmd-Stop {
  Pick-Env
  $c = Choose 'Stop how?' 1 @('Stop (containers, data and settings kept; start again with start)', 'Stop and remove the containers (data, settings and images kept)')
  Step "Stopping the $($script:EnvName) installation ($($script:Project))"
  if ($c -eq 1) { DC @('stop') } else { DC @('down', '--remove-orphans') }
  Say 'Stopped. The database, files and certificates stay in Docker volumes: nothing was deleted.'
}
function Show-Status {
  Step "Status of the $($script:EnvName) installation ($($script:Project))"
  DC @('ps', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}')
  foreach ($s in (Apps)) { if (Test-Ready $s) { Say "  ${s}: ready" } else { Say "  ${s}: not ready" } }
  Say "Address: $(EnvGet 'APP_URL')"
}
function Cmd-Status { Pick-Env; Show-Status }

# ------------------------------------------------------------------ backup folder, lock, passphrase
function Get-BackupDir {
  $d = Conf 'BACKUP_DIR'
  if (-not $d) { $d = Join-Path $Root 'backups' }
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null; Protect-Path $d -Dir }
  return (Resolve-Path -LiteralPath $d).ProviderPath
}
function Lock-Dir([string]$Dir) { # one backup or restore at a time; a lock left by a run that was closed is taken over
  $l = Join-Path $Dir '.lock'
  if (Test-Path -LiteralPath $l) {
    $pidFile = Join-Path $l 'pid'
    $old = ''
    if (Test-Path -LiteralPath $pidFile) { $old = ([IO.File]::ReadAllText($pidFile)).Trim() }
    if ($old -match '^[0-9]+$' -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue)) { Die "another backup or restore is running (process $old): wait for it to finish" }
    if (-not $old -and (Get-Item -LiteralPath $l -Force).LastWriteTime -gt (Get-Date).AddMinutes(-5)) { Die "another backup or restore has just started: wait for it to finish (or remove $l if none is running)" }
    Warn 'an earlier backup or restore stopped without cleaning up; what it left is removed'
    Remove-Item -LiteralPath $l -Recurse -Force
  }
  New-Item -ItemType Directory -Path $l | Out-Null
  $script:LockDir = $l
  [IO.File]::WriteAllText((Join-Path $l 'pid'), "$PID")
  # left by a run that was closed (it may hold decrypted data)
  Get-ChildItem -LiteralPath $Dir -Force | Where-Object { $_.Name -like '.work-*' -or $_.Name -like '.restore-*' -or $_.Name -like '*.partial' } | Remove-Item -Recurse -Force
}
function Get-Passphrase([switch]$New) {
  if ($env:CS_BACKUP_PASSPHRASE) { return $env:CS_BACKUP_PASSPHRASE }
  $f = Conf 'BACKUP_PASSPHRASE_FILE'
  if ($f) {
    if (-not (Test-Path -LiteralPath $f)) { Die "BACKUP_PASSPHRASE_FILE $f cannot be read" }
    return [string]([IO.File]::ReadAllLines($f) | Select-Object -First 1)
  }
  while ($true) {
    $p = Ask-Secret 'Backup passphrase (12 characters or more; the backup cannot be opened without it)'
    if ($New) {
      if ($p.Length -lt 12) { Say 'Too short.'; continue }
      $q = Ask-Secret 'Type it again'
      if ($p -cne $q) { Say 'They differ.'; continue }
    }
    return $p
  }
}
function With-Passphrase([string]$Pass, [scriptblock]$Body) { # the passphrase reaches the container as an environment variable only
  $old = $env:CS_BACKUP_PASSPHRASE
  $env:CS_BACKUP_PASSPHRASE = $Pass
  try { & $Body } finally { $env:CS_BACKUP_PASSPHRASE = $old }
}

# ------------------------------------------------------------------ copies: folder, server, bucket
function Dest-Label([string]$Kind) {
  switch ($Kind) {
    'folder' { $f = Conf 'BACKUP_FOLDER'; if ($f) { return "A folder or USB drive: $f" }; return 'A folder or USB drive' }
    'server' { $h = Conf 'BACKUP_SERVER_HOST'; if ($h) { return "Another server (SFTP): $(Conf 'BACKUP_SERVER_USER')@${h}:$(Conf 'BACKUP_SERVER_PATH')" }; return 'Another server (SFTP)' }
    'bucket' {
      $b = Conf 'BACKUP_BUCKET_NAME'; $e = Conf 'BACKUP_BUCKET_ENDPOINT'
      if (-not $e) { $e = 'Amazon S3' }
      if ($b) { return "A storage bucket (S3): $b/$(Conf 'BACKUP_BUCKET_PREFIX') at $e" }; return 'A storage bucket (S3)'
    }
  }
}
function Dest-Ready([string]$Kind) {
  switch ($Kind) {
    'folder' { return [bool](Conf 'BACKUP_FOLDER') }
    'server' { return ((Conf 'BACKUP_SERVER_HOST') -and (Conf 'BACKUP_SERVER_USER') -and (Conf 'BACKUP_SERVER_PATH')) }
    'bucket' { return ((Conf 'BACKUP_BUCKET_NAME') -and (Conf 'BACKUP_BUCKET_ACCESS_KEY_ID') -and (Conf 'BACKUP_BUCKET_SECRET_ACCESS_KEY')) }
  }
  return $false
}
function Remote-Target([string]$Kind) {
  if ($Kind -eq 'server') { return "dest:$(Conf 'BACKUP_SERVER_PATH')" }
  $p = Conf 'BACKUP_BUCKET_PREFIX'
  if ($p) { return "dest:$(Conf 'BACKUP_BUCKET_NAME')/$p" }
  return "dest:$(Conf 'BACKUP_BUCKET_NAME')"
}
function Get-HostKeyAlgos([string]$File) { # the key types in a known_hosts file, so the server is asked for one listed there
  $types = @()
  if (Test-Path -LiteralPath $File) {
    foreach ($l in [IO.File]::ReadAllLines($File)) {
      $p = @($l.Trim() -split '\s+')
      if ($p.Count -ge 3 -and -not $p[0].StartsWith('@')) { $types += $p[1] }
    }
  }
  $out = @()
  foreach ($t in @('ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa')) {
    if ($types -contains $t) { if ($t -eq 'ssh-rsa') { $out += @('rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa') } else { $out += $t } }
  }
  if (-not $out.Count) { $out = @('ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256') }
  return ($out -join ' ')
}
# Invoke-Rclone server|bucket DIR ro|rw RCLONE-ARGS: DIR is /data inside. The connection settings
# reach rclone as environment variables, never on the command line.
function Invoke-Rclone([string]$Kind, [string]$Mount, [string]$Mode, [string[]]$RcloneArgs, [switch]$Capture, [switch]$AllowFail) {
  $vars = [ordered]@{}
  $all = @('docker', 'run', '--rm', '-v', "${Mount}:/data:$Mode", '-e', 'RCLONE_CONFIG=/tmp/rclone.conf', '-e', 'XDG_CACHE_HOME=/tmp', '-e', 'RCLONE_LOG_LEVEL=ERROR')
  $net = Conf 'BACKUP_DOCKER_NETWORK'
  if ($net) { $all += @('--network', $net) }
  if ($Kind -eq 'server') {
    $vars['TYPE'] = 'sftp'; $vars['HOST'] = Conf 'BACKUP_SERVER_HOST'; $vars['USER'] = Conf 'BACKUP_SERVER_USER'
    $v = Conf 'BACKUP_SERVER_PORT'; if (-not $v) { $v = '22' }; $vars['PORT'] = $v
    $v = Conf 'BACKUP_SERVER_KEY_FILE'; if ($v) { $all += @('-v', "${v}:/run/cs/key:ro"); $vars['KEY_FILE'] = '/run/cs/key' }
    $v = Conf 'BACKUP_SERVER_PASSWORD'; if ($v) { $vars['PASS'] = $v }
    $v = Conf 'BACKUP_SERVER_KNOWN_HOSTS'
    if ($v) { $all += @('-v', "${v}:/run/cs/known_hosts:ro"); $vars['KNOWN_HOSTS_FILE'] = '/run/cs/known_hosts'; $vars['HOST_KEY_ALGORITHMS'] = Get-HostKeyAlgos $v }
  } else {
    $e = Conf 'BACKUP_BUCKET_ENDPOINT'
    $vars['TYPE'] = 's3'; $vars['NO_CHECK_BUCKET'] = 'true'
    if ($e) { $vars['PROVIDER'] = 'Other'; $vars['ENDPOINT'] = $e } else { $vars['PROVIDER'] = 'AWS' }
    $r = Conf 'BACKUP_BUCKET_REGION'; if ($r) { $vars['REGION'] = $r }
    $vars['ACCESS_KEY_ID'] = Conf 'BACKUP_BUCKET_ACCESS_KEY_ID'; $vars['SECRET_ACCESS_KEY'] = Conf 'BACKUP_BUCKET_SECRET_ACCESS_KEY'
  }
  foreach ($k in @($vars.Keys)) { Set-Item -Path "env:RCLONE_CONFIG_DEST_$k" -Value $vars[$k]; $all += @('-e', "RCLONE_CONFIG_DEST_$k") }
  try {
    $all += @($RcloneImage) + $RcloneArgs
    if ($Capture) { return , (Native $all -Capture -AllowFail:$AllowFail) }
    Native $all -AllowFail:$AllowFail
  } finally { foreach ($k in @($vars.Keys)) { Remove-Item -Path "env:RCLONE_CONFIG_DEST_$k" -ErrorAction SilentlyContinue } }
}
function New-ScratchDir {
  $d = Join-Path ([IO.Path]::GetTempPath()) ('cs-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $d | Out-Null
  $script:Cleanup.Add($d)
  return $d
}
function Setup-Dest([string]$Kind) { # asks for one destination's settings, tests it and saves them; $true when it works
  switch ($Kind) {
    'folder' {
      $v = Ask 'Folder for the copies (an external drive, a network share)' (Conf 'BACKUP_FOLDER')
      if (-not $v) { Die 'no folder given' }
      if (-not (Test-Path -LiteralPath $v)) { New-Item -ItemType Directory -Path $v -Force | Out-Null }
      Save 'BACKUP_FOLDER' (Resolve-Path -LiteralPath $v).ProviderPath
      return $true
    }
    'server' {
      Save 'BACKUP_SERVER_HOST' (Ask 'Server name or address' (Conf 'BACKUP_SERVER_HOST'))
      $v = Conf 'BACKUP_SERVER_PORT'; if (-not $v) { $v = '22' }
      Save 'BACKUP_SERVER_PORT' (Ask 'SSH port' $v)
      Save 'BACKUP_SERVER_USER' (Ask 'User on that server' (Conf 'BACKUP_SERVER_USER'))
      Save 'BACKUP_SERVER_PATH' (Ask 'Folder on that server (it is created)' (Conf 'BACKUP_SERVER_PATH'))
      $k = Conf 'BACKUP_SERVER_KEY_FILE'
      $ssh = Join-Path $HOME '.ssh'
      if (-not $k -and (Test-Path (Join-Path $ssh 'id_ed25519'))) { $k = Join-Path $ssh 'id_ed25519' }
      if (-not $k -and (Test-Path (Join-Path $ssh 'id_rsa'))) { $k = Join-Path $ssh 'id_rsa' }
      if (-not $k) { $k = 'none' }
      $v = Ask 'SSH key file (none: use a password instead)' $k
      if ($v -and $v -ne 'none') {
        if (-not (Test-Path -LiteralPath $v)) { Die "cannot read $v" }
        Save 'BACKUP_SERVER_KEY_FILE' $v; Save 'BACKUP_SERVER_PASSWORD' ''
      } else {
        $env:CS_OBSCURE = Ask-Secret 'Password for that user'
        try { $o = Native @('docker', 'run', '--rm', '-e', 'CS_OBSCURE', '--entrypoint', 'sh', $RcloneImage, '-c', 'printenv CS_OBSCURE | rclone obscure -') -Capture }
        finally { Remove-Item env:CS_OBSCURE -ErrorAction SilentlyContinue }
        Save 'BACKUP_SERVER_PASSWORD' ([string]($o | Select-Object -First 1)).Trim(); Save 'BACKUP_SERVER_KEY_FILE' ''
      }
      $k = Conf 'BACKUP_SERVER_KNOWN_HOSTS'
      if (-not $k -and (Test-Path (Join-Path $ssh 'known_hosts'))) { $k = Join-Path $ssh 'known_hosts' }
      if (-not $k) { $k = 'none' }
      $v = Ask 'known_hosts file to check the server''s identity (none: not checked)' $k
      if ($v -eq 'none') { $v = '' }
      if (-not $v) { Warn 'the server''s identity will not be checked: connect once with ssh first, then give your known_hosts file' }
      Save 'BACKUP_SERVER_KNOWN_HOSTS' $v
    }
    'bucket' {
      Say 'Endpoint examples: empty for Amazon S3; s3.eu-central-003.backblazeb2.com (Backblaze B2);'
      Say '<account>.r2.cloudflarestorage.com (Cloudflare R2); s3.eu-central-1.wasabisys.com (Wasabi).'
      Save 'BACKUP_BUCKET_ENDPOINT' (Ask 'Endpoint (https://... or a host name; empty for Amazon S3)' (Conf 'BACKUP_BUCKET_ENDPOINT'))
      Save 'BACKUP_BUCKET_REGION' (Ask 'Region (e.g. eu-central-1; may be empty for other providers)' (Conf 'BACKUP_BUCKET_REGION'))
      Save 'BACKUP_BUCKET_NAME' (Ask 'Bucket name' (Conf 'BACKUP_BUCKET_NAME'))
      $v = Conf 'BACKUP_BUCKET_PREFIX'; if (-not $v) { $v = 'curriculum-scope' }
      Save 'BACKUP_BUCKET_PREFIX' (Ask 'Folder inside the bucket' $v)
      Save 'BACKUP_BUCKET_ACCESS_KEY_ID' (Ask 'Access key ID' (Conf 'BACKUP_BUCKET_ACCESS_KEY_ID'))
      $v = Ask-Secret 'Secret access key (Enter keeps the saved one)'
      if ($v) { Save 'BACKUP_BUCKET_SECRET_ACCESS_KEY' $v }
    }
  }
  Say 'Checking the connection...'
  $t = New-ScratchDir
  Invoke-Rclone $Kind $t 'ro' @('mkdir', (Remote-Target $Kind)) -AllowFail
  if ($script:Code -eq 0) { [void](Invoke-Rclone $Kind $t 'ro' @('lsf', (Remote-Target $Kind), '--max-depth', '1') -Capture -AllowFail) }
  if ($script:Code -eq 0) { Say 'Connected.'; return $true }
  Warn "could not reach $(Dest-Label $Kind); check the settings (saved in .env.backup)"
  return $false
}
function Setup-Passfile { # scheduled backups read the passphrase from a file that only you can read
  $f = Conf 'BACKUP_PASSPHRASE_FILE'
  if (-not $f) { $f = Join-Path $HOME '.curriculum-scope-backup-passphrase' }
  $f = Ask 'File holding the passphrase, for scheduled backups (empty: always ask)' $f
  if (-not $f) { Save 'BACKUP_PASSPHRASE_FILE' ''; return }
  if (-not (Test-Path -LiteralPath $f) -or (Get-Item -LiteralPath $f).Length -eq 0) {
    $p = Ask-Secret "Passphrase to keep in $f (12 characters or more)"
    if ($p.Length -lt 12) { Warn 'too short; nothing saved'; return }
    $q = Ask-Secret 'Type it again'
    if ($p -cne $q) { Warn 'they differ; nothing saved'; return }
    $parent = Split-Path -Parent $f
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($f, "$p`n")
  }
  Protect-Path $f
  Save 'BACKUP_PASSPHRASE_FILE' $f
  Say 'Saved. Keep a copy of the passphrase away from this computer too: the backups cannot be opened without it.'
}
function Cmd-Destinations {
  while ($true) {
    $f = Conf 'BACKUP_PASSPHRASE_FILE'
    $pf = 'Passphrase file for scheduled backups'
    if ($f) { $pf = "${pf}: $f" }
    $c = Choose 'Set up which backup copy? (saved in .env.backup, readable by you only)' 5 @((Dest-Label 'folder'), (Dest-Label 'server'), (Dest-Label 'bucket'), $pf, 'Done')
    switch ($c) {
      1 { [void](Setup-Dest 'folder') }
      2 { [void](Setup-Dest 'server') }
      3 { [void](Setup-Dest 'bucket') }
      4 { Setup-Passfile }
      default { return }
    }
  }
}
function Pick-Copies { # sets $script:Copies (folder, server, bucket)
  $saved = Conf 'BACKUP_COPY_TO'
  if ($script:To) { $list = $script:To }
  elseif ($script:Yes) { $list = $saved }
  else {
    Say 'Copy this backup to (it is always kept in the backup folder too):'
    $kinds = @('folder', 'server', 'bucket')
    for ($k = 0; $k -lt 3; $k++) {
      $note = ''
      if (-not (Dest-Ready $kinds[$k])) { $note = ' (not set up yet)' }
      Say ('  {0}) {1}{2}' -f ($k + 1), (Dest-Label $kinds[$k]), $note)
    }
    $def = $saved -replace 'folder', '1' -replace 'server', '2' -replace 'bucket', '3'
    $ans = Ask 'Numbers separated by commas, or 0 for none' $def
    $names = @()
    foreach ($n in ($ans -split '[,\s]+' | Where-Object { $_ })) {
      switch ($n) { '1' { $names += 'folder' } '2' { $names += 'server' } '3' { $names += 'bucket' } '0' { } default { $names += $n } }
    }
    $list = $names -join ','
    if ($list -ne $saved -and (Confirm-Yes 'Use this choice by default next time?' 'y')) { Save 'BACKUP_COPY_TO' $list }
  }
  $script:Copies = @()
  foreach ($d in ($list -split '[,\s]+' | Where-Object { $_ })) {
    if ($d -eq 'none') { continue }
    if (@('folder', 'server', 'bucket') -notcontains $d) { Die "unknown copy target $d (folder, server, bucket)" }
    if (-not (Dest-Ready $d)) {
      if ($script:Yes) { Die "$d copies are not set up: run ops\cs.bat destinations" }
      if (-not (Setup-Dest $d)) { Die "could not set up $d" }
    }
    $script:Copies += $d
  }
}
function Copy-Out([string]$Kind, [string]$Dir, [string]$Name) { # copies the archive and its .sha256; $true when it arrived intact
  if ($Kind -eq 'folder') {
    $t = Conf 'BACKUP_FOLDER'
    try {
      if (-not (Test-Path -LiteralPath $t)) { New-Item -ItemType Directory -Path $t -Force | Out-Null }
      Copy-Item -LiteralPath (Join-Path $Dir $Name), (Join-Path $Dir "$Name.sha256") -Destination $t -Force
      return (Test-Sha256 (Join-Path $t $Name))
    } catch { Warn $_.Exception.Message; return $false }
  }
  Invoke-Rclone $Kind $Dir 'ro' @('copy', '/data', (Remote-Target $Kind), '--include', $Name, '--include', "$Name.sha256", '--retries', '3') -AllowFail
  return ($script:Code -eq 0)
}
function Prune([string]$Kind, [string]$Dir, [int]$Days) { # removes backups older than DAYS there
  if ($Days -le 0) { return }
  if ($Kind -eq 'local' -or $Kind -eq 'folder') {
    $where = $Dir
    if ($Kind -eq 'folder') { $where = Conf 'BACKUP_FOLDER' }
    $cut = (Get-Date).AddDays(-$Days)
    Get-ChildItem -LiteralPath $where -File -Filter 'cs-backup-*' | Where-Object { $_.LastWriteTime -lt $cut } | ForEach-Object { Say $_.FullName; Remove-Item -LiteralPath $_.FullName -Force }
    return
  }
  Invoke-Rclone $Kind $Dir 'ro' @('delete', (Remote-Target $Kind), '--min-age', "${Days}d", '--include', 'cs-backup-*') -AllowFail
  if ($script:Code -ne 0) { Warn "could not clean up old backups in $Kind" }
}

# ------------------------------------------------------------------ backup
function Test-Pgdmp([string]$Path) {
  $fs = [IO.File]::OpenRead($Path)
  try { $b = New-Object byte[] 5; $n = $fs.Read($b, 0, 5); return ($n -eq 5 -and [Text.Encoding]::ASCII.GetString($b) -eq 'PGDMP') } finally { $fs.Dispose() }
}
function Get-Verify([string]$Db, [string]$User) { # ops/verify.sql on a database of the bundled server
  DC @('cp', (Join-Path $Root 'ops/verify.sql'), 'postgres:/tmp/cs-verify.sql') -Quiet
  return , (DC @('exec', '-T', '-e', "CS_DB=$Db", '-e', "CS_USER=$User", 'postgres', 'sh', '-c', 'psql -U $CS_USER -d $CS_DB -v ON_ERROR_STOP=1 -At -F ''|'' -f /tmp/cs-verify.sql') -Capture -AllowFail)
}
function Cmd-Backup {
  Pick-Env
  $dir = Get-BackupDir
  Lock-Dir $dir
  $ts = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
  $name = "cs-backup-$($script:EnvName)-$ts"
  $work = Join-Path $dir ".work-$ts"
  New-Item -ItemType Directory -Path $work | Out-Null
  $script:Cleanup.Add($work); $script:Cleanup.Add((Join-Path $dir "$name.tar.partial")); $script:Cleanup.Add((Join-Path $dir "$name.tar.enc.partial"))

  # Choices: saved defaults, asked unless --yes.
  $settings = Confirm-Yes "Include the settings file ($($script:EnvFile): passwords and keys)? Needed to rebuild a lost server" (YN ((Conf 'BACKUP_INCLUDE_SETTINGS') -eq 'yes'))
  $enc = -not ((Conf 'BACKUP_ENCRYPT') -eq 'no' -or $script:NoEncrypt)
  if ($settings) { $enc = $true; Say 'The archive is encrypted, as it holds the settings file.' }
  else { $enc = Confirm-Yes 'Encrypt the archive with a passphrase (recommended: it holds students'' data)?' (YN $enc) }
  $certs = $false
  if ($script:EnvName -eq 'prod') { $certs = Confirm-Yes 'Include the TLS certificates (Caddy)?' (YN ((Conf 'BACKUP_INCLUDE_CERTIFICATES') -ne 'no')) }
  Pick-Copies
  $keep = Conf 'BACKUP_KEEP_DAYS'
  if (-not $script:Yes) {
    if (-not $keep) { $keep = '30' }
    $keep = Ask 'Delete backups older than how many days, here and in the copies (0 = keep all)' $keep
    Save 'BACKUP_INCLUDE_SETTINGS' $(if ($settings) { 'yes' } else { 'no' }); Save 'BACKUP_ENCRYPT' $(if ($enc) { 'yes' } else { 'no' }); Save 'BACKUP_KEEP_DAYS' $keep
    if ($script:EnvName -eq 'prod') { Save 'BACKUP_INCLUDE_CERTIFICATES' $(if ($certs) { 'yes' } else { 'no' }) }
  }
  $pass = ''
  if ($enc) { $pass = Get-Passphrase -New; Ensure-Image }

  Step 'Database'
  $db = Get-DbName
  $bk = EnvGet 'DB_BACKUP_USER'
  if (-not $bk) { $bk = 'curriculum_backup' }
  if ($script:Managed) {
    if (-not (EnvGet 'BACKUP_DATABASE_URL')) { Die "set BACKUP_DATABASE_URL in $($script:EnvFile) (the read-only backup role of the managed database)" }
    $env:CS_URL = EnvGet 'BACKUP_DATABASE_URL'
    try {
      Pg-Tool @('-e', 'CS_URL', '-v', "${work}:/w") @('sh', '-c', 'set -f; pg_dump --format=custom --compress=6 -f /w/database.dump $CS_URL')
      $live = Pg-Tool @('-e', 'CS_URL', '-v', "$(Join-Path $Root 'ops'):/ops:ro") @('sh', '-c', 'set -f; psql $CS_URL -v ON_ERROR_STOP=1 -At -F ''|'' -f /ops/verify.sql') -Capture
    } finally { Remove-Item env:CS_URL -ErrorAction SilentlyContinue }
  } else {
    if (-not (Test-Running 'postgres')) { Die 'the database is not running: start the installation first (ops\start.bat)' }
    DC @('exec', '-T', '-e', "CS_DB=$db", '-e', "CS_USER=$bk", 'postgres', 'sh', '-c', 'pg_dump -U $CS_USER -d $CS_DB --format=custom --compress=6 -f /tmp/cs-backup.dump')
    DC @('cp', 'postgres:/tmp/cs-backup.dump', (Join-Path $work 'database.dump')) -Quiet
    DC @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/cs-backup.dump') -Quiet -AllowFail
    $live = Get-Verify $db $bk
    if ($script:Code -ne 0) { Die 'the check of the live database failed (ops/verify.sql)' }
  }
  Write-Lines (Join-Path $work 'verify-live.txt') $live
  if (-not (Test-Pgdmp (Join-Path $work 'database.dump'))) { Die 'the database dump is not valid' }
  $mig = (@($live | Where-Object { $_.StartsWith('migrations|') })[0] -split '\|')[1]
  Say "  $(Size (Join-Path $work 'database.dump')), $(@($live | Where-Object { $_.StartsWith('rows|') }).Count) tables, migrations $mig"

  if ($settings) {
    Step 'Settings file'
    Copy-Item -LiteralPath $script:EnvFile -Destination (Join-Path $work 'settings.env')
  }
  if ($certs) {
    Step 'TLS certificates'
    $vol = "$($script:Project)_caddy_data"
    Native @('docker', 'volume', 'inspect', $vol) -Quiet -AllowFail
    if ($script:Code -eq 0) { Native @('docker', 'run', '--rm', '-v', "${vol}:/data:ro", '-v', "${work}:/w", $ToolImage, 'tar', '-czf', '/w/caddy-data.tar.gz', '-C', '/data', '.') -Quiet }
    else { Warn "no certificate volume ($vol) yet: skipped"; $certs = $false }
  }

  $commit = 'unknown'
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $g = Native @('git', '-C', $Root, 'rev-parse', '--short', 'HEAD') -Capture -AllowFail
    if ($script:Code -eq 0 -and $g.Count) { $commit = $g[0] }
  }
  $imageId = 'unknown'
  $g = Native @('docker', 'image', 'inspect', '-f', '{{.Id}}', $script:Image) -Capture -AllowFail
  if ($script:Code -eq 0 -and $g.Count -and $g[0].Length -ge 19) { $imageId = $g[0].Substring(7, 12) }
  $includes = 'database'
  if ($settings) { $includes += ',settings' }
  if ($certs) { $includes += ',certificates' }
  $m = New-Object System.Collections.Generic.List[string]
  $m.Add('format=cs-backup-1')
  $m.Add('created=' + (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"))
  $m.Add("environment=$($script:EnvName)")
  $m.Add("project=$($script:Project)")
  $m.Add('database=' + $(if ($script:Managed) { 'managed' } else { 'bundled' }))
  $m.Add("db_name=$db")
  $m.Add("app_commit=$commit")
  $m.Add("app_image=$imageId")
  $m.Add("includes=$includes")
  foreach ($f in (Get-ChildItem -LiteralPath $work -File | Sort-Object Name)) { $m.Add("sha256.$($f.Name)=$(Sha256 $f.FullName)") }
  Write-Lines (Join-Path $work 'manifest.txt') $m

  Step 'Archive'
  Native (@('docker', 'run', '--rm') + (Tool-User) + @('-v', "${dir}:/b", $ToolImage, 'tar', '-C', "/b/.work-$ts", '-cf', "/b/$name.tar.partial", '.')) -Quiet
  if ($enc) {
    $image = $script:Image
    With-Passphrase $pass {
      Native (@('docker', 'run', '--rm') + (Tool-User) + @('-e', 'CS_BACKUP_PASSPHRASE', '-v', "${dir}:/b", $image, 'sh', '-c', "node dist/cli/backup-crypt.js encrypt < /b/$name.tar.partial > /b/$name.tar.enc.partial"))
    }
    Move-Item -LiteralPath (Join-Path $dir "$name.tar.enc.partial") -Destination (Join-Path $dir "$name.tar.enc") -Force
    Remove-Item -LiteralPath (Join-Path $dir "$name.tar.partial") -Force
    $final = "$name.tar.enc"
  } else {
    Move-Item -LiteralPath (Join-Path $dir "$name.tar.partial") -Destination (Join-Path $dir "$name.tar") -Force
    $final = "$name.tar"
  }
  Protect-Path (Join-Path $dir $final)
  Write-Sha256 (Join-Path $dir $final)
  Protect-Path (Join-Path $dir "$final.sha256")
  Remove-Item -LiteralPath $work -Recurse -Force
  $note = ''
  if ($enc) { $note = ', encrypted' }
  Say "  $(Join-Path $dir $final) ($(Size (Join-Path $dir $final))$note)"

  foreach ($d in $script:Copies) {
    Step "Copy: $(Dest-Label $d)"
    if (Copy-Out $d $dir $final) { Say '  copied' } else { Warn "the copy to $d failed"; $script:Failed += $d }
  }

  $days = 0
  if ([int]::TryParse([string]$keep, [ref]$days) -and $days -gt 0) {
    Step "Removing backups older than $days days"
    Prune 'local' $dir $days
    foreach ($d in $script:Copies) { if ($script:Failed -notcontains $d) { Prune $d $dir $days } } # not where this backup did not arrive
  }

  Step 'Done'
  Say "Backup: $(Join-Path $dir $final)"
  if ($enc) { Say 'Keep the passphrase somewhere safe, apart from the backups: without it the backup cannot be opened.' }
  if (-not $settings) { Say "The settings file is not in this backup: keep a copy of $($script:EnvFile) (above all DATA_ENCRYPTION_KEY) in a password manager." }
  if ($script:Failed.Count) { Die "copies failed: $($script:Failed -join ' ') (the backup itself is in $dir)" }
}

# ------------------------------------------------------------------ restore and test
function Get-BackupList([string]$Source, [string]$Dir, [string]$Scratch) { # archive names, newest first
  if ($Source -eq 'local' -or $Source -eq 'folder') {
    $where = $Dir
    if ($Source -eq 'folder') { $where = Conf 'BACKUP_FOLDER' }
    if (-not (Test-Path -LiteralPath $where)) { return , @() }
    return , @(Get-ChildItem -LiteralPath $where -File | Where-Object { $_.Name -match '^cs-backup-.*\.tar(\.enc)?$' } | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.Name })
  }
  $l = Invoke-Rclone $Source $Scratch 'ro' @('lsf', (Remote-Target $Source), '--files-only', '--format', 'tp', '--separator', '|', '--include', 'cs-backup-*.tar', '--include', 'cs-backup-*.tar.enc') -Capture
  return , @($l | Where-Object { $_ } | Sort-Object -Descending | ForEach-Object { ($_ -split '\|', 2)[1] })
}
function Fetch-Backup([string]$Source, [string]$Dir, [string]$Name, [string]$Staging) { # the local path of the archive
  switch ($Source) {
    'local' { return (Join-Path $Dir $Name) }
    'folder' {
      $f = Conf 'BACKUP_FOLDER'
      Copy-Item -LiteralPath (Join-Path $f $Name) -Destination $Staging
      if (Test-Path -LiteralPath (Join-Path $f "$Name.sha256")) { Copy-Item -LiteralPath (Join-Path $f "$Name.sha256") -Destination $Staging }
      return (Join-Path $Staging $Name)
    }
    default {
      Invoke-Rclone $Source $Staging 'rw' @('copy', (Remote-Target $Source), '/data', '--include', $Name, '--include', "$Name.sha256")
      return (Join-Path $Staging $Name)
    }
  }
}
$RestoreBundled = @'
set -e
trap 'rm -f /tmp/cs-restore.dump' EXIT
createdb -U $POSTGRES_USER -O $OWNER $NEW_DB
psql -U $POSTGRES_USER -d postgres -v ON_ERROR_STOP=1 -q <<SQL
REVOKE ALL ON DATABASE $NEW_DB FROM PUBLIC;
GRANT CONNECT ON DATABASE $NEW_DB TO $APPR, $BK;
SQL
pg_restore -U $POSTGRES_USER --exit-on-error -d $NEW_DB /tmp/cs-restore.dump || { dropdb -U $POSTGRES_USER $NEW_DB; exit 1; }
'@
$RestoreManaged = @'
set -ef
createdb --maintenance-db=$CS_ADMIN -O $OWNER $NEW_DB
psql $CS_ADMIN -v ON_ERROR_STOP=1 -q <<SQL
REVOKE ALL ON DATABASE $NEW_DB FROM PUBLIC;
GRANT CONNECT ON DATABASE $NEW_DB TO $APPR, $BK;
SQL
pg_restore --exit-on-error --no-owner --role=$OWNER -d $CS_TARGET /r/$DUMP || { dropdb --maintenance-db=$CS_ADMIN $NEW_DB; exit 1; }
'@
function Restore-Db([string]$Dump, [string]$New) { # creates NEW and restores DUMP into it (bundled or managed)
  $owner = EnvGet 'DB_OWNER_USER'; if (-not $owner) { $owner = 'curriculum_owner' }
  $app = EnvGet 'DB_APP_USER'; if (-not $app) { $app = 'curriculum_app' }
  $bk = EnvGet 'DB_BACKUP_USER'; if (-not $bk) { $bk = 'curriculum_backup' }
  if ($New -notmatch '^[a-z_][a-z0-9_]{0,62}$') { Die "invalid database name $New" }
  $roles = @('-e', "NEW_DB=$New", '-e', "OWNER=$owner", '-e', "APPR=$app", '-e', "BK=$bk")
  if ($script:Managed) {
    if (-not $script:RestoreUrl) { Die 'no administrator connection for the managed database' }
    $env:CS_ADMIN = $script:RestoreUrl
    $env:CS_TARGET = Url-WithDb $script:RestoreUrl $New
    try { Pg-Tool (@('-e', 'CS_ADMIN', '-e', 'CS_TARGET', '-e', "DUMP=$(Split-Path -Leaf $Dump)", '-v', "$(Split-Path -Parent $Dump):/r:ro") + $roles) @('sh', '-c', (Clean-Script $RestoreManaged)) }
    finally { Remove-Item env:CS_ADMIN, env:CS_TARGET -ErrorAction SilentlyContinue }
  } else {
    if (-not (Test-Running 'postgres')) { Say 'Starting the database...'; DC @('up', '-d', 'postgres') }
    Wait-Postgres
    DC @('cp', $Dump, 'postgres:/tmp/cs-restore.dump') -Quiet
    DC (@('exec', '-T') + $roles + @('postgres', 'sh', '-c', (Clean-Script $RestoreBundled)))
  }
}
function Verify-Db([string]$Db, [string]$Expected, [string]$Out) { # ops/verify.sql on DB, compared with the backup's; $true when it matches
  if ($script:Managed) { # as the backup role: the one role that reads every row despite row-level security
    $env:CS_URL = Url-WithDb (EnvGet 'BACKUP_DATABASE_URL') $Db
    try { $lines = Pg-Tool @('-e', 'CS_URL', '-v', "$(Join-Path $Root 'ops'):/ops:ro") @('sh', '-c', 'set -f; psql $CS_URL -v ON_ERROR_STOP=1 -At -F ''|'' -f /ops/verify.sql') -Capture -AllowFail }
    finally { Remove-Item env:CS_URL -ErrorAction SilentlyContinue }
  } else {
    DC @('cp', (Join-Path $Root 'ops/verify.sql'), 'postgres:/tmp/cs-verify.sql') -Quiet
    $lines = DC @('exec', '-T', '-e', "CS_DB=$Db", 'postgres', 'sh', '-c', 'psql -U $POSTGRES_USER -d $CS_DB -v ON_ERROR_STOP=1 -At -F ''|'' -f /tmp/cs-verify.sql') -Capture -AllowFail
  }
  if ($script:Code -ne 0) { Warn 'the check of the restored database failed (ops/verify.sql)'; return $false }
  Write-Lines $Out $lines
  $exp = [IO.File]::ReadAllLines($Expected)
  foreach ($k in @('migrations', 'forced_rls_tables')) {
    $a = (@($exp | Where-Object { $_.StartsWith("$k|") }) -join '')
    $b = (@($lines | Where-Object { $_.StartsWith("$k|") }) -join '')
    if ($a -ne $b) { Warn "the restored database differs from the backup: $k is `"$b`", expected `"$a`""; return $false }
  }
  $rows = @($lines | Where-Object { $_.StartsWith('rows|') })
  $mig = (@($lines | Where-Object { $_.StartsWith('migrations|') })[0] -split '\|')[1]
  $rls = (@($lines | Where-Object { $_.StartsWith('forced_rls_tables|') })[0] -split '\|')[1]
  Say "  $mig migrations, row-level security forced on $rls tables, $($rows.Count) tables"
  $before = @{}
  foreach ($l in $exp) { if ($l.StartsWith('rows|')) { $p = $l -split '\|'; $before[$p[1]] = $p[2] } }
  $diff = @()
  foreach ($l in $rows) { $p = $l -split '\|'; if ($before.ContainsKey($p[1]) -and $before[$p[1]] -ne $p[2]) { $diff += "    $($p[1]): $($before[$p[1]]) in the backup check, $($p[2]) restored" } }
  if ($diff.Count) { Say '  Row counts that differ from the check made while the backup ran (it was taken while the app was running):'; $diff | ForEach-Object { Say $_ } }
  else { Say "  Row counts: all $($rows.Count) tables match the backup." }
  return $true
}
function Drop-Db([string]$Db) {
  if ($script:Managed) {
    $env:CS_ADMIN = $script:RestoreUrl
    try { Pg-Tool @('-e', 'CS_ADMIN', '-e', "DB=$Db") @('sh', '-c', 'set -f; dropdb --if-exists --maintenance-db=$CS_ADMIN $DB') -AllowFail }
    finally { Remove-Item env:CS_ADMIN -ErrorAction SilentlyContinue }
  } else { DC @('exec', '-T', '-e', "DB=$Db", 'postgres', 'sh', '-c', 'dropdb -U $POSTGRES_USER --if-exists $DB') -AllowFail }
}
function Base-Db([string]$Name) { # the database name without a suffix added by an earlier restore or test
  if ($Name -match '^(.+)_(r|check_)[0-9]{14}$') { return $Matches[1] }
  return $Name
}
function Cmd-Restore {
  Pick-Env -MissingOk
  $dir = Get-BackupDir
  Lock-Dir $dir
  $ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  $staging = Join-Path $dir ".restore-$ts"
  New-Item -ItemType Directory -Path $staging | Out-Null
  $script:Cleanup.Add($staging)
  $putBack = $false

  if ($script:From) { $src = $script:From }
  else {
    $c = Choose 'Restore from where?' 1 @("This computer's backup folder ($dir)", (Dest-Label 'folder'), (Dest-Label 'server'), (Dest-Label 'bucket'))
    $src = @('local', 'folder', 'server', 'bucket')[$c - 1]
  }
  if (@('local', 'folder', 'server', 'bucket') -notcontains $src) { Die '--from must be local, folder, server or bucket' }
  if ($src -ne 'local' -and -not (Dest-Ready $src)) { if (-not (Setup-Dest $src)) { Die "could not set up $src" } }

  $list = Get-BackupList $src $dir $staging
  if (-not $list.Count) { Die 'no backups found there' }
  if ($script:Pick) {
    $name = $script:Pick
    if ($list -notcontains $name) { Die "$name is not there" }
  } else {
    $n = [math]::Min($list.Count, 15)
    $c = Choose 'Which backup? (newest first)' 1 @($list[0..($n - 1)])
    $name = $list[$c - 1]
  }

  Step "Fetching $name"
  $archive = Fetch-Backup $src $dir $name $staging
  if (Test-Path -LiteralPath "$archive.sha256") {
    if (-not (Test-Sha256 $archive)) { Die "the checksum of $name does not match: the file is damaged" }
    Say '  checksum matches'
  } else { Warn "no checksum file next to ${name}: not checked" }
  $x = Join-Path $staging 'x'
  New-Item -ItemType Directory -Path $x | Out-Null
  if ($name.EndsWith('.enc')) {
    Ensure-Image
    $pass = Get-Passphrase
    $image = $script:Image
    $inDir = Split-Path -Parent $archive
    With-Passphrase $pass {
      Native (@('docker', 'run', '--rm') + (Tool-User) + @('-e', 'CS_BACKUP_PASSPHRASE', '-v', "${inDir}:/in:ro", '-v', "${staging}:/out", $image, 'sh', '-c', "node dist/cli/backup-crypt.js decrypt < /in/$name > /out/backup.tar")) -AllowFail
    }
    if ($script:Code -ne 0) { Die "could not decrypt $name (wrong passphrase, or a damaged file)" }
    $archive = Join-Path $staging 'backup.tar'
    Say '  decrypted'
  }
  Native (@('docker', 'run', '--rm') + (Tool-User) + @('-v', "$(Split-Path -Parent $archive):/in:ro", '-v', "${x}:/x", $ToolImage, 'tar', '-C', '/x', '-xf', "/in/$(Split-Path -Leaf $archive)")) -Quiet -AllowFail
  if ($script:Code -ne 0) { Die "$name could not be unpacked" }
  $manifest = Join-Path $x 'manifest.txt'
  if ((Get-KV $manifest 'format') -ne 'cs-backup-1' -or -not (Test-Path -LiteralPath (Join-Path $x 'database.dump'))) { Die "$name is not a Curriculum Scope backup" }
  foreach ($f in @('database.dump', 'settings.env', 'caddy-data.tar.gz', 'verify-live.txt')) {
    $p = Join-Path $x $f
    if ((Test-Path -LiteralPath $p) -and (Sha256 $p) -ne (Get-KV $manifest "sha256.$f")) { Die "$f inside the backup does not match its checksum" }
  }
  Say "  Made $(Get-KV $manifest 'created') on the $(Get-KV $manifest 'environment') installation, app version $(Get-KV $manifest 'app_commit'); contains $(Get-KV $manifest 'includes')"
  $verifyOnly = ($script:Cmd -eq 'verify' -or $script:OnlyVerify)

  if ($script:NoEnv) {
    if (-not (Test-Path -LiteralPath (Join-Path $x 'settings.env'))) { Die "$($script:EnvFile) not found and this backup has no settings file: create $($script:EnvFile) first (the same DATA_ENCRYPTION_KEY as before; docs/DEPLOYMENT_GUIDE.md section 8)" }
    if ($verifyOnly) { Die "$($script:EnvFile) not found: restore the backup (not only test it) to put its settings file back" }
    Say "  $($script:EnvFile) is missing here: the settings file from the backup is put back."
    Copy-Item -LiteralPath (Join-Path $x 'settings.env') -Destination $script:EnvFile
    Protect-Path $script:EnvFile
    $putBack = $true
    Pick-Env
  }

  if ($script:Managed) {
    if (-not (EnvGet 'BACKUP_DATABASE_URL')) { Die "set BACKUP_DATABASE_URL in $($script:EnvFile) (the backup role checks the restored database)" }
    $script:RestoreUrl = EnvGet 'RESTORE_ADMIN_URL'
    if (-not $script:RestoreUrl) { $script:RestoreUrl = Ask-Secret 'Administrator connection to the managed database server (postgres://admin:...@host:5432/postgres)' }
  }

  if ($verifyOnly) {
    Step 'Testing the backup in a scratch database (nothing else changes)'
    $base = Base-Db (Get-DbName)
    if (-not $base) { $base = 'cs' }
    $newdb = "${base}_check_$ts"
    Restore-Db (Join-Path $x 'database.dump') $newdb
    $ok = Verify-Db $newdb (Join-Path $x 'verify-live.txt') (Join-Path $staging 'verify-restored.txt')
    Drop-Db $newdb
    if (-not $ok) { Die 'the backup does not match its check (see above)' }
    Say "The backup can be restored. (The scratch database $newdb was removed.)"
    return
  }

  # 1. Settings: before the database, so passwords and keys match the data.
  if (-not $putBack -and (Test-Path -LiteralPath (Join-Path $x 'settings.env'))) {
    if (Confirm-Yes "Restore the settings file over $($script:EnvFile)? (the current one is kept as $($script:EnvFile).before-restore-$ts)" 'n') {
      Copy-Item -LiteralPath $script:EnvFile -Destination "$($script:EnvFile).before-restore-$ts"
      Protect-Path "$($script:EnvFile).before-restore-$ts"
      Copy-Item -LiteralPath (Join-Path $x 'settings.env') -Destination $script:EnvFile -Force
      Protect-Path $script:EnvFile
      Pick-Env
      Say '  settings restored'
    }
  }

  # 2. Database: into a new database; the current one is kept.
  $olddb = Get-DbName
  $newdb = "$(Base-Db $olddb)_r$ts"
  Step "Restoring the database into a new database, $newdb ($olddb is not touched)"
  if (-not (Confirm-Yes 'Go ahead?' 'y')) { Die 'stopped; nothing changed' }
  Restore-Db (Join-Path $x 'database.dump') $newdb
  if (-not (Verify-Db $newdb (Join-Path $x 'verify-live.txt') (Join-Path $staging 'verify-restored.txt'))) { Drop-Db $newdb; Die 'nothing changed: the restored copy was removed' }

  # 3. Certificates.
  if ((Test-Path -LiteralPath (Join-Path $x 'caddy-data.tar.gz')) -and $script:EnvName -eq 'prod') {
    $vol = "$($script:Project)_caddy_data"
    Native @('docker', 'volume', 'inspect', $vol) -Quiet -AllowFail
    $fresh = ($script:Code -ne 0)
    if (Confirm-Yes 'Restore the TLS certificates too?' (YN $fresh)) {
      DC @('stop', 'caddy') -Quiet -AllowFail
      if ($fresh) { # made by Compose, so it recognises the volume later
        DC @('up', '--no-start', '--no-deps', 'caddy') -Quiet -AllowFail
        Native @('docker', 'volume', 'inspect', $vol) -Quiet -AllowFail
        if ($script:Code -ne 0) { Native @('docker', 'volume', 'create', $vol) -Quiet }
      } else {
        Native @('docker', 'run', '--rm', '-v', "${vol}:/data:ro", '-v', "${dir}:/b", $ToolImage, 'tar', '-czf', "/b/caddy-data-before-restore-$ts.tar.gz", '-C', '/data', '.') -Quiet
      }
      Native @('docker', 'run', '--rm', '-v', "${vol}:/data", '-v', "${x}:/x:ro", $ToolImage, 'sh', '-c', 'find /data -mindepth 1 -delete && tar -xzf /x/caddy-data.tar.gz -C /data') -Quiet
      Say '  certificates restored'
    }
  }

  # 4. Switch the app to the restored database.
  if ($script:Managed) {
    Step "Switching the app to $newdb"
    Say 'With a managed database, the database name changes in DATABASE_URL, MIGRATION_DATABASE_URL and BACKUP_DATABASE_URL.'
  }
  if (Confirm-Yes "Switch the app to $newdb now? It stops for about a minute; $olddb is kept" 'y') {
    foreach ($s in ((Apps) + @('worker'))) { DC @('stop', $s) -Quiet -AllowFail }
    Copy-Item -LiteralPath $script:EnvFile -Destination "$($script:EnvFile).before-switch-$ts"
    Protect-Path "$($script:EnvFile).before-switch-$ts"
    if ($script:Managed) {
      foreach ($k in @('DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BACKUP_DATABASE_URL')) { $v = EnvGet $k; if ($v) { Set-KV $script:EnvFile $k (Url-WithDb $v $newdb) } }
    }
    Set-KV $script:EnvFile 'DB_NAME' $newdb
    Step "Starting with $newdb"
    DC (@('up', '-d') + (Scale-Args))
    foreach ($s in (Apps)) { [void](Wait-Ready $s) }
    $keys = DC @('exec', '-T', 'app', 'node', 'dist/cli/rotate-data-key.js', '--check') -Capture -AllowFail
    if ($script:Code -eq 0) { Say "  The encryption key in $($script:EnvFile) reads every stored secret (two-factor and webhook secrets)." }
    else {
      Warn "the encryption key in $($script:EnvFile) cannot read some stored secrets: restore the settings file from the same backup, or add the old key to DATA_ENCRYPTION_KEYS_PREVIOUS"
      $keys | ForEach-Object { Write-Host $_ }
    }
    Step 'Done'
    Say "The app now uses $newdb. The previous database, $olddb, is kept; the previous settings are in $($script:EnvFile).before-switch-$ts."
    if (-not $script:Managed) {
      $t = DC @('exec', '-T', '-e', "CS_DB=$olddb", 'postgres', 'sh', '-c', 'psql -U $POSTGRES_USER -d $CS_DB -At -c ''SELECT count(*) FROM pg_tables WHERE schemaname = $$public$$''') -Capture -AllowFail
      if ($script:Code -eq 0 -and $t -contains '0') { Say "$olddb is empty (it was made when the database first started on this computer)." }
      Say "When you no longer need ${olddb}: docker compose $($script:Files -join ' ') --env-file $($script:EnvFile) exec postgres dropdb -U postgres $olddb"
    }
  } else {
    $extra = ''
    if ($script:Managed) { $extra = ' and the database name in the three URLs' }
    Say "Not switched. To switch later: set DB_NAME=$newdb in $($script:EnvFile)$extra, then run ops\start.bat."
  }
}

# ------------------------------------------------------------------ menu
function Cmd-Menu {
  $c = Choose 'Curriculum Scope: what do you want to do?' 3 @('Start', 'Stop', 'Status', 'Back up', 'Restore', 'Test a backup (changes nothing)', 'Set up backup copies (folder or USB drive, server, bucket)', 'Quit')
  switch ($c) {
    1 { $script:Cmd = 'start'; Cmd-Start }
    2 { $script:Cmd = 'stop'; Cmd-Stop }
    3 { $script:Cmd = 'status'; Cmd-Status }
    4 { $script:Cmd = 'backup'; Cmd-Backup }
    5 { $script:Cmd = 'restore'; Cmd-Restore }
    6 { $script:Cmd = 'verify'; Cmd-Restore }
    7 { $script:Cmd = 'destinations'; Cmd-Destinations }
  }
}

try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die 'Docker is not installed (Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/)' }
  Native @('docker', 'compose', 'version') -Quiet -AllowFail
  if ($script:Code -ne 0) { Die 'Docker Compose v2 is missing (update Docker Desktop)' }
  Native @('docker', 'info') -Quiet -AllowFail
  if ($script:Code -ne 0) { Die 'cannot reach Docker: is Docker Desktop running?' }
  switch ($script:Cmd) {
    'start' { Cmd-Start }
    'stop' { Cmd-Stop }
    'status' { Cmd-Status }
    'backup' { Cmd-Backup }
    'restore' { Cmd-Restore }
    'verify' { Cmd-Restore }
    'destinations' { Cmd-Destinations }
    default { Cmd-Menu }
  }
} finally { Invoke-Cleanup }
exit 0
