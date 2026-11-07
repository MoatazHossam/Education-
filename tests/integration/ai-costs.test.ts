import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { monthStart } from '../../src/ai/costs.js';
import { createAiProvider } from '../../src/ai/providers/index.js';
import { estimateTokens, runAiTask, type AiTask } from '../../src/ai/service.js';
import { withSystemContext } from '../../src/db/index.js';
import type { StaffUser } from '../../src/db/types.js';
import type { AppContext } from '../../src/http/context.js';
import { AppError } from '../../src/lib/errors.js';
import { periodKey } from '../../src/lib/time.js';
import { evaluate, ServerErrorCounter } from '../../src/ops/alerts.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { createHarness, createPlatformAdmin, resetData, signUp, type Client, type Harness } from '../helpers/harness.js';

// AI cost controls, second part (docs/production/AI_COST_CONTROL_PLAN.md AI-3, AI-6), against the
// provider simulator: prices per model entered by a platform administrator, each request priced when
// it is logged, the platform's monthly budget (AI_MONTHLY_BUDGET_USD) with its alerts, and the cost
// report. The prices below are test values, not any provider's.

const KEY = 'sim-key-0123456789';
const MODEL = 'gemini-2.5-pro';
const sim = new AiSimulator(KEY);
// The simulator's address is known once it has started.
const env = () => ({ RATE_LIMIT_ENABLED: 'false', AI_PROVIDER: 'gemini', AI_API_KEY: KEY, AI_MODEL: MODEL, AI_API_BASE: sim.base('gemini'), AI_TIMEOUT_MS: '5000' });
let h: Harness;
let ctx: AppContext;
// The same app with a platform budget of US$4 a month.
let b: Harness;
let bctx: AppContext;

beforeAll(async () => {
  await sim.start();
  h = await createHarness(env());
  ctx = { config: h.config, db: h.db, log: h.app.log, payments: null, ai: createAiProvider(h.config), files: null };
  b = await createHarness({ ...env(), AI_MONTHLY_BUDGET_USD: '4' });
  bctx = { config: b.config, db: b.db, log: b.app.log, payments: null, ai: createAiProvider(b.config), files: null };
});
afterAll(async () => {
  await h.close();
  await b.close();
  await sim.stop();
});
beforeEach(async () => {
  sim.reset();
  sim.defaultText = GOOD;
  await resetData(h.ownerDb);
});

const Topics = z.object({ topics: z.array(z.string().min(1)).min(1).max(5) });
const TASK: AiTask<z.infer<typeof Topics>> = {
  feature: 'revision_topics',
  system: 'You suggest revision topics for teachers.',
  prompt: 'Suggest revision topics for grade 5 science: the water cycle.',
  output: Topics,
  maxOutputTokens: 1000,
};
const GOOD = '{"topics":["Evaporation","Condensation"]}';
// What the simulator reports for one Gemini call by default: 120 in, 30 out plus 10 of thinking.
const SIM_IN = 120;
const SIM_OUT = 40;

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

async function school(name = 'AI School') {
  const owner = await signUp(h, { org: name });
  const user = (await h.ownerDb.selectFrom('users').selectAll().where('id', '=', owner.userId).executeTakeFirstOrThrow()) as StaffUser;
  await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || '{"ai_requests_per_month": 100}'::jsonb WHERE org_id = ${owner.orgId}`.execute(trx));
  return { ...owner, user, caller: { orgId: owner.orgId, user } };
}

async function setPrice(admin: Client, model: string, input: number, output: number) {
  const res = await admin.put('/api/admin/ai/prices', { provider: 'gemini', model, inputUsdPerMtok: input, outputUsdPerMtok: output });
  expect(res.statusCode).toBe(200);
}

const lastCost = async () =>
  sys((trx) => trx.selectFrom('ai_requests').select(['cost_usd_micros', 'model', 'status']).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow());

async function rejection(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const aiAlerts = async (harness: Harness) => (await evaluate(harness.db, harness.config, new ServerErrorCounter())).filter((o) => o.key.startsWith('ai_'));

describe('AI costs: prices and the cost of each request', () => {
  it('a platform administrator sets a model’s prices, and each request is priced when it is logged', async () => {
    const admin = await createPlatformAdmin(h);
    const s = await school('Alpha School');
    await setPrice(admin, MODEL, 1.25, 10);
    sim.script('gemini', { kind: 'ok', text: GOOD, inputTokens: 400, outputTokens: 60 });
    await runAiTask(ctx, s.caller, TASK);
    // 400 × 1.25 + (60 + 10) × 10 micro-dollars.
    expect(await lastCost()).toMatchObject({ cost_usd_micros: '1200', status: 'ok' });

    // A new price applies to the requests that end after it; the audit keeps the previous one.
    await setPrice(admin, MODEL, 2, 20);
    await runAiTask(ctx, s.caller, TASK);
    expect((await lastCost()).cost_usd_micros).toBe(String(SIM_IN * 2 + SIM_OUT * 20));
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('action', '=', 'admin.ai_price_set').orderBy('id').execute());
    expect(audit.map((a) => a.metadata)).toEqual([
      { provider: 'gemini', model: MODEL, inputUsdPerMtok: 1.25, outputUsdPerMtok: 10, previous: null },
      { provider: 'gemini', model: MODEL, inputUsdPerMtok: 2, outputUsdPerMtok: 20, previous: { inputUsdPerMtok: 1.25, outputUsdPerMtok: 10 } },
    ]);

    // The cost report: the month's spending, per school and per feature.
    const body = (await admin.get('/api/admin/ai')).json();
    const spent = (1200 + SIM_IN * 2 + SIM_OUT * 20) / 1e6;
    expect(body.budget).toEqual({ monthlyUsd: null, spentUsd: spent, unpricedRequests: 0, state: 'off' });
    expect(body.currentPrice).toMatchObject({ provider: 'gemini', model: MODEL, inputUsdPerMtok: 2, outputUsdPerMtok: 20 });
    expect(body.prices).toHaveLength(1);
    expect(body.schools).toEqual([expect.objectContaining({ orgId: s.orgId, requests: 2, costUsd: spent, unpricedRequests: 0 })]);
    expect(body.features).toEqual([{ feature: 'revision_topics', requests: 2, inputTokens: 400 + SIM_IN, outputTokens: 70 + SIM_OUT, costUsd: spent }]);
  });

  it('prices by the model that answered, else by the configured one; without either the cost is empty and counted as unpriced', async () => {
    const admin = await createPlatformAdmin(h);
    const s = await school();
    await setPrice(admin, MODEL, 1, 1);
    await setPrice(admin, 'gemini-2.5-pro-002', 3, 3);
    sim.script('gemini', { kind: 'ok', text: GOOD, model: 'gemini-2.5-pro-002' });
    await runAiTask(ctx, s.caller, TASK);
    expect(await lastCost()).toMatchObject({ model: 'gemini-2.5-pro-002', cost_usd_micros: String((SIM_IN + SIM_OUT) * 3) });
    sim.script('gemini', { kind: 'ok', text: GOOD, model: 'gemini-2.5-pro-preview' });
    await runAiTask(ctx, s.caller, TASK);
    expect(await lastCost()).toMatchObject({ model: 'gemini-2.5-pro-preview', cost_usd_micros: String(SIM_IN + SIM_OUT) });

    const q = new URLSearchParams({ provider: 'gemini', model: MODEL });
    expect((await admin.delete(`/api/admin/ai/prices?${q}`)).statusCode).toBe(200);
    expect((await admin.delete(`/api/admin/ai/prices?${q}`)).statusCode).toBe(404);
    sim.script('gemini', { kind: 'ok', text: GOOD, model: 'gemini-2.5-pro-preview' });
    await runAiTask(ctx, s.caller, TASK);
    expect((await lastCost()).cost_usd_micros).toBeNull();
    const body = (await admin.get('/api/admin/ai')).json();
    expect(body.budget.unpricedRequests).toBe(1);
    expect(body.currentPrice).toBeNull();
    expect(body.schools[0]).toMatchObject({ requests: 3, unpricedRequests: 1, costUsd: ((SIM_IN + SIM_OUT) * 4) / 1e6 });
    const removed = await sys((trx) => trx.selectFrom('audit_logs').select('metadata').where('action', '=', 'admin.ai_price_removed').executeTakeFirstOrThrow());
    expect(removed.metadata).toEqual({ provider: 'gemini', model: MODEL, inputUsdPerMtok: 1, outputUsdPerMtok: 1 });
  });

  it('a reply without token counts is priced and counted at its estimate; a call that failed without answering costs nothing', async () => {
    const admin = await createPlatformAdmin(h);
    const s = await school();
    await setPrice(admin, MODEL, 1, 2);
    sim.script('gemini', { kind: 'ok', text: GOOD, noUsage: true });
    await runAiTask(ctx, s.caller, TASK);
    const promptTokens = estimateTokens(TASK.system.length + TASK.prompt.length, 0);
    expect((await lastCost()).cost_usd_micros).toBe(String(promptTokens * 1 + 1000 * 2));
    const tokens = await sys((trx) => trx.selectFrom('usage_counters').select('quantity').where('org_id', '=', s.orgId).where('metric', '=', 'ai_tokens').where('period', '=', periodKey()).executeTakeFirstOrThrow());
    expect(tokens.quantity).toBe(promptTokens + 1000);

    sim.script('gemini', { kind: 'error', status: 401 });
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_FAILED');
    expect(await lastCost()).toMatchObject({ status: 'failed', cost_usd_micros: '0' });
  });

  it('only platform administrators set prices, and only valid ones', async () => {
    const admin = await createPlatformAdmin(h);
    const s = await school();
    const good = { provider: 'gemini', model: MODEL, inputUsdPerMtok: 1, outputUsdPerMtok: 2 };
    // The admin surface is not revealed to other users.
    expect((await s.client.put('/api/admin/ai/prices', good)).statusCode).toBe(404);
    expect((await s.client.delete(`/api/admin/ai/prices?provider=gemini&model=${MODEL}`)).statusCode).toBe(404);
    for (const bad of [
      { ...good, inputUsdPerMtok: -1 },
      { ...good, outputUsdPerMtok: 0.0000001 },
      { ...good, outputUsdPerMtok: 100_001 },
      { ...good, inputUsdPerMtok: null },
      { ...good, provider: 'other' },
      { ...good, model: 'bad model' },
    ]) {
      expect((await admin.put('/api/admin/ai/prices', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    // Six decimal places are kept, also on large prices, where multiplying by a million is inexact.
    expect((await admin.put('/api/admin/ai/prices', { ...good, outputUsdPerMtok: 99_999.123456 })).statusCode).toBe(200);
    expect((await admin.put('/api/admin/ai/prices', { ...good, inputUsdPerMtok: 0.075 })).statusCode).toBe(200);
    expect((await admin.get('/api/admin/ai')).json().prices).toEqual([expect.objectContaining({ inputUsdPerMtok: 0.075, outputUsdPerMtok: 2 })]);
  });
});

describe('AI costs: the platform budget (AI_MONTHLY_BUDGET_USD)', () => {
  it('without a price for the model, requests are refused before the provider and an alert says why', async () => {
    const s = await school();
    const err = await rejection(runAiTask(bctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([503, 'AI_PAUSED']);
    expect(sim.requests).toHaveLength(0);
    const used = await sys((trx) => trx.selectFrom('usage_counters').select('quantity').where('org_id', '=', s.orgId).where('metric', '=', 'ai_requests').executeTakeFirst());
    expect(used?.quantity ?? 0).toBe(0);
    expect((await aiAlerts(b)).map((a) => a.key)).toEqual(['ai_price_missing']);
    // The app without a budget raises none of these.
    expect(await aiAlerts(h)).toEqual([]);
  });

  it('warns at 80 %, refuses every school’s new requests once spending reaches the budget, and counts this month only', async () => {
    const admin = await createPlatformAdmin(b);
    // US$1.20 + US$0.40 = US$1.60 a request.
    await setPrice(admin, MODEL, 10_000, 10_000);
    const s = await school('Alpha School');
    const other = await school('Beta School');
    // Last month's spending does not count.
    await sys((trx) => trx.insertInto('ai_requests').values({ org_id: s.orgId, user_id: null, feature: 'revision_topics', provider: 'gemini', model: MODEL, status: 'ok', error_kind: null, input_tokens: null, output_tokens: null, duration_ms: 1, cost_usd_micros: 50_000_000, created_at: new Date(monthStart().getTime() - 86_400_000) }).execute());

    await runAiTask(bctx, s.caller, TASK);
    expect(await aiAlerts(b)).toEqual([]);
    await runAiTask(bctx, s.caller, TASK);
    // US$3.20 of US$4.00.
    expect(await aiAlerts(b)).toEqual([{ key: 'ai_budget_high', summary: 'AI spending this month reached 80% of the platform budget (US$3.20 of US$4.00)', details: { spentUsd: '3.20', budgetUsd: '4.00' } }]);
    // Under the budget, a request still goes; it may end above it.
    await runAiTask(bctx, other.caller, TASK);
    expect((await aiAlerts(b)).map((a) => [a.key, a.details.spentUsd])).toEqual([['ai_budget_reached', '4.80']]);

    for (const caller of [s.caller, other.caller]) {
      const err = await rejection(runAiTask(bctx, caller, TASK));
      expect([err.statusCode, err.code]).toEqual([503, 'AI_PAUSED']);
    }
    expect(sim.requests).toHaveLength(3);
    const body = (await admin.get('/api/admin/ai')).json();
    expect(body.budget).toEqual({ monthlyUsd: 4, spentUsd: 4.8, unpricedRequests: 0, state: 'reached' });
  });
});
