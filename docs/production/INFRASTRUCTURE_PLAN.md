# Infrastructure plan

Audited: `main` at `d66de3b`. Evidence labels as in [PRODUCTION_READINESS_AUDIT.md §0](PRODUCTION_READINESS_AUDIT.md).
Target: one Linux VPS, 4 vCPU / 8 GB RAM, Docker Compose, PostgreSQL 16 with encrypted off-server backups.
No Kubernetes and no service split is proposed: the measured load (below) does not need them.

## 1. Current deployment as built [V-code]

| Service | Image | Role | Health | Source |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | Database (bundled; optional when managed) | `pg_isready` | `docker-compose.yml:67-91` |
| `migrate` | `midad:${APP_IMAGE_TAG}` | One-shot: migrations, then catalogue seed | exit code | `docker-compose.yml:95-105` |
| `app`, `app2` | same | Web/API, stateless | `/healthz` (Dockerfile), `/readyz` (Caddy) | `docker-compose.yml:107-116`, `docker-compose.prod.yml:24-37`, `Dockerfile:36-37` |
| `worker` | same | Jobs loop, file checks | DB heartbeat (`dist/cli/worker-health.js`) | `docker-compose.yml:118-133` |
| `clamav` | `clamav/clamav:1.5` | Virus scan (clamd) | `clamdcheck.sh`, 180 s start | `docker-compose.prod.yml:54-65` |
| `caddy` | `caddy:2.10-alpine` | TLS, compression, load balancing | — | `docker-compose.prod.yml:78-94`, `deploy/Caddyfile` |
| `mailpit` | dev only | — | — | `docker-compose.prod.yml:75-76` |

Good practice already present: non-root image; log rotation on every container (`docker-compose.yml:8-12`);
database not published to the host (`docker-compose.yml:90-91`); app ports removed in production
(`docker-compose.prod.yml:15`); 5 s drain on SIGTERM with `/readyz` reporting `draining`
(`src/server.ts:19-37`); readiness includes "schema current" (`src/http/health.ts:14-25`); DB statement timeout
30 s and connection timeout 10 s (`src/db/index.ts:17-24`); rolling restart script (`scripts/rolling-restart.sh`).

## 2. Findings

| ID | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| I-1 | No memory or CPU limits on any container; one runaway (ClamAV reload, image decode) can push PostgreSQL into the OOM killer | High | No `mem_limit`/`deploy.resources` in either compose file [V-code] |
| I-2 | PostgreSQL runs with stock settings (`shared_buffers` 128 MB etc.) | Medium | `docker-compose.yml:67-91` has no `command:` or config mount [V-code] |
| I-3 | **Rollback through `ops/start.sh` fails after a release that added a migration** | High | See §6 [V-code, not executed] |
| I-4 | Images are built on the production host; only one `previous` tag is kept; no registry, no digests | Medium | `ops/midad.sh:206-231`, `scripts/rolling-restart.sh:26-35` [V-code] |
| I-5 | Bundled database has daily logical backups only: RPO 24 h, no point-in-time recovery | Medium | `docs/DEPLOYMENT_GUIDE.md §5` [DOC] |
| I-6 | Homework files live in PostgreSQL (`bytea`), default quota 1 GB per school | Medium | `0013_classroom.ts:127`, `src/billing/entitlements.ts:9` [V-code] |
| I-7 | ClamAV needs ~1.5 GB and may briefly need about twice that while reloading signatures | High on 8 GB | `docker-compose.prod.yml:49-53` [V-code]; reload behaviour [ASSUMPTION — ClamAV default `ConcurrentDatabaseReload yes`; confirm in the image] |
| I-8 | Logs stay on the host (json-file, 50 MB per container); no central search or retention | Low | `docker-compose.yml:8-12` [V-code] |
| I-9 | No host metrics (disk, memory, load) or external uptime check yet | Medium | `docs/DEPLOYMENT_GUIDE.md §6` [DOC] |
| I-10 | `SHUTDOWN_DRAIN_MS` 5 s and Caddy health every 2 s are tuned; long AI requests (up to minutes) are cut at `stop_grace_period: 30s` | Low | `docker-compose.prod.yml:19,22`, AI_COST_CONTROL_PLAN §2 |

## 3. Memory and CPU budget on 4 vCPU / 8 GB

Estimates **[ASSUMPTION]** from typical footprints; to be measured on the target host (§9).

| Component | Steady | Peak | Proposed limit | Notes |
| --- | --- | --- | --- | --- |
| Host OS, Docker, sshd | 0.5 GB | 0.7 GB | — | |
| PostgreSQL 16 | 2.3 GB | 3.0 GB | 3.0 GB | `shared_buffers=2GB` + work_mem × active queries |
| `app` ×2 (Node 22) | 2 × 0.25 GB | 2 × 0.6 GB | 768 MB each, `--max-old-space-size=512` | 5 MB uploads are buffered in memory; Argon2 uses 19 MiB per concurrent hash, 4 at a time (libuv pool) |
| `worker` (Node + sharp/libvips) | 0.3 GB | 0.8 GB | 1 GB | `limitImageWork()` in `src/worker.ts:36`; images ≤ 100 MP |
| `clamav` | 1.3 GB | 2.6 GB (reload) | 2.5 GB with `ConcurrentDatabaseReload no` | Without that setting the reload peak can exceed the limit |
| `caddy` | 0.05 GB | 0.1 GB | 256 MB | |
| Page cache headroom | rest | | | PostgreSQL relies on it |
| **Total of limits** | | | **≈ 8.3 GB** | Slightly over 8 GB on purpose (not all peak together); add 2 GB swap as a safety net |

CPU: the measured exam load (300 students, 5 teachers, about 1,900 requests/min, p95 ≤ 79 ms) used a
two-instance local stack **[DOC]** `docs/TEST_REPORT.md §5`. On 4 vCPU the expected bottleneck is Argon2 during
mass sign-in at the start of an exam (each hash tens of milliseconds on one core **[ASSUMPTION]**) and ClamAV
scanning bursts of hand-ins. Neither needs more machines at launch scale; both need measuring (§9).

**When to grow:** sustained CPU > 70 %, PostgreSQL cache hit < 99 %, or database > 50 % of disk. Next steps in order:
(1) 8 vCPU / 16 GB on the same provider; (2) managed PostgreSQL; (3) object storage for files; (4) ClamAV on a
small second VM. Kubernetes is not warranted at this scale.

## 4. Storage

- **Database size driver:** homework files (I-6). 100 schools at the 1 GB default would be about 100 GB of
  `bytea` plus TOAST overhead. Backups (`pg_dump --compress=6`) gain little on JPEG/PDF data.
- **Launch:** 160 GB+ NVMe volume, encrypted (provider option or LUKS); set per-plan `max_storage_mb` deliberately
  (a platform admin can, `src/admin/routes.ts:33`); alert at 70 % disk.
- **Later (when DB > ~50 GB or restore time > RTO):** move `classroom_files.data` to S3-compatible storage
  (bucket per environment, server-side encryption, private, signed URLs of minutes, the worker still scans before
  release). This is a contained change: `saveFile`, `openable`/`sendFile` in `src/classroom/files.ts` and the
  file-check worker.

## 5. PostgreSQL

Proposed settings for 8 GB host with ~3 GB for PostgreSQL **[ASSUMPTION — validate with pgtune-style checks and
load test]**, passed as `command:` flags or a mounted `postgresql.conf`:

```
shared_buffers = 2GB
effective_cache_size = 4GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 60          # 2×10 app + 3 worker + migrate + backup + admin, with margin
wal_compression = on
checkpoint_completion_target = 0.9
random_page_cost = 1.1        # NVMe
log_min_duration_statement = 500ms
idle_in_transaction_session_timeout = 60s
shm_size: 1gb                 # compose service setting, needed for shared memory
```

Point-in-time recovery: either a managed PostgreSQL with PITR (recommended once revenue allows; the compose files
already support `DATABASE_URL` + `--scale postgres=0`, `docker-compose.yml:20-24`) or WAL archiving from the
bundled container with pgBackRest or WAL-G to the same off-site bucket. Target RPO 15 min, RTO 4 h.

## 6. Migrations and rollback

**What exists [V-code].** Kysely migrator with a static registry (`src/db/migrator.ts:21-52`); migrations run by the
schema owner, then privileges granted to the runtime role (`migrator.ts:64-73`); readiness fails while migrations
are pending (`src/http/health.ts:17-18`); documented rule: migrations must be backward compatible so a rollback only
needs the old image (`docs/DEPLOYMENT_GUIDE.md §4`). Down migrations exist but are not part of the rollback runbook.

**I-3 — rollback via `ops/start.sh` [V-code, not executed].** The documented rollback is "set
`APP_IMAGE_TAG=previous` and run `ops/start.sh --env prod`" (`docs/DEPLOYMENT_GUIDE.md §4.3`). That runs
`docker compose up -d` (`ops/midad.sh:217, 233`), which starts the `migrate` service from the previous image.
Its `migrateToLatest` (`src/db/migrator.ts:54-58`) uses Kysely, which throws
`corrupted migrations: previously executed migration X is missing` when the database has a migration the old code
does not know (`node_modules/kysely/dist/esm/migration/migrator.js:496`). `app`, `app2` and `worker` depend on
`migrate` completing successfully (`docker-compose.yml:114-116, 131-133`), so they would not start.
The other documented path, `APP_IMAGE_TAG=previous scripts/rolling-restart.sh` without `--build`, uses
`up -d --no-deps` (`scripts/rolling-restart.sh:38-44`) and skips `migrate`, so it should work.
*Fix options:* (a) make `migrate-cli up` treat "database ahead of code" as success when all known migrations are
applied; or (b) change the runbook to the rolling path only and make `ops/start.sh` skip `migrate` when
`APP_IMAGE_TAG=previous`. (a) is safer. *Acceptance:* a scripted drill — release N+1 with a new migration, roll back
to N with both paths, `/readyz` 200 on both instances.

**Release artefacts (I-4).** Build in CI, push to a private registry (GHCR) tagged with the git SHA, deploy by
digest; keep the last 5 releases. Until CI runs on GitHub (B-7), build locally with `scripts/ci-local.sh` and push
from there.

## 7. Health checks and monitoring

Existing [V-code]: `/healthz` (liveness, no dependencies), `/readyz` (DB, schema, draining), worker heartbeat with
2-minute alert, ClamAV health, eight in-app alerts sent by email or webhook (`src/ops/alerts.ts`,
`docs/DEPLOYMENT_GUIDE.md §6`).

To add at launch:
1. External uptime check of `https://<domain>/readyz` every minute from outside the region (also catches TLS
   expiry) **[DOC]** already recommended.
2. Host metrics: disk, memory, swap, load; Docker container restarts (node_exporter + a hosted Grafana/Prometheus
   free tier, or the VPS provider's monitoring).
3. Log shipping (Vector or Promtail → a hosted log service in an approved region), 30-day retention; logs contain
   no request bodies (`src/app.ts:50-54`).
4. Backup success/failure alert (cron mail or the log service) and a weekly verified restore **[DOC]** §8.5.

## 8. Recommended hosting configuration

| Item | Recommendation |
| --- | --- |
| Server | 1 × VPS, 4 vCPU (dedicated or high-share), 8 GB RAM, 160 GB+ NVMe, encrypted volume, 2 GB swap |
| OS | Ubuntu 24.04 LTS or Debian 12, unattended security updates, SSH keys only, no root login |
| Runtime | Docker Engine + Compose v2 (as now) |
| Region | **Decided after legal review** (L-1). Options: an EU region (cheapest, e.g. Hetzner/OVH) if counsel permits cross-border transfer for Egyptian schools; a Gulf region (AWS `me-central-1` UAE, Azure UAE North, Google `me-central2` Dammam, Oracle Jeddah) if KSA/UAE customers require in-region hosting [ASSUMPTION — region availability to confirm] |
| Network | Ports 22 (restricted to admin IPs), 80, 443 only; host firewall with egress rules (SECURITY_GAP_ANALYSIS S-12) |
| Database | Bundled PostgreSQL 16 tuned per §5 at launch; managed PostgreSQL with PITR in the same region when affordable |
| Backups | Daily encrypted `ops/backup.sh` to an S3-compatible bucket at a different provider, 30 daily + 12 monthly, bucket versioning/object lock; weekly verified restore |
| Edge | Optional CDN/WAF in front only after setting Caddy `trusted_proxies` |
| Email | Transactional SMTP provider with SPF, DKIM, DMARC on the sending domain |
| Staging | A second, smaller VPS (2 vCPU/4 GB, ClamAV on) with the same compose files, Paymob test mode, AI provider with a low cap |

## 9. Verification commands

```bash
# Compose files render and include limits once added
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production config | grep -nE "mem_limit|memory:"

# Health
curl -fsS https://$DOMAIN/healthz && curl -fsS https://$DOMAIN/readyz
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production ps

# Memory under load (run during scripts/load-exam.mjs on staging)
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"

# PostgreSQL settings and cache hit ratio
docker compose ... exec postgres psql -U postgres -c "SHOW shared_buffers; SHOW max_connections;"
docker compose ... exec postgres psql -U postgres -d midad -c "SELECT sum(blks_hit)*100/nullif(sum(blks_hit+blks_read),0) AS hit_pct FROM pg_stat_database;"

# Database and file storage size
docker compose ... exec postgres psql -U postgres -d midad -c "SELECT pg_size_pretty(pg_database_size('midad')), pg_size_pretty(pg_total_relation_size('classroom_files'));"

# Backup and restore drill
ops/backup.sh --env prod && ops/restore.sh --env prod --only-verify

# Rollback drill (after the I-3 fix), on staging
APP_IMAGE_TAG=previous scripts/rolling-restart.sh && curl -fsS https://$STAGING/readyz
```
