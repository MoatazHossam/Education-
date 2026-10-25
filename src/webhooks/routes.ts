import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import { getEntitlements, requireFeature } from '../billing/entitlements.js';
import type { Executor } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { encryptSecret } from '../lib/crypto.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { validateWebhookUrl, WebhookTargetError } from './net.js';
import { MAX_ENDPOINTS, newSecret, pingPayload, recordResult, sendDelivery, WEBHOOK_EVENTS } from './service.js';

// Webhook endpoints of an organization (owners and admins; the plan must include
// API access, like API keys). The signing secret is returned once, when the
// endpoint is created or its secret is replaced.

const OrgParams = z.object({ orgId: z.string() });
const EndpointParams = z.object({ orgId: z.string(), id: zUuid });
const Events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).transform((e) => [...new Set(e)]);
const Description = z.string().trim().max(120).transform((v) => v || null).nullable();
const CreateBody = z.object({ url: z.string().trim().min(1).max(500), description: Description.optional(), events: Events });
const UpdateBody = z
  .object({ url: z.string().trim().min(1).max(500).optional(), description: Description.optional(), events: Events.optional(), enabled: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

type EndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secret_prefix: string;
  enabled: boolean;
  disabled_reason: 'failing' | null;
  consecutive_failures: number;
  created_at: Date;
};

const endpointView = (e: EndpointRow) => ({
  id: e.id,
  url: e.url,
  description: e.description,
  events: e.events,
  secretPrefix: e.secret_prefix,
  enabled: e.enabled,
  disabledReason: e.disabled_reason,
  consecutiveFailures: e.consecutive_failures,
  createdAt: e.created_at,
});

const ENDPOINT_COLUMNS = ['id', 'url', 'description', 'events', 'secret_prefix', 'enabled', 'disabled_reason', 'consecutive_failures', 'created_at'] as const;

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;
  const grace = config.GRACE_DAYS;

  const checkedUrl = (raw: string) => {
    try {
      return validateWebhookUrl(raw, config.WEBHOOK_ALLOW_INSECURE_TARGETS);
    } catch (err) {
      if (err instanceof WebhookTargetError) throw new AppError(400, 'INVALID_WEBHOOK_URL', err.message);
      throw err;
    }
  };
  const getEndpoint = async (trx: Executor, orgId: string, id: string) => {
    const row = await trx.selectFrom('webhook_endpoints').selectAll().where('org_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Webhook');
    return row;
  };

  app.get('/api/orgs/:orgId/webhooks', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const rows = await trx.selectFrom('webhook_endpoints').select(ENDPOINT_COLUMNS).where('org_id', '=', orgId).orderBy('created_at').execute();
      const { rows: last } = await sql<{ endpoint_id: string; status: string; created_at: Date; last_status_code: number | null }>`
        SELECT DISTINCT ON (endpoint_id) endpoint_id, status, created_at, last_status_code
        FROM webhook_deliveries WHERE org_id = ${orgId} ORDER BY endpoint_id, created_at DESC`.execute(trx);
      const lastBy = new Map(last.map((l) => [l.endpoint_id, { status: l.status, at: l.created_at, statusCode: l.last_status_code }]));
      return { webhooks: rows.map((r) => ({ ...endpointView(r), lastDelivery: lastBy.get(r.id) ?? null })), events: WEBHOOK_EVENTS, max: MAX_ENDPOINTS };
    });
  });

  app.post('/api/orgs/:orgId/webhooks', async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(CreateBody, req.body);
    const url = checkedUrl(body.url);
    const created = await inOrg(ctx, req, orgId, 'admin', async (trx, { user }) => {
      requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'Webhooks');
      const count = await trx.selectFrom('webhook_endpoints').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_ENDPOINTS) throw conflict(`At most ${MAX_ENDPOINTS} webhook endpoints`, 'WEBHOOK_LIMIT');
      const { secret, prefix } = newSecret();
      const row = await trx
        .insertInto('webhook_endpoints')
        .values({ org_id: orgId, url, description: body.description ?? null, events: body.events, secret_enc: encryptSecret(config.DATA_ENCRYPTION_KEY, secret), secret_prefix: prefix, created_by: user.id })
        .returning(ENDPOINT_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.created', targetType: 'webhook_endpoint', targetId: row.id, metadata: { url, events: body.events } }, requestMeta(req));
      return { row, secret };
    });
    // The secret is returned exactly once; it is stored encrypted because signing needs it.
    return reply.status(201).send({ webhook: endpointView(created.row), secret: created.secret });
  });

  app.patch('/api/orgs/:orgId/webhooks/:id', async (req) => {
    const { orgId, id } = parse(EndpointParams, req.params);
    const body = parse(UpdateBody, req.body);
    const url = body.url !== undefined ? checkedUrl(body.url) : undefined;
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      await getEndpoint(trx, orgId, id);
      // Switching off is always allowed; anything else needs API access on the plan.
      if (!(body.enabled === false && url === undefined && body.events === undefined && body.description === undefined)) {
        requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'Webhooks');
      }
      const row = await trx
        .updateTable('webhook_endpoints')
        .set({
          ...(url !== undefined ? { url } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.events !== undefined ? { events: body.events } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          // Switching on again starts the failure count afresh.
          ...(body.enabled === true ? { disabled_reason: null, consecutive_failures: 0 } : {}),
        })
        .where('id', '=', id)
        .returning(ENDPOINT_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.updated', targetType: 'webhook_endpoint', targetId: id, metadata: { ...body, ...(url ? { url } : {}) } }, requestMeta(req));
      return { webhook: endpointView(row) };
    });
  });

  app.delete('/api/orgs/:orgId/webhooks/:id', async (req) => {
    const { orgId, id } = parse(EndpointParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const endpoint = await getEndpoint(trx, orgId, id);
      await trx.deleteFrom('webhook_endpoints').where('id', '=', id).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.deleted', targetType: 'webhook_endpoint', targetId: id, metadata: { url: endpoint.url } }, requestMeta(req));
      return { status: 'deleted' };
    });
  });

  app.post('/api/orgs/:orgId/webhooks/:id/rotate-secret', async (req) => {
    const { orgId, id } = parse(EndpointParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      await getEndpoint(trx, orgId, id);
      requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'Webhooks');
      const { secret, prefix } = newSecret();
      const row = await trx
        .updateTable('webhook_endpoints')
        .set({ secret_enc: encryptSecret(config.DATA_ENCRYPTION_KEY, secret), secret_prefix: prefix })
        .where('id', '=', id)
        .returning(ENDPOINT_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.secret_rotated', targetType: 'webhook_endpoint', targetId: id }, requestMeta(req));
      return { webhook: endpointView(row), secret };
    });
  });

  // Sends a "ping" at once and reports the result. The HTTP request is made outside
  // any database transaction; the delivery is recorded before and after it.
  app.post('/api/orgs/:orgId/webhooks/:id/test', rateLimited(10, '1 minute'), async (req) => {
    const { orgId, id } = parse(EndpointParams, req.params);
    const claimed = await inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const endpoint = await getEndpoint(trx, orgId, id);
      requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'Webhooks');
      const payload = pingPayload(orgId, id);
      const row = await trx
        .insertInto('webhook_deliveries')
        .values({ org_id: orgId, endpoint_id: id, event_id: payload.id, event_type: 'ping', payload: JSON.stringify(payload), attempts: 1, next_attempt_at: sql<Date>`now() + interval '10 minutes'` })
        .returning(['id', 'org_id', 'endpoint_id', 'event_type', 'payload', 'attempts'])
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.tested', targetType: 'webhook_endpoint', targetId: id }, requestMeta(req));
      return { ...row, url: endpoint.url, secret_enc: endpoint.secret_enc };
    });
    const res = await sendDelivery(config, claimed);
    const status = await inOrg(ctx, req, orgId, 'admin', (trx) => recordResult(trx, claimed, res, false));
    return { delivery: { id: claimed.id, status, statusCode: res.statusCode, error: res.error } };
  });

  app.get('/api/orgs/:orgId/webhooks/:id/deliveries', async (req) => {
    const { orgId, id } = parse(EndpointParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      await getEndpoint(trx, orgId, id);
      const rows = await trx
        .selectFrom('webhook_deliveries')
        .select(['id', 'event_id', 'event_type', 'status', 'attempts', 'last_status_code', 'last_error', 'created_at', 'delivered_at', 'next_attempt_at', 'payload'])
        .where('endpoint_id', '=', id)
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute();
      return {
        deliveries: rows.map((d) => ({
          id: d.id, eventId: d.event_id, eventType: d.event_type, status: d.status, attempts: d.attempts,
          statusCode: d.last_status_code, error: d.last_error, createdAt: d.created_at, deliveredAt: d.delivered_at,
          nextAttemptAt: d.status === 'pending' ? d.next_attempt_at : null, payload: d.payload,
        })),
      };
    });
  });

  // Queues the same event again (same event id, so receivers can tell it is a repeat).
  app.post('/api/orgs/:orgId/webhooks/:id/deliveries/:deliveryId/redeliver', async (req, reply) => {
    const { orgId, id, deliveryId } = parse(EndpointParams.extend({ deliveryId: zUuid }), req.params);
    const created = await inOrg(ctx, req, orgId, 'admin', async (trx) => {
      await getEndpoint(trx, orgId, id);
      requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'Webhooks');
      const source = await trx.selectFrom('webhook_deliveries').selectAll().where('id', '=', deliveryId).where('endpoint_id', '=', id).executeTakeFirst();
      if (!source) throw notFound('Delivery');
      if (source.status === 'pending') throw conflict('This delivery is still being sent', 'DELIVERY_PENDING');
      const row = await trx
        .insertInto('webhook_deliveries')
        .values({ org_id: orgId, endpoint_id: id, event_id: source.event_id, event_type: source.event_type, payload: JSON.stringify(source.payload) })
        .returning(['id', 'status'])
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'webhook.redelivered', targetType: 'webhook_endpoint', targetId: id, metadata: { from: deliveryId, eventType: source.event_type } }, requestMeta(req));
      return row;
    });
    return reply.status(202).send({ delivery: created });
  });
}
