# Deployment guide

Nothing here has been deployed to a real production host from this repository; every step below
was run locally (development stack, Docker image, compose stack, backup and restore) as recorded
in TEST_REPORT.md.

## 1. Local development (no Docker)

Requirements: Node.js 22, PostgreSQL 16.

```bash
npm ci
# Create roles and the database (as a PostgreSQL superuser):
psql -U postgres <<'SQL'
CREATE ROLE curriculum_owner LOGIN PASSWORD 'dev-owner' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE curriculum_app   LOGIN PASSWORD 'dev-app'   NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE curriculum_scope OWNER curriculum_owner;
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
- strong random `SESSION_SECRET` (`openssl rand -base64 48`), `DATA_ENCRYPTION_KEY` (`openssl rand -base64 32`), DB passwords
- `EMAIL_TRANSPORT=smtp`, `SMTP_URL=smtps://user:pass@smtp.provider:465`, `EMAIL_FROM`
- `BILLING_PROVIDER=paymob` + `PAYMOB_*` (or `disabled`)
- `SALES_EMAIL` for the Enterprise "Contact sales" link

The app refuses to start in production with the sandbox provider, a non-SMTP mailer, a non-HTTPS
`APP_URL`, or a database role that bypasses RLS.

### 3.3 Start
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production ps
curl -fsS https://<domain>/readyz
```
Production runs two app instances (`app`, `app2`) behind Caddy, which balances requests between
them, checks `/readyz` every 2 s and routes around an instance that is restarting or down. Each
instance opens up to `DATABASE_POOL_MAX` (default 10) database connections: two instances and the
worker need about 21, well within PostgreSQL's default of 100 (check a managed plan's limit).

Caddy obtains TLS certificates automatically. With managed PostgreSQL, remove the `postgres`
service and point `DATABASE_URL`/`MIGRATION_DATABASE_URL` at it (create the three roles with the
SQL from `deploy/postgres-init/01-roles.sh`; on services without `BYPASSRLS` for customers, run
backups with the provider's tooling).

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

1. Take a backup (`scripts/backup.sh`), `git pull` (or check out a tagged release), then
   `scripts/rolling-restart.sh --build`. It rebuilds the image, applies new migrations with the
   old release still serving, then replaces `app`, waits until it is ready, replaces `app2`, and
   finally the worker. Each instance drains for 5 s before it stops, so the restart drops no
   requests (TEST_REPORT §4).
   Without `--build` it only restarts the instances, one at a time. If an instance does not
   become ready, the script stops and the other keeps serving.
2. Migrations must be backwards-compatible with the previous release (add columns/tables first,
   remove later) so a rollback only needs the old image.
3. Rollback: redeploy the previous image tag. If a migration must be reverted, restore from the
   pre-upgrade backup (take one with `scripts/backup.sh` before every release).

## 5. Backups and recovery

**Backup (daily, cron on the host):**
```bash
# /etc/cron.d/curriculum-scope-backup
15 2 * * * root cd /opt/curriculum-scope && docker compose --env-file .env.production exec -T postgres \
  sh -c 'pg_dump -U "$DB_BACKUP_USER" -d "$DB_NAME" --format=custom' > backups/cs-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).dump
```
or, with a reachable database, `BACKUP_DATABASE_URL=postgres://curriculum_backup:…@host/db scripts/backup.sh`
(checksums, optional `BACKUP_GPG_RECIPIENT` encryption, `RETENTION_DAYS` pruning). Copy dumps
off-site (object storage in another region) and keep at least 30 daily + 12 monthly copies **(assumption)**.

**Verify (weekly):** `RESTORE_ADMIN_URL=postgres://postgres:…@host/postgres scripts/verify-backup.sh <dump>`
restores into a scratch database, checks migrations, row counts, RLS and invariants, then drops it.

**Restore (incident):**
1. Stop writes: `docker compose … stop app worker`.
2. `RESTORE_ADMIN_URL=… scripts/restore.sh <dump> curriculum_scope_restored` (never overwrites the live DB).
3. Point `DATABASE_URL`/`MIGRATION_DATABASE_URL` to the restored database (or rename databases), run `migrate`, start `app` and `worker`.
4. Check `/readyz`, sign in, compare counts with the verification output; record the incident.

Targets **(assumptions)**: RPO 24 h with daily dumps (minutes with managed PITR), RTO 4 h.

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
- [ ] Backup taken and verified before migration
- [ ] `/readyz` 200; sign-up → verify → login works on production with real email
- [ ] Paymob test-mode run recorded (or billing disabled with manual invoicing)
- [ ] Platform admin created with TOTP; demo data absent
- [ ] Monitoring and alerts firing to a real channel
- [ ] Privacy policy, terms and support contact published
