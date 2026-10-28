import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { recordAudit, requestMeta } from '../audit/audit.js';
import { requirePlatformAdmin } from '../auth/guards.js';
import { getEntitlements } from '../billing/entitlements.js';
import { withSystemContext } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { periodKey } from '../lib/time.js';
import { InvalidReplyError, parseJsonReply, portableSchema } from './schema.js';
import { aiNotConfigured } from './service.js';
import { AiProviderError } from './types.js';

// Platform administration of AI assistance (docs/AI_LAYER.md): the configured
// provider, which schools have an allowance and what they used this month, and
// a test request to check the provider setup. Schools get an allowance through
// the subscription's limit overrides (PATCH /api/admin/orgs/:orgId/subscription,
// ai_requests_per_month), like student accounts.

const TestReply = z.object({ arabic: z.string().min(1).max(100) });

export function registerAiAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.get('/api/admin/ai', async (req) => {
    requirePlatformAdmin(req);
    const period = periodKey();
    const monthStart = new Date(`${period}-01T00:00:00Z`);
    return withSystemContext(db, async (trx) => {
      // Schools with an allowance of their own, on a plan that includes AI, or with use this month.
      const { rows } = await sql<{ id: string; name: string }>`
        SELECT o.id, o.name FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id
        LEFT JOIN plans p ON p.id = s.plan_id
        WHERE coalesce((s.limit_overrides->>'ai_requests_per_month')::bigint, 0) <> 0
           OR (s.limit_overrides->'ai_requests_per_month') = 'null'::jsonb
           OR coalesce((p.limits->>'ai_requests_per_month')::bigint, 0) <> 0
           OR EXISTS (SELECT 1 FROM ai_requests r WHERE r.org_id = o.id AND r.created_at >= ${monthStart})
        ORDER BY o.name LIMIT 500`.execute(trx);
      const usage = await trx
        .selectFrom('ai_requests')
        .select((eb) => [
          'org_id',
          eb.fn.countAll<string>().as('requests'),
          sql<string>`count(*) FILTER (WHERE status = 'ok')`.as('ok'),
          sql<string>`count(*) FILTER (WHERE status = 'failed')`.as('failed'),
          sql<string | null>`sum(input_tokens)`.as('input_tokens'),
          sql<string | null>`sum(output_tokens)`.as('output_tokens'),
        ])
        .where('created_at', '>=', monthStart)
        .groupBy('org_id')
        .execute();
      const counters = await trx.selectFrom('usage_counters').select(['org_id', 'quantity']).where('metric', '=', 'ai_requests').where('period', '=', period).execute();
      const byOrg = new Map(usage.map((u) => [u.org_id, u]));
      const used = new Map(counters.map((c) => [c.org_id, c.quantity]));
      const schools = [];
      for (const o of rows) {
        const ent = await getEntitlements(trx, o.id, config.GRACE_DAYS);
        const u = byOrg.get(o.id);
        schools.push({
          orgId: o.id,
          name: o.name,
          planName: ent.planName,
          // null: no monthly cap.
          limit: ent.limits.ai_requests_per_month === undefined ? 0 : ent.limits.ai_requests_per_month,
          used: used.get(o.id) ?? 0,
          requests: Number(u?.requests ?? 0),
          ok: Number(u?.ok ?? 0),
          failed: Number(u?.failed ?? 0),
          inputTokens: Number(u?.input_tokens ?? 0),
          outputTokens: Number(u?.output_tokens ?? 0),
        });
      }
      return {
        provider: ctx.ai ? { name: ctx.ai.name, model: ctx.ai.model, customEndpoint: Boolean(config.AI_API_BASE) } : null,
        settings: { timeoutMs: config.AI_TIMEOUT_MS, maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS },
        period,
        schools,
      };
    });
  });

  // One small request to the provider, outside any school's allowance, to check the key, model and network.
  app.post('/api/admin/ai/test', rateLimited(10, '1 hour'), async (req) => {
    const { user } = requirePlatformAdmin(req);
    if (!ctx.ai) throw aiNotConfigured();
    const started = Date.now();
    let result: Record<string, unknown>;
    try {
      const reply = await ctx.ai.generate({
        system: 'You are a translator. Answer with JSON only.',
        prompt: 'Translate the English word "curriculum" into Arabic. Answer as {"arabic": "<the word>"}.',
        jsonSchema: portableSchema(TestReply),
        maxOutputTokens: Math.min(4000, config.AI_MAX_OUTPUT_TOKENS),
      });
      let valid = false;
      if (reply.finish === 'stop') {
        try {
          parseJsonReply(reply.text, TestReply);
          valid = true;
        } catch (err) {
          if (!(err instanceof InvalidReplyError)) throw err;
        }
      }
      result = { ok: valid, finish: reply.finish, model: reply.model, ms: Date.now() - started, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, reply: reply.text.slice(0, 500) };
    } catch (err) {
      if (!(err instanceof AiProviderError)) throw err;
      req.log.warn({ err }, 'AI provider test failed');
      result = { ok: false, errorKind: err.kind, status: err.status ?? null, message: err.message.slice(0, 500), ms: Date.now() - started };
    }
    await withSystemContext(db, (trx) =>
      recordAudit(
        trx,
        { type: 'platform_admin', userId: user.id, email: user.email },
        { action: 'admin.ai_tested', metadata: { provider: ctx.ai!.name, ok: result.ok, model: result.model ?? ctx.ai!.model, errorKind: result.errorKind ?? null } },
        requestMeta(req),
      ),
    );
    return { provider: { name: ctx.ai.name, model: ctx.ai.model }, result };
  });
}
