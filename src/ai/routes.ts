import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { recordAudit, requestMeta } from '../audit/audit.js';
import { requirePlatformAdmin } from '../auth/guards.js';
import { getEntitlements } from '../billing/entitlements.js';
import { withSystemContext } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { notFound } from '../lib/errors.js';
import { periodKey } from '../lib/time.js';
import { parse } from '../lib/validation.js';
import { budgetState, microsToUsd, monthStart, platformSpend } from './costs.js';
import { InvalidReplyError, parseJsonReply, portableSchema } from './schema.js';
import { aiNotConfigured, aiWorstCaseMs } from './service.js';
import { AI_PROVIDERS, AiProviderError } from './types.js';

// Platform administration of AI assistance (docs/AI_LAYER.md): the configured
// provider, which schools have an allowance and what they used this month, and
// a test request to check the provider setup. Schools get an allowance through
// the subscription's limit overrides (PATCH /api/admin/orgs/:orgId/subscription,
// ai_requests_per_month), like student accounts. Platform administrators also enter what
// the provider charges per model (from its price page: nothing is assumed), which prices each
// request and keeps the platform's monthly budget, AI_MONTHLY_BUDGET_USD (docs/AI_LAYER.md §3).

const TestReply = z.object({ arabic: z.string().min(1).max(100) });

// US dollars per million tokens, as numeric(12, 6) stores them. Decimal places are counted on the number's
// own digits: multiplying by a million rounds wrongly for large prices.
const UsdPerMtok = z.number().min(0).max(100_000).refine((n) => /^\d+(\.\d{1,6})?$/.test(String(n)), 'At most 6 decimal places');
const PriceKey = z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/, 'A model id such as gemini-2.5-pro') });
const PriceBody = PriceKey.extend({ inputUsdPerMtok: UsdPerMtok, outputUsdPerMtok: UsdPerMtok });

export function registerAiAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.get('/api/admin/ai', async (req) => {
    requirePlatformAdmin(req);
    const period = periodKey();
    const since = monthStart(period);
    return withSystemContext(db, async (trx) => {
      // Schools with an allowance of their own, on a plan that includes AI, or with use this month.
      const { rows } = await sql<{ id: string; name: string }>`
        SELECT o.id, o.name FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id
        LEFT JOIN plans p ON p.id = s.plan_id
        WHERE coalesce((s.limit_overrides->>'ai_requests_per_month')::bigint, 0) <> 0
           OR (s.limit_overrides->'ai_requests_per_month') = 'null'::jsonb
           OR coalesce((p.limits->>'ai_requests_per_month')::bigint, 0) <> 0
           OR EXISTS (SELECT 1 FROM ai_requests r WHERE r.org_id = o.id AND r.created_at >= ${since})
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
          sql<string | null>`sum(cost_usd_micros)`.as('cost'),
          sql<string>`count(*) FILTER (WHERE cost_usd_micros IS NULL AND status <> 'failed')`.as('unpriced'),
        ])
        .where('created_at', '>=', since)
        .groupBy('org_id')
        .execute();
      // The month's use per feature, across all schools (production finding A-3).
      const features = await trx
        .selectFrom('ai_requests')
        .select((eb) => [
          'feature',
          eb.fn.countAll<string>().as('requests'),
          sql<string | null>`sum(input_tokens)`.as('input_tokens'),
          sql<string | null>`sum(output_tokens)`.as('output_tokens'),
          sql<string | null>`sum(cost_usd_micros)`.as('cost'),
        ])
        .where('created_at', '>=', since)
        .groupBy('feature')
        .orderBy('feature')
        .execute();
      const prices = await trx.selectFrom('ai_model_prices').selectAll().orderBy('provider').orderBy('model').execute();
      const spend = await platformSpend(trx, since);
      const budget = ctx.ai ? await budgetState(trx, config, ctx.ai.name, ctx.ai.model) : null;
      const counters = await trx.selectFrom('usage_counters').select(['org_id', 'metric', 'quantity']).where('metric', 'in', ['ai_requests', 'ai_tokens']).where('period', '=', period).execute();
      const byOrg = new Map(usage.map((u) => [u.org_id, u]));
      const used = new Map(counters.filter((c) => c.metric === 'ai_requests').map((c) => [c.org_id, c.quantity]));
      const tokensUsed = new Map(counters.filter((c) => c.metric === 'ai_tokens').map((c) => [c.org_id, c.quantity]));
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
          // null: no token cap.
          tokenLimit: ent.limits.ai_tokens_per_month ?? null,
          tokensUsed: tokensUsed.get(o.id) ?? 0,
          requests: Number(u?.requests ?? 0),
          ok: Number(u?.ok ?? 0),
          failed: Number(u?.failed ?? 0),
          inputTokens: Number(u?.input_tokens ?? 0),
          outputTokens: Number(u?.output_tokens ?? 0),
          costUsd: microsToUsd(u?.cost ?? 0),
          unpricedRequests: Number(u?.unpriced ?? 0),
        });
      }
      const price = (r: (typeof prices)[number]) => ({ provider: r.provider, model: r.model, inputUsdPerMtok: Number(r.input_usd_per_mtok), outputUsdPerMtok: Number(r.output_usd_per_mtok), updatedAt: r.updated_at });
      const current = ctx.ai ? prices.find((r) => r.provider === ctx.ai!.name && r.model === ctx.ai!.model) : undefined;
      return {
        provider: ctx.ai ? { name: ctx.ai.name, model: ctx.ai.model, customEndpoint: Boolean(config.AI_API_BASE) } : null,
        settings: { timeoutMs: config.AI_TIMEOUT_MS, maxRetries: config.AI_MAX_RETRIES, worstCaseMs: aiWorstCaseMs(config), maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS, userDailyLimit: config.AI_USER_DAILY_LIMIT },
        period,
        // monthlyUsd null: no platform cap. state: ok, high (80 % or more), reached, or unpriced (refused: no price for the model).
        budget: {
          monthlyUsd: config.AI_MONTHLY_BUDGET_USD || null,
          spentUsd: microsToUsd(spend.micros),
          unpricedRequests: spend.unpriced,
          state: budget?.state ?? 'off',
        },
        currentPrice: current ? price(current) : null,
        prices: prices.map(price),
        features: features.map((f) => ({ feature: f.feature, requests: Number(f.requests), inputTokens: Number(f.input_tokens ?? 0), outputTokens: Number(f.output_tokens ?? 0), costUsd: f.cost === null ? null : microsToUsd(f.cost) })),
        schools,
      };
    });
  });

  // What the provider charges for a model, entered from its price page. Prices requests logged from now on.
  app.put('/api/admin/ai/prices', async (req) => {
    const { user } = requirePlatformAdmin(req);
    const body = parse(PriceBody, req.body);
    return withSystemContext(db, async (trx) => {
      const before = await trx.selectFrom('ai_model_prices').selectAll().where('provider', '=', body.provider).where('model', '=', body.model).executeTakeFirst();
      await trx
        .insertInto('ai_model_prices')
        .values({ provider: body.provider, model: body.model, input_usd_per_mtok: body.inputUsdPerMtok, output_usd_per_mtok: body.outputUsdPerMtok, updated_by: user.id })
        .onConflict((oc) => oc.columns(['provider', 'model']).doUpdateSet({ input_usd_per_mtok: body.inputUsdPerMtok, output_usd_per_mtok: body.outputUsdPerMtok, updated_by: user.id, updated_at: new Date() }))
        .execute();
      await recordAudit(
        trx,
        { type: 'platform_admin', userId: user.id, email: user.email },
        {
          action: 'admin.ai_price_set',
          metadata: {
            provider: body.provider,
            model: body.model,
            inputUsdPerMtok: body.inputUsdPerMtok,
            outputUsdPerMtok: body.outputUsdPerMtok,
            previous: before ? { inputUsdPerMtok: Number(before.input_usd_per_mtok), outputUsdPerMtok: Number(before.output_usd_per_mtok) } : null,
          },
        },
        requestMeta(req),
      );
      return { price: { provider: body.provider, model: body.model, inputUsdPerMtok: body.inputUsdPerMtok, outputUsdPerMtok: body.outputUsdPerMtok } };
    });
  });

  app.delete('/api/admin/ai/prices', async (req) => {
    const { user } = requirePlatformAdmin(req);
    const key = parse(PriceKey, req.query);
    return withSystemContext(db, async (trx) => {
      const removed = await trx.deleteFrom('ai_model_prices').where('provider', '=', key.provider).where('model', '=', key.model).returningAll().executeTakeFirst();
      if (!removed) throw notFound('Price');
      await recordAudit(
        trx,
        { type: 'platform_admin', userId: user.id, email: user.email },
        { action: 'admin.ai_price_removed', metadata: { provider: key.provider, model: key.model, inputUsdPerMtok: Number(removed.input_usd_per_mtok), outputUsdPerMtok: Number(removed.output_usd_per_mtok) } },
        requestMeta(req),
      );
      return { ok: true };
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
