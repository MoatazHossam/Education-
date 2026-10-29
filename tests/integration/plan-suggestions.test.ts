import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { addMember, createHarness, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

// Drafts of teaching plans by the AI provider (docs/TEACHING_PLANS.md §4), end to end
// against the Gemini simulator: who may ask, what is sent, what comes back, and that
// nothing is saved until the member saves the plan.

const KEY = 'sim-key-0123456789';
const sim = new AiSimulator(KEY);
let h: Harness;
beforeAll(async () => {
  await sim.start();
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false', AI_PROVIDER: 'gemini', AI_API_KEY: KEY, AI_MODEL: 'gemini-2.5-flash', AI_API_BASE: sim.base('gemini') });
});
afterAll(async () => {
  await h.close();
  await sim.stop();
});
beforeEach(async () => {
  sim.reset();
  await resetData(h.ownerDb);
});

const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

async function school() {
  const owner = await signUp(h, { org: 'Nile School' });
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const versionId = await publishedVersionId(h);
  const rows = await h.ownerDb
    .selectFrom('catalog_subjects as s')
    .innerJoin('catalog_materials as m', 'm.subject_id', 's.id')
    .select(['s.name_en', 'm.id', 'm.title'])
    .where('s.version_id', '=', versionId)
    .where('s.grade', '=', 4)
    .orderBy('s.sort_order')
    .orderBy('s.name_en')
    .orderBy('m.sort_order')
    .execute();
  const subjectEn = rows[0]!.name_en;
  const books = rows.filter((r) => r.name_en === subjectEn);
  const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name: 'Primary 4', catalogVersionId: versionId })).json().scope;
  await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: books.map((b) => b.id) });
  return { owner, teacher, orgId: owner.orgId, subjectEn, titles: books.map((b) => b.title), base: `/api/orgs/${owner.orgId}/scopes/${scope.id}/plans` };
}

async function allow(orgId: string, perMonth: number) {
  await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || jsonb_build_object('ai_requests_per_month', ${perMonth}::int) WHERE org_id = ${orgId}`.execute(trx));
}

const LESSON_REPLY = {
  title: 'دورة الماء',
  objectives: ['يسمّي التلميذ مراحل دورة الماء'],
  materials: ['غلاية', 'طبق بارد'],
  warm_up: 'من أين يأتي المطر؟',
  activities: [{ title: 'تمهيد', minutes: 5, description: 'أسئلة سريعة.' }, { title: 'تجربة', minutes: 30, description: 'نغلي الماء تحت طبق بارد.' }],
  questions: ['ما التبخر؟'],
  assessment: 'بطاقة خروج.',
  homework: 'ارسم دورة الماء.',
  differentiation: 'بطاقات مصوّرة للدعم.',
};
const week = (n: number) => ({ topics: `الوحدة ${n}`, objectives: 'أهداف الأسبوع', notes: '' });

describe('teaching plan drafts', () => {
  it('are off until the school has AI requests; the plans page says whether to offer them', async () => {
    const s = await school();
    expect((await s.teacher.client.get(s.base)).json().ai).toBeNull();
    const res = await s.teacher.client.post(`${s.base}/suggest-lesson`, { grade: 4, subjectEn: s.subjectEn, topic: 'دورة الماء', language: 'ar' });
    expect([res.statusCode, res.json().error.code]).toEqual([402, 'FEATURE_NOT_IN_PLAN']);
    expect(sim.requests).toHaveLength(0);
  });

  it('write a lesson plan from the topic and lesson text; nothing is saved until the member saves it', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.teacher.client.get(s.base)).json().ai).toEqual({ left: 10 });
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(LESSON_REPLY) });

    const res = await s.teacher.client.post(`${s.base}/suggest-lesson`, { grade: 4, subjectEn: s.subjectEn, topic: 'دورة الماء', lessonText: 'يتبخر الماء بفعل حرارة الشمس.', durationMinutes: 40, language: 'ar' });
    expect(res.statusCode, res.body).toBe(200);
    const { draft, model } = res.json();
    expect(model).toBe('gemini-2.5-flash');
    expect(draft).toMatchObject({ kind: 'lesson', grade: 4, subjectEn: s.subjectEn, language: 'ar', title: 'دورة الماء' });
    expect(draft.content).toMatchObject({ topic: 'دورة الماء', durationMinutes: 40, books: s.titles, warmUp: 'من أين يأتي المطر؟', notes: '' });

    const sent = JSON.stringify(sim.requests[0]!.body);
    for (const part of ['دورة الماء', 'يتبخر الماء بفعل حرارة الشمس', 'grade 4 of 12 (primary 4)', s.titles[0]!, 'The lesson lasts 40 minutes']) expect(sent).toContain(part);

    const page = (await s.teacher.client.get(s.base)).json();
    expect(page).toMatchObject({ plans: [], ai: { left: 9 } });
    const log = await sys((trx) => trx.selectFrom('ai_requests').select(['feature', 'status']).where('org_id', '=', s.orgId).execute());
    expect(log).toEqual([{ feature: 'lesson_plan', status: 'ok' }]);

    // The member saves the draft (here unchanged) as a plan marked as written with AI.
    const saved = await s.teacher.client.post(s.base, { ...draft, aiAssisted: true });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().plan).toMatchObject({ aiAssisted: true, content: draft.content });
  });

  it('write a pacing plan with exactly the weeks asked for, asking again once when the count is wrong', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    sim.script('gemini', { kind: 'ok', text: JSON.stringify({ title: 'الفصل الأول', weeks: [week(1), week(2)] }) }, { kind: 'ok', text: JSON.stringify({ title: 'الفصل الأول', weeks: [week(1), week(2), week(3)] }) });

    const res = await s.teacher.client.post(`${s.base}/suggest-pacing`, { grade: 4, subjectEn: s.subjectEn, startDate: '2026-09-27', weeks: 3, periodsPerWeek: 3, contents: 'الوحدة 1\nالوحدة 2\nالوحدة 3', language: 'ar' });
    expect(res.statusCode, res.body).toBe(200);
    expect(sim.requests).toHaveLength(2);
    expect(res.json().draft).toEqual({
      kind: 'pacing', grade: 4, subjectEn: s.subjectEn, language: 'ar', title: 'الفصل الأول',
      content: { startDate: '2026-09-27', periodsPerWeek: 3, books: s.titles, weeks: [week(1), week(2), week(3)] },
    });
    const sent = JSON.stringify(sim.requests[0]!.body);
    for (const part of ['The term starts on 2026-09-27', 'Return exactly 3 entries', 'with 3 periods', 'الوحدة 1\\nالوحدة 2']) expect(sent).toContain(part);
    const log = await sys((trx) => trx.selectFrom('ai_requests').select(['feature', 'status', 'attempts']).where('org_id', '=', s.orgId).execute());
    expect(log).toEqual([{ feature: 'pacing_plan', status: 'ok', attempts: 2 }]);
  });

  it('check the subject, the request and the school before asking the AI service', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    const lesson = { grade: 4, subjectEn: s.subjectEn, topic: 'دورة الماء', language: 'ar' };
    const pacing = { grade: 4, subjectEn: s.subjectEn, startDate: '2026-09-27', weeks: 10, language: 'ar' };
    expect((await s.teacher.client.post(`${s.base}/suggest-lesson`, { ...lesson, grade: 9 })).json().error.code).toBe('INVALID_SUBJECT');
    expect((await s.teacher.client.post(`${s.base}/suggest-pacing`, { ...pacing, subjectEn: 'Astronomy' })).json().error.code).toBe('INVALID_SUBJECT');
    expect((await s.teacher.client.post(`${s.base}/suggest-lesson`, { ...lesson, topic: 'x' })).statusCode).toBe(400);
    expect((await s.teacher.client.post(`${s.base}/suggest-lesson`, { ...lesson, lessonText: 'x'.repeat(12_001) })).statusCode).toBe(400);
    expect((await s.teacher.client.post(`${s.base}/suggest-pacing`, { ...pacing, weeks: 41 })).statusCode).toBe(400);
    expect((await s.teacher.client.post(`${s.base}/suggest-pacing`, { ...pacing, contents: 'x'.repeat(8001) })).statusCode).toBe(400);

    const other = await signUp(h, { org: 'Delta School' });
    await allow(other.orgId, 10);
    expect((await other.client.post(`${s.base.replace(s.orgId, other.orgId)}/suggest-lesson`, lesson)).statusCode).toBe(404);
    expect(sim.requests).toHaveLength(0);
  });
});
