import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiProvider } from '../../src/ai/providers/index.js';
import { aiAllowance, aiDayKey, estimateTokens, runAiTask, type AiTask } from '../../src/ai/service.js';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import type { StaffUser } from '../../src/db/types.js';
import type { AppContext } from '../../src/http/context.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { AppError } from '../../src/lib/errors.js';
import { periodKey } from '../../src/lib/time.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { addMember, createHarness, createPlatformAdmin, resetData, signUp, type Harness } from '../helpers/harness.js';

// AI cost controls, first part (docs/production/AI_COST_CONTROL_PLAN.md AI-4, AI-5, AI-7), against the
// provider simulator: a daily cap per member, a monthly token budget per school (an estimate taken
// before each attempt, settled to the reply's counts), and AI limits carried on plans.

const KEY = 'sim-key-0123456789';
const sim = new AiSimulator(KEY);
let h: Harness;
let ctx: AppContext;

beforeAll(async () => {
  await sim.start();
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false', AI_PROVIDER: 'gemini', AI_API_KEY: KEY, AI_MODEL: 'gemini-2.5-pro', AI_API_BASE: sim.base('gemini'), AI_TIMEOUT_MS: '5000' });
  ctx = { config: h.config, db: h.db, log: h.app.log, payments: null, ai: createAiProvider(h.config) };
});
afterAll(async () => {
  await h.close();
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
// What the simulator reports for one Gemini call: 120 in, 30 out plus 10 of thinking.
const SIM_TOKENS = 160;
const ESTIMATE = estimateTokens(TASK.system.length + TASK.prompt.length, 1000);

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

async function school(name = 'AI School') {
  const owner = await signUp(h, { org: name });
  const user = (await h.ownerDb.selectFrom('users').selectAll().where('id', '=', owner.userId).executeTakeFirstOrThrow()) as StaffUser;
  return { ...owner, user, caller: { orgId: owner.orgId, user } };
}

async function limits(orgId: string, overrides: Record<string, number | null>) {
  await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || ${JSON.stringify(overrides)}::jsonb WHERE org_id = ${orgId}`.execute(trx));
}

async function counter(orgId: string, metric: 'ai_requests' | 'ai_tokens'): Promise<number> {
  const row = await sys((trx) => trx.selectFrom('usage_counters').select('quantity').where('org_id', '=', orgId).where('metric', '=', metric).where('period', '=', periodKey()).executeTakeFirst());
  return row?.quantity ?? 0;
}

async function daily(orgId: string, userId: string): Promise<number> {
  const row = await sys((trx) => trx.selectFrom('ai_user_daily').select('requests').where('org_id', '=', orgId).where('user_id', '=', userId).where('day', '=', aiDayKey()).executeTakeFirst());
  return row?.requests ?? 0;
}

async function rejection(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('AI: requests per member per day (AI-5)', () => {
  it('the 51st request of the day by one member gets 429, before the provider; others in the school go on', async () => {
    expect(h.config.AI_USER_DAILY_LIMIT).toBe(50);
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 200 });
    for (let i = 0; i < 50; i++) await runAiTask(ctx, s.caller, TASK);
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([429, 'AI_DAILY_LIMIT']);
    expect(err.message).toContain('Try again tomorrow');
    expect(sim.requests).toHaveLength(50);
    // The refused request took nothing: the school's monthly count and the member's day stay at 50.
    expect(await counter(s.orgId, 'ai_requests')).toBe(50);
    expect(await daily(s.orgId, s.userId)).toBe(50);

    const editor = await addMember(h, s.client, s.orgId, 'editor');
    const other = (await h.ownerDb.selectFrom('users').selectAll().where('id', '=', editor.userId).executeTakeFirstOrThrow()) as StaffUser;
    await runAiTask(ctx, { orgId: s.orgId, user: other }, TASK);
    expect(await daily(s.orgId, editor.userId)).toBe(1);
  });

  it('a provider that fails without answering gives the day\'s unit back, as it does the month\'s', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 5 });
    sim.script('gemini', { kind: 'error', status: 401 });
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_FAILED');
    expect(await daily(s.orgId, s.userId)).toBe(0);
    expect(await counter(s.orgId, 'ai_requests')).toBe(0);
    await runAiTask(ctx, s.caller, TASK);
    expect(await daily(s.orgId, s.userId)).toBe(1);
  });

  it('cannot be overrun by one member\'s concurrent requests', async () => {
    const small = await createHarness({ RATE_LIMIT_ENABLED: 'false', AI_PROVIDER: 'gemini', AI_API_KEY: KEY, AI_MODEL: 'gemini-2.5-pro', AI_API_BASE: sim.base('gemini'), AI_TIMEOUT_MS: '5000', AI_USER_DAILY_LIMIT: '3' });
    try {
      const smallCtx: AppContext = { config: small.config, db: small.db, log: small.app.log, payments: null, ai: createAiProvider(small.config) };
      const s = await school();
      await limits(s.orgId, { ai_requests_per_month: 100 });
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => runAiTask(smallCtx, s.caller, TASK)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const codes = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => (r.reason as AppError).code);
      expect(codes).toEqual(Array(5).fill('AI_DAILY_LIMIT'));
      expect(await daily(s.orgId, s.userId)).toBe(3);
      expect(await counter(s.orgId, 'ai_requests')).toBe(3);
    } finally {
      await small.close();
    }
  });

  it('the worker forgets daily counts after a week', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 5 });
    await runAiTask(ctx, s.caller, TASK);
    await sys((trx) => sql`INSERT INTO ai_user_daily (org_id, user_id, day, requests) VALUES (${s.orgId}, ${s.userId}, current_date - 8, 7)`.execute(trx));
    const removed = await runCleanup(h.db, h.config);
    expect(removed.aiUserDaily).toBe(1);
    expect(await daily(s.orgId, s.userId)).toBe(1);
  });
});

describe('AI: token budget per school (AI-4)', () => {
  it('counts each request\'s real tokens, also without a budget', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 5 });
    await runAiTask(ctx, s.caller, TASK);
    await runAiTask(ctx, s.caller, TASK);
    expect(await counter(s.orgId, 'ai_tokens')).toBe(2 * SIM_TOKENS);
  });

  it('concurrent requests cannot take more than the budget: each holds an estimate until its reply settles it', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: null, ai_tokens_per_month: 3 * ESTIMATE });
    // The replies take a moment, so all eight are asked for while the first three are in flight.
    sim.script('gemini', ...Array.from({ length: 3 }, () => ({ kind: 'ok' as const, text: GOOD, delayMs: 400 })));
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => runAiTask(ctx, s.caller, TASK)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as AppError);
    expect(rejected.map((e) => e.code)).toEqual(Array(5).fill('PLAN_LIMIT_REACHED'));
    expect(rejected[0]!.message).toContain('AI tokens');
    expect(sim.requests).toHaveLength(3);
    // Settled to what the replies reported, so the budget has room again.
    expect(await counter(s.orgId, 'ai_tokens')).toBe(3 * SIM_TOKENS);
    await runAiTask(ctx, s.caller, TASK);
    expect(await counter(s.orgId, 'ai_tokens')).toBe(4 * SIM_TOKENS);
  });

  it('a spent budget refuses before the provider and shows no AI left; a failed call gives its estimate back', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 10, ai_tokens_per_month: ESTIMATE + 100 });
    sim.script('gemini', { kind: 'error', status: 401 });
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_FAILED');
    expect(await counter(s.orgId, 'ai_tokens')).toBe(0);
    await runAiTask(ctx, s.caller, TASK);
    expect(await counter(s.orgId, 'ai_tokens')).toBe(SIM_TOKENS);
    // SIM_TOKENS + ESTIMATE is more than the budget: the next request cannot start.
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([402, 'PLAN_LIMIT_REACHED']);
    expect(sim.requests).toHaveLength(2);
    await limits(s.orgId, { ai_tokens_per_month: SIM_TOKENS });
    expect(await withOrgContext(h.db, { orgId: s.orgId, userId: s.userId }, (trx) => aiAllowance(ctx, trx, s.orgId))).toEqual({ left: 0 });
  });

  it('a second attempt (the first reply had the wrong shape) takes another estimate, and stops when the budget has none', async () => {
    const s = await school();
    await limits(s.orgId, { ai_requests_per_month: 10, ai_tokens_per_month: ESTIMATE + 50 });
    sim.script('gemini', { kind: 'ok', text: 'not json', inputTokens: 100, outputTokens: 20 });
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([502, 'AI_INVALID_REPLY']);
    expect(sim.requests).toHaveLength(1);
    // The first attempt's own tokens stay counted (100 in, 20 out plus 10 thinking).
    expect(await counter(s.orgId, 'ai_tokens')).toBe(130);
    const row = await sys((trx) => trx.selectFrom('ai_requests').selectAll().where('org_id', '=', s.orgId).executeTakeFirstOrThrow());
    expect(row).toMatchObject({ status: 'invalid_output', attempts: 1, input_tokens: 100, output_tokens: 30 });
  });

  it('the platform administrator sets a token budget per school and sees its use', async () => {
    const s = await school();
    const admin = await createPlatformAdmin(h);
    const res = await admin.patch(`/api/admin/orgs/${s.orgId}/subscription`, { planId: 'professional', status: 'active', limitOverrides: { ai_requests_per_month: 10, ai_tokens_per_month: 50_000 } });
    expect(res.statusCode).toBe(200);
    await runAiTask(ctx, s.caller, TASK);
    const ai = (await admin.get('/api/admin/ai')).json();
    expect(ai.settings.userDailyLimit).toBe(50);
    expect(ai.schools[0]).toMatchObject({ orgId: s.orgId, limit: 10, used: 1, tokenLimit: 50_000, tokensUsed: SIM_TOKENS });
    expect((await admin.patch(`/api/admin/orgs/${s.orgId}/subscription`, { planId: 'professional', status: 'active', limitOverrides: { ai_tokens_per_month: -1 } })).statusCode).toBe(400);
    // The counter is a 32-bit integer: a budget it could not hold is refused, not a server error later.
    expect((await admin.patch(`/api/admin/orgs/${s.orgId}/subscription`, { planId: 'professional', status: 'active', limitOverrides: { ai_tokens_per_month: 3_000_000_000 } })).statusCode).toBe(400);
  });
});

describe('AI: allowances carried on plans (AI-7)', () => {
  it('a plan with AI requests turns AI on for its schools; a school\'s override still wins', async () => {
    const s = await school();
    // A new school is on its trial of the Professional plan, which has no AI.
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('FEATURE_NOT_IN_PLAN');
    const admin = await createPlatformAdmin(h);
    const plan = (await admin.get('/api/admin/plans')).json().plans.find((p: { id: string }) => p.id === 'professional');
    expect(plan.limits).toMatchObject({ ai_requests_per_month: 0, ai_tokens_per_month: null });
    expect((await admin.patch('/api/admin/plans/professional', { limits: { ...plan.limits, ai_requests_per_month: 2, ai_tokens_per_month: 100_000 } })).statusCode).toBe(200);
    try {
      await runAiTask(ctx, s.caller, TASK);
      await runAiTask(ctx, s.caller, TASK);
      expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('PLAN_LIMIT_REACHED');
      // An override above the plan's allowance, and one that turns AI off for this school only.
      await limits(s.orgId, { ai_requests_per_month: 3 });
      await runAiTask(ctx, s.caller, TASK);
      await limits(s.orgId, { ai_requests_per_month: 0 });
      expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('FEATURE_NOT_IN_PLAN');
    } finally {
      // Plans are shared by every test file: put it back.
      expect((await admin.patch('/api/admin/plans/professional', { limits: plan.limits })).statusCode).toBe(200);
    }
  });
});
