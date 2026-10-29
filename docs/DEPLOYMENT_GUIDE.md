# Deployment guide

العربية: [دليل النشر والتشغيل](DEPLOYMENT_GUIDE.ar.md) (the same guide in Arabic; update both together).

Nothing here has been deployed to a real production host from this repository; every step below
was run locally (development stack, Docker image, compose stack, backup and restore) as recorded
in TEST_REPORT.md. Day-to-day operation (start, stop, backups, restores) uses the scripts in `ops/`,
for Linux and Windows (§8).

## 1. Local development (no Docker)

Requirements: Node.js 22, PostgreSQL 16.

```bash
npm ci
# Create roles and the database (as a PostgreSQL superuser):
psql -U postgres <<'SQL'
CREATE ROLE midad_owner LOGIN PASSWORD 'dev-owner' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE midad_app  LOGIN PASSWORD 'dev-app'   NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE midad OWNER midad_owner;
SQL
cp .env.example .env     # fill SESSION_SECRET, DATA_ENCRYPTION_KEY, DATABASE_URL, MIGRATION_DATABASE_URL, SANDBOX_WEBHOOK_SECRET
set -a; . ./.env; set +a
npm run db:migrate       # schema + grants for APP_DB_ROLE
npm run db:seed          # plans, 2026/27 catalogue, demo users (prints credentials and the admin TOTP secret)
npm run dev              # http://localhost:3000
npm run dev:worker       # emails (log transport prints them) and billing lifecycle
```

Tests: `TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm test` (creates its own
databases and roles), `npm run test:e2e` (Playwright; starts its own server on port 3100).

## 2. Docker Compose (local or single host)

```bash
cp .env.docker.example .env.docker   # set every password and secret
docker compose --env-file .env.docker up --build
```
Services: `postgres` (roles created by `deploy/postgres-init/01-roles.sh` on first start),
`migrate` (one-shot: migrations, grants, plans, catalogue), `app` (port `APP_PORT`), `worker`,
`mailpit` (development SMTP UI on `127.0.0.1:8025`).

Builds behind a TLS-intercepting proxy: `docker build --network host --build-arg HTTPS_PROXY=… --secret id=build_ca,src=/path/ca.crt .`
(the CA is mounted only during `npm ci`, never stored in the image).

## 3. Production (single host, recommended for launch)

### 3.1 Infrastructure
- One Linux VM with Docker (e.g. 2–4 vCPU, 4–8 GB RAM). Hetzner CPX22 (2 vCPU/4 GB) is about
  €7.99/month after its April 2026 price change ([Better Stack](https://betterstack.com/community/guides/web-servers/digitalocean-vs-hetzner/)).
  The virus scanner (ClamAV) alone holds about 1–1.5 GB of memory: 4 GB is the minimum with it, 8 GB
  leaves room.
  If customer data must stay in Egypt or the region, choose the hosting location after the legal
  review (SECURITY_DESIGN.md §7).
- Prefer **managed PostgreSQL 16** with automated backups and point-in-time recovery; otherwise use
  the bundled `postgres` service plus the backup job below.
- DNS `A/AAAA` record for your domain → the VM. Ports 80/443 open; nothing else public.
- SMTP provider (with SPF, DKIM, DMARC for the sender domain).
- Payment provider account (Paymob) — or `BILLING_PROVIDER=disabled` and manual invoicing.

### 3.2 Configuration
Create `.env.production` from `.env.docker.example`:
- `NODE_ENV=production`, `APP_URL=https://<domain>`, `DOMAIN=<domain>`, `ACME_EMAIL=<ops email>`
- strong random secrets, generated freshly for each installation:

  | Setting | Linux | Windows (PowerShell) |
  | --- | --- | --- |
  | `SESSION_SECRET` | `openssl rand -base64 48` | `$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)` |
  | `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` | the same with `byte[] 32` |
  | the four database passwords | `openssl rand -hex 24` | `$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b \| % { $_.ToString('x2') })` |

  Database passwords must be letters and digits only: they are placed inside database addresses,
  where a `/` or `@` from base64 would break them.
- `EMAIL_TRANSPORT=smtp`, `SMTP_URL=smtps://user:pass@smtp.provider:465`, `EMAIL_FROM`
- leave `WEBHOOK_ALLOW_INSECURE_TARGETS` unset: it lets customer webhooks reach http and private addresses, for development only, and the app refuses to start with it in production. The worker makes outbound HTTPS requests to customers' webhook URLs; if the host has an egress firewall, allow outbound 443 and block private ranges and `169.254.169.254` (SECURITY_DESIGN §6)
- `BILLING_PROVIDER=paymob` + `PAYMOB_*` (or `disabled`)
- `SALES_EMAIL` for the Enterprise "Contact sales" link
- `FILE_SCAN`: the production compose file sets `clamav` (homework files are scanned by its `clamav`
  service before anyone opens them, CLASSROOM.md §5). ClamAV updates its signatures itself from
  `database.clamav.net`: with an egress firewall, allow outbound HTTPS to it (or run a private mirror).
  `FILE_SCAN=off` turns scanning off; photos are still resized. Outside Docker Compose, set
  `FILE_SCAN=clamav`, `CLAMAV_HOST` and `CLAMAV_PORT` (3310) for the worker and run `clamd` with a TCP
  socket reachable only from it.
- AI assistance (optional, docs/AI_LAYER.md): `AI_PROVIDER` (`gemini`, `anthropic` or `openai`; `none`
  by default), `AI_API_KEY` and `AI_MODEL`. Use a paid API tier whose terms exclude training on your
  requests. Check the key and model with `npm run ai:check` (same variables) before enabling AI for any
  school; then a platform administrator gives each school its monthly allowance. The app makes outbound
  HTTPS requests to the provider: with an egress firewall, allow its API host (`generativelanguage.googleapis.com`,
  `api.anthropic.com` or `api.openai.com`).

The app refuses to start in production with the sandbox provider, a non-SMTP mailer, a non-HTTPS
`APP_URL`, `FILE_SCAN` unset, an AI provider without its key and model, or a database role that bypasses RLS.

### 3.3 Start
`ops/start.sh --env prod` (Linux) or `ops\start.bat --env prod` (Windows) checks the settings, builds
the image the first time, starts everything and waits until both app instances are ready (§8.2).
It runs:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production ps
curl -fsS https://<domain>/readyz
```
Production runs two app instances (`app`, `app2`) behind Caddy, which balances requests between
them, checks `/readyz` every 2 s and routes around an instance that is restarting or down. Each
instance opens up to `DATABASE_POOL_MAX` (default 10) database connections: two instances and the
worker need about 21, well within PostgreSQL's default of 100 (check a managed plan's limit).

The `clamav` service (image `clamav/clamav:1.5`, signatures kept in the `clamav_db` volume) takes a
minute or two to load its signatures on the first start, about 15 s later on; homework files uploaded
meanwhile wait and are checked as soon as it answers (the worker logs that it is waiting). It listens
only inside the compose network.

Caddy obtains TLS certificates automatically. Every container's log is capped at 5 files of 10 MB,
so logs cannot fill the disk.

**Managed PostgreSQL.** Create the three roles with the SQL from `deploy/postgres-init/01-roles.sh`,
then set in `.env.production`:

| Setting | Value |
| --- | --- |
| `DATABASE_URL` | the app role (`midad_app`), e.g. `postgres://midad_app:…@db.example.com:5432/midad` |
| `MIGRATION_DATABASE_URL` | the owner role (`midad_owner`), same database |
| `BACKUP_DATABASE_URL` | the backup role (`midad_backup`, `BYPASSRLS` + `pg_read_all_data`), same database |
| `DATABASE_SSL` | `true` |
| `RESTORE_ADMIN_URL` (optional) | for restores: a role that can create databases and is a member of the owner role, database `postgres`; left out, a restore asks for it |

With `DATABASE_URL` set, the ops scripts start everything except the bundled `postgres` service. Where a
provider does not allow `BYPASSRLS`, the scripts cannot back up (tenant tables force row-level
security): use the provider's backups and point-in-time recovery instead.

### 3.4 First platform administrator
```bash
docker compose ... exec app node dist/cli/create-platform-admin.js --email ops@<domain> --name "Ops"
```
Prints a one-time password. Sign in, change the password, enrol TOTP (required before any admin page works).

### 3.5 Paymob setup (when credentials exist)
0. Before any deployment, with **test-mode** keys on a developer machine:
   `PAYMOB_SECRET_KEY=… PAYMOB_PUBLIC_KEY=… PAYMOB_HMAC_SECRET=… PAYMOB_INTEGRATION_IDS=… npm run paymob:check`.
   It creates a real test intention with the application's adapter, prints the checkout link (pay with
   Paymob's test card) and verifies the signed redirect on `localhost`. Live keys are refused.
1. Create card (and wallet) integrations; note integration ids.
2. Set the transaction-processed callback to `https://<domain>/api/billing/webhooks/paymob`.
3. Copy secret key, public key, HMAC secret into the env file; restart `app` and `worker`.
4. In Paymob test mode, run: subscribe → pay → check the invoice turns paid; decline a payment;
   replay a callback; verify `/admin/events`. Record results in TEST_REPORT.md before going live.

## 4. Upgrades and rollback

1. Take a backup (`ops/backup.sh --env prod`, Windows `ops\backup.bat --env prod`), `git pull` (or
   check out a tagged release), then on Linux `scripts/rolling-restart.sh --build`. It rebuilds the
   image, applies new migrations with the old release still serving, then replaces `app`, waits
   until it is ready, replaces `app2`, and finally the worker. Each instance drains for 5 s before
   it stops, so the restart drops no requests (TEST_REPORT §4).
   Without `--build` it only restarts the instances, one at a time. If an instance does not
   become ready, the script stops and the other keeps serving.
   On Windows (or as a simpler path on Linux): `ops\start.bat --env prod` and answer yes to
   "Rebuild the app image first". Both instances restart together, a few seconds without service.
2. Migrations must be backwards-compatible with the previous release (add columns/tables first,
   remove later) so a rollback only needs the old image.
3. Rollback: both ways of rebuilding keep the image they replace as `midad:previous`.
   Add `APP_IMAGE_TAG=previous` to `.env.production` and run `ops/start.sh --env prod`
   (or `APP_IMAGE_TAG=previous scripts/rolling-restart.sh`); remove the line again before the
   next upgrade, which would otherwise build into that tag. If a migration must be reverted,
   restore the pre-upgrade backup (§8.6).

### Rotating `DATA_ENCRYPTION_KEY`

The key encrypts two-factor secrets and customer webhook signing secrets. Rotate it about once a
year, when someone who had access to it leaves, or if it may have leaked. There is no downtime.

1. **Back up first:** run `ops/backup.sh --env prod` (§8). Then check the current state:
   `docker compose … exec app node dist/cli/rotate-data-key.js --check`. It prints the current key's id
   (a short fingerprint, not the key) and how many values each key has encrypted.
2. **Swap the keys:** generate a new key with `openssl rand -base64 32`. In `.env.production`, move the
   current key to `DATA_ENCRYPTION_KEYS_PREVIOUS` and put the new one in `DATA_ENCRYPTION_KEY`.
3. **Restart:** run `scripts/rolling-restart.sh`. Every instance now writes with the new key and still
   reads the old one.
   - During the few seconds of the restart, an instance not yet restarted cannot read a value that a
     restarted one has just written, such as a new two-factor enrollment.
   - A code or test that fails in that window can be retried.
4. **Re-encrypt:** run `docker compose … exec app node dist/cli/rotate-data-key.js`. It rewrites every
   value with the new key, prints counts per column, and records `admin.data_key_rotated` in the
   platform audit log (counts and the key id only).
   - It exits with 1 and lists any value that none of the configured keys can read.
   - In that case, add the key that value was written with to `DATA_ENCRYPTION_KEYS_PREVIOUS` and run it again.
5. **Confirm:** `--check` shows every value with the current key.
6. **Remove the old key:** clear `DATA_ENCRYPTION_KEYS_PREVIOUS` and run `scripts/rolling-restart.sh` again.
7. **Keep the old key with old backups:** store it apart from the backups, for as long as you keep backups
   made before step 4. Restoring one of them needs it: put it back in `DATA_ENCRYPTION_KEYS_PREVIOUS`,
   run step 4 on the restored database, then remove it again. Destroy the old key when the last of
   those backups is deleted.

Locally: `npm run keys:check` and `npm run keys:rotate`.

## 5. Backups and recovery

Use the ops scripts (§8): `ops/backup.sh` / `ops\backup.bat` for backups (encrypted, with copies to
a folder or USB drive, another server or a storage bucket), `ops/restore.sh --only-verify` to test
one, `ops/restore.sh` to restore, and §8.8 to rebuild a lost server. The minimum:

- a **daily scheduled backup** with at least one copy **off the server** (§8.5);
- a **weekly test** of the newest off-site copy (§8.5), and a full restore drill before launch and
  after major changes;
- the backup passphrase and `.env.production` (above all `DATA_ENCRYPTION_KEY`) kept in a password
  manager, apart from the backups.

Keep at least 30 daily copies (the default retention) and 12 monthly ones **(assumption)**: for the
monthly ones, keep one backup a month in a place retention does not touch (a second folder or a
bucket with versioning), since the scripts delete by age only.

The older `scripts/backup.sh`, `scripts/verify-backup.sh` and `scripts/restore.sh` work against any
PostgreSQL reachable from the host with the PostgreSQL client tools installed there (no Docker);
they handle only the database, not settings, certificates or copies.

Targets **(assumptions)**: RPO 24 h with daily backups (minutes with managed PITR), RTO 4 h. The drill
rebuilt a wiped server from an off-site copy in about 90 seconds of script time (TEST_REPORT §4).

## 6. Monitoring and alerts

**Built in (configure before launch).** Set `ALERT_EMAILS` (comma-separated) and/or `ALERT_WEBHOOK_URL` (a
Slack, Discord or Mattermost incoming webhook, or any endpoint that accepts JSON) in `.env.production`, then use
Platform admin → Overview → **Send test alert** to check delivery. Treat the webhook URL as a secret. Every app
instance checks once a minute; one message is sent when a problem starts, a reminder every 6 hours while it
lasts, and one when it has been clear for 5 minutes. Alerts are sent directly (not through the email queue),
are also written to the logs (`"msg":"operational alert"`), and contain counts only.

| Alert | Fires when | First thing to check |
| --- | --- | --- |
| Worker stopped | no worker heartbeat for 2 minutes (4 × `WORKER_INTERVAL_MS`) | `docker compose … ps worker`, `logs worker` |
| Emails failing | an email gave up in the last hour, or 3+ are being retried | SMTP settings and the provider; worker logs |
| Email backlog | an email has waited more than 15 minutes | whether the worker runs |
| Server errors | 10+ responses with status 500–599 in 5 minutes on one instance | `docker compose … logs app app2` |
| Payment notifications failing | a provider webhook failed to process in the last hour | Platform admin → Webhooks |
| Migrations pending | the schema is behind the code | `docker compose … run --rm migrate` |
| Homework files waiting | a homework file has waited more than 10 minutes for its check (virus scan, photo resizing); nobody can open it meanwhile | `docker compose … ps clamav worker`, `logs clamav worker` (the worker logs the scanner's error) |
| Database unreachable | two checks in a row cannot reach PostgreSQL (one message per instance) | `ps postgres` / the managed database status |

**Outside the host (needed as well).** Nothing on the host can report that the host itself, Caddy or both app
instances are down. Add an external uptime check of `https://<domain>/readyz` every minute, alerting after two
failures (any uptime service, for example UptimeRobot or Better Stack); it also covers TLS certificate expiry.

| Other signal | How |
| --- | --- |
| Logs | JSON logs from `app`, `app2`, `worker` (`docker compose logs`); ship them to a log service to search and keep them |
| Disk / DB size | Host monitoring; PostgreSQL `pg_database_size` |
| Backups | The backup cron's own failure email or the log service; restore drill (§5) |

## 7. Release checklist

- [ ] All CI jobs green on the release commit
- [ ] `.env.production` reviewed; secrets generated freshly; no sandbox provider
- [ ] Backup taken (`ops/backup.sh`) and tested (`ops/restore.sh --only-verify`) before migration
- [ ] Daily backup scheduled with an off-site copy, weekly test scheduled, passphrase stored apart (§8.5)
- [ ] A full restore drill done on this host or one like it (§8.6, §8.8)
- [ ] `/readyz` 200; sign-up → verify → login works on production with real email
- [ ] Paymob test-mode run recorded (or billing disabled with manual invoicing)
- [ ] Platform admin created with TOTP; demo data absent
- [ ] Monitoring and alerts firing to a real channel
- [ ] Before schools use online tests: `scripts/load-exam.mjs` run on staging hardware like production's,
      with the largest grade expected on one school network (TEST_REPORT §5). It creates a class,
      students and a test, so run it as the owner of a test school on staging, never a real school
- [ ] Privacy policy, terms and support contact published

## 8. Operations scripts (Linux and Windows)

`ops/` holds one tool in two forms: `ops/midad.sh` for Linux (bash) and `ops\midad.ps1` for Windows
(PowerShell), with short launchers. Both do the same things, read the same settings and make the same
backups: a backup made with one restores with the other. The host needs only Docker with Compose v2;
the database tools, encryption and file transfers run in containers.

| Task | Linux | Windows |
| --- | --- | --- |
| Menu of everything below | `ops/midad.sh` | double-click `ops\midad.bat` |
| Start | `ops/start.sh` | `ops\start.bat` |
| Stop | `ops/stop.sh` | `ops\stop.bat` |
| Status | `ops/status.sh` | `ops\status.bat` |
| Back up | `ops/backup.sh` | `ops\backup.bat` |
| Restore | `ops/restore.sh` | `ops\restore.bat` |
| Test a backup (changes nothing) | `ops/restore.sh --only-verify` | `ops\restore.bat --only-verify` |
| Set up backup copies | `ops/midad.sh destinations` | `ops\midad.bat destinations` |

Without options the scripts ask what they need: which installation, which choices, which backup.
Options for the same answers, the same on both systems:

| Option | Meaning |
| --- | --- |
| `--env dev` / `--env prod` | development (`docker-compose.yml`, `.env.docker`) or production (`+ docker-compose.prod.yml`, `.env.production`) |
| `--env-file FILE` | another settings file |
| `--yes` | ask nothing: use the saved choices and defaults (for schedules); needs `--env` |
| `--to folder,server,bucket` or `--to none` | backup: where to copy it, besides the backup folder |
| `--no-encrypt` | backup: leave the archive unencrypted (not possible with the settings file in it) |
| `--from local\|folder\|server\|bucket`, `--file NAME` | restore: where from, which backup (default: the newest) |
| `--only-verify` | restore: test the backup in a scratch database only |

### 8.1 Host setup

**Linux** (recommended for a server): Docker Engine with the Compose plugin
(`https://docs.docker.com/engine/install/`), `systemctl enable docker`, the repository in for example
`/opt/midad`, and `.env.production` (§3.2) readable by its owner only (`chmod 600`; the
start script offers to fix it). Run the scripts as root or as a member of the `docker` group.

**Windows 10 (22H2) or 11:** Docker Desktop with the WSL 2 engine, and the repository (Git for Windows,
or the ZIP from GitHub). The `.bat` files run `ops\midad.ps1` with PowerShell 7 when it is installed,
otherwise with the Windows PowerShell 5.1 built into Windows, allowing that one script to run
(`-ExecutionPolicy Bypass`). Edit settings files with Notepad. Docker Desktop runs only while its
user is signed in: for the app to come back after a restart, turn on *Start Docker Desktop when you
sign in* and sign that user in (a locked screen is fine). A server that must run with nobody signed in
belongs on Linux. Check Docker Desktop's licence terms for your organisation (larger organisations
need a paid subscription).

**After a restart of the computer** the containers come back by themselves (`restart: unless-stopped`),
unless they were stopped with the stop script, which keeps them stopped.

### 8.2 Start, stop, status

- **Start** checks the settings file (required values present, no `change-me` left, `https://` in
  production, file readable by you only), builds the app image the first time, starts every service and
  waits until the app instances answer `/readyz`, then shows the status. It asks whether to rebuild the
  image first (after updating the code; the replaced image is kept as `midad:previous`, §4).
  With a managed database (`DATABASE_URL` set) the bundled `postgres` service is not started.
- **Stop** asks: stop (containers kept, start again with start) or stop and remove the containers. Neither
  deletes data: the database, certificates and virus signatures stay in Docker volumes.
- **Status** lists the services with their state and health, whether each app instance is ready, and
  the address.

### 8.3 Backups

| Part | In the backup |
| --- | --- |
| Database (`pg_dump`) | always: every school's data, including homework files and photos (they are stored in the database) |
| Check of the live database | always: migrations, row-level security, row counts of every table, to compare after a restore |
| Settings file (`.env.production`) | asked, default no: passwords and keys including `DATA_ENCRYPTION_KEY`, needed to rebuild a lost server; the archive is then always encrypted |
| TLS certificates (Caddy) | asked in production, default yes: a rebuilt server serves HTTPS at once, without waiting for new certificates |

Not included: Docker images (rebuilt from the code; the backup records the app version), virus
signatures (downloaded again), and `.env.backup` with your copy settings (note them down).

- **Name and format:** `midad-backup-<dev|prod>-<UTC time>.tar.enc` (or `.tar`), with a `.sha256` checksum
  file next to it; inside, a `manifest.txt` lists every part with its own checksum.
- **Encryption** (default on): AES-256-GCM with a key derived from your passphrase (scrypt). The
  passphrase needs 12 characters or more. A wrong passphrase and any changed byte are both detected.
  **Without the passphrase a backup cannot be opened**: keep it in a password manager, apart from the
  backups. The scripts never write it anywhere except a passphrase file you create for schedules (§8.5).
- **Where:** the backup folder (default `backups/` in the project folder, readable by you only; another
  with `BACKUP_DIR` in `.env.backup`), plus the copies you choose (§8.4). Each copy is checked against the
  checksum after the transfer.
- **Old backups:** backups older than the number of days you choose (default 30; 0 keeps all) are
  deleted from the backup folder and from each copy the new backup reached. Only files named
  `midad-backup-*` are touched, and only after a successful backup, so the newest always stays.
- **Safety:** the backup runs while the app serves (`pg_dump` reads a consistent snapshot). One backup or
  restore runs at a time; a lock left by a run that was killed is taken over, and what it left behind
  (possibly decrypted data) is deleted. If any copy fails, the script says which, keeps the backup, and
  exits with an error code so a schedule reports it.
- The choices are saved in `.env.backup` (readable by you only) and reused next time and by `--yes`.

### 8.4 Copies: folder or USB drive, another server, a storage bucket

Keep at least one copy **off the server**. Set copies up from the menu (*Set up backup copies*) or when
a backup first asks for one; the connection is tested when you save it.

| Copy | You give | Notes |
| --- | --- | --- |
| Folder or USB drive | a path: a mounted drive, a network share (Windows: a mapped drive or `\\server\share\folder`) | the drive must be mounted when the backup runs |
| Another server (SFTP) | host, port, user, folder; an SSH key file (recommended) or a password; a `known_hosts` file | connect once with `ssh user@host` first, so its key is in `~/.ssh/known_hosts` (Windows: `%USERPROFILE%\.ssh\known_hosts`, with the OpenSSH client built into Windows). If the server's key changes, copies stop until you check it and update the file. A password is stored obscured, not encrypted: keep `.env.backup` private |
| Storage bucket (S3-compatible) | endpoint (empty for Amazon S3; e.g. `s3.eu-central-003.backblazeb2.com`, `<account>.r2.cloudflarestorage.com`, `s3.eu-central-1.wasabisys.com`), region, bucket, folder, access key | the key needs list, read, write and delete on that bucket (delete for old backups). For copies this server cannot delete, use the provider's object lock or versioning, with its own retention |

`.env.backup` reference (written by the menu; edit it only for the advanced lines):

| Setting | Meaning |
| --- | --- |
| `BACKUP_DIR` | backup folder (default `backups/` in the project) |
| `BACKUP_COPY_TO` | default copies, e.g. `folder,bucket` |
| `BACKUP_KEEP_DAYS` | delete backups older than this (0 = never) |
| `BACKUP_ENCRYPT`, `BACKUP_INCLUDE_SETTINGS`, `BACKUP_INCLUDE_CERTIFICATES` | the saved answers (`yes`/`no`) |
| `BACKUP_PASSPHRASE_FILE` | file holding the passphrase, for schedules (§8.5) |
| `BACKUP_FOLDER`; `BACKUP_SERVER_*`; `BACKUP_BUCKET_*` | the three kinds of copy |
| `BACKUP_DOCKER_NETWORK` | advanced: a Docker network the tool containers join, for a copy server or database reachable only there |
| `BACKUP_PG_IMAGE` | advanced, managed database: client tools as new as the server, e.g. `postgres:17-alpine` for PostgreSQL 17 |

### 8.5 Scheduled backups and tests

First run one backup by hand and answer the questions: a schedule (`--yes`) reuses those answers.
For the passphrase, choose *Passphrase file for scheduled backups* in the copies menu: it writes the
passphrase to a file readable only by you (on Windows by you and SYSTEM) and saves its location.
Alternatively set `MIDAD_BACKUP_PASSPHRASE` in the schedule's environment.

**Linux (cron):**
```bash
# /etc/cron.d/midad   (cron emails the echo line when a run fails)
MAILTO=ops@example.com
15 2 * * * root cd /opt/midad && ops/backup.sh --env prod --yes >>/var/log/midad-backup.log 2>&1 || echo "Midad backup failed: see /var/log/midad-backup.log"
45 3 * * 0 root cd /opt/midad && ops/restore.sh --env prod --yes --from bucket --only-verify >>/var/log/midad-backup.log 2>&1 || echo "Midad backup test failed: see /var/log/midad-backup.log"
```
The second line tests the newest copy in the bucket every Sunday (use `server` or `folder` for those copies).

**Windows (Task Scheduler):** *Create Task…*; *Run only when user is logged on* (Docker Desktop needs the
signed-in user); trigger *Daily* at 02:15; action *Start a program*: program `cmd.exe`, arguments
`/c ops\backup.bat --env prod --yes >> backups\backup-log.txt 2>&1`, *Start in* the project folder (e.g.
`C:\midad`). A second task, weekly, with `ops\restore.bat --env prod --yes --from bucket --only-verify`.
The *Last Run Result* column shows `0x0` for success and `0x1` for a failure; details are in the log file.

Never schedule a restore without `--only-verify`: with `--yes` it would switch the app to the restored data.

### 8.6 Restoring

The restore asks where from (the backup folder or a copy) and which backup (newest first), then:

1. fetches it, checks its checksum, decrypts it and checks every part against the manifest;
2. **settings file** (when in the backup): asks whether to put it over the current one (kept as
   `<settings file>.before-restore-<time>`); on a computer without a settings file it is put back
   without asking;
3. restores the database into a **new database** `<name>_r<time>`; the current database is not touched;
4. checks it: the same migrations, row-level security still forced on every table, and the row count of
   every table compared with the check made at backup time (differences are listed; changes made while
   the backup ran cause small ones);
5. **certificates** (when in the backup): asks; the current ones are saved first as
   `backups/caddy-data-before-restore-<time>.tar.gz`;
6. **switches** when you agree (about a minute without service): stops the app and worker, keeps the
   current settings as `<settings file>.before-switch-<time>`, sets `DB_NAME` to the new database (with a
   managed database, the database name in the three URLs), starts everything, waits until it is ready,
   and checks that `DATA_ENCRYPTION_KEY` reads every stored secret (two-factor and webhook secrets).

Everything written after the backup was taken is not in the restored database. The previous database is
kept; the script prints the command to delete it when you no longer need it. **To undo a restore,** copy
`<settings file>.before-switch-<time>` back over the settings file and run start. If the key check
fails, restore the settings file from the same backup, or put the key the backup was made with in
`DATA_ENCRYPTION_KEYS_PREVIOUS` (§4, rotating the key).

### 8.7 Testing a backup

*Test a backup* (`--only-verify`) does steps 1 and 3–4 in a scratch database, then deletes it; nothing else
changes and the app keeps running. Test the newest off-site copy every week (§8.5) and after changing
copy settings.

### 8.8 Rebuilding a lost server

1. Set up the new computer (§8.1) and get the code: the same version as the backup or newer (the restore
   shows the version the backup was made with; newer code upgrades the restored database when it starts).
2. Bring what reaches a copy (the USB drive; the SSH key and `known_hosts`; or the bucket's access key) and
   the passphrase.
3. Run `ops/restore.sh --env prod` (Windows `ops\restore.bat --env prod`), choose the copy (it asks for the
   connection settings), the backup and the passphrase. With no `.env.production` on the computer, the
   settings file comes back from the backup; the database and certificates follow and the app starts.
4. If the server's address changed, update DNS. Set up the backup copies and schedules again
   (`.env.backup` is not in backups).

A backup without the settings file needs `.env.production` written first, with the same
`DATA_ENCRYPTION_KEY` (two-factor and webhook secrets cannot be read without it); new database
passwords are fine with the bundled database, which creates its roles on first start. A new
`SESSION_SECRET` signs everyone out.

### 8.9 With a managed database

With `DATABASE_URL` set (§3.3), backups read the database through `BACKUP_DATABASE_URL`; a restore
creates the new database on the managed server through `RESTORE_ADMIN_URL` (taken from the settings file,
or asked), checks it as the backup role, and switches the three URLs. The admin role needs to create
databases and be a member of the owner role (`GRANT midad_owner TO <admin>`); it needs no superuser
rights.

### 8.10 What has been tested

The drill in TEST_REPORT §4 ran both scripts against the two-instance production stack with ClamAV,
holding a school with a 20-student online test, an owner with two-factor sign-in, a webhook (its secret
stored encrypted) and a homework photo. The copy targets were containers: an SFTP server (with a key and
with a password) and an S3-compatible server, plus a folder. The managed-database mode ran against a
separate PostgreSQL with an admin that is not a superuser. The Windows script ran under PowerShell 7.4
on Linux; it has **not yet run on Windows** (Docker Desktop, Windows PowerShell 5.1, `cmd.exe`). Before
relying on it, do one backup, test and restore on the Windows computer.
