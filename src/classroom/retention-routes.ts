import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import type { Executor } from '../db/index.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { AppError, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/validation.js';
import { dropStaleNotices, getPeriods, listHeld, listNotices, NOTICE_DAYS, periodsInOrder, previewPeriods, scheduleNotices, zPeriods, type RetentionPeriods } from './retention.js';

// How long the school keeps classroom data (docs/CLASSROOM.md §11). Owners and admins only.

const OrgParams = z.object({ orgId: z.string() });
const Hold = z.object({ kind: z.enum(['homework', 'test']), id: zUuid, keep: z.boolean() });

function assertInOrder(p: RetentionPeriods): void {
  if (!periodsInOrder(p)) {
    throw new AppError(400, 'RETENTION_ORDER', 'Students’ work and monitoring records cannot be kept longer than the homework or test they belong to.');
  }
}

async function overview(exec: Executor, orgId: string) {
  const p = await getPeriods(exec, orgId);
  const by = p.updatedBy ? await exec.selectFrom('users').select('name').where('id', '=', p.updatedBy).executeTakeFirst() : undefined;
  return {
    periods: { monitoringDays: p.monitoringDays, workDays: p.workDays, recordsDays: p.recordsDays },
    updatedAt: p.updatedAt,
    updatedBy: by?.name ?? null,
    noticeDays: NOTICE_DAYS,
    upcoming: await listNotices(exec, orgId),
    held: await listHeld(exec, orgId),
  };
}

export function registerRetentionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;

  app.get('/api/orgs/:orgId/classroom-retention', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    return inOrg(ctx, req, orgId, 'admin', (trx, { org }) => overview(trx, org.id));
  });

  // What saving these periods would do now: homework and tests with data past them, deleted NOTICE_DAYS after saving.
  app.post('/api/orgs/:orgId/classroom-retention/preview', async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const periods = parse(zPeriods, req.body);
    assertInOrder(periods);
    return inOrg(ctx, req, orgId, 'admin', (trx, { org }) => previewPeriods(trx, org.id, periods));
  });

  app.put('/api/orgs/:orgId/classroom-retention', rateLimited(30, '1 hour'), async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const periods = parse(zPeriods, req.body);
    assertInOrder(periods);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { org, user }) => {
      const before = await getPeriods(trx, org.id);
      const row = { monitoring_days: periods.monitoringDays, work_days: periods.workDays, records_days: periods.recordsDays, updated_by: user.id, updated_at: new Date() };
      await trx
        .insertInto('classroom_retention')
        .values({ org_id: org.id, ...row })
        .onConflict((oc) => oc.column('org_id').doUpdateSet(row))
        .execute();
      const dropped = await dropStaleNotices(trx, org.id, periods);
      const noticed = await scheduleNotices(trx, config, org.id, periods);
      await recordAudit(
        trx,
        actorFromRequest(req),
        {
          orgId: org.id,
          action: 'classroom.retention_updated',
          targetType: 'organization',
          targetId: org.id,
          metadata: { before: { monitoringDays: before.monitoringDays, workDays: before.workDays, recordsDays: before.recordsDays }, after: periods, noticesDropped: dropped, noticesSent: noticed.length },
        },
        requestMeta(req),
      );
      return { ...(await overview(trx, org.id)), noticesSent: noticed.length };
    });
  });

  // Keep one homework or test whatever the periods say (an appeal, a dispute), or let the periods apply again.
  app.put('/api/orgs/:orgId/classroom-retention/hold', rateLimited(120, '1 hour'), async (req) => {
    const { orgId } = parse(OrgParams, req.params);
    const body = parse(Hold, req.body);
    return inOrg(ctx, req, orgId, 'admin', async (trx, { org }) => {
      const item =
        body.kind === 'homework'
          ? await trx.updateTable('homework').set({ retention_hold: body.keep }).where('org_id', '=', org.id).where('id', '=', body.id).returning(['id', 'title']).executeTakeFirst()
          : await trx.updateTable('tests').set({ retention_hold: body.keep }).where('org_id', '=', org.id).where('id', '=', body.id).returning(['id', 'title']).executeTakeFirst();
      if (!item) throw notFound(body.kind === 'homework' ? 'Homework' : 'Test');
      if (body.keep) {
        await trx.deleteFrom('classroom_retention_notices').where('org_id', '=', org.id).where('item_id', '=', item.id).execute();
      } else {
        await scheduleNotices(trx, config, org.id, await getPeriods(trx, org.id));
      }
      await recordAudit(
        trx,
        actorFromRequest(req),
        { orgId: org.id, action: 'classroom.retention_hold', targetType: body.kind, targetId: item.id, metadata: { title: item.title, keep: body.keep } },
        requestMeta(req),
      );
      return overview(trx, org.id);
    });
  });
}
