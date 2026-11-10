# Infrastructure plan

Audited: `main` at `d66de3b`. Evidence labels as in [PRODUCTION_READINESS_AUDIT.md §0](PRODUCTION_READINESS_AUDIT.md).
Target: one Linux VPS, 4 vCPU / 8 GB RAM, Docker Compose, PostgreSQL 16 with encrypted off-server backups.
No Kubernetes and no service split is proposed: the measured load (below) does not need them.

## 1. Current deployment as built [V-code]

| Service | Image | Role | Health | Source |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine@sha256:…` | Database (bundled; optional when managed) | `pg_isready` | `docker-compose.yml:67-91` |
| `migrate` | `midad:${APP_IMAGE_TAG}` | One-shot: migrations, then catalogue seed | exit code | `docker-compose.yml:95-105` |
| `app`, `app2` | same | Web/API, stateless | `/healthz` (Dockerfile), `/readyz` (Caddy) | `docker-compose.yml:107-116`, `docker-compose.prod.yml:24-37`, `Dockerfile:36-37` |
| `worker` | same | Jobs loop, file checks | DB heartbeat (`dist/cli/worker-health.js`) | `docker-compose.yml:118-133` |
| `clamav` | `clamav/clamav:1.5@sha256:…` | Virus scan (clamd) | `clamdcheck.sh`, 180 s start | `docker-compose.prod.yml:54-65` |
| `caddy` | `caddy:2.11-alpine@sha256:…` | TLS, compression, load balancing | — | `docker-compose.prod.yml:78-94`, `deploy/Caddyfile` |
| `mailpit` | dev only | — | — | `docker-compose.prod.yml:75-76` |

Every third-party image, and the app image's Node.js base (`node:22-bookworm-slim@sha256:…`), is pinned by digest
since task 1.9 (security finding S-15); Dependabot proposes new digests and tags weekly (`.github/dependabot.yml`,
`DEPLOYMENT_GUIDE.md` §4).

Good practice already present: non-root image; log rotation on every container (`docker-compose.yml:8-12`);
database not published to the host (`docker-compose.yml:90-91`); app ports removed in production
(`docker-compose.prod.yml:15`); 5 s drain on SIGTERM with `/readyz` reporting `draining`
(`src/server.ts:19-37`); readiness includes "schema current" (`src/http/health.ts:14-25`); DB statement timeout
30 s and connection timeout 10 s (`src/db/index.ts:17-24`); rolling restart script (`scripts/rolling-restart.sh`).

## 2. Findings

| ID | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| I-1 | ~~No memory or CPU limits on any container; one runaway (ClamAV reload, image decode) can push PostgreSQL into the OOM killer~~ **Fixed 2026-11-05 (task 1.4):** a memory limit per container (§3) | — | `docker-compose.prod.yml` [V-run, §3] |
| I-2 | ~~PostgreSQL runs with stock settings (`shared_buffers` 128 MB etc.)~~ **Fixed 2026-11-05 (task 1.4):** tuned for its memory limit (§5) | — | `docker-compose.prod.yml` [V-run, §5] |
| I-3 | ~~Rollback through `ops/start.sh` fails after a release that added a migration~~ **Fixed 2026-11-05 (task 1.2)** | — | See §6 [V-run] |
| I-4 | Images are built on the production host; only one `previous` tag is kept; no registry, no digests for the app image (base and third-party images are pinned by digest since task 1.9) | Medium | `ops/midad.sh:206-231`, `scripts/rolling-restart.sh:26-35` [V-code] |
| I-5 | Bundled database has daily logical backups only: RPO 24 h, no point-in-time recovery | Medium | `docs/DEPLOYMENT_GUIDE.md §5` [DOC] |
| I-6 | ~~Homework files live in PostgreSQL (`bytea`), default quota 1 GB per school~~ **Fixed 2026-11-07:** `FILE_STORAGE=s3` keeps them in any S3-compatible bucket, encrypted per file; `files:move` moves stored ones (§4). The database remains the default | — | `src/classroom/file-store.ts`, DEPLOYMENT_GUIDE §3.8 [V-run against MinIO, TEST_REPORT §4] |
| I-7 | ~~ClamAV needs ~1.5 GB and may briefly need about twice that while reloading signatures~~ **Fixed 2026-11-05 (task 1.4):** measured 0.94 GB steady and 1.89 GB during a reload; with `ConcurrentDatabaseReload no` the reload stays at 0.96 GB | — | [V-run, §3] |
| I-8 | Logs stay on the host (json-file, 50 MB per container); no central search or retention | Low | `docker-compose.yml:8-12` [V-code] |
| I-9 | No host metrics (disk, memory, load) or external uptime check yet | Medium | `docs/DEPLOYMENT_GUIDE.md §6` [DOC] |
| I-10 | `SHUTDOWN_DRAIN_MS` 5 s and Caddy health every 2 s are tuned; long AI requests (up to minutes) are cut at `stop_grace_period: 30s` | Low | `docker-compose.prod.yml:19,22`, AI_COST_CONTROL_PLAN §2 |

## 3. Memory and CPU budget on 4 vCPU / 8 GB

**In place since 2026-11-05 (task 1.4)** in `docker-compose.prod.yml`, each value changeable in the env file
(`docs/DEPLOYMENT_GUIDE.md §3.6`, with columns for 4 GB and 16 GB hosts). Measured [V-run] on the production-settings
stack under the 300-student exam load test (`docs/TEST_REPORT.md §4`, "Container memory limits"); the database there
is small, so PostgreSQL's figure will grow with real data, up to its limit.

| Component | Limit | Measured peak under load | Notes |
| --- | --- | --- | --- |
| Host OS, Docker, sshd | — | — | About 0.5–0.7 GB **[ASSUMPTION]** |
| PostgreSQL 16 | 3 GB | 157 MiB | `shared_buffers` 1 GB (§5); `shm_size` 1 GB |
| `app` ×2 (Node 22) | 768 MB each, heap 512 MB | 114 and 95 MiB | 5 MB uploads are buffered in memory; Argon2 uses 19 MiB per concurrent hash, 4 at a time (libuv pool) |
| `worker` (Node + sharp/libvips) | 1 GB, heap 512 MB | 77 MiB | `limitImageWork()` in `src/worker.ts`; images ≤ 100 MP |
| `clamav` | 2 GB | 962 MiB | 944 MiB steady; a signature reload reached 1,886 MiB with the default `ConcurrentDatabaseReload yes` and 956 MiB with `no` (set) |
| `caddy` | 256 MB | 29 MiB | |
| `migrate` (one-shot) | 768 MB, heap 512 MB | — | |
| Page cache headroom | rest | | |
| **Total of limits** | **≈ 8.3 GB** | | Slightly over 8 GB on purpose (not all peak together); add 2 GB swap as a safety net |

A container over its limit is handled inside it: in the test, a process in `worker` that kept allocating was stopped
by the kernel at its 1 GB limit (exit 137) while the worker itself, PostgreSQL and both app instances kept running
and `/readyz` answered 200. No CPU limits are set: sign-in bursts need all cores for Argon2, and a fixed `cpus` value
fails on a host with fewer cores.

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
- **When the database grows (> ~50 GB, or restore time > RTO): object storage, built 2026-11-07.**
  `FILE_STORAGE=s3` with the `S3_*` settings puts new homework files in a private bucket of any S3-compatible
  provider (one bucket per environment), and `npm run files:move -- --to s3` moves the stored ones
  (DEPLOYMENT_GUIDE §3.8). Each file is encrypted by the application before it is sent (its own AES-256-GCM key,
  kept encrypted with `DATA_ENCRYPTION_KEY`), so the provider's own encryption is a second layer, not the only one.
  Files are served through the application rather than by signed links: it decrypts them, and the access checks,
  the sandbox headers and the worker's check before release stay as they are; at 5 MB per file this costs little.
  The bucket needs its own backup (versioning, or a copy elsewhere): the ops scripts' backups hold the database
  only.

## 5. PostgreSQL

**In place since 2026-11-05 (task 1.4)** as `command:` flags in `docker-compose.prod.yml`, each changeable in the env
file; checked with `SHOW` on the running stack [V-run]:

```
shared_buffers = 1GB                    # POSTGRES_SHARED_BUFFERS
effective_cache_size = 2GB              # POSTGRES_EFFECTIVE_CACHE_SIZE
work_mem = 16MB                         # POSTGRES_WORK_MEM
maintenance_work_mem = 256MB            # POSTGRES_MAINTENANCE_WORK_MEM
max_connections = 80                    # POSTGRES_MAX_CONNECTIONS; about 50 in use (2×(10+5) app, 3+5 worker, migrate, backup, tools)
wal_compression = on
checkpoint_completion_target = 0.9
random_page_cost = 1.1                  # NVMe
log_min_duration_statement = 500ms
idle_in_transaction_session_timeout = 2min
shm_size: 1g                            # POSTGRES_SHM_SIZE; compose service setting, shared memory for parallel queries
memory limit: 3g                        # POSTGRES_MEMORY_LIMIT
```

Two changes from the first draft of this plan, for reasons found while doing it:
- `shared_buffers` 1 GB and `effective_cache_size` 2 GB rather than 2 GB and 4 GB: the container's memory limit also
  bounds the operating system's file cache for PostgreSQL's files, so the cache beyond `shared_buffers` is only what
  the 3 GB limit leaves after shared buffers and connections.
- `idle_in_transaction_session_timeout` 2 min rather than 60 s: the worker holds a transaction open while it waits
  for ClamAV (up to 30 s, longer than that while signatures reload) and while it resizes a photo.

No statement took 500 ms or more during the load test (none in the database log).

Point-in-time recovery: either a managed PostgreSQL with PITR (recommended once revenue allows; the compose files
already support `DATABASE_URL` + `--scale postgres=0`, `docker-compose.yml:20-24`) or WAL archiving from the
bundled container with pgBackRest or WAL-G to the same off-site bucket. Target RPO 15 min, RTO 4 h.

## 6. Migrations and rollback

**What exists [V-code].** Kysely migrator with a static registry (`src/db/migrator.ts`); migrations run by the
schema owner, then privileges granted to the runtime roles; readiness fails while migrations are pending
(`src/http/health.ts`); documented rule: migrations must be backward compatible (expand/contract) so a rollback only
needs the old image (`docs/DEPLOYMENT_GUIDE.md §4`). A down migration is part of the runbook only for a migration
that breaks that rule (0019, below).

**I-3 — rollback via `ops/start.sh`: fixed 2026-11-05 (task 1.2) [V-run].** The documented rollback is "set
`APP_IMAGE_TAG=previous` and run `ops/start.sh --env prod`" (`docs/DEPLOYMENT_GUIDE.md §4.3`). That runs
`docker compose up -d`, which starts the `migrate` service from the previous image, and `app`, `app2` and `worker`
start only when `migrate` succeeds (`docker-compose.yml`). Kysely's migrator throws
`corrupted migrations: previously executed migration X is missing` when the database has a migration the old code
does not know, so before the fix the stack did not come back.
*Fix (option (a) of this plan):* `migrateToLatest` (`src/db/migrator.ts`) compares the database's applied
migrations with the release's (`migrationStatus`). A database ahead of the release is accepted when the unknown
migrations all sort after the release's latest and every one of the release's is applied; `migrate-cli up` then
prints `Database is ahead of this release (rollback): … stay applied`. It still refuses, with what it found, an
unknown migration among the release's own (another branch) and a newer database that lacks one of the release's.
`migrate-cli down` refuses while the database has migrations the release does not know.
*Verification:*
- `tests/integration/migrator.test.ts` (3 tests): reproduces Kysely's error on a database a later release migrated,
  then shows `migrateToLatest` and the CLI succeed on it, and the two refusals.
- `scripts/rollback-drill.sh` on Docker (2026-11-05): builds release N from the checkout and N+1 = N plus migration
  `9000_rollback_drill` (a new table and a new column), starts N+1 with `ops/start.sh`, rolls back to N with
  `ops/start.sh`, goes forward again, and rolls back with `scripts/rolling-restart.sh`; after each step both app
  instances answer `/readyz` 200 on the expected image. On `main` before the fix it failed at the first rollback with
  the Kysely error above; with the fix it passed in 1 min 30 s. On staging it is launch item E-2 (task 2.7).

**Migration 0019 (task 1.1) is not backward compatible**: releases before it rely on the `app.rls_bypass`
setting it switched off, so going back past it needs `npm run db:migrate:down` once before the older
image (documented in `docs/DEPLOYMENT_GUIDE.md`). Nothing is deployed yet, so this costs nothing now.

**Release artefacts (I-4). Build in CI, push to a private registry (GHCR) tagged with the git SHA, deploy by
digest; keep the last 5 releases. GitHub Actions runs again (B-7 cleared 2026-11-01); `scripts/ci-local.sh` can still build locally and push
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

# Rollback drill, on staging (own Compose project with throwaway settings; needs ports 80 and 443 free)
scripts/rollback-drill.sh
```
