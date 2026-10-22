import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../http/context.js';
import { parse } from '../lib/validation.js';

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/notifications', async (req) => {
    const { user } = requireUser(req);
    const rows = await ctx.db
      .selectFrom('notifications')
      .select(['id', 'org_id', 'kind', 'title', 'body', 'link', 'read_at', 'created_at'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { notifications: rows.map((n) => ({ id: n.id, orgId: n.org_id, kind: n.kind, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at })) };
  });

  app.post('/api/notifications/read', async (req) => {
    const { user } = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(100).optional() }), req.body);
    let q = ctx.db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', user.id).where('read_at', 'is', null);
    if (ids?.length) q = q.where('id', 'in', ids);
    const res = await q.executeTakeFirst();
    return { updated: Number(res.numUpdatedRows) };
  });
}
