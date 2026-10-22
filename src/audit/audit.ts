import type { FastifyRequest } from 'fastify';
import { withSystemContext, type Database, type Executor } from '../db/index.js';
import type { AuditLogsTable } from '../db/types.js';

export interface AuditActor {
  type: AuditLogsTable['actor_type'];
  userId?: string | null;
  email?: string | null;
}

export interface AuditEntry {
  orgId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: FastifyRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null };
}

export function actorFromRequest(req: FastifyRequest): AuditActor {
  const auth = req.auth;
  if (auth?.kind === 'session') {
    return { type: auth.user.is_platform_admin ? 'platform_admin' : 'user', userId: auth.user.id, email: auth.user.email };
  }
  if (auth?.kind === 'api_key') return { type: 'api_key', email: `api-key:${auth.keyName}` };
  return { type: 'anonymous' };
}

/**
 * Writes an audit entry with the given executor. Org-scoped entries must be
 * written inside that org's context (or a system context); platform-level
 * entries (orgId null) need a system context — use recordPlatformAudit.
 */
export async function recordAudit(exec: Executor, actor: AuditActor, entry: AuditEntry, meta?: RequestMeta | null): Promise<void> {
  await exec
    .insertInto('audit_logs')
    .values({
      org_id: entry.orgId ?? null,
      actor_user_id: actor.userId ?? null,
      actor_email: actor.email ?? null,
      actor_type: actor.type,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: JSON.stringify(entry.metadata ?? {}),
      ip: meta?.ip ?? null,
      user_agent: meta?.userAgent ?? null,
    })
    .execute();
}

export async function recordPlatformAudit(db: Database, actor: AuditActor, entry: AuditEntry, meta?: RequestMeta | null): Promise<void> {
  await withSystemContext(db, (trx) => recordAudit(trx, actor, entry, meta));
}
