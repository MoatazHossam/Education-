"""The Windows start script (meeting-minutes/start.ps1, start.bat, stop.bat).

The static checks run everywhere. Where PowerShell 7 is installed (GitHub's Ubuntu runners have it),
the script itself runs: parsed, then with a fake `docker` and a local readiness endpoint, so the
settings file, the checks and the start sequence are exercised; only the interactive administrator
prompt (it needs a console) is left to a person."""

from __future__ import annotations

import base64
import http.server
import os
import re
import shutil
import socket
import stat
import subprocess
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]  # meeting-minutes/
PS1 = ROOT / "start.ps1"
PWSH = shutil.which("pwsh")
needs_pwsh = pytest.mark.skipif(PWSH is None, reason="PowerShell 7 (pwsh) is not installed")
SECRETS = ("POSTGRES_PASSWORD", "MAHDAR_APP_DB_PASSWORD", "MAHDAR_SECRET_KEY", "MAHDAR_DATA_KEY")


def test_powershell_tests_run_on_ci():
    # On CI the script must really run, not be skipped: GitHub's Ubuntu runners include PowerShell 7.
    if os.environ.get("CI") == "true":
        assert PWSH, "pwsh is missing on CI: the start script would go untested"


def test_scripts_suit_windows():
    raw = PS1.read_bytes()
    # Windows PowerShell 5.1 misreads non-ASCII characters in a file without a byte order mark.
    assert all(b < 128 for b in raw), "start.ps1 must stay ASCII"
    for bat in ("start.bat", "stop.bat"):
        text = (ROOT / bat).read_bytes().decode("ascii")
        assert "\n" not in text.replace("\r\n", ""), f"{bat} needs CRLF line endings"
    start = (ROOT / "start.bat").read_text()
    assert '-ExecutionPolicy Bypass -File "%~dp0start.ps1"' in start and "pause" in start
    assert 'cd /d "%~dp0"' in (ROOT / "stop.bat").read_text()
    # Every setting the script fills in exists in the example it copies.
    example = (ROOT / ".env.docker.example").read_text()
    for key in (*SECRETS, "ANTHROPIC_API_KEY", "MAHDAR_ALLOWED_EXTERNAL_PROVIDERS", "MAHDAR_PORT"):
        assert re.search(rf"^{key}=", example, re.M), key
    # The compose project name, which the earlier-database check relies on (volume mahdar_pgdata).
    assert re.search(r"^name: mahdar$", (ROOT / "docker-compose.yml").read_text(), re.M)


def _env(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


@pytest.fixture
def folder(tmp_path):
    d = tmp_path / "meeting minutes"  # a space, as in many Windows paths
    d.mkdir()
    for f in ("start.ps1", ".env.docker.example", "docker-compose.yml"):
        shutil.copy(ROOT / f, d / f)
    return d


def _run(folder: Path, *args: str, path: str | None = None, extra: dict | None = None) -> subprocess.CompletedProcess:
    env = {"HOME": str(folder.parent), "PATH": path if path is not None else os.environ.get("PATH", "")}
    env.update(extra or {})
    return subprocess.run(
        [PWSH, "-NoProfile", "-File", str(folder / "start.ps1"), *args],
        cwd=folder.parent,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=120,
    )


@needs_pwsh
def test_script_parses():
    cmd = (
        "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("
        f"'{PS1}', [ref]$null, [ref]$e); if ($e) {{ $e | ForEach-Object {{ $_.ToString() }}; exit 1 }}"
    )
    r = subprocess.run([PWSH, "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


@needs_pwsh
def test_settings_are_created_once_and_kept(folder):
    r = _run(folder, "-SettingsOnly", "-SkipClaudeKey")
    assert r.returncode == 0, r.stdout + r.stderr
    f = folder / ".env.docker"
    env = _env(f)
    assert re.fullmatch(r"[0-9a-f]{48}", env["POSTGRES_PASSWORD"])
    assert re.fullmatch(r"[0-9a-f]{48}", env["MAHDAR_APP_DB_PASSWORD"])
    assert env["POSTGRES_PASSWORD"] != env["MAHDAR_APP_DB_PASSWORD"]
    assert len(base64.b64decode(env["MAHDAR_SECRET_KEY"])) == 48
    assert len(base64.b64decode(env["MAHDAR_DATA_KEY"])) == 32
    assert env["ANTHROPIC_API_KEY"] == "" and env["MAHDAR_PORT"] == "8080"
    assert b"\r" not in f.read_bytes() and f.read_bytes()[:3] != b"\xef\xbb\xbf"
    assert stat.S_IMODE(f.stat().st_mode) == 0o600
    assert "# --- Required secrets" in f.read_text()  # the example's comments are kept

    # A second run keeps every value; a Claude key is added, and Claude allowed for this installation.
    r = _run(folder, "-SettingsOnly", "-ClaudeKey", "sk-ant-test-key")
    assert r.returncode == 0, r.stdout + r.stderr
    again = _env(f)
    assert all(again[k] == env[k] for k in SECRETS)
    assert again["ANTHROPIC_API_KEY"] == "sk-ant-test-key"
    assert again["MAHDAR_ALLOWED_EXTERNAL_PROVIDERS"] == "anthropic"
    assert "kept as they are" in r.stdout


@needs_pwsh
def test_missing_or_stopped_docker_is_explained(folder, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    os.symlink(shutil.which("chmod"), bin_dir / "chmod")
    r = _run(folder, "-SkipClaudeKey", "-NoBrowser", path=str(bin_dir))
    assert r.returncode == 1 and "Docker was not found" in r.stdout, r.stdout + r.stderr

    docker = bin_dir / "docker"
    docker.write_text("#!/bin/sh\nexit 1\n")
    docker.chmod(0o755)
    r = _run(folder, "-SkipClaudeKey", "-NoBrowser", path=str(bin_dir))
    assert r.returncode == 1 and "Docker Desktop is not running" in r.stdout, r.stdout + r.stderr


class _Ready(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/readyz" else 404)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


@needs_pwsh
def test_start_sequence_with_a_fake_docker(folder, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    os.symlink(shutil.which("chmod"), bin_dir / "chmod")
    log = tmp_path / "docker.log"
    (bin_dir / "docker").write_text(
        '#!/bin/sh\necho "$*" >> "$FAKE_DOCKER_LOG"\ncase "$*" in *org-count*) echo 1 ;; esac\nexit 0\n'
    )
    (bin_dir / "docker").chmod(0o755)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = http.server.HTTPServer(("127.0.0.1", port), _Ready)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        assert _run(folder, "-SettingsOnly", "-SkipClaudeKey").returncode == 0
        f = folder / ".env.docker"
        f.write_text(re.sub(r"^MAHDAR_PORT=.*$", f"MAHDAR_PORT={port}", f.read_text(), flags=re.M))
        r = _run(folder, "-SkipClaudeKey", "-NoBrowser", path=str(bin_dir), extra={"FAKE_DOCKER_LOG": str(log)})
    finally:
        server.shutdown()
    assert r.returncode == 0, r.stdout + r.stderr
    calls = log.read_text().splitlines()
    env_file = str(folder / ".env.docker")
    assert calls[0] == "info"
    assert f"compose --env-file {env_file} up --build -d" in calls
    assert f"compose --env-file {env_file} exec -T api python3 -m mahdar.cli org-count" in calls
    assert not any("create-admin" in c for c in calls)  # an administrator exists already
    assert not any(c.startswith("volume") for c in calls)  # the secrets were not new
    assert "An administrator already exists" in r.stdout and f"http://localhost:{port}" in r.stdout
