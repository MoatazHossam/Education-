import { sql } from 'kysely';
import type { z } from 'zod';
import { recordAudit, type RequestMeta } from '../audit/audit.js';
import { adjustUsage, consumeUsage, getEntitlements, releaseUsage, usageFor } from '../billing/entitlements.js';
import type { AppConfig } from '../config.js';
import { withOrgContext, type Executor } from '../db/index.js';
import type { AiRequestsTable, StaffUser } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { AppError, badRequest, featureUnavailable, forbidden } from '../lib/errors.js';
import { periodKey } from '../lib/time.js';
import { checkPlatformBudget, costExpression } from './costs.js';
import { InvalidReplyError, parseJsonReply, portableSchema } from './schema.js';
import { AiProviderError, callDeadlineMs, type AiErrorKind, type AiReply } from './types.js';

// Every use of AI goes through runAiTask (docs/AI_LAYER.md):
//  - only staff of a school run it, never students, and features pass only
//    curriculum material and staff instructions, never students' data;
//  - the school must have a monthly allowance (ai_requests_per_month, 0 on every
//    plan until a platform administrator sets one);
//  - each request takes one unit of the allowance before the provider is called
//    (concurrent requests cannot overrun it) and gives it back if the provider
//    failed without answering; the same for the member's daily requests
//    (AI_USER_DAILY_LIMIT) and, where the school has a token budget
//    (ai_tokens_per_month), an estimate of the tokens, settled to what the reply reports;
//  - each request leaves a row in ai_requests and an audit entry: who, which
//    feature, provider, model, outcome and tokens; never the text;
//  - a JSON reply is checked against the feature's schema, and asked for once
//    more if it does not match.

/** Characters of instructions plus task, to bound the cost of one request. */
export const MAX_PROMPT_CHARS = 60_000;
/** Kept in ai_requests for cost reporting, then removed by the worker. */
export const AI_REQUEST_RETENTION_DAYS = 400;
const ATTEMPTS_FOR_VALID_JSON = 2;

/**
 * Tokens one attempt may use, taken from the school's token budget before the call and settled
 * afterwards. Prompt characters / 2 rounds up: Arabic and other scripts can take a token per two
 * characters, Latin text fewer. Plus the most output tokens the request allows.
 */
export function estimateTokens(promptChars: number, maxOutputTokens: number): number {
  return Math.ceil(promptChars / 2) + maxOutputTokens;
}

/** The UTC day a member's daily AI requests are counted in (YYYY-MM-DD), like the monthly periodKey. */
export function aiDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** 429 for a member who used today's AI requests in this school (production finding A-5). */
export const aiDailyLimit = (limit: number) => new AppError(429, 'AI_DAILY_LIMIT', `You have used today's AI requests (${limit}). Try again tomorrow.`, { limit });

async function takeDailyUnit(trx: Executor, orgId: string, userId: string, day: string, limit: number): Promise<void> {
  if (limit === 0) return;
  const res = await sql<{ requests: number }>`
    INSERT INTO ai_user_daily (org_id, user_id, day, requests) VALUES (${orgId}, ${userId}, ${day}, 1)
    ON CONFLICT (org_id, user_id, day) DO UPDATE
      SET requests = ai_user_daily.requests + 1, updated_at = now()
      WHERE ai_user_daily.requests < ${limit}
    RETURNING requests`.execute(trx);
  if (!res.rows[0]) throw aiDailyLimit(limit);
}

async function releaseDailyUnit(trx: Executor, orgId: string, userId: string, day: string): Promise<void> {
  await trx
    .updateTable('ai_user_daily')
    .set((eb) => ({ requests: eb('requests', '-', 1), updated_at: new Date() }))
    .where('org_id', '=', orgId)
    .where('user_id', '=', userId)
    .where('day', '=', day)
    .where('requests', '>', 0)
    .execute();
}

/**
 * The longest a school member waits for an AI request before an answer or an error (production finding
 * A-4). A provider that does not answer fails the request after one call (timeout: 503 AI_UNAVAILABLE);
 * the bound is reached only when the first call's reply has the wrong shape and is asked for once more.
 */
export function aiWorstCaseMs(config: Pick<AppConfig, 'AI_TIMEOUT_MS' | 'AI_MAX_RETRIES'>): number {
  return ATTEMPTS_FOR_VALID_JSON * callDeadlineMs(config.AI_TIMEOUT_MS, config.AI_MAX_RETRIES);
}

export interface AiTask<T> {
  /** Name recorded in the usage log, e.g. "test_questions". */
  feature: string;
  system: string;
  prompt: string;
  /** The reply's shape: the reply is JSON checked against it. Without it the reply is text. */
  output?: z.ZodType<T>;
  /** Capped by AI_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

export interface AiCaller {
  orgId: string;
  user: StaffUser;
  meta?: RequestMeta | null;
}

export interface AiResult<T> {
  value: T;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

type Outcome = { status: AiRequestsTable['status']; errorKind?: AiErrorKind; reply?: AiReply };

export const aiNotConfigured = () => new AppError(503, 'AI_NOT_CONFIGURED', 'AI assistance is not set up on this server');

/** The error a school member sees when the provider failed (details stay in the server log). */
export function aiFailure(kind: AiErrorKind): AppError {
  if (kind === 'rate_limited') return new AppError(503, 'AI_BUSY', 'The AI service is busy. Try again in a minute.');
  if (kind === 'unavailable' || kind === 'timeout') return new AppError(503, 'AI_UNAVAILABLE', 'The AI service did not answer. Try again later.');
  return new AppError(502, 'AI_FAILED', 'The AI service could not handle the request. Try again later; if it keeps happening, contact support.');
}

/**
 * AI requests the school has left this month (null: no cap), or null when it has none at all or no
 * provider is set up. Pages use it to show an AI feature only where it can run.
 */
export async function aiAllowance(ctx: AppContext, exec: Executor, orgId: string): Promise<{ left: number | null } | null> {
  if (!ctx.ai) return null;
  const { limits } = await getEntitlements(exec, orgId, ctx.config.GRACE_DAYS);
  const limit = limits.ai_requests_per_month;
  if (limit === 0 || limit === undefined) return null;
  const usage = await usageFor(exec, orgId);
  // A spent token budget leaves no request, whatever the request count says.
  const tokens = limits.ai_tokens_per_month;
  if (typeof tokens === 'number' && usage.ai_tokens >= tokens) return { left: 0 };
  return { left: limit === null ? null : Math.max(0, limit - usage.ai_requests) };
}

export async function runAiTask<T = string>(ctx: AppContext, caller: AiCaller, task: AiTask<T>): Promise<AiResult<T>> {
  const ai = ctx.ai;
  if (!ai) throw aiNotConfigured();
  // Defence in depth: student accounts never reach the provider, whatever the route.
  if (caller.user.kind !== 'staff') throw forbidden();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(task.feature)) throw new Error(`Invalid AI feature name: ${task.feature}`);
  if (task.system.length + task.prompt.length > MAX_PROMPT_CHARS) throw badRequest(`The request is too long for the AI service (at most ${MAX_PROMPT_CHARS} characters)`);

  const { orgId, user } = caller;
  const period = periodKey();
  const day = aiDayKey();
  const request = {
    system: task.system,
    prompt: task.prompt,
    jsonSchema: task.output ? portableSchema(task.output) : undefined,
    maxOutputTokens: Math.min(task.maxOutputTokens ?? ctx.config.AI_MAX_OUTPUT_TOKENS, ctx.config.AI_MAX_OUTPUT_TOKENS),
  };
  const estimate = estimateTokens(task.system.length + task.prompt.length, request.maxOutputTokens);
  // The platform's monthly spending cap, across all schools: checked before any allowance is taken.
  await checkPlatformBudget(ctx.db, ctx.config, ai.name, ai.model);
  // null: no token cap. Tokens are counted either way, so a budget set mid-month starts from the real use.
  let tokenLimit = null as number | null;
  // All or nothing: a refused step gives back the units taken before it.
  await withOrgContext(ctx.db, { orgId, userId: user.id }, async (trx) => {
    const ent = await getEntitlements(trx, orgId, ctx.config.GRACE_DAYS);
    // null: no monthly cap.
    const limit = ent.limits.ai_requests_per_month;
    if (limit === 0 || limit === undefined) throw featureUnavailable('AI assistance');
    await consumeUsage(trx, orgId, 'ai_requests', limit, 'AI requests');
    await takeDailyUnit(trx, orgId, user.id, day, ctx.config.AI_USER_DAILY_LIMIT);
    tokenLimit = ent.limits.ai_tokens_per_month ?? null;
    if (tokenLimit !== null) await consumeUsage(trx, orgId, 'ai_tokens', tokenLimit, 'AI tokens', estimate);
  });
  // Tokens taken from the budget so far, settled in finish().
  let reserved = tokenLimit !== null ? estimate : 0;
  const started = Date.now();
  let attempts = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  const finish = async (outcome: Outcome) => {
    const row = {
      org_id: orgId,
      user_id: user.id,
      feature: task.feature,
      provider: ai.name,
      model: (outcome.reply?.model ?? ai.model).slice(0, 100),
      status: outcome.status,
      error_kind: outcome.errorKind ?? null,
      attempts,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: Date.now() - started,
    };
    // The provider failed before producing anything: nothing was spent.
    const nothing = outcome.status === 'failed' && attempts === 1;
    // The reply's own counts replace the estimate; without counts the estimate stays as spent.
    const reported = inputTokens !== null || outputTokens !== null;
    const spentIn = nothing ? 0 : reported ? (inputTokens ?? 0) : (estimate - request.maxOutputTokens) * attempts;
    const spentOut = nothing ? 0 : reported ? (outputTokens ?? 0) : request.maxOutputTokens * attempts;
    try {
      await withOrgContext(ctx.db, { orgId, userId: user.id }, async (trx) => {
        const { id } = await trx
          .insertInto('ai_requests')
          .values({ ...row, cost_usd_micros: costExpression(ai.name, row.model, ai.model, spentIn, spentOut) })
          .returning('id')
          .executeTakeFirstOrThrow();
        // The units taken for a request that spent nothing are given back.
        if (nothing) {
          await releaseUsage(trx, orgId, 'ai_requests', period);
          if (ctx.config.AI_USER_DAILY_LIMIT > 0) await releaseDailyUnit(trx, orgId, user.id, day);
        }
        // Settles the estimates taken; without a budget nothing was taken and the tokens are added.
        const actual = spentIn + spentOut;
        await adjustUsage(trx, orgId, 'ai_tokens', period, actual - reserved);
        await recordAudit(
          trx,
          { type: 'user', userId: user.id, email: user.email },
          { orgId, action: 'ai.request', targetType: 'ai_request', targetId: id, metadata: { feature: row.feature, provider: row.provider, model: row.model, status: row.status, errorKind: row.error_kind, inputTokens, outputTokens } },
          caller.meta,
        );
      });
    } catch (err) {
      // The request itself already succeeded or failed; a failure to log it must not change its outcome.
      ctx.log.error({ err, feature: task.feature, orgId }, 'could not record an AI request');
    }
  };

  let last: AiReply | undefined;
  for (;;) {
    // A second attempt (the first reply had the wrong shape) takes another estimate from the budget.
    if (attempts > 0 && tokenLimit !== null) {
      const budget = tokenLimit;
      try {
        await withOrgContext(ctx.db, { orgId, userId: user.id }, (trx) => consumeUsage(trx, orgId, 'ai_tokens', budget, 'AI tokens', estimate));
        reserved += estimate;
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== 'PLAN_LIMIT_REACHED') throw err;
        await finish({ status: 'invalid_output', reply: last });
        throw new AppError(502, 'AI_INVALID_REPLY', 'The AI reply could not be used. Try again.');
      }
    }
    attempts++;
    let reply: AiReply;
    try {
      reply = await ai.generate(request);
    } catch (err) {
      const kind = err instanceof AiProviderError ? err.kind : 'other';
      ctx.log.error({ err, provider: ai.name, model: ai.model, feature: task.feature, orgId }, 'AI provider request failed');
      await finish({ status: 'failed', errorKind: kind });
      throw aiFailure(kind);
    }
    last = reply;
    inputTokens = add(inputTokens, reply.inputTokens);
    outputTokens = add(outputTokens, reply.outputTokens);
    if (reply.finish === 'refused') {
      await finish({ status: 'refused', reply });
      throw new AppError(422, 'AI_REFUSED', 'The AI service declined this request.');
    }
    if (reply.finish === 'length') {
      await finish({ status: 'too_long', reply });
      throw new AppError(502, 'AI_REPLY_TOO_LONG', 'The AI reply was longer than allowed. Ask for less at a time.');
    }
    try {
      const value = task.output ? parseJsonReply(reply.text, task.output) : nonEmpty(reply.text);
      await finish({ status: 'ok', reply });
      return { value: value as T, model: reply.model, inputTokens, outputTokens };
    } catch (err) {
      if (!(err instanceof InvalidReplyError)) throw err;
      if (attempts < ATTEMPTS_FOR_VALID_JSON) continue;
      ctx.log.warn({ provider: ai.name, model: reply.model, feature: task.feature, reason: err.message }, 'AI reply did not match the expected shape');
      await finish({ status: 'invalid_output', reply });
      throw new AppError(502, 'AI_INVALID_REPLY', 'The AI reply could not be used. Try again.');
    }
  }
}

function nonEmpty(text: string): string {
  if (!text.trim()) throw new InvalidReplyError('The reply is empty');
  return text;
}
