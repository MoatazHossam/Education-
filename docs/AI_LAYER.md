# AI layer

**Status (2026-10-28): the provider-independent layer is built and tested; no product feature uses it
yet, and it has not been run against a real provider (no key in this environment).** The first feature
planned on it is question generation for online tests (a teacher reviews every question before it is
saved). The Wise EduAgent integration and any AI that students use stay blocked (PROJECT_STATUS B-8,
B-9).

## 1. What it is

One provider for the whole server, chosen by configuration: **Google Gemini**, **Anthropic Claude** or
**OpenAI**. Every use of AI goes through one function, `runAiTask` (`src/ai/service.ts`), which is the
same for every provider. It enforces who may use AI and how much, sends the request, checks the reply,
and logs the request. Changing provider is a configuration change; features do not change.

| File | Role |
| --- | --- |
| `src/ai/types.ts` | The provider interface (`AiProvider.generate`), the reply, error kinds |
| `src/ai/providers/gemini.ts`, `anthropic.ts`, `openai.ts` | One adapter per provider, each through the provider's official SDK (`@google/genai` 2.29.1, `@anthropic-ai/sdk` 0.133.0, `openai` 7.32.0, pinned) |
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
| `AI_TIMEOUT_MS` | 120000 | Per attempt; the SDKs retry 429, 5xx and connection errors twice |
| `AI_MAX_OUTPUT_TOKENS` | 16000 | Most output tokens one request may use (thinking included on models that think) |

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
allowance of `null` (through the API) means no monthly cap.

**What is sent.** A feature sends curriculum material and the staff member's own instructions. It never
sends students' data: names, usernames, answers, marks, homework or files. Each feature's prompt is
reviewed for this before it is merged. A request is at most 60,000 characters.

**Counting.** Each request takes one unit of the month's allowance before the provider is called (an
atomic conditional update, so concurrent requests cannot overrun it). If the provider fails without
answering, the unit is given back. A refusal, a reply cut at the token limit, or an unusable reply keeps
the unit: tokens were spent.

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
| Allowance used up | 402 `PLAN_LIMIT_REACHED` | — | — |
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
| Notes | an invalid key is a 400 `API_KEY_INVALID`, mapped to `auth` | no sampling parameters (current models reject them); on Claude Opus 5.5, Opus 5, Sonnet 5.5 and Fable 5.1 the request opts into Anthropic's server-side fallback (`fallbacks: "default"`), which re-runs a declined request on the model Anthropic recommends; the log records the model that answered | `AI_API_BASE` includes `/v1` |

## 5. Platform administration

- **Platform overview → AI assistance:** provider and model; the schools with an allowance or use this
  month, with requests used against the allowance, failed requests and tokens; **Test the connection**
  (one small request outside any allowance, recorded as `admin.ai_tested`).
- **A school's page:** "AI requests per month (override)". Empty returns to the plan's value (0).
- **The school's billing page** shows "AI requests this month" once it has an allowance.
- API: `GET /api/admin/ai`, `POST /api/admin/ai/test` (API_DOCUMENTATION.md), and `ai_requests_per_month`
  in `limitOverrides` of `PATCH /api/admin/orgs/:orgId/subscription`.

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

## 7. Tests

- `tests/unit/ai-layer.test.ts` (7): portable schemas, JSON reply checks, error kinds, configuration.
- `tests/integration/ai-providers-contract.test.ts` (24): each adapter against a local simulator of its
  provider's documented API (`tests/helpers/ai-simulator.ts`): request fields and key header, reply
  parsing, refusals, truncation, error mapping, retries, timeouts, Anthropic's fallback opt-in.
- `tests/integration/ai.test.ts` (17): off by default, AI not configured, students refused, the admin
  override, the log and audit without text, a second attempt on a bad reply, refusals, units given back
  on failure, the monthly limit under 8 concurrent requests, unlimited allowances, row-level security,
  retention, the admin endpoints.
- E2E (platform admin journey): the AI card, the connection test, the override, and the school's meter.
  The E2E server's provider is the simulator, run as its own process.

Passing against the simulator does not replace a run against the provider: `npm run ai:check` with a
real key is the remaining check (PROJECT_STATUS, AI layer).
