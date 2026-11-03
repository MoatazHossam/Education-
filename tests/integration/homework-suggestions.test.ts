import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { addMember, createHarness, createStudent, enableStudents, resetData, signUp, type Harness } from '../helpers/harness.js';

// Homework suggested by the AI provider (docs/CLASSROOM.md §13), end to end against the Gemini
// simulator: who may ask, what is sent, what comes back, and that nothing is saved.

const KEY = 'sim-key-0123456789';
const sim = new AiSimulator(KEY);
let h: Harness;
beforeAll(async () => {
  await sim.start();
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false', AI_PROVIDER: 'gemini', AI_API_KEY: KEY, AI_MODEL: 'gemini-2.5-pro', AI_API_BASE: sim.base('gemini') });
});
afterAll(async () => {
  await h.close();
  await sim.stop();
});
beforeEach(async () => {
  sim.reset();
  await resetData(h.ownerDb);
});

const SUBJECT = { subjectEn: 'Science', subjectAr: 'العلوم' };
const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

async function school() {
  const owner = await signUp(h, { org: 'Nile School' });
  await enableStudents(h, owner.orgId);
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const art = await addMember(h, owner.client, owner.orgId, 'viewer');
  const student = await createStudent(h, owner.client, owner.orgId, { username: 'salma', name: 'Salma', grade: 5 });
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '5A', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [student.userId] });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, ...SUBJECT });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: art.userId, subjectEn: 'Art', subjectAr: 'التربية الفنية' });
  return { owner, teacher, art, classId, orgId: owner.orgId };
}

async function allow(orgId: string, perMonth: number) {
  await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || jsonb_build_object('ai_requests_per_month', ${perMonth}::int) WHERE org_id = ${orgId}`.execute(trx));
}

const REPLY = {
  title: ' دورة الماء في الطبيعة ',
  instructions: '1. اقرأ فقرة دورة الماء في الكتاب.\n2. ارسم دورة الماء في كراستك وسمِّ مراحلها.\n3. صوّر الرسم وسلّمه.',
  estimated_minutes: 25,
  teacher_notes: 'المراحل: التبخر، التكثف، الهطول، الجريان.',
};
const BODY = { ...SUBJECT, topic: 'دورة الماء', lessonText: 'يتبخر الماء من البحار بفعل حرارة الشمس ثم يتكثف في السحب.', kind: 'writing', minutes: 30, language: 'ar' };
const url = (s: { orgId: string; classId: string }) => `/api/orgs/${s.orgId}/classes/${s.classId}/suggest-homework`;

describe('homework suggestions', () => {
  it('are off until the school has AI requests; the class page says whether to offer them', async () => {
    const s = await school();
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}`)).json().ai).toBeNull();
    const res = await s.teacher.client.post(url(s), BODY);
    expect([res.statusCode, res.json().error.code]).toEqual([402, 'FEATURE_NOT_IN_PLAN']);
    expect(sim.requests).toHaveLength(0);
  });

  it('send the topic, lesson text, grade and subject; return a suggestion; save nothing', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}`)).json().ai).toEqual({ left: 10 });
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(REPLY) });

    const res = await s.teacher.client.post(url(s), BODY);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      suggestion: { title: 'دورة الماء في الطبيعة', instructions: REPLY.instructions, estimatedMinutes: 25, teacherNotes: REPLY.teacher_notes },
      model: 'gemini-2.5-pro',
    });

    const sent = JSON.stringify(sim.requests[0]!.body);
    for (const part of ['دورة الماء', 'يتبخر الماء من البحار', 'grade 5 of 12 (primary 5)', 'Science (العلوم)', 'Modern Standard Arabic', 'about 30 minutes', 'writing:']) expect(sent).toContain(part);
    expect(sent).not.toContain('Salma');

    // Nothing was saved; one AI request was counted and logged for this feature.
    const page = (await s.teacher.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}`)).json();
    expect(page).toMatchObject({ homework: [], ai: { left: 9 } });
    const log = await sys((trx) => trx.selectFrom('ai_requests').select(['feature', 'status']).where('org_id', '=', s.orgId).execute());
    expect(log).toEqual([{ feature: 'homework_suggestion', status: 'ok' }]);

    // The teacher sets it like any homework.
    const set = await s.teacher.client.post(`/api/orgs/${s.orgId}/classes/${s.classId}/homework`, {
      ...SUBJECT,
      title: res.json().suggestion.title,
      instructions: res.json().suggestion.instructions,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(set.statusCode, set.body).toBe(201);
  });

  it('only for the subject\'s teachers and the school\'s admins, in an open class, for a subject of its grade', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.art.client.post(url(s), BODY)).json().error.code).toBe('NOT_SUBJECT_TEACHER');
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(REPLY) });
    expect((await s.owner.client.post(url(s), BODY)).statusCode).toBe(200);
    expect((await s.owner.client.post(url(s), { ...BODY, subjectEn: 'Astronomy' })).json().error.code).toBe('INVALID_SUBJECT');

    // Another school's member cannot reach the class at all.
    const other = await signUp(h, { org: 'Delta School' });
    await enableStudents(h, other.orgId);
    await allow(other.orgId, 10);
    expect((await other.client.post(url({ orgId: other.orgId, classId: s.classId }), BODY)).statusCode).toBe(404);

    await s.owner.client.patch(`/api/orgs/${s.orgId}/classes/${s.classId}`, { archived: true });
    expect((await s.owner.client.post(url(s), BODY)).json().error.code).toBe('CLASS_ARCHIVED');
    expect((await s.owner.client.get(`/api/orgs/${s.orgId}/classes/${s.classId}`)).json().ai).toBeNull();
    expect(sim.requests).toHaveLength(1);
  });

  it('refuse an incomplete or too long request before asking the AI service', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.teacher.client.post(url(s), { ...BODY, topic: 'x' })).statusCode).toBe(400);
    expect((await s.teacher.client.post(url(s), { ...BODY, lessonText: 'x'.repeat(12_001) })).statusCode).toBe(400);
    expect((await s.teacher.client.post(url(s), { ...BODY, minutes: 500 })).statusCode).toBe(400);
    expect((await s.teacher.client.post(url(s), { ...BODY, kind: 'game' })).statusCode).toBe(400);
    expect(sim.requests).toHaveLength(0);
  });

  it('ask again once when the reply is not in the expected shape, and pass on failures', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    sim.script('gemini', { kind: 'ok', text: '{"title":"No instructions"}' }, { kind: 'ok', text: JSON.stringify(REPLY) });
    expect((await s.teacher.client.post(url(s), BODY)).statusCode).toBe(200);
    expect(sim.requests).toHaveLength(2);
    sim.script('gemini', { kind: 'refusal' });
    expect((await s.teacher.client.post(url(s), BODY)).json().error.code).toBe('AI_REFUSED');
  });
});
