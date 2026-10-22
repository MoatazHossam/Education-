# Curriculum Scope

Multi-tenant SaaS for planning which Egyptian K-12 curriculum materials an organization covers —
derived from the **Egypt Curriculum Picker** Claude Artifact (original source preserved in
[`legacy/`](legacy/README.md)).

Teams pick Ministry books, language-school variants, external references and international
programmes for grades 1–12 in the original picker interface; selections are saved as shared,
versioned **content scopes**, exported (TXT/CSV/JSON) or read by API. Around it: accounts with
2FA, organizations and roles, plans and billing, an audit log, and a platform admin console.
English and Arabic (RTL).

> **Status: not production ready.** Functionally complete and tested locally; blocked on
> payment-provider credentials, hosting/monitoring, CI on GitHub and legal review.
> See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Quick start (Docker)

```bash
cp .env.docker.example .env.docker      # set passwords; SESSION_SECRET=$(openssl rand -base64 48); DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose --env-file .env.docker up --build
# App: http://localhost:3000 · Mailpit (emails): http://localhost:8025
docker compose --env-file .env.docker exec app node dist/cli/create-platform-admin.js --email you@example.com
```

## Development

```bash
npm ci
cp .env.example .env    # see docs/DEPLOYMENT_GUIDE.md §1 for creating the roles and database
set -a; . ./.env; set +a
npm run db:migrate && npm run db:seed   # seed prints demo logins (development only)
npm run dev             # web app on :3000
npm run dev:worker      # emails + billing lifecycle
```

| Command | Purpose |
| --- | --- |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm test` | Unit + integration tests (needs `TEST_PG_ADMIN_URL`, a PostgreSQL superuser URL) |
| `npm run test:e2e` | Playwright end-to-end journeys |
| `npm run build` / `npm start` / `npm run start:worker` | Production build and processes |
| `scripts/backup.sh`, `scripts/restore.sh`, `scripts/verify-backup.sh` | Backups (see docs) |
| `node scripts/perf-smoke.mjs` | Latency/throughput probe |

## Layout

```
src/            server (Fastify + TypeScript)
  auth/ orgs/ scopes/ catalog/ billing/ admin/ api-v1/ notifications/ audit/ jobs/ db/ http/ lib/ cli/
public/         single-page front end (vanilla ES modules, EN/AR)
tests/          unit/, integration/ (real PostgreSQL), e2e/ (Playwright)
deploy/         Postgres role init, Caddyfile
scripts/        backup/restore/verify, performance probe
legacy/         the original artifact, verbatim
docs/           product, architecture, security, API, billing, deployment, testing, commercial, status
```

## Documentation

[Product overview](docs/PRODUCT_OVERVIEW.md) ·
[Current state](docs/CURRENT_STATE_ASSESSMENT.md) ·
[Feature inventory](docs/FEATURE_INVENTORY.md) ·
[Gap analysis](docs/GAP_ANALYSIS.md) ·
[Requirements](docs/PRODUCT_REQUIREMENTS.md) ·
[Architecture](docs/SAAS_ARCHITECTURE.md) ·
[Database](docs/DATABASE_DESIGN.md) ·
[Security](docs/SECURITY_DESIGN.md) ·
[API](docs/API_DOCUMENTATION.md) ·
[Subscriptions](docs/SUBSCRIPTION_MODEL.md) ·
[Deployment](docs/DEPLOYMENT_GUIDE.md) ·
[Test strategy](docs/TEST_STRATEGY.md) ·
[Test report](docs/TEST_REPORT.md) ·
[Commercial feasibility](docs/COMMERCIAL_FEASIBILITY.md) ·
[Roadmap](docs/IMPLEMENTATION_ROADMAP.md) ·
[Project status](docs/PROJECT_STATUS.md)
