import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { addMember, createHarness, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

// Teaching plans of a curriculum scope (docs/TEACHING_PLANS.md): who reads and writes
// them, what is checked, and that they stay within their school and scope.

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

/** The first subject of a grade in the published catalogue, with its books. */
async function subjectOf(versionId: string, grade: number) {
  const rows = await h.ownerDb
    .selectFrom('catalog_subjects as s')
    .innerJoin('catalog_materials as m', 'm.subject_id', 's.id')
    .select(['s.name_en', 's.name_ar', 'm.id', 'm.title'])
    .where('s.version_id', '=', versionId)
    .where('s.grade', '=', grade)
    .orderBy('s.sort_order')
    .orderBy('s.name_en')
    .orderBy('m.sort_order')
    .execute();
  const first = rows[0]!;
  const books = rows.filter((r) => r.name_en === first.name_en);
  return { nameEn: first.name_en, nameAr: first.name_ar, materialIds: books.map((b) => b.id), titles: books.map((b) => b.title) };
}

async function school() {
  const owner = await signUp(h, { org: 'Nile School', name: 'Mona Owner' });
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const colleague = await addMember(h, owner.client, owner.orgId, 'viewer');
  const admin = await addMember(h, owner.client, owner.orgId, 'admin');
  const versionId = await publishedVersionId(h);
  const subject = await subjectOf(versionId, 5);
  const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Primary 5', catalogVersionId: versionId })).json().scope;
  await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: subject.materialIds });
  const base = `/api/orgs/${owner.orgId}/scopes/${scope.id}/plans`;
  return { owner, teacher, colleague, admin, versionId, subject, scope, base, orgId: owner.orgId };
}

const LESSON = {
  topic: 'The water cycle',
  durationMinutes: 45,
  objectives: ['Name the stages of the water cycle', 'Explain evaporation'],
  activities: [{ title: 'Warm-up questions', minutes: 5 }, { title: 'Group drawing', minutes: 25, description: 'Each group draws the cycle.' }],
  homework: 'Draw the water cycle in your notebook.',
};
const PACING = {
  startDate: '2026-09-27',
  periodsPerWeek: 4,
  weeks: [{ topics: 'Unit 1: Living things', objectives: 'Classify living things' }, { topics: 'Unit 1: Habitats' }, { topics: '', notes: 'Mid-term holiday' }],
};
const lesson = (s: { subject: { nameEn: string } }, extra: Record<string, unknown> = {}) => ({
  kind: 'lesson', grade: 5, subjectEn: s.subject.nameEn, title: 'Water cycle lesson', language: 'en', content: LESSON, ...extra,
});

describe('teaching plans', () => {
  it('any member writes plans for the scope’s subjects; everyone in the school reads them', async () => {
    const s = await school();
    const empty = (await s.teacher.client.get(s.base)).json();
    expect(empty.scope).toMatchObject({ id: s.scope.id, name: 'Primary 5' });
    expect(empty.grades).toEqual([{ grade: 5, subjects: [{ nameEn: s.subject.nameEn, nameAr: s.subject.nameAr, books: s.subject.titles }] }]);
    expect(empty).toMatchObject({ plans: [], limit: 500, ai: null });

    const created = await s.teacher.client.post(s.base, lesson(s));
    expect(created.statusCode, created.body).toBe(201);
    const plan = created.json().plan;
    expect(plan).toMatchObject({
      kind: 'lesson', grade: 5, subjectEn: s.subject.nameEn, subjectAr: s.subject.nameAr, title: 'Water cycle lesson', language: 'en',
      aiAssisted: false, createdBy: 'Member viewer', canEdit: true,
    });
    // Missing parts are saved empty, so the editor always gets every field.
    expect(plan.content).toEqual({
      ...LESSON, books: [], materials: [], warmUp: '', questions: [], assessment: '', differentiation: '', notes: '',
      activities: [{ title: 'Warm-up questions', minutes: 5, description: '' }, { title: 'Group drawing', minutes: 25, description: 'Each group draws the cycle.' }],
    });

    const pacing = await s.admin.client.post(s.base, { kind: 'pacing', grade: 5, subjectEn: s.subject.nameEn, title: 'First term', language: 'ar', aiAssisted: true, content: PACING });
    expect(pacing.statusCode, pacing.body).toBe(201);
    expect(pacing.json().plan.content.weeks[2]).toEqual({ topics: '', objectives: '', notes: 'Mid-term holiday' });

    const list = (await s.colleague.client.get(s.base)).json().plans;
    expect(list.map((p: { title: string; canEdit: boolean; summary: unknown }) => [p.title, p.canEdit, p.summary])).toEqual([
      ['Water cycle lesson', false, { topic: 'The water cycle', durationMinutes: 45 }],
      ['First term', false, { startDate: '2026-09-27', weeks: 3 }],
    ]);
    expect(list[0]).not.toHaveProperty('content');
    const one = (await s.colleague.client.get(`${s.base}/${plan.id}`)).json();
    expect(one.plan.content.topic).toBe('The water cycle');
    expect(one.plan.canEdit).toBe(false);

    // The audit names the plan, never its content.
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('org_id', '=', s.orgId).where('action', 'like', 'plan.%').orderBy('created_at').execute());
    expect(audit.map((a) => a.action)).toEqual(['plan.created', 'plan.created']);
    expect(audit[1]!.metadata).toEqual({ scopeId: s.scope.id, kind: 'pacing', grade: 5, subjectEn: s.subject.nameEn, aiAssisted: true });
    expect(JSON.stringify(audit)).not.toContain('water');
  });

  it('only the author and the school’s admins change or remove a plan', async () => {
    const s = await school();
    const plan = (await s.teacher.client.post(s.base, lesson(s))).json().plan;
    const url = `${s.base}/${plan.id}`;

    expect((await s.colleague.client.patch(url, { title: 'Mine now' })).json().error.code).toBe('NOT_PLAN_AUTHOR');
    expect((await s.colleague.client.delete(url)).statusCode).toBe(403);

    const edited = await s.teacher.client.patch(url, { title: 'Water cycle, revised', content: { ...LESSON, durationMinutes: 50, notes: 'Bring a kettle.' } });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().plan).toMatchObject({ title: 'Water cycle, revised', content: { durationMinutes: 50, notes: 'Bring a kettle.' }, updatedBy: 'Member viewer' });

    const byAdmin = await s.admin.client.patch(url, { language: 'ar' });
    expect(byAdmin.json().plan).toMatchObject({ language: 'ar', updatedBy: 'Member admin', canEdit: true, title: 'Water cycle, revised' });

    expect((await s.owner.client.delete(url)).statusCode).toBe(204);
    expect((await s.teacher.client.get(url)).statusCode).toBe(404);
    const audit = await sys((trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('org_id', '=', s.orgId).where('action', 'like', 'plan.%').orderBy('created_at').execute());
    expect(audit.map((a) => a.action)).toEqual(['plan.created', 'plan.updated', 'plan.updated', 'plan.deleted']);
    expect(audit[1]!.metadata).toEqual({ scopeId: s.scope.id, changed: ['title', 'content'] });
  });

  it('checks the grade and subject, the content against the kind, and the number of plans', async () => {
    const s = await school();
    const other = await subjectOf(s.versionId, 6);
    const codeOf = async (body: unknown) => (await s.teacher.client.post(s.base, body)).json().error?.code;
    expect(await codeOf(lesson(s, { grade: 6, subjectEn: other.nameEn }))).toBe('INVALID_SUBJECT');
    expect(await codeOf(lesson(s, { subjectEn: 'Astronomy' }))).toBe('INVALID_SUBJECT');
    expect(await codeOf(lesson(s, { kind: 'pacing' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(lesson(s, { content: { ...LESSON, durationMinutes: 5 } }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(lesson(s, { content: { ...LESSON, studentNames: ['Salma'] } }))).toBe('VALIDATION_ERROR');
    expect(await codeOf({ ...lesson(s), kind: 'pacing', content: { ...PACING, weeks: [] } })).toBe('VALIDATION_ERROR');
    expect(await codeOf(lesson(s, { title: '' }))).toBe('VALIDATION_ERROR');

    const plan = (await s.teacher.client.post(s.base, lesson(s))).json().plan;
    const bad = await s.teacher.client.patch(`${s.base}/${plan.id}`, { content: PACING });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details[0].path).toBe('content.topic');
    expect((await s.teacher.client.patch(`${s.base}/${plan.id}`, {})).statusCode).toBe(400);

    // A scope holds at most 500 plans.
    await sys((trx) => sql`
      INSERT INTO teaching_plans (org_id, scope_id, kind, grade, subject_en, subject_ar, title, language, content)
      SELECT ${s.orgId}, ${s.scope.id}, 'lesson', 5, 'x', 'x', 'Plan ' || n, 'en', '{}'::jsonb FROM generate_series(1, 499) AS n`.execute(trx));
    expect(await codeOf(lesson(s))).toBe('TOO_MANY_PLANS');
  });

  it('stay within their school and scope, and go with the scope', async () => {
    const s = await school();
    const plan = (await s.teacher.client.post(s.base, lesson(s))).json().plan;

    const other = await signUp(h, { org: 'Delta School' });
    expect((await other.client.get(s.base)).statusCode).toBe(404);
    expect((await other.client.get(`/api/orgs/${other.orgId}/scopes/${s.scope.id}/plans/${plan.id}`)).statusCode).toBe(404);
    expect((await other.client.post(`/api/orgs/${other.orgId}/scopes/${s.scope.id}/plans`, lesson(s))).statusCode).toBe(404);

    // Another scope of the same school does not reach the plan.
    const second = (await s.owner.client.post(`/api/orgs/${s.orgId}/scopes`, { name: 'Primary 6', catalogVersionId: s.versionId })).json().scope;
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/scopes/${second.id}/plans/${plan.id}`)).statusCode).toBe(404);
    expect((await s.teacher.client.patch(`/api/orgs/${s.orgId}/scopes/${second.id}/plans/${plan.id}`, { title: 'x' })).statusCode).toBe(404);
    expect((await s.teacher.client.get(`${s.base}/not-a-uuid`)).statusCode).toBe(404);

    expect((await s.owner.client.delete(`/api/orgs/${s.orgId}/scopes/${s.scope.id}`)).statusCode).toBe(200);
    expect(await sys((trx) => trx.selectFrom('teaching_plans').select('id').execute())).toEqual([]);
  });
});
