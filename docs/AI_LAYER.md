# AI layer

**Status (2026-10-29): the provider-independent layer is built and tested, and the owner chose Google
Gemini. Four features for teachers are built on it (§6a): questions suggested for online tests, homework
suggestions, and drafts of lesson plans and pacing plans. A teacher reviews every result before anything is
saved. None has run against the real Gemini API yet: no key is set in this environment.** The Wise EduAgent integration and any AI that students use stay blocked
(PROJECT_STATUS B-8, B-9).

**To turn it on with Gemini:** set `AI_PROVIDER=gemini`, `AI_API_KEY` (a Gemini API key from Google AI
Studio, on a paid tier) and `AI_MODEL` (the Gemini model to use) as environment secrets; run
`npm run ai:check`; then give schools their monthly allowance (§5).

## 1. What it is

One provider for the whole server, chosen by configuration: **Google Gemini**, **Anthropic Claude** or
**OpenAI**. Every use of AI goes through one function, `runAiTask` (`src/ai/service.ts`), which is the
same for every provider. It enforces who may use AI and how much, sends the request, checks the reply,
and logs the request. Changing provider is a configuration change; features do not change.

| File | Role |
| --- | --- |
| `src/ai/types.ts` | The provider interface (`AiProvider.generate`), the reply, error kinds |
| `src/ai/providers/gemini.ts`, `anthropic.ts`, `openai.ts` | One adapter per provider, each through the provider's official SDK (`@google/genai` 2.32.0, `@anthropic-ai/sdk` 1.6.0, `openai` 7.45.1, pinned) |
| `src/ai/providers/index.ts` | The configured provider, or none |
| `src/ai/schema.ts` | Reply schemas in the form every provider accepts; checking a JSON reply |
| `src/ai/service.ts` | `runAiTask`: allowance, request, checks, log, audit |
| `src/ai/routes.ts` | Platform administration: status and use, connection test |
| `src/cli/ai-check.ts` | `npm run ai:check`: one real request, to check a key and model |
| `src/db/migrations/0017_ai_requests.ts` | The usage log and the `ai_requests` usage counter |

## 2. Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `none` | `none`, `gemini`, `anthropic` or `openai`. `none` turns AI off on the server |
| `AI_API_KEY` | — | The provider's API key. Required with a provider. An environment secret, never in git or a chat |
| `AI_MODEL` | — | The model id, e.g. `gemini-2.5-pro` or `claude-opus-5-5`. Required with a provider |
| `AI_API_BASE` | the provider's | Another endpoint: regional, a compatible service, or the simulator in tests. https in production |
| `AI_TIMEOUT_MS` | 60000 | Per attempt, 5000–600000 |
| `AI_MAX_RETRIES` | 1 | Retries after the first attempt of one provider call, 0–3. The SDKs retry timeouts, connection errors, 408, 429 and 5xx |
| `AI_MAX_OUTPUT_TOKENS` | 16000 | Most output tokens one request may use (thinking included on models that think) |
| `AI_USER_DAILY_LIMIT` | 50 | AI requests one member may make per day (UTC) in one school, 0–10000; 0 for no daily cap (§3) |
| `AI_MONTHLY_BUDGET_USD` | 0 | What all schools' AI requests may cost in a month, in US dollars, 0–1000000; 0 for no platform cap (§3) |

**How long a teacher can wait** (production finding A-4). Each provider call has a deadline:
(1 + `AI_MAX_RETRIES`) × `AI_TIMEOUT_MS`, plus 10 s before each retry for the SDK's backoff. The
Anthropic and OpenAI SDKs wait as long as a provider's `retry-after` asks, up to 60 s; a call still
running at its deadline is cancelled and counts as a timeout. A reply of the wrong shape is asked
for once more (§3), so the longest wait is two calls:

| | Defaults (60 s, 1 retry) | Before task 1.6 (120 s, 2 retries) |
| --- | --- | --- |
| Provider never answers | 503 `AI_UNAVAILABLE` after about 2 min (2 attempts and the backoff) | about 6 min |
| Longest possible | 2 × (2 × 60 s + 10 s) = 4 min 20 s | about 12 min, more with long `retry-after` waits |

`GET /api/admin/ai` shows the settings in force, with this bound as `settings.worstCaseMs`.

The app refuses to start with a provider but no key or model, and with a non-https `AI_API_BASE` in
production. After setting a key, run `npm run ai:check` (same variables): it sends one small request
with a JSON schema and checks the reply, without touching the database or any school's allowance.

**Before enabling a provider, check its current terms for API data.** Use a paid API tier whose terms
exclude using requests for training, and record the provider and region in the privacy notice and in
the agreement with schools (SECURITY_DESIGN §7). Google's Gemini API terms treat unpaid use differently
from paid use.

## 3. Rules every request follows

**Who.** Only staff of a school (owners, admins, editors, viewers, as each feature decides). A student
account is refused inside `runAiTask` whatever the route, so a mistake in a future route cannot open it.

**Which schools.** A school needs a monthly allowance, `ai_requests_per_month`. It is 0 on every plan
until AI is priced, so AI is off for every school until a platform administrator sets an allowance for
it (Platform admin → the school → "AI requests per month (override)"), as for student accounts. An
allowance of `null` (through the API) means no monthly cap. A school can also have a monthly **token
budget**, `ai_tokens_per_month` (input and output tokens together); it is `null`, no budget, on every plan
until the allowances per plan are decided (AI_COST_CONTROL_PLAN D-6), and a platform administrator sets
one per school ("AI tokens per month (override)", at most 1,000,000,000).

**How much one member.** Each member may make `AI_USER_DAILY_LIMIT` requests a day (50 by default) in
each school, so one account cannot use up the school's allowance. The day is the UTC day, like the
monthly period. The 51st request that day gets 429 `AI_DAILY_LIMIT` before the provider is called; others
in the school go on. The counts are kept in `ai_user_daily` (row-level security like every school's data)
and the worker removes them after a week.

**What is sent.** A feature sends curriculum material and the staff member's own instructions. It never
sends students' data: names, usernames, answers, marks, homework or files. Each feature's prompt is
reviewed for this before it is merged. A request is at most 60,000 characters.

**Counting.** Each request takes, in one transaction before the provider is called, one unit of the
month's allowance, one unit of the member's day and, when the school has a token budget, an estimate of
the tokens it may use. Each is an atomic conditional update, so concurrent requests cannot overrun any of
them, and a refused step gives back the units taken before it. The estimate is the prompt's characters / 2
(Arabic text can take a token per two characters, Latin text fewer) plus the output tokens the request
allows; a second attempt (after a reply of the wrong shape, "Checking the reply" below) takes another estimate, and stops with
`AI_INVALID_REPLY` when the budget has none left. When the request ends, the estimate is settled to the
tokens the reply reports; a reply without counts keeps the estimate as spent. Tokens are counted in
`usage_counters` (`ai_tokens`) whether or not the school has a budget, so a budget set mid-month starts
from the real use. If the provider fails without answering, the request unit, the day's unit and the
estimate are all given back. A refusal, a reply cut at the token limit, or an unusable reply keeps them:
tokens were spent.

Reservations never take the budget past its limit. Settling can, by what replies used beyond their
estimates; the estimate already counts the full output allowance, so only a prompt that tokenizes to more
than one token per two characters goes over.

**Prices.** A platform administrator enters what the provider charges for a model, per million input and
output tokens in US dollars, from the provider's price page (Platform admin → AI assistance; table
`ai_model_prices`). Nothing assumes a price: a model without one has none. Each request is priced when it is
logged, by the model that answered, else by the configured model, and the cost is kept in
`ai_requests.cost_usd_micros` (millionths of a dollar; one dollar per million tokens is one millionth of a
dollar per token, rounded up per request). A reply without token counts is priced at its estimate; a call that
failed without answering costs nothing; a request with no price for either model has no cost and is counted
as unpriced.

**Platform budget.** `AI_MONTHLY_BUDGET_USD` caps what all schools' requests may cost in a UTC month. Before any
allowance is taken, a request is refused with 503 `AI_PAUSED` when the month's cost has reached the budget, or
when a budget is set and the configured model has no price (the spending could not be measured). Requests
already running finish, so the month can end above the budget by what they cost. Operational alerts: AI
spending at 80 % of the budget or more (`ai_budget_high`), the budget reached (`ai_budget_reached`), and a budget
with no price for the model (`ai_price_missing`) (DEPLOYMENT_GUIDE §6). Set the budget and the model's prices
before giving any school an allowance; the provider console's own spending limit stays the last line
(AI_COST_CONTROL_PLAN AI-1).

**Checking the reply.** A feature that wants structured data gives a zod schema. The provider is asked
for JSON matching it (each provider's own structured-output mode), and the reply is checked against the
full schema on our side. If it does not match, the provider is asked once more; a second miss is an
error. The schema's portable form (`portableSchema`) keeps only what all three providers accept; length
and range limits are dropped from what is sent and still checked here. Every field must be required
(make optional ones `.nullable()`); the function refuses a schema with optional fields.

**Outcomes** (what a school member sees; details stay in the server log):

| Outcome | HTTP, code | Logged status | Unit |
| --- | --- | --- | --- |
| Reply accepted | 200 | `ok` | used |
| No allowance / AI off on the server | 402 `FEATURE_NOT_IN_PLAN` / 503 `AI_NOT_CONFIGURED` | — | — |
| Allowance or token budget used up | 402 `PLAN_LIMIT_REACHED` | — | — |
| The member's requests for today used up | 429 `AI_DAILY_LIMIT` | — | — |
| The platform's monthly budget reached, or no price for the model under a budget | 503 `AI_PAUSED` | — | — |
| Provider declined (safety rules) | 422 `AI_REFUSED` | `refused` | used |
| Reply cut at the token limit | 502 `AI_REPLY_TOO_LONG` | `too_long` | used |
| Reply unusable twice | 502 `AI_INVALID_REPLY` | `invalid_output` | used |
| Provider busy (429) | 503 `AI_BUSY` | `failed` (`rate_limited`) | given back |
| Provider down or too slow | 503 `AI_UNAVAILABLE` | `failed` (`unavailable`, `timeout`) | given back |
| Key refused, bad request, other | 502 `AI_FAILED` | `failed` (`auth`, `bad_request`, `other`) | given back |

**Log.** Each request leaves one row in `ai_requests` (school, staff member, feature, provider, model
that answered, outcome, attempts, input and output tokens, duration) and an `ai.request` audit entry
with the same facts. Neither keeps the text of the request or the reply. `ai_requests` is protected by
row-level security like every school's data, and the worker removes rows after 400 days.

## 4. Provider details

| | Gemini | Anthropic | OpenAI |
| --- | --- | --- | --- |
| API | `models.generateContent` | Messages | Chat Completions |
| JSON replies | `responseMimeType` + `responseJsonSchema` | `output_config.format` (`json_schema`) | `response_format` `json_schema`, `strict` |
| Output tokens | answer + thinking tokens | as reported (thinking included) | `max_completion_tokens` (reasoning included) |
| Refusal | `promptFeedback.blockReason`, finish `SAFETY` etc. | `stop_reason: refusal` (checked before the text) | `message.refusal`, `content_filter` |
| Retries (`AI_MAX_RETRIES`) | timeouts, 408, 429, 5xx, after 1–2 s (more for later retries); `retry-after` not used | timeouts, connection errors, 408, 409, 429, 5xx; waits for `retry-after` up to 60 s | as Anthropic |
| Notes | an invalid key is a 400 `API_KEY_INVALID`, mapped to `auth` | API version `2026-10-21` (SDK 1.x), with the key sent as `Authorization: Bearer`: a gateway behind `AI_API_BASE` must accept that header; no sampling parameters (current models reject them, and `2026-10-21` refuses them); on Claude Opus 5.5, Opus 5, Sonnet 5.5 and Fable 5.1 the request opts into Anthropic's server-side fallback (`fallbacks: "default"`), which re-runs a declined request on the model Anthropic recommends; the log records the model that answered | `AI_API_BASE` includes `/v1` |

## 5. Platform administration

- **Platform overview → AI assistance:** provider and model; the month's spending against the platform
  budget (and how many requests had no price); the schools with an allowance or use this month, with
  requests used against the allowance, failed requests, tokens, tokens counted against the budget when the
  school has one, and cost; the use per feature (requests, tokens, cost); the configured model's prices,
  entered or changed here (`admin.ai_price_set`, with the previous prices), and the other priced models, each
  with **Remove price** (`admin.ai_price_removed`); **Test the connection** (one small request outside any
  allowance, recorded as `admin.ai_tested`).
- **A school's page:** "AI requests per month (override)" and "AI tokens per month (override)". Empty
  returns to the plan's value (0 requests; no token budget).
- **The school's billing page** shows "AI requests this month" once it has an allowance.
- API: `GET /api/admin/ai`, `POST /api/admin/ai/test` (API_DOCUMENTATION.md), and `ai_requests_per_month`
  and `ai_tokens_per_month` in `limitOverrides` of `PATCH /api/admin/orgs/:orgId/subscription` (or in a
  plan's `limits`, `PATCH /api/admin/plans/:planId`); `PUT` and `DELETE /api/admin/ai/prices` for prices.

## 6. Writing a feature on it

```ts
const Questions = z.object({ questions: z.array(z.object({ text: z.string().min(5), choices: z.array(z.string()).min(2).max(6), answer: z.number().int() })).min(1).max(10) });

app.post('/api/orgs/:orgId/tests/:testId/suggested-questions', async (req) => {
  const { orgId, testId } = parse(Params, req.params);
  // Access and the curriculum material first, in a short transaction of their own.
  const { user, book } = await inOrg(ctx, req, orgId, 'editor', async (trx, { user }) => ({ user, book: await bookOfTest(trx, testId) }));
  const { value } = await runAiTask(ctx, { orgId, user, meta: requestMeta(req) }, {
    feature: 'test_questions',
    system: 'You write exam questions for Egyptian school teachers. …',
    prompt: `Book: ${book.title}\nUnit: …\nWrite 5 multiple-choice questions.`,
    output: Questions,
  });
  return { questions: value.questions }; // shown to the teacher to review and edit; nothing is saved here
});
```

Keep the provider call out of database transactions (`runAiTask` does its own short ones), show the
result to the teacher for review before anything is saved, and add the feature to §3's review.

## 6a. Features built on it

| Feature (`feature` in the log) | Who | What is sent | Docs |
| --- | --- | --- | --- |
| `test_questions`: questions suggested for an online test | the subject's teachers and the school's admins, before a student starts | the topic, the teacher's lesson text, the grade, subject, the subject's book titles, the test's title and kind | ONLINE_TESTS.md §14 |
| `homework_suggestion`: a homework suggestion in the new-homework form | the subject's teachers and the school's admins, in an open class | the topic, the teacher's lesson text, the kind of homework and its minutes, the grade, subject and the subject's book titles | CLASSROOM.md §14 |
| `lesson_plan`: a draft lesson plan | any member of the school, for a grade and subject with books in the scope | the topic, the member's lesson text, the lesson's length, the grade, subject and the subject's book titles | TEACHING_PLANS.md §4 |
| `pacing_plan`: a draft pacing plan for a term | any member of the school, for a grade and subject with books in the scope | the term's first day, weeks and periods a week, the member's list of contents, the grade, subject and the subject's book titles | TEACHING_PLANS.md §4 |

None of them sends anything about students. The wording shared by the features (the grade's stage, the
language rule, the lesson text limit) is in `src/ai/teaching.ts`.

## 7. Tests

- `tests/unit/ai-layer.test.ts` (11): portable schemas, JSON reply checks, error kinds, configuration, the
  longest wait, the token estimate, the day key and the daily cap setting.
- `tests/integration/ai-providers-contract.test.ts` (30): each adapter against a local simulator of its
  provider's documented API (`tests/helpers/ai-simulator.ts`): request fields and key header, reply
  parsing, refusals, truncation, error mapping, retries, timeouts, the call deadline, Anthropic's fallback opt-in.
- `tests/integration/ai.test.ts` (19): off by default, AI not configured, students refused, the admin
  override, the log and audit without text, a second attempt on a bad reply, refusals, units given back
  on failure, the monthly limit under 8 concurrent requests, unlimited allowances, row-level security,
  retention, the admin endpoints.
- `tests/integration/ai-limits.test.ts` (10): the 51st request of a member's day refused before the
  provider while others go on; the day's unit given back on failure; the daily cap under concurrent
  requests; the week's cleanup; tokens counted without a budget; a budget under 8 concurrent requests
  with slow replies (3 fit, no more); a spent budget refused before the provider; a second attempt's
  estimate; the admin override (and its bounds) and the AI card; plan limits for AI.
- `tests/unit/billing-logic.test.ts`: every plan carries both AI limits, and an override replaces them.
- `tests/integration/ai-costs.test.ts` (6): prices set by a platform administrator and audited with the previous
  ones; each request priced when logged (the answering model, else the configured one, else no cost); a reply
  without counts priced at its estimate; a failed call at nothing; price validation and access; the cost
  report per school and per feature; the platform budget: no price refused, the 80 % alert, every school
  refused once it is reached (the provider not called, no allowance taken), last month not counted.
- E2E (platform admin journey): the AI card, the connection test, the override, and the school's meter.
  The E2E server's provider is the simulator, run as its own process; it answers each feature's requests
  (`tests/e2e/ai-simulator-server.ts`).
- Each feature's own tests are listed in its document (§6a).

Passing against the simulator does not replace a run against the provider: `npm run ai:check` with a
real key is the remaining check (PROJECT_STATUS, AI layer).
