# AI cost control plan

Audited: `main` at `d66de3b`. Evidence labels as in [PRODUCTION_READINESS_AUDIT.md §0](PRODUCTION_READINESS_AUDIT.md).
Provider prices change often; all money figures here are placeholders **[ASSUMPTION]** to be filled from the chosen
provider's price page on the day of launch.

## 1. What exists [V-code]

| Control | Implementation | Source |
| --- | --- | --- |
| One provider per server | `AI_PROVIDER` = `none` / `gemini` / `anthropic` / `openai`, model in `AI_MODEL` | `src/config.ts:83-88`, `src/ai/providers/index.ts` |
| Off by default | `ai_requests_per_month` is 0 on every plan until a platform admin sets an override | `src/billing/entitlements.ts:49-50`, `src/billing/plans.ts` |
| Staff only | Students refused inside `runAiTask` | `src/ai/service.ts:69-70` |
| Monthly request quota per school | One unit consumed before the provider call, inside the tenant transaction; concurrent requests cannot overrun | `src/ai/service.ts:76-82`, `src/billing/entitlements.ts:129-149` |
| Refund on failure | Unit released when the provider failed on the first attempt | `src/ai/service.ts:113` |
| Size bounds | Prompt ≤ 60,000 characters; output ≤ `AI_MAX_OUTPUT_TOKENS` (default 16,000) | `src/ai/service.ts:26, 72, 88`, `src/config.ts:88` |
| Route limit | Test-question suggestions: 30 per hour per caller | `src/classroom/tests-routes.ts:264` |
| Usage log | `ai_requests`: org, user, feature, provider, model, status, attempts, input/output tokens, duration; no text; 400-day retention; RLS | `src/db/migrations/0017_ai_requests.ts`, `src/jobs/tasks.ts:72` |
| Admin view | Per-school requests and token sums this month; "Test the connection" | `src/ai/routes.ts:19-80` |
| Audit | `ai.request` audit entry per call with tokens | `src/ai/service.ts:114-119` |

The foundation (atomic quota, logging without content, staff-only) is good. What is missing is money.

## 2. Gaps

| ID | Gap | Severity | Evidence |
| --- | --- | --- | --- |
| A-1 | Quotas count **requests**, not tokens or money. One request can use up to 60,000 prompt characters and 16,000 output tokens, and a JSON retry costs a second full call without a second unit | High | `service.ts:26, 29, 88, 154` [V-code] |
| A-2 | **No platform-wide spend cap** or circuit breaker: if many schools get allowances, nothing stops the monthly bill except per-school counts | High | No such check in `src/ai/` [V-code] |
| A-3 | No cost model: tokens are stored but never priced; no per-plan or per-school margin view | Medium | `src/ai/routes.ts:42-50` sums tokens only [V-code] |
| A-4 | Worst-case latency is very long: `AI_TIMEOUT_MS` 120 s per attempt, SDK retries 2 (3 attempts), and 2 attempts for valid JSON — up to about 12 minutes holding one HTTP request | Medium | `src/config.ts:87`, `src/ai/providers/gemini.ts:28`, `anthropic.ts:32`, `openai.ts:23`, `service.ts:29` [V-code] |
| A-5 | Allowances are per school only; no per-user daily cap beyond the 30/hour route limit | Low | [V-code] |
| A-6 | Monthly period is UTC (`periodKey`), while schools work in local time | Low | `src/lib/time.ts:22-25` [V-code] |
| A-7 | No plan includes AI; pricing of AI for customers undecided | Business | B-10 [DOC] |
| A-8 | Two more AI features (homework suggestions, teaching plans) exist on an unmerged branch and will raise usage | Info | `claude/friendly-rubin-hmemjl` `e6d2b46..5ac2daf` |

## 3. Target controls

Layered, cheapest first:

1. **Provider-side hard limit (no code).** Set a monthly budget/alert in the provider's console (Google Cloud
   billing budget for Gemini, Anthropic/OpenAI workspace spend limits) at, say, 120 % of the expected bill.
   This is the last line if everything else fails. **[ASSUMPTION — feature names differ per provider]**
2. **Token budget per school** (replaces or complements request counts): `ai_tokens_per_month` limit; consume an
   *estimate* before the call (prompt characters / 3 + requested max output), then settle to actual tokens from the
   reply inside the same `finish` transaction. Count JSON retries.
3. **Platform spend cap**: a `ai_platform_budget` setting (money per month) and a price table
   `ai_model_prices(provider, model, input_per_mtok, output_per_mtok, currency, valid_from)`; before each call,
   refuse new requests with `AI_BUSY` when month-to-date estimated spend ≥ cap; operational alert at 80 % and
   100 %.
4. **Per-user daily cap** (e.g. 50 requests/day) to stop one account draining a school's allowance.
5. **Shorter worst case**: `AI_TIMEOUT_MS` 60 s, provider retries 1, keep 2 JSON attempts → worst case about
   4 minutes; longer tasks (teaching plans) as background jobs with a status endpoint, not a held HTTP request.
6. **Model routing**: a small/fast model for structured suggestions; a larger one only for features that need it.
   Configuration becomes `AI_MODEL_DEFAULT` + per-feature override, still one provider.
7. **Prompt caching** where the provider supports it for repeated system prompts **[ASSUMPTION]**.
8. **Reporting**: cost per school, per feature, per plan this month; margin against what the school pays.

## 4. Budget worksheet (fill before launch)

| Input | Value | Source |
| --- | --- | --- |
| Provider and model | Gemini (chosen 2026-10-28), model TBD | B-10 [DOC] |
| Price per 1M input / output tokens | TBD | Provider price page |
| Typical tokens per test-question request | Measure: run 20 real requests on staging; read `ai_requests` | `npm run ai:check`, then the admin AI card |
| Requests per teacher per month | Assumption until pilot | Pilot |
| Teachers per school | Assumption until pilot | Pilot |
| Allowance per plan | Decision D-6 | Owner |
| Platform monthly cap | Decision D-6 | Owner |

`cost per school ≈ requests × (avg_in × price_in + avg_out × price_out) × (1 + retry_rate)`

## 5. Data-exposure controls (cost-adjacent)

Choose a paid tier whose terms exclude training on inputs; record provider, region and retention terms in the
privacy notice and DPA; keep students out (already enforced). See SECURITY_GAP_ANALYSIS S-11.

## 6. Implementation steps

| Step | Depends on | Acceptance criteria | Verification |
| --- | --- | --- | --- |
| AI-1 Provider console budget + key on staging | Key (C-5) | `npm run ai:check` passes; console alert configured | `npm run ai:check` |
| AI-2 Timeouts and retries reduced (config + adapter default) | — | Worst case ≤ 4 min in a simulator test with a hanging provider | `npm run test:integration -- ai ai-providers-contract` |
| AI-3 Price table + month-to-date spend + platform cap | D-6 | With cap reached, new calls get 503 `AI_BUSY` and an alert fires; existing tests pass | New integration test using `tests/helpers/ai-simulator.ts` |
| AI-4 Token budget per school (estimate then settle) | AI-3 | Concurrent requests cannot exceed the token budget by more than one request's estimate | Concurrency test like the existing quota test |
| AI-5 Per-user daily cap | — | 51st request in a day by one user gets 429 | Integration test |
| AI-6 Cost report in platform admin | AI-3 | Admin AI card shows spend per school and per feature | E2E admin journey |
| AI-7 Plan allowances | D-6 | Plans carry AI limits; overrides still work | `npm run test:unit -- billing-logic` |

## 7. Verification commands

```bash
npm run test:unit -- ai-layer question-suggestions
npm run test:integration -- ai ai-providers-contract test-question-suggestions
AI_PROVIDER=gemini AI_API_KEY=... AI_MODEL=... npm run ai:check
# Month-to-date tokens per school (as the backup or owner role)
psql "$BACKUP_DATABASE_URL" -c "SELECT org_id, count(*), sum(input_tokens), sum(output_tokens) FROM ai_requests WHERE created_at >= date_trunc('month', now()) GROUP BY 1 ORDER BY 3 DESC NULLS LAST;"
```
