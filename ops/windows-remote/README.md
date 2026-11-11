# Midad remote control from Windows

Double-click files that run a Linux server's Midad operations from a Windows PC over SSH: status, a live
monitor, back up now, test the newest backup, the backups list, download the backups to the PC, the daily
report, logs, restart without downtime, start, stop, system updates and a root shell, plus a control panel
that does them one after another with one sudo password.

1. Copy this folder to the PC (unblock the zip first: right-click, *Properties*, *Unblock*).
2. Copy `midad-settings.example.bat` to `midad-settings.bat` and write the server's address and SSH user in it.
3. Run `Midad - Setup first time.bat` once: a key for this PC, the helper `server/midad-remote.sh` on the server
   as `/usr/local/sbin/midad-remote`, and `ssh midad` for PowerShell.

Everything else, file by file: [docs/DEPLOYMENT_GUIDE.md §8.12](../../docs/DEPLOYMENT_GUIDE.md#812-remote-control-from-windows)
(Arabic: [docs/DEPLOYMENT_GUIDE.ar.md §8.12](../../docs/DEPLOYMENT_GUIDE.ar.md)).

`midad-settings.bat` is this PC's own and is never committed (`.gitignore`).
