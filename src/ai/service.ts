import type { z } from 'zod';
import { recordAudit, type RequestMeta } from '../audit/audit.js';
import { consumeUsage, getEntitlements, releaseUsage } from '../billing/entitlements.js';
import { withOrgContext } from '../db/index.js';
import type { AiRequestsTable, StaffUser } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { AppError, badRequest, featureUnavailable, forbidden } from '../lib/errors.js';
import { periodKey } from '../lib/time.js';
import { InvalidReplyError, parseJsonReply, portableSchema } from './schema.js';
import { AiProviderError, type AiErrorKind, type AiReply } from './types.js';

// Every use of AI goes through runAiTask (docs/AI_LAYER.md):
//  - only staff of a school run it, never students, and features pass only
//    curriculum material and staff instructions, never students' data;
//  - the school must have a monthly allowance (ai_requests_per_month, 0 on every
//    plan until a platform administrator sets one);
//  - each request takes one unit of the allowance before the provider is called
//    (concurrent requests cannot overrun it) and gives it back if the provider
//    failed without answering;
//  - each request leaves a row in ai_requests and an audit entry: who, which
//    feature, provider, model, outcome and tokens; never the text;
//  - a JSON reply is checked against the feature's schema, and asked for once
//    more if it does not match.

/** Characters of instructions plus task, to bound the cost of one request. */
export const MAX_PROMPT_CHARS = 60_000;
/** Kept in ai_requests for cost reporting, then removed by the worker. */
export const AI_REQUEST_RETENTION_DAYS = 400;
const ATTEMPTS_FOR_VALID_JSON = 2;

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

export async function runAiTask<T = string>(ctx: AppContext, caller: AiCaller, task: AiTask<T>): Promise<AiResult<T>> {
  const ai = ctx.ai;
  if (!ai) throw aiNotConfigured();
  // Defence in depth: student accounts never reach the provider, whatever the route.
  if (caller.user.kind !== 'staff') throw forbidden();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(task.feature)) throw new Error(`Invalid AI feature name: ${task.feature}`);
  if (task.system.length + task.prompt.length > MAX_PROMPT_CHARS) throw badRequest(`The request is too long for the AI service (at most ${MAX_PROMPT_CHARS} characters)`);

  const { orgId, user } = caller;
  const period = periodKey();
  await withOrgContext(ctx.db, { orgId, userId: user.id }, async (trx) => {
    const ent = await getEntitlements(trx, orgId, ctx.config.GRACE_DAYS);
    // null: no monthly cap.
    const limit = ent.limits.ai_requests_per_month;
    if (limit === 0 || limit === undefined) throw featureUnavailable('AI assistance');
    await consumeUsage(trx, orgId, 'ai_requests', limit, 'AI requests');
  });

  const request = {
    system: task.system,
    prompt: task.prompt,
    jsonSchema: task.output ? portableSchema(task.output) : undefined,
    maxOutputTokens: Math.min(task.maxOutputTokens ?? ctx.config.AI_MAX_OUTPUT_TOKENS, ctx.config.AI_MAX_OUTPUT_TOKENS),
  };
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
    try {
      await withOrgContext(ctx.db, { orgId, userId: user.id }, async (trx) => {
        const { id } = await trx.insertInto('ai_requests').values(row).returning('id').executeTakeFirstOrThrow();
        // The provider failed before producing anything: the unit taken for this request is given back.
        if (outcome.status === 'failed' && attempts === 1) await releaseUsage(trx, orgId, 'ai_requests', period);
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

  for (;;) {
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
