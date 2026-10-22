import type { FastifyRequest } from 'fastify';
import { withOrgContext, type Trx } from '../db/index.js';
import type { Organization, Role, Session, User } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';

export const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function hasRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function requireUser(req: FastifyRequest): { user: User; session: Session } {
  const auth = req.auth;
  if (auth?.kind !== 'session') throw unauthorized();
  if (auth.session.state !== 'active') throw new AppError(401, 'MFA_REQUIRED', 'Two-factor verification is required');
  return { user: auth.user, session: auth.session };
}

export function requirePlatformAdmin(req: FastifyRequest): { user: User; session: Session } {
  const { user, session } = requireUser(req);
  // Do not reveal the admin surface to ordinary users.
  if (!user.is_platform_admin) throw notFound();
  if (!user.mfa_enabled) {
    throw forbidden('Platform administrators must enable two-factor authentication', 'MFA_ENROLLMENT_REQUIRED');
  }
  if (!session.mfa_verified) throw forbidden('Two-factor verification is required for this session', 'MFA_REQUIRED');
  return { user, session };
}

export interface OrgAccess {
  org: Organization;
  role: Role;
  user: User;
  session: Session;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside the tenant context of `orgId` after verifying, server side,
 * that the authenticated user is a member with at least `minRole`. The org id
 * from the URL is only a selector: membership is the source of authority, and
 * non-members get a 404 so other tenants' existence is not disclosed.
 */
export async function inOrg<T>(
  ctx: AppContext,
  req: FastifyRequest,
  orgId: string,
  minRole: Role,
  fn: (trx: Trx, access: OrgAccess) => Promise<T>,
): Promise<T> {
  const { user, session } = requireUser(req);
  if (!UUID_RE.test(orgId)) throw notFound('Organization');
  return withOrgContext(ctx.db, { orgId, userId: user.id }, async (trx) => {
    const row = await trx
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.org_id')
      .selectAll('o')
      .select('m.role')
      .where('m.org_id', '=', orgId)
      .where('m.user_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw notFound('Organization');
    const { role, ...org } = row;
    if (org.status !== 'active') throw forbidden('This organization is suspended. Contact support.', 'ORG_SUSPENDED');
    if (org.require_mfa_for_admins && hasRole(role, 'admin') && !session.mfa_verified) {
      throw forbidden('This organization requires two-factor authentication for owners and admins', 'MFA_REQUIRED_BY_ORG');
    }
    if (!hasRole(role, minRole)) throw forbidden();
    return fn(trx, { org: org as Organization, role, user, session });
  });
}
