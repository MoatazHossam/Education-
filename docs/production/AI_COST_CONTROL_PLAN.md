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
| Token budget per school (AI-4) | `ai_tokens_per_month`: an estimate reserved before each call (and each second attempt), settled to the reply's counts; tokens counted for every school | `src/ai/service.ts` (`estimateTokens`, `runAiTask`), `src/billing/entitlements.ts` (`consumeUsage` amount, `adjustUsage`), migration 0021 |
| Daily cap per member (AI-5) | `AI_USER_DAILY_LIMIT` (50) requests a day per member per school; 429 `AI_DAILY_LIMIT`; unit given back on failure | `src/ai/service.ts` (`takeDailyUnit`), `ai_user_daily` (migration 0021), cleanup in `src/jobs/tasks.ts` |
| AI limits on plans (AI-7) | Every plan carries `ai_requests_per_month` (0) and `ai_tokens_per_month` (null) until D-6; overrides per school still replace them | `src/billing/plans.ts` |
| Prices and cost per request (AI-3) | `ai_model_prices` entered by platform admins from the provider's price page (none assumed); each request priced when logged (`ai_requests.cost_usd_micros`) | `src/ai/costs.ts`, `src/ai/routes.ts`, migration 0022 |
| Platform budget (AI-3) | `AI_MONTHLY_BUDGET_USD`: new requests get 503 `AI_PAUSED` once the month's cost reaches it, or with no price for the model; alerts at 80 % and 100 % and for a missing price | `src/ai/costs.ts` (`checkPlatformBudget`), `src/ops/alerts.ts` |
| Cost report (AI-6) | Admin AI card: spending against the budget, cost per school and per feature, unpriced requests | `src/ai/routes.ts`, `public/js/views/admin.js` |

The foundation (atomic quota, logging without content, staff-only) is good. What is missing is money.

## 2. Gaps

| ID | Gap | Severity | Evidence |
| --- | --- | --- | --- |
| A-1 | Quotas count **requests**, not tokens or money. One request can use up to 60,000 prompt characters and 16,000 output tokens, and a JSON retry costs a second full call without a second unit. **Tokens fixed by AI-4**: a school can have a token budget, and a JSON retry takes a second estimate from it; money is AI-3 | High · **tokens fixed** | `service.ts:26, 29, 88, 154` [V-code] |
| A-2 | **No platform-wide spend cap** or circuit breaker: if many schools get allowances, nothing stops the monthly bill except per-school counts. **Fixed by AI-3**: `AI_MONTHLY_BUDGET_USD` with alerts (docs/AI_LAYER.md §3); it needs the model's prices entered | High · **fixed** | `src/ai/costs.ts` [V-code] |
| A-3 | No cost model: tokens are stored but never priced; no per-plan or per-school margin view. **Fixed by AI-3 and AI-6** for cost per request, school and feature; a margin against what each school pays waits for prices per plan (D-6) | Medium · **cost fixed** | `src/ai/routes.ts` [V-code] |
| A-4 | Worst-case latency is very long: `AI_TIMEOUT_MS` 120 s per attempt, SDK retries 2 (3 attempts), and 2 attempts for valid JSON — up to about 12 minutes holding one HTTP request. **Fixed by task 1.6**: 60 s, 1 retry (`AI_MAX_RETRIES`), and a deadline on each provider call; at most 4 min 20 s, a provider that never answers gives 503 after about 2 min (docs/AI_LAYER.md §2) | Medium · **fixed** | `src/config.ts:87`, `src/ai/providers/gemini.ts:28`, `anthropic.ts:32`, `openai.ts:23`, `service.ts:29` [V-code] |
| A-5 | Allowances are per school only; no per-user daily cap beyond the 30/hour route limit. **Fixed by AI-5**: `AI_USER_DAILY_LIMIT` (docs/AI_LAYER.md §3) | Low · **fixed** | [V-code] |
| A-6 | Monthly period is UTC (`periodKey`), while schools work in local time | Low | `src/lib/time.ts:22-25` [V-code] |
| A-7 | No plan includes AI; pricing of AI for customers undecided | Business | B-10 [DOC] |
| A-8 | Two more AI features (homework suggestions, teaching plans) exist on an unmerged branch and will raise usage | Info | `claude/friendly-rubin-hmemjl` `e6d2b46..5ac2daf` |

## 3. Target controls

Layered, cheapest first:

1. **Provider-side hard limit (no code).** Set a monthly budget/alert in the provider's console (Google Cloud
   billing budget for Gemini, Anthropic/OpenAI workspace spend limits) at, say, 120 % of the expected bill.
   This is the last line if everything else fails. **[ASSUMPTION — feature names differ per provider]**
2. **Token budget per school** (**done, AI-4**; complements request counts): `ai_tokens_per_month` limit; consume an
   *estimate* before the call (prompt characters / 2, since Arabic text can take a token per two characters, + requested
   max output), then settle to actual tokens from the reply inside the same `finish` transaction. JSON retries take
   another estimate.
3. **Platform spend cap** (**done, AI-3**): `AI_MONTHLY_BUDGET_USD` (US dollars a month) and a price table
   `ai_model_prices(provider, model, input_usd_per_mtok, output_usd_per_mtok)`, entered by platform admins; each
   request is priced when logged; before each call, new requests are refused with `AI_PAUSED` (not `AI_BUSY`, whose
   message says to try again in a minute) when the month's cost ≥ cap, or with no price for the model; operational
   alerts at 80 % and 100 % and for a missing price. A changed price applies to requests from then on (the audit
   keeps the previous one), instead of a `valid_from` history.
4. **Per-user daily cap** (**done, AI-5**: `AI_USER_DAILY_LIMIT`, 50 requests/day) to stop one account draining a school's allowance.
5. **Shorter worst case** (**done, task 1.6**): `AI_TIMEOUT_MS` 60 s, provider retries 1 (`AI_MAX_RETRIES`), keep 2
   JSON attempts, and a deadline on each provider call ((1 + retries) × timeout + 10 s per retry), because the
   Anthropic and OpenAI SDKs otherwise wait up to 60 s for a `retry-after` → worst case 4 min 20 s. Still open:
   longer tasks (teaching plans) as background jobs with a status endpoint, not a held HTTP request.
6. **Model routing**: a small/fast model for structured suggestions; a larger one only for features that need it.
   Configuration becomes `AI_MODEL_DEFAULT` + per-feature override, still one provider.
7. **Prompt caching** where the provider supports it for repeated system prompts **[ASSUMPTION]**.
8. **Reporting** (**done for cost, AI-6**): cost per school and per feature this month on the admin AI card; per
   plan and the margin against what the school pays wait for the plan prices (D-6).

## 4. Budget worksheet (fill before launch)

| Input | Value | Source |
| --- | --- | --- |
| Provider and model | Gemini (chosen 2026-10-28), model TBD | B-10 [DOC] |
| Price per 1M input / output tokens | TBD | Provider price page |
| Typical tokens per test-question request | Measure: run 20 real requests on staging; read `ai_requests` | `npm run ai:check`, then the admin AI card |
| Requests per teacher per month | Assumption until pilot | Pilot |
| Teachers per school | Assumption until pilot | Pilot |
| Allowance per plan | Decision D-6 | Owner |
| Platform monthly cap | Decision D-6, then `AI_MONTHLY_BUDGET_USD` | Owner |

`cost per school ≈ requests × (avg_in × price_in + avg_out × price_out) × (1 + retry_rate)`

## 5. Data-exposure controls (cost-adjacent)

Choose a paid tier whose terms exclude training on inputs; record provider, region and retention terms in the
privacy notice and DPA; keep students out (already enforced). See SECURITY_GAP_ANALYSIS S-11.

## 6. Implementation steps

| Step | Depends on | Acceptance criteria | Verification |
| --- | --- | --- | --- |
| AI-1 Provider console budget + key on staging | Key (C-5) | `npm run ai:check` passes; console alert configured | `npm run ai:check` |
| AI-2 **Done (task 1.6).** Timeouts and retries reduced (config + adapter default) | — | Worst case ≤ 4 min in a simulator test with a hanging provider (measured with the defaults: 503 `AI_UNAVAILABLE` after 120–122 s on all three adapters, TEST_REPORT §4) | `npm run test:integration -- ai ai-providers-contract` |
| AI-3 **Done in code; the budget and prices wait for D-6 and the provider's price page.** Price table + month-to-date spend + platform cap | D-6 | With cap reached, new calls get 503 (`AI_PAUSED`) and an alert fires; existing tests pass | `npm run test:integration -- ai-costs` |
| AI-4 **Done.** Token budget per school (estimate then settle) | — (built without prices: it counts tokens, not money) | Concurrent requests cannot exceed the token budget by more than one request's estimate (measured: 8 concurrent requests on a budget of 3 estimates, 3 reach the provider) | `npm run test:integration -- ai-limits` |
| AI-5 **Done.** Per-user daily cap | — | 51st request in a day by one user gets 429 | `npm run test:integration -- ai-limits` |
| AI-6 **Done.** Cost report in platform admin | AI-3 | Admin AI card shows spend per school and per feature | `npm run test:integration -- ai-costs`; E2E admin journey (prices) |
| AI-7 **Done in code; values wait for D-6.** Plan allowances | D-6 | Plans carry AI limits; overrides still work | `npm run test:unit -- billing-logic`, `npm run test:integration -- ai-limits` |

## 7. Verification commands

```bash
npm run test:unit -- ai-layer question-suggestions
npm run test:integration -- ai ai-providers-contract test-question-suggestions
AI_PROVIDER=gemini AI_API_KEY=... AI_MODEL=... npm run ai:check
# Month-to-date tokens per school (as the backup or owner role)
psql "$BACKUP_DATABASE_URL" -c "SELECT org_id, count(*), sum(input_tokens), sum(output_tokens) FROM ai_requests WHERE created_at >= date_trunc('month', now()) GROUP BY 1 ORDER BY 3 DESC NULLS LAST;"
```
