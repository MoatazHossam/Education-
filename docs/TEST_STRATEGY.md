# Test strategy

## 1. Layers

| Layer | Tool | Location | Runs against | Purpose |
| --- | --- | --- | --- | --- |
| Unit | Vitest | `tests/unit` | pure functions | Billing maths (effective plan, proration), time helpers, crypto envelope, password hashing, TOTP replay, webhook signatures (sandbox, Paymob), export formats (text layout, CSV injection), configuration guards, translation completeness, **fidelity of the catalogue to the original artifact** |
| Integration | Vitest + `app.inject` | `tests/integration` | real PostgreSQL with production-like roles | API behaviour end to end inside the server, including database constraints and RLS |
| Provider contract | Vitest + local HTTP simulator | `tests/integration/paymob-contract.test.ts`, `tests/helpers/paymob-simulator.ts` | simulator of Paymob's documented API | The real Paymob adapter's requests, callbacks, signatures and invoice binding |
| End-to-end | Playwright (Chromium) | `tests/e2e` | real server process + real browser | User journeys, UI, crash recovery |
| Security (cross-cutting) | Vitest | `tenancy`, `authz-coverage`, `auth`, `billing` | | BOLA/IDOR, privilege escalation, CSRF, brute force, webhook forgery/replay, plan-limit bypass |
| Performance smoke | `scripts/perf-smoke.mjs` | — | running server | Latency/throughput of key endpoints |
| Operational | shell scripts | `scripts/*.sh`, Docker | real containers | Image build, compose health, backup → restore → verify |

### Why integration tests use a real database
Tenant isolation relies on PostgreSQL Row-Level Security, composite foreign keys and transaction
settings. Mocks would not exercise any of that. `tests/helpers/global-setup.ts` creates a fresh
database owned by a **non-superuser owner role** and runs the app as a separate **non-BYPASSRLS
app role**, mirroring production; RLS is genuinely enforced in every test.

## 2. Required journeys (from the brief) and where they are covered

| # | Journey | Covered by |
| --- | --- | --- |
| 1 | Register organization | `auth.test.ts`, E2E 1 |
| 2 | Verify email | `auth.test.ts`, E2E 1 |
| 3 | Log in | `auth.test.ts`, E2E 1 |
| 4 | Invite another user | `tenancy.test.ts`, E2E 2 |
| 5 | Assign a role | `tenancy.test.ts`, E2E 2 |
| 6 | Create a business record (scope + selections) | `scopes.test.ts`, E2E 1 |
| 7 | Verify tenant isolation | `tenancy.test.ts`, `authz-coverage.test.ts`, E2E 3 |
| 8 | Subscribe to a plan | `billing.test.ts`, E2E 4 |
| 9 | Enforce plan limits | `scopes.test.ts`, `admin-api-ops.test.ts`, E2E 5 |
| 10 | Upgrade or downgrade | `billing.test.ts`, E2E 4 |
| 11 | Cancel subscription | `billing.test.ts`, E2E 4 |
| 12 | Verify data persistence | `scopes.test.ts`, E2E 1 and 6 |
| 13 | Restore service after a recoverable failure | E2E 6 (server process killed and restarted; session and data survive); `billing.test.ts` (failed payment then retry); webhook failure is retryable by design; backup restore verified operationally |

## 3. Security test focus

- **Route enumeration** (`authz-coverage.test.ts`): reads the app's registered routes; every admin
  route must return 401/404 to anonymous/ordinary users, every org route 401/404 to non-members,
  v1 needs a key, and any new route outside those groups fails the test until added to an explicit
  allowlist.
- **RLS proofs**: unscoped queries return nothing; other-tenant context sees nothing; `WITH CHECK`
  blocks cross-tenant inserts; the app role cannot update audit rows or disable RLS.
- **Webhooks**: bad signature, stale timestamp, unknown provider, replayed event id, same
  transaction under a new event id, amount mismatch.
- **Limits**: concurrent invitations against a 2-seat plan (exactly one succeeds).

## 4. Performance targets (assumptions to confirm with real usage)

| Metric | Target |
| --- | --- |
| API read p95 (catalogue, scope) | < 300 ms at 20 concurrent users |
| Selection save p95 | < 300 ms |
| Export p95 | < 500 ms |
| Error rate under target load | 0% |

Run `node scripts/perf-smoke.mjs <url> <email> <password> [concurrency] [requests]` against a
staging host sized like production before launch; sandbox numbers are not capacity guarantees.

## 5. How to run

```bash
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres   # superuser for creating test DBs/roles
npm run lint && npm run typecheck
npm test                 # unit + integration (creates curriculum_scope_test)
npm run test:e2e         # Playwright (creates curriculum_scope_e2e, server on :3100)
```
CI runs the same commands (`.github/workflows/ci.yml`) plus `npm audit --omit=dev` and a Docker
build with a production-guard smoke test.

## 6. Gaps

- No automated accessibility audit (axe) yet; no cross-browser E2E (Firefox/WebKit).
- Paymob adapter tested against a simulator and an independent HMAC vector, not against Paymob; run `npm run paymob:check` with test-mode keys, then the staging checklist.
- No load test on production-sized infrastructure; no chaos testing of PostgreSQL failover.
- E2E runs Chromium only.
