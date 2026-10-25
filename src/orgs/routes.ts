import type { FastifyInstance } from 'fastify';
import { sql, type NotNull } from 'kysely';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { withSystemContext } from '../db/index.js';
import { hasRole, inOrg, requireUser } from '../auth/guards.js';
import { verifyPassword } from '../auth/password.js';
import { assertSeatAvailable, countScopes, countSeats, getEntitlements, lockOrg, requireFeature, usageFor } from '../billing/entitlements.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { addDays } from '../lib/time.js';
import { parse, zEmail, zLocale, zUuid } from '../lib/validation.js';
import { enqueueEmail, notify } from '../notifications/email.js';
import { createOrganization } from './service.js';

const INVITE_TTL_DAYS = 7;
const MAX_OWNED_ORGS = 10;
const MAX_ACTIVE_API_KEYS = 10;

const OrgParams = z.object({ orgId: z.string() });

export function registerOrgRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const grace = config.GRACE_DAYS;

  // ------------------------------------------------------------ organizations
  app.post('/api/orgs', rateLimited(10, '1 hour'), async (req, reply) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(2).max(120), locale: zLocale.optional() }), req.body);
    const owned = await db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.current_user', ${user.id}, true)`.execute(trx);
      return trx.selectFrom('memberships').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', user.id).where('role', '=', 'owner').executeTakeFirstOrThrow();
    });
    if (Number(owned.n) >= MAX_OWNED_ORGS) throw conflict(`You can own at most ${MAX_OWNED_ORGS} organizations`, 'ORG_LIMIT');
    const fresh = await db.selectFrom('users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
    const { org, trial } = await db.transaction().execute((trx) => createOrganization(trx, config, { name: body.name, owner: fresh, locale: body.locale ?? user.locale }, requestMeta(req)));
    return reply.status(201).send({ organization: { id: org.id, name: org.name, slug: org.slug }, trial });
  });

  app.get('/api/orgs/:orgId', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, { org, role }) => {
      const ent = await getEntitlements(trx, org.id, grace);
      const seats = await countSeats(trx, org.id);
      const scopes = await countScopes(trx, org.id);
      const usage = await usageFor(trx, org.id);
      return {
        organization: { id: org.id, name: org.name, slug: org.slug, locale: org.locale, status: org.status, requireMfaForAdmins: org.require_mfa_for_admins, createdAt: org.created_at },
        role,
        plan: { id: ent.planId, name: ent.planName, state: ent.state, limits: ent.limits, features: ent.features, trialEndsAt: ent.subscription?.trial_ends_at ?? null },
        usage: { members: seats.members, pendingInvites: seats.pendingInvites, scopes, ...usage },
      };
    });
  });

  app.patch('/api/orgs/:orgId', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120).optional(), locale: zLocale.optional(), requireMfaForAdmins: z.boolean().optional() }),
      req.body,
    );
    return inOrg(ctx, req, orgId, 'admin', async (trx, { org, role }) => {
      if (body.requireMfaForAdmins !== undefined) {
        if (role !== 'owner') throw forbidden('Only the owner can change the two-factor policy');
        if (body.requireMfaForAdmins) requireFeature(await getEntitlements(trx, org.id, grace), 'require_mfa_policy', 'the two-factor policy');
      }
      const updated = await trx
        .updateTable('organizations')
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.locale ? { locale: body.locale } : {}),
          ...(body.requireMfaForAdmins !== undefined ? { require_mfa_for_admins: body.requireMfaForAdmins } : {}),
        })
        .where('id', '=', org.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId: org.id, action: 'org.updated', targetType: 'organization', targetId: org.id, metadata: body }, requestMeta(req));
      return { organization: { id: updated.id, name: updated.name, slug: updated.slug, locale: updated.locale, requireMfaForAdmins: updated.require_mfa_for_admins } };
    });
  });

  // Permanent deletion of the organization and all its tenant data (cascade).
  // Requires the owner's password and the exact organization name.
  app.delete('/api/orgs/:orgId', rateLimited(5, '1 hour'), async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ password: z.string().min(1).max(256), confirmName: z.string().max(120) }), req.body);
    const meta = requestMeta(req);
    const deleted = await inOrg(ctx, req, orgId, 'owner', async (_trx, { user, org }) => {
      if (!(await verifyPassword(user.password_hash, body.password))) throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
      if (body.confirmName.trim() !== org.name) throw new AppError(400, 'CONFIRMATION_MISMATCH', 'Type the organization name exactly to confirm');
      return { org, user };
    });
    await withSystemContext(db, async (trx) => {
      const members = await trx.selectFrom('memberships').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
      await trx.deleteFrom('organizations').where('id', '=', orgId).execute();
      // Audit rows keep org_id (no foreign key) so the deletion itself stays on record.
      await recordAudit(trx, { type: 'user', userId: deleted.user.id, email: deleted.user.email }, { orgId, action: 'org.deleted', targetType: 'organization', targetId: orgId, metadata: { name: deleted.org.name, members: Number(members.n) } }, meta);
    });
    return { status: 'deleted' };
  });

  // ------------------------------------------------------------ members
  app.get('/api/orgs/:orgId/members', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx) => {
      const rows = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.name', 'u.email', 'u.mfa_enabled', 'm.role', 'm.created_at'])
        .where('m.org_id', '=', orgId)
        .orderBy(sql`CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END`)
        .orderBy('u.name')
        .execute();
      return { members: rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, role: r.role, mfaEnabled: r.mfa_enabled, joinedAt: r.created_at })) };
    });
  });

  app.patch('/api/orgs/:orgId/members/:userId', async (req) => {
    const { orgId, userId } = parse(z.object({ orgId: z.string(), userId: zUuid }), req.params);
    const { role: newRole } = parse(z.object({ role: z.enum(['admin', 'editor', 'viewer']) }), req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { role: myRole, user }) => {
      const target = await trx.selectFrom('memberships').select('role').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
      if (!target) throw notFound('Member');
      if (target.role === 'owner') throw forbidden('The owner role can only change through an ownership transfer');
      if (userId === user.id) throw forbidden('You cannot change your own role');
      // Admins manage editors and viewers; only the owner manages admins.
      if (myRole === 'admin' && (target.role === 'admin' || newRole === 'admin')) throw forbidden('Only the owner can grant or change the admin role');
      await trx.updateTable('memberships').set({ role: newRole }).where('org_id', '=', orgId).where('user_id', '=', userId).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'member.role_changed', targetType: 'user', targetId: userId, metadata: { from: target.role, to: newRole } }, requestMeta(req));
      return { userId, role: newRole };
    });
  });

  app.delete('/api/orgs/:orgId/members/:userId', async (req) => {
    const { orgId, userId } = parse(z.object({ orgId: z.string(), userId: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, { role: myRole, user }) => {
      const target = await trx.selectFrom('memberships').select('role').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst();
      if (!target) throw notFound('Member');
      const self = userId === user.id;
      if (target.role === 'owner') throw forbidden(self ? 'Transfer ownership before leaving the organization' : 'The owner cannot be removed');
      if (!self) {
        if (!hasRole(myRole, 'admin')) throw forbidden();
        if (myRole === 'admin' && target.role === 'admin') throw forbidden('Only the owner can remove an admin');
      }
      await trx.deleteFrom('memberships').where('org_id', '=', orgId).where('user_id', '=', userId).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: self ? 'member.left' : 'member.removed', targetType: 'user', targetId: userId, metadata: { role: target.role } }, requestMeta(req));
      return { status: 'removed' };
    });
  });

  app.post('/api/orgs/:orgId/transfer-ownership', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ userId: zUuid, password: z.string().min(1).max(256) }), req.body);
    return inOrg(ctx, req, orgId, 'owner', async (trx, { user, org }) => {
      if (!(await verifyPassword(user.password_hash, body.password))) throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
      if (body.userId === user.id) throw conflict('You already own this organization');
      const target = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.email', 'u.name', 'u.locale', 'u.status'])
        .where('m.org_id', '=', orgId)
        .where('m.user_id', '=', body.userId)
        // Members are staff accounts, which always have an email (migration 0007).
        .$narrowType<{ email: NotNull }>()
        .executeTakeFirst();
      if (!target) throw notFound('Member');
      if (target.status !== 'active') throw conflict('The new owner must have an active account');
      // Demote first: the partial unique index allows only one owner at a time.
      await trx.updateTable('memberships').set({ role: 'admin' }).where('org_id', '=', orgId).where('user_id', '=', user.id).execute();
      await trx.updateTable('memberships').set({ role: 'owner' }).where('org_id', '=', orgId).where('user_id', '=', target.id).execute();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'org.ownership_transferred', targetType: 'user', targetId: target.id, metadata: { from: user.id } }, requestMeta(req));
      await enqueueEmail(trx, target.email, 'ownership_transferred', target.locale, { orgName: org.name, fromName: user.name });
      await notify(trx, { userId: target.id, orgId, kind: 'ownership_transferred', title: `You now own ${org.name}`, body: `${user.name} transferred ownership to you.`, link: `/org/${orgId}/settings` });
      return { status: 'transferred', newOwnerId: target.id };
    });
  });

  // ------------------------------------------------------------ invitations
  app.get('/api/orgs/:orgId/invitations', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const rows = await trx
        .selectFrom('invitations as i')
        .leftJoin('users as u', 'u.id', 'i.invited_by')
        .select(['i.id', 'i.email', 'i.role', 'i.expires_at', 'i.created_at', 'u.name as invitedBy'])
        .where('i.org_id', '=', orgId)
        .where('i.accepted_at', 'is', null)
        .where('i.revoked_at', 'is', null)
        .orderBy('i.created_at', 'desc')
        .execute();
      const now = new Date();
      return { invitations: rows.map((r) => ({ id: r.id, email: r.email, role: r.role, invitedBy: r.invitedBy, createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at <= now })) };
    });
  });

  app.post('/api/orgs/:orgId/invitations', rateLimited(30, '1 hour'), async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ email: zEmail, role: z.enum(['admin', 'editor', 'viewer']) }), req.body);
    const result = await inOrg(ctx, req, orgId, 'admin', async (trx, { role: myRole, user, org }) => {
      if (body.role === 'admin' && myRole !== 'owner') throw forbidden('Only the owner can invite admins');
      await lockOrg(trx, orgId);
      const member = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select('u.id')
        .where('m.org_id', '=', orgId)
        .where('u.email', '=', body.email)
        .executeTakeFirst();
      if (member) throw conflict('This person is already a member', 'ALREADY_MEMBER');
      // Replace any previous open invitation for the same address.
      await trx.updateTable('invitations').set({ revoked_at: new Date() }).where('org_id', '=', orgId).where('email', '=', body.email).where('accepted_at', 'is', null).where('revoked_at', 'is', null).execute();
      await assertSeatAvailable(trx, orgId, await getEntitlements(trx, orgId, grace));
      const token = randomToken(32);
      const invite = await trx
        .insertInto('invitations')
        .values({ org_id: orgId, email: body.email, role: body.role, token_hash: sha256Hex(token), invited_by: user.id, expires_at: addDays(new Date(), INVITE_TTL_DAYS) })
        .returning(['id', 'email', 'role', 'expires_at'])
        .executeTakeFirstOrThrow();
      await enqueueEmail(trx, body.email, 'invitation', org.locale, { orgName: org.name, inviterName: user.name, role: body.role, link: `${config.APP_URL}/invite?token=${token}` });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'invitation.created', targetType: 'invitation', targetId: invite.id, metadata: { email: body.email, role: body.role } }, requestMeta(req));
      return invite;
    });
    return reply.status(201).send({ invitation: { id: result.id, email: result.email, role: result.role, expiresAt: result.expires_at } });
  });

  app.post('/api/orgs/:orgId/invitations/:id/resend', rateLimited(10, '1 hour'), async (req) => {
    const { orgId, id } = parse(z.object({ orgId: z.string(), id: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { user, org, role }) => {
      const invite = await trx.selectFrom('invitations').selectAll().where('id', '=', id).where('org_id', '=', orgId).where('accepted_at', 'is', null).where('revoked_at', 'is', null).executeTakeFirst();
      if (!invite) throw notFound('Invitation');
      if (invite.role === 'admin' && role !== 'owner') throw forbidden('Only the owner can invite admins');
      const token = randomToken(32);
      await trx.updateTable('invitations').set({ token_hash: sha256Hex(token), expires_at: addDays(new Date(), INVITE_TTL_DAYS) }).where('id', '=', id).execute();
      await enqueueEmail(trx, invite.email, 'invitation', org.locale, { orgName: org.name, inviterName: user.name, role: invite.role, link: `${config.APP_URL}/invite?token=${token}` });
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'invitation.resent', targetType: 'invitation', targetId: id }, requestMeta(req));
      return { status: 'resent' };
    });
  });

  app.delete('/api/orgs/:orgId/invitations/:id', async (req) => {
    const { orgId, id } = parse(z.object({ orgId: z.string(), id: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const res = await trx.updateTable('invitations').set({ revoked_at: new Date() }).where('id', '=', id).where('org_id', '=', orgId).where('accepted_at', 'is', null).where('revoked_at', 'is', null).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Invitation');
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'invitation.revoked', targetType: 'invitation', targetId: id }, requestMeta(req));
      return { status: 'revoked' };
    });
  });

  // ------------------------------------------------------------ audit log
  app.get('/api/orgs/:orgId/audit-logs', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const q = parse(
      z.object({ action: z.string().max(60).optional(), before: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const ent = await getEntitlements(trx, orgId, grace);
      const since = addDays(new Date(), -ent.limits.audit_log_days);
      let query = trx
        .selectFrom('audit_logs')
        .select(['id', 'actor_email', 'actor_type', 'action', 'target_type', 'target_id', 'metadata', 'ip', 'created_at'])
        .where('org_id', '=', orgId)
        .where('created_at', '>=', since)
        .orderBy('id', 'desc')
        .limit(q.limit);
      if (q.action) query = query.where('action', 'like', `${q.action.replace(/[%_\\]/g, '\\$&')}%`);
      if (q.before) query = query.where('id', '<', q.before);
      const rows = await query.execute();
      return {
        retentionDays: ent.limits.audit_log_days,
        entries: rows.map((r) => ({ id: r.id, actor: r.actor_email, actorType: r.actor_type, action: r.action, targetType: r.target_type, targetId: r.target_id, metadata: r.metadata, ip: r.ip, createdAt: r.created_at })),
        nextBefore: rows.length === q.limit ? rows.at(-1)!.id : null,
      };
    });
  });

  // ------------------------------------------------------------ support access (customer-controlled)
  app.get('/api/orgs/:orgId/support-access', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'owner', async (trx) => {
      const rows = await trx
        .selectFrom('support_access_grants as g')
        .leftJoin('users as u', 'u.id', 'g.granted_by')
        .select(['g.id', 'g.reason', 'g.expires_at', 'g.revoked_at', 'g.created_at', 'u.name as grantedBy'])
        .where('g.org_id', '=', orgId)
        .orderBy('g.created_at', 'desc')
        .limit(20)
        .execute();
      const now = new Date();
      return { grants: rows.map((g) => ({ id: g.id, reason: g.reason, grantedBy: g.grantedBy, createdAt: g.created_at, expiresAt: g.expires_at, revokedAt: g.revoked_at, active: !g.revoked_at && g.expires_at > now })) };
    });
  });

  app.post('/api/orgs/:orgId/support-access', async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(z.object({ reason: z.string().trim().min(5).max(500), hours: z.number().int().min(1).max(72) }), req.body);
    const grant = await inOrg(ctx, req, orgId, 'owner', async (trx, { user }) => {
      const g = await trx
        .insertInto('support_access_grants')
        .values({ org_id: orgId, granted_by: user.id, reason: body.reason, expires_at: new Date(Date.now() + body.hours * 3_600_000) })
        .returning(['id', 'expires_at'])
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'support_access.granted', targetType: 'support_access_grant', targetId: g.id, metadata: { hours: body.hours, reason: body.reason } }, requestMeta(req));
      return g;
    });
    return reply.status(201).send({ grant: { id: grant.id, expiresAt: grant.expires_at } });
  });

  app.delete('/api/orgs/:orgId/support-access/:id', async (req) => {
    const { orgId, id } = parse(z.object({ orgId: z.string(), id: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'owner', async (trx) => {
      const res = await trx.updateTable('support_access_grants').set({ revoked_at: new Date() }).where('id', '=', id).where('org_id', '=', orgId).where('revoked_at', 'is', null).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Grant');
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'support_access.revoked', targetType: 'support_access_grant', targetId: id }, requestMeta(req));
      return { status: 'revoked' };
    });
  });

  // ------------------------------------------------------------ API keys
  app.get('/api/orgs/:orgId/api-keys', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const rows = await trx
        .selectFrom('api_keys as k')
        .leftJoin('users as u', 'u.id', 'k.created_by')
        .select(['k.id', 'k.name', 'k.prefix', 'k.created_at', 'k.last_used_at', 'k.revoked_at', 'u.name as createdBy'])
        .where('k.org_id', '=', orgId)
        .orderBy('k.created_at', 'desc')
        .execute();
      return { apiKeys: rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdBy: k.createdBy, createdAt: k.created_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at })) };
    });
  });

  app.post('/api/orgs/:orgId/api-keys', async (req, reply) => {
    const { orgId } = parse(OrgParams, req.params);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const created = await inOrg(ctx, req, orgId, 'admin', async (trx, { user }) => {
      requireFeature(await getEntitlements(trx, orgId, grace), 'api_access', 'API access');
      const active = await trx.selectFrom('api_keys').select((eb) => eb.fn.countAll<string>().as('n')).where('org_id', '=', orgId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(active.n) >= MAX_ACTIVE_API_KEYS) throw conflict(`At most ${MAX_ACTIVE_API_KEYS} active API keys`, 'API_KEY_LIMIT');
      const key = `cs_live_${randomToken(32)}`;
      const row = await trx
        .insertInto('api_keys')
        .values({ org_id: orgId, name, prefix: key.slice(0, 14), key_hash: sha256Hex(key), created_by: user.id })
        .returning(['id', 'name', 'prefix', 'created_at'])
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'api_key.created', targetType: 'api_key', targetId: row.id, metadata: { name } }, requestMeta(req));
      return { ...row, key };
    });
    // The plaintext key is returned exactly once; only its hash is stored.
    return reply.status(201).send({ apiKey: { id: created.id, name: created.name, prefix: created.prefix, createdAt: created.created_at }, key: created.key });
  });

  app.delete('/api/orgs/:orgId/api-keys/:id', async (req) => {
    const { orgId, id } = parse(z.object({ orgId: z.string(), id: zUuid }), req.params);
    return inOrg(ctx, req, orgId, 'admin', async (trx) => {
      const res = await trx.updateTable('api_keys').set({ revoked_at: new Date() }).where('id', '=', id).where('org_id', '=', orgId).where('revoked_at', 'is', null).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('API key');
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'api_key.revoked', targetType: 'api_key', targetId: id }, requestMeta(req));
      return { status: 'revoked' };
    });
  });
}

