import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { recordAudit, type AuditActor } from '../audit/audit.js';
import { getEntitlements } from '../billing/entitlements.js';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Executor } from '../db/index.js';
import { decryptSecret, hmacHex, randomToken } from '../lib/crypto.js';
import { notify } from '../notifications/email.js';
import { postWebhook, type DeliveryResult } from './net.js';

// Webhooks to customer systems (migration 0012). A scope change queues one
// delivery per subscribed endpoint, in the transaction that makes the change,
// when the organization's plan includes API access. The worker sends them,
// signed with the endpoint's secret, and retries failures with backoff. The
// payload carries the scope's current state only; receivers fetch the details
// with the read API (/api/v1/scopes/:id).

export const WEBHOOK_EVENTS = ['scope.created', 'scope.updated', 'scope.deleted', 'scope.items_changed', 'scope.items_annotated'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const MAX_ENDPOINTS = 5;
/** Minutes to wait before attempts 2, 3, …: about 21 hours in all. */
const RETRY_MINUTES = [1, 5, 30, 120, 360, 720];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** An endpoint failing this many attempts in a row is switched off and its organization's admins are told. */
export const DISABLE_AFTER_FAILURES = 25;
/** Finished deliveries are kept this long (jobs/tasks.ts cleanup), then deleted. */
export const DELIVERY_RETENTION_DAYS = 30;
/** The most rows the delivery history download holds (newest first). */
export const EXPORT_MAX_DELIVERIES = 10_000;
const BATCH = 20;
const SYSTEM: AuditActor = { type: 'system', email: 'webhooks' };

export function newSecret(): { secret: string; prefix: string } {
  const secret = `whsec_${randomToken(24)}`;
  return { secret, prefix: secret.slice(0, 10) };
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`; receivers recompute it and check t is recent. */
export function signatureHeader(secret: string, body: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

function deliveryHeaders(secret: string, body: string, eventType: string, deliveryId: string): Record<string, string> {
  return {
    'user-agent': 'CurriculumScope-Webhooks/1',
    'x-curriculumscope-event': eventType,
    'x-curriculumscope-delivery': deliveryId,
    'x-curriculumscope-signature': signatureHeader(secret, body),
  };
}

async function scopeState(exec: Executor, scopeId: string) {
  const { rows } = await sql<{ id: string; name: string; catalogVersionId: string; academicYear: string; itemCount: number; updatedAt: Date }>`
    SELECT s.id, s.name, s.catalog_version_id AS "catalogVersionId", v.academic_year AS "academicYear",
           (SELECT count(*)::int FROM scope_items i WHERE i.scope_id = s.id) AS "itemCount", s.updated_at AS "updatedAt"
    FROM scopes s JOIN catalog_versions v ON v.id = s.catalog_version_id
    WHERE s.id = ${scopeId}`.execute(exec);
  return rows[0] ?? null;
}

/**
 * Queues `type` for the organization's endpoints subscribed to it. Several
 * "updated", "items changed" or "items annotated" events for one scope that are
 * still waiting for their first attempt become one, with the latest state (and,
 * for "items annotated", every book changed: notes, assignees, statuses and due
 * dates are not sent, receivers read them with the API).
 */
export async function emitScopeEvent(
  exec: Executor,
  orgId: string,
  graceDays: number,
  type: WebhookEvent,
  scope: { id: string; name: string },
  materialIds?: string[],
): Promise<void> {
  const endpoints = await exec
    .selectFrom('webhook_endpoints')
    .select('id')
    .where('org_id', '=', orgId)
    .where('enabled', '=', true)
    .where(sql<boolean>`${type} = ANY(events)`)
    .execute();
  if (!endpoints.length) return;
  if (!(await getEntitlements(exec, orgId, graceDays)).features.api_access) return;
  const state = type === 'scope.deleted' ? null : await scopeState(exec, scope.id);
  const eventId = randomUUID();
  const payload = {
    id: eventId,
    type,
    createdAt: new Date().toISOString(),
    organizationId: orgId,
    data: {
      scope: state ?? { id: scope.id, name: scope.name },
      ...(type === 'scope.items_annotated' ? { materialIds: [...new Set(materialIds ?? [])].sort() } : {}),
    },
  };
  const coalesceKey = type === 'scope.deleted' || type === 'scope.created' ? null : `${type}:${scope.id}`;
  // Merging keeps the latest state; for "items annotated" it also keeps every book changed meanwhile.
  await sql`
    INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, payload, coalesce_key)
    SELECT ${orgId}, e.id, ${eventId}, ${type}, ${JSON.stringify(payload)}::json, ${coalesceKey}
    FROM unnest(${endpoints.map((e) => e.id)}::uuid[]) AS e(id)
    ON CONFLICT (endpoint_id, coalesce_key) WHERE status = 'pending' AND attempts = 0 AND coalesce_key IS NOT NULL
    DO UPDATE SET
      payload = CASE WHEN EXCLUDED.event_type <> 'scope.items_annotated' THEN EXCLUDED.payload ELSE json_build_object(
        'id', EXCLUDED.payload->'id', 'type', EXCLUDED.payload->'type', 'createdAt', EXCLUDED.payload->'createdAt',
        'organizationId', EXCLUDED.payload->'organizationId',
        'data', json_build_object(
          'scope', EXCLUDED.payload->'data'->'scope',
          'materialIds', (SELECT json_agg(m ORDER BY m) FROM (
            SELECT json_array_elements_text(webhook_deliveries.payload->'data'->'materialIds') AS m
            UNION SELECT json_array_elements_text(EXCLUDED.payload->'data'->'materialIds')) AS u))) END,
      event_id = EXCLUDED.event_id,
      created_at = now()`.execute(exec);
}

/** A test event, sent at once by the management API. */
export function pingPayload(orgId: string, endpointId: string) {
  return { id: randomUUID(), type: 'ping', createdAt: new Date().toISOString(), organizationId: orgId, data: { endpointId } };
}

interface Claimed {
  id: string;
  org_id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secret_enc: string;
}

/** Sends one claimed delivery (its attempt already counted). */
export function sendDelivery(config: AppConfig, d: Claimed, timeoutMs?: number): Promise<DeliveryResult> {
  const body = JSON.stringify(d.payload);
  const secret = decryptSecret(config.dataKeys, d.secret_enc);
  return postWebhook(d.url, body, deliveryHeaders(secret, body, d.event_type, d.id), { allowInsecure: config.WEBHOOK_ALLOW_INSECURE_TARGETS, timeoutMs });
}

const DISABLED_NOTICE = {
  en: (url: string, n: number) => ({ title: 'A webhook was switched off', body: `Sending to ${url} failed ${n} times in a row. Check the endpoint, then switch it back on in Settings.` }),
  ar: (url: string, n: number) => ({ title: 'أُوقف أحد عناوين الإشعارات (webhook)', body: `فشل الإرسال إلى ${url} ${n} مرة متتالية. راجع العنوان ثم أعد تشغيله من الإعدادات.` }),
};

/**
 * Records the outcome of an attempt: delivered, retried later, or failed for
 * good (after MAX_ATTEMPTS, or at once when `retry` is false). Failures count
 * against the endpoint, which is switched off after DISABLE_AFTER_FAILURES in a row.
 */
export async function recordResult(exec: Executor, d: Pick<Claimed, 'id' | 'org_id' | 'endpoint_id' | 'attempts'>, res: DeliveryResult, retry = true): Promise<'delivered' | 'retrying' | 'failed'> {
  if (res.ok) {
    await exec.updateTable('webhook_deliveries').set({ status: 'delivered', delivered_at: sql<Date>`now()`, last_status_code: res.statusCode, last_error: null }).where('id', '=', d.id).execute();
    await exec.updateTable('webhook_endpoints').set({ consecutive_failures: 0 }).where('id', '=', d.endpoint_id).execute();
    return 'delivered';
  }
  const final = !retry || d.attempts >= MAX_ATTEMPTS;
  const waitMinutes = RETRY_MINUTES[Math.min(d.attempts, RETRY_MINUTES.length) - 1] ?? 1;
  await exec
    .updateTable('webhook_deliveries')
    .set({
      status: final ? 'failed' : 'pending',
      next_attempt_at: sql<Date>`now() + make_interval(mins => ${waitMinutes}::int)`,
      last_status_code: res.statusCode,
      last_error: res.error?.slice(0, 300) ?? null,
    })
    .where('id', '=', d.id)
    .execute();
  const endpoint = await exec
    .updateTable('webhook_endpoints')
    .set((eb) => ({ consecutive_failures: eb('consecutive_failures', '+', 1) }))
    .where('id', '=', d.endpoint_id)
    .returning(['url', 'enabled', 'consecutive_failures'])
    .executeTakeFirst();
  if (endpoint?.enabled && endpoint.consecutive_failures >= DISABLE_AFTER_FAILURES) {
    await exec.updateTable('webhook_endpoints').set({ enabled: false, disabled_reason: 'failing' }).where('id', '=', d.endpoint_id).execute();
    await recordAudit(exec, SYSTEM, { orgId: d.org_id, action: 'webhook.disabled', targetType: 'webhook_endpoint', targetId: d.endpoint_id, metadata: { reason: 'failing', failures: endpoint.consecutive_failures } });
    const admins = await exec
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.locale'])
      .where('m.org_id', '=', d.org_id)
      .where('m.role', 'in', ['owner', 'admin'])
      .execute();
    for (const a of admins) {
      const text = DISABLED_NOTICE[a.locale](endpoint.url, endpoint.consecutive_failures);
      await notify(exec, { userId: a.id, orgId: d.org_id, kind: 'webhook_disabled', title: text.title, body: text.body, link: `/org/${d.org_id}/settings` });
    }
  }
  return final ? 'failed' : 'retrying';
}

/**
 * One worker pass: claims up to BATCH due deliveries of enabled endpoints (the
 * claim counts the attempt and leases the row for 10 minutes, so another worker
 * skips it and a crash only delays it), sends them in parallel outside any
 * transaction, then records each outcome.
 */
export async function processWebhookDeliveries(db: Database, config: AppConfig, opts: { timeoutMs?: number } = {}) {
  const claimed = await withSystemContext(db, async (trx) => {
    const { rows } = await sql<Claimed>`
      UPDATE webhook_deliveries d SET attempts = d.attempts + 1, next_attempt_at = now() + interval '10 minutes'
      FROM webhook_endpoints e
      WHERE e.id = d.endpoint_id AND d.id IN (
        SELECT d2.id FROM webhook_deliveries d2 JOIN webhook_endpoints e2 ON e2.id = d2.endpoint_id
        WHERE d2.status = 'pending' AND d2.next_attempt_at <= now() AND e2.enabled
        ORDER BY d2.next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE OF d2 SKIP LOCKED)
      RETURNING d.id, d.org_id, d.endpoint_id, d.event_type, d.payload, d.attempts, e.url, e.secret_enc`.execute(trx);
    return rows;
  });
  const summary = { delivered: 0, retrying: 0, failed: 0 };
  await Promise.all(
    claimed.map(async (d) => {
      const res = await sendDelivery(config, d, opts.timeoutMs);
      const outcome = await withSystemContext(db, (trx) => recordResult(trx, d, res));
      summary[outcome]++;
    }),
  );
  return summary;
}
