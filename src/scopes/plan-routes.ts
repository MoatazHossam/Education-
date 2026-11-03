import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aiAllowance, runAiTask } from '../ai/service.js';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import type { AppContext } from '../http/context.js';
import { rateLimited } from '../http/rate-limit.js';
import { conflict } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import {
  assertCanEdit, getPlan, listPlans, MAX_PLANS_PER_SCOPE, parseContent, planCount, PlanBody, PlanPatch, planView, scopeSubject, scopeSubjects,
} from './plans.js';
import { LessonSuggestBody, lessonPrompt, PacingSuggestBody, pacingPrompt, SuggestedLesson, suggestedPacing, toLessonDraft, toPacingDraft, type PlanContext } from './plan-suggestions.js';
import { getScope } from './service.js';

// Teaching plans of a curriculum scope (docs/TEACHING_PLANS.md). Audit entries
// name the plan, never its content. Drafts by the AI provider come back unsaved.

const ScopeParams = z.object({ orgId: z.string(), scopeId: z.string() });
const PlanParams = ScopeParams.extend({ planId: z.string() });

export function registerPlanRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/orgs/:orgId/scopes/:scopeId/plans', async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      const { academicYear, grades } = await scopeSubjects(trx, scope);
      return {
        scope: { id: scope.id, name: scope.name, academicYear },
        grades,
        plans: await listPlans(trx, access, scope.id),
        limit: MAX_PLANS_PER_SCOPE,
        ai: await aiAllowance(ctx, trx, orgId),
      };
    });
  });

  app.post('/api/orgs/:orgId/scopes/:scopeId/plans', rateLimited(300, '1 hour'), async (req, reply) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(PlanBody, req.body);
    const plan = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      const subject = await scopeSubject(trx, scope, body.grade, body.subjectEn);
      if ((await planCount(trx, scope.id)) >= MAX_PLANS_PER_SCOPE) throw conflict(`A scope can hold at most ${MAX_PLANS_PER_SCOPE} plans`, 'TOO_MANY_PLANS');
      const { id } = await trx
        .insertInto('teaching_plans')
        .values({
          org_id: orgId,
          scope_id: scope.id,
          kind: body.kind,
          grade: body.grade,
          subject_en: subject.nameEn,
          subject_ar: subject.nameAr,
          title: body.title,
          language: body.language,
          content: JSON.stringify(body.content),
          ai_assisted: body.aiAssisted,
          created_by: access.user.id,
          updated_by: access.user.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordAudit(trx, actorFromRequest(req), {
        orgId, action: 'plan.created', targetType: 'teaching_plan', targetId: id,
        metadata: { scopeId: scope.id, kind: body.kind, grade: body.grade, subjectEn: subject.nameEn, aiAssisted: body.aiAssisted },
      }, requestMeta(req));
      return planView(await getPlan(trx, scope.id, id), access);
    });
    return reply.status(201).send({ plan });
  });

  /** Who asks, and the grade and subject's books in the scope, for a draft. */
  function draftContext(req: FastifyRequest, orgId: string, scopeId: string, grade: number, subjectEn: string) {
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      const subject = await scopeSubject(trx, scope, grade, subjectEn);
      const context: PlanContext = { grade, subjectEn: subject.nameEn, subjectAr: subject.nameAr, books: subject.books };
      return { user: access.user, context };
    });
  }

  app.post('/api/orgs/:orgId/scopes/:scopeId/plans/suggest-lesson', rateLimited(30, '1 hour'), async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(LessonSuggestBody, req.body);
    const { user, context } = await draftContext(req, orgId, scopeId, body.grade, body.subjectEn);
    const result = await runAiTask(ctx, { orgId, user, meta: requestMeta(req) }, { feature: 'lesson_plan', ...lessonPrompt(context, body), output: SuggestedLesson });
    const draft = toLessonDraft(context, body, result.value);
    return { draft: { kind: 'lesson', grade: body.grade, subjectEn: context.subjectEn, language: body.language, ...draft }, model: result.model };
  });

  app.post('/api/orgs/:orgId/scopes/:scopeId/plans/suggest-pacing', rateLimited(30, '1 hour'), async (req) => {
    const { orgId, scopeId } = parse(ScopeParams, req.params);
    const body = parse(PacingSuggestBody, req.body);
    const { user, context } = await draftContext(req, orgId, scopeId, body.grade, body.subjectEn);
    const result = await runAiTask(ctx, { orgId, user, meta: requestMeta(req) }, { feature: 'pacing_plan', ...pacingPrompt(context, body), output: suggestedPacing(body.weeks) });
    const draft = toPacingDraft(context, body, result.value);
    return { draft: { kind: 'pacing', grade: body.grade, subjectEn: context.subjectEn, language: body.language, ...draft }, model: result.model };
  });

  app.get('/api/orgs/:orgId/scopes/:scopeId/plans/:planId', async (req) => {
    const { orgId, scopeId, planId } = parse(PlanParams, req.params);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      return { plan: planView(await getPlan(trx, scope.id, planId), access), scope: { id: scope.id, name: scope.name } };
    });
  });

  app.patch('/api/orgs/:orgId/scopes/:scopeId/plans/:planId', rateLimited(600, '1 hour'), async (req) => {
    const { orgId, scopeId, planId } = parse(PlanParams, req.params);
    const body = parse(PlanPatch, req.body);
    return inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      const plan = await getPlan(trx, scope.id, planId);
      assertCanEdit(access, plan);
      const content = body.content === undefined ? undefined : parseContent(plan.kind, body.content);
      await trx
        .updateTable('teaching_plans')
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.language !== undefined ? { language: body.language } : {}),
          ...(content !== undefined ? { content: JSON.stringify(content) } : {}),
          updated_by: access.user.id,
        })
        .where('id', '=', plan.id)
        .execute();
      const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
      await recordAudit(trx, actorFromRequest(req), { orgId, action: 'plan.updated', targetType: 'teaching_plan', targetId: plan.id, metadata: { scopeId: scope.id, changed } }, requestMeta(req));
      return { plan: planView(await getPlan(trx, scope.id, plan.id), access) };
    });
  });

  app.delete('/api/orgs/:orgId/scopes/:scopeId/plans/:planId', async (req, reply) => {
    const { orgId, scopeId, planId } = parse(PlanParams, req.params);
    await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const scope = await getScope(trx, orgId, scopeId);
      const plan = await getPlan(trx, scope.id, planId);
      assertCanEdit(access, plan);
      await trx.deleteFrom('teaching_plans').where('id', '=', plan.id).execute();
      await recordAudit(trx, actorFromRequest(req), {
        orgId, action: 'plan.deleted', targetType: 'teaching_plan', targetId: plan.id,
        metadata: { scopeId: scope.id, kind: plan.kind, grade: plan.grade, subjectEn: plan.subject_en, title: plan.title },
      }, requestMeta(req));
    });
    return reply.status(204).send();
  });
}
