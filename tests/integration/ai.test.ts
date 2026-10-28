import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiProvider } from '../../src/ai/providers/index.js';
import { MAX_PROMPT_CHARS, runAiTask, type AiTask } from '../../src/ai/service.js';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import type { StaffUser } from '../../src/db/types.js';
import type { AppContext } from '../../src/http/context.js';
import { runCleanup } from '../../src/jobs/tasks.js';
import { AppError } from '../../src/lib/errors.js';
import { periodKey } from '../../src/lib/time.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { createHarness, createPlatformAdmin, resetData, signUp, type Harness } from '../helpers/harness.js';

// The AI layer end to end against the provider simulator (Gemini's API):
// off by default, per-school allowance, atomic monthly limit, usage given back
// when the provider fails, the usage log and audit trail (no text kept),
// tenant isolation, staff only, and the platform administration endpoints.

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
};
const GOOD = '{"topics":["Evaporation","Condensation"]}';

async function school(name = 'AI School') {
  const owner = await signUp(h, { org: name });
  const user = (await h.ownerDb.selectFrom('users').selectAll().where('id', '=', owner.userId).executeTakeFirstOrThrow()) as StaffUser;
  return { ...owner, user, caller: { orgId: owner.orgId, user } };
}

// Tenant tables are row-level secured for the owner role too: fixtures and checks run in a system context.
const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

async function allow(orgId: string, perMonth: number | null) {
  const res = await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || jsonb_build_object('ai_requests_per_month', ${perMonth}::int) WHERE org_id = ${orgId}`.execute(trx));
  expect(Number(res.numAffectedRows)).toBe(1);
}

async function used(orgId: string): Promise<number> {
  const row = await sys((trx) => trx.selectFrom('usage_counters').select('quantity').where('org_id', '=', orgId).where('metric', '=', 'ai_requests').where('period', '=', periodKey()).executeTakeFirst());
  return row?.quantity ?? 0;
}

async function log(orgId: string) {
  return sys((trx) => trx.selectFrom('ai_requests').selectAll().where('org_id', '=', orgId).orderBy('created_at').execute());
}

async function rejection(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('AI layer: who may use it', () => {
  it('is off for every school until a platform administrator sets an allowance; nothing reaches the provider', async () => {
    const s = await school();
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([402, 'FEATURE_NOT_IN_PLAN']);
    expect(sim.requests).toHaveLength(0);
    expect(await used(s.orgId)).toBe(0);
  });

  it('is off on a server without a provider', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    const err = await rejection(runAiTask({ ...ctx, ai: null }, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([503, 'AI_NOT_CONFIGURED']);
  });

  it('refuses a student account whatever the route', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    const student = { ...s.user, kind: 'student' } as unknown as StaffUser;
    expect((await rejection(runAiTask(ctx, { orgId: s.orgId, user: student }, TASK))).statusCode).toBe(403);
    expect(sim.requests).toHaveLength(0);
  });

  it('refuses a request too long to send', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    const err = await rejection(runAiTask(ctx, s.caller, { ...TASK, prompt: 'x'.repeat(MAX_PROMPT_CHARS) }));
    expect(err.statusCode).toBe(400);
    expect(await used(s.orgId)).toBe(0);
  });
});

describe('AI layer: a request', () => {
  it('enabled through the admin API, returns the checked reply and logs who, what and the cost, never the text', async () => {
    const s = await school();
    const admin = await createPlatformAdmin(h);
    const patch = await admin.patch(`/api/admin/orgs/${s.orgId}/subscription`, { limitOverrides: { ai_requests_per_month: 10 } });
    expect(patch.statusCode).toBe(200);
    sim.script('gemini', { kind: 'ok', text: GOOD, inputTokens: 300, outputTokens: 40 });

    const res = await runAiTask(ctx, { ...s.caller, meta: { ip: '203.0.113.9', userAgent: 'vitest' } }, TASK);
    expect(res.value.topics).toEqual(['Evaporation', 'Condensation']);
    expect(res).toMatchObject({ model: 'gemini-2.5-pro', inputTokens: 300, outputTokens: 50 });

    const sent = sim.requests[0]!;
    expect(sent.headers['x-goog-api-key']).toBe(KEY);
    expect(JSON.stringify(sent.body)).toContain(TASK.prompt);
    expect(await used(s.orgId)).toBe(1);

    const [row] = await log(s.orgId);
    expect(row).toMatchObject({ user_id: s.userId, feature: 'revision_topics', provider: 'gemini', model: 'gemini-2.5-pro', status: 'ok', error_kind: null, attempts: 1, input_tokens: 300, output_tokens: 50 });
    const audit = await sys((trx) => trx.selectFrom('audit_logs').selectAll().where('org_id', '=', s.orgId).where('action', '=', 'ai.request').execute());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: s.userId, target_id: row!.id, ip: '203.0.113.9' });
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain('water cycle');
    expect(JSON.stringify(row)).not.toContain('water cycle');

    // The school sees its allowance and use; the billing page shows it as a meter.
    const org = (await s.client.get(`/api/orgs/${s.orgId}`)).json();
    expect(org.plan.limits.ai_requests_per_month).toBe(10);
    expect(org.usage.ai_requests).toBe(1);
  });

  it('asks once more when the reply does not match the schema, and counts both attempts\' tokens', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    sim.script('gemini', { kind: 'ok', text: 'Here are some topics: evaporation', inputTokens: 100, outputTokens: 20 }, { kind: 'ok', text: GOOD, inputTokens: 100, outputTokens: 20 });
    const res = await runAiTask(ctx, s.caller, TASK);
    expect(res.value.topics).toHaveLength(2);
    expect(sim.requests).toHaveLength(2);
    expect((await log(s.orgId))[0]).toMatchObject({ status: 'ok', attempts: 2, input_tokens: 200, output_tokens: 60 });
    expect(await used(s.orgId)).toBe(1);
  });

  it('gives up on a second unusable reply; the unit stays used (tokens were spent)', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    sim.script('gemini', { kind: 'ok', text: '{"topics":[]}' }, { kind: 'ok', text: 'not json' });
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([502, 'AI_INVALID_REPLY']);
    expect((await log(s.orgId))[0]).toMatchObject({ status: 'invalid_output', attempts: 2 });
    expect(await used(s.orgId)).toBe(1);
  });

  it('reports a refusal and a reply cut at the limit', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    sim.script('gemini', { kind: 'refusal' }, { kind: 'length', text: '{"topics":["Evap' });
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_REFUSED');
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_REPLY_TOO_LONG');
    expect((await log(s.orgId)).map((r) => r.status)).toEqual(['refused', 'too_long']);
    expect(await used(s.orgId)).toBe(2);
  });

  it('gives the unit back when the provider fails without answering', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    sim.script('gemini', { kind: 'error', status: 401 }, { kind: 'error', status: 400 });
    const auth = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([auth.statusCode, auth.code]).toEqual([502, 'AI_FAILED']);
    expect(auth.message).not.toContain(KEY);
    expect((await rejection(runAiTask(ctx, s.caller, TASK))).code).toBe('AI_FAILED');
    expect((await log(s.orgId)).map((r) => [r.status, r.error_kind])).toEqual([
      ['failed', 'auth'],
      ['failed', 'bad_request'],
    ]);
    expect(await used(s.orgId)).toBe(0);
  });

  it('a text reply (no schema) is returned as text', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    sim.script('gemini', { kind: 'ok', text: 'Evaporation, condensation.' });
    const res = await runAiTask(ctx, s.caller, { feature: 'summary', system: 's', prompt: 'p' });
    expect(res.value).toBe('Evaporation, condensation.');
    expect(sim.requests[0]!.body.generationConfig).not.toHaveProperty('responseJsonSchema');
  });
});

describe('AI layer: monthly allowance', () => {
  it('stops at the limit, before calling the provider', async () => {
    const s = await school();
    await allow(s.orgId, 2);
    await runAiTask(ctx, s.caller, TASK);
    await runAiTask(ctx, s.caller, TASK);
    const err = await rejection(runAiTask(ctx, s.caller, TASK));
    expect([err.statusCode, err.code]).toEqual([402, 'PLAN_LIMIT_REACHED']);
    expect(sim.requests).toHaveLength(2);
  });

  it('cannot be overrun by concurrent requests', async () => {
    const s = await school();
    await allow(s.orgId, 3);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => runAiTask(ctx, s.caller, TASK)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.map((r) => (r.reason as AppError).code)).toEqual(Array(5).fill('PLAN_LIMIT_REACHED'));
    expect(await used(s.orgId)).toBe(3);
    expect(sim.requests).toHaveLength(3);
  });

  it('an unlimited allowance (null) has no cap', async () => {
    const s = await school();
    await allow(s.orgId, null);
    for (let i = 0; i < 3; i++) await runAiTask(ctx, s.caller, TASK);
    expect(await used(s.orgId)).toBe(3);
    const admin = await createPlatformAdmin(h);
    expect((await admin.get('/api/admin/ai')).json().schools[0]).toMatchObject({ orgId: s.orgId, limit: null, used: 3 });
  });
});

describe('AI layer: isolation and retention', () => {
  it('a school sees only its own usage log', async () => {
    const a = await school('School A');
    const b = await school('School B');
    await allow(a.orgId, 5);
    await runAiTask(ctx, a.caller, TASK);
    const own = await withOrgContext(h.db, { orgId: a.orgId, userId: a.userId }, (trx) => trx.selectFrom('ai_requests').select('id').execute());
    const other = await withOrgContext(h.db, { orgId: b.orgId, userId: b.userId }, (trx) => trx.selectFrom('ai_requests').select('id').execute());
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('the worker removes log rows after the retention period', async () => {
    const s = await school();
    await allow(s.orgId, 5);
    await runAiTask(ctx, s.caller, TASK);
    await sys((trx) => trx.updateTable('ai_requests').set({ created_at: new Date(Date.now() - 401 * 86_400_000) }).where('org_id', '=', s.orgId).execute());
    const removed = await runCleanup(h.db, h.config);
    expect(removed.aiRequests).toBe(1);
    expect(await log(s.orgId)).toHaveLength(0);
  });
});

describe('AI layer: platform administration', () => {
  it('lists the provider and each enabled school with its allowance, use and tokens', async () => {
    const a = await school('Alpha School');
    await school('Beta School');
    await allow(a.orgId, 50);
    sim.script('gemini', { kind: 'ok', text: GOOD, inputTokens: 400, outputTokens: 60 });
    await runAiTask(ctx, a.caller, TASK);
    const admin = await createPlatformAdmin(h);
    const res = await admin.get('/api/admin/ai');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toEqual({ name: 'gemini', model: 'gemini-2.5-pro', customEndpoint: true });
    expect(body.period).toBe(periodKey());
    expect(body.schools).toEqual([{ orgId: a.orgId, name: 'Alpha School', planName: 'Professional', limit: 50, used: 1, requests: 1, ok: 1, failed: 0, inputTokens: 400, outputTokens: 70 }]);
  });

  it('tests the provider setup outside any allowance, and records the test', async () => {
    const admin = await createPlatformAdmin(h);
    sim.script('gemini', { kind: 'ok', text: '{"arabic":"منهج"}' }, { kind: 'error', status: 401 });
    const ok = (await admin.post('/api/admin/ai/test', {})).json();
    expect(ok.provider).toEqual({ name: 'gemini', model: 'gemini-2.5-pro' });
    expect(ok.result).toMatchObject({ ok: true, finish: 'stop', model: 'gemini-2.5-pro', reply: '{"arabic":"منهج"}' });
    const bad = (await admin.post('/api/admin/ai/test', {})).json();
    expect(bad.result).toMatchObject({ ok: false, errorKind: 'auth', status: 400 });
    expect(JSON.stringify(bad)).not.toContain(KEY);
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select('metadata').where('action', '=', 'admin.ai_tested').orderBy('created_at').execute());
    expect(audit.map((a) => (a.metadata as { ok: boolean }).ok)).toEqual([true, false]);
  });
});
