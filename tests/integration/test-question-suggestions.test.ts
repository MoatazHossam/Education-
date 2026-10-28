import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystemContext } from '../../src/db/index.js';
import { AiSimulator } from '../helpers/ai-simulator.js';
import { addMember, createHarness, createStudent, enableStudents, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

// Questions suggested by the AI provider for a test (docs/ONLINE_TESTS.md §14), end to end against the
// Gemini simulator: who may ask, what is sent, how the reply becomes questions, and that nothing is saved.

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
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
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
  const testId = (await teacher.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/tests`, { ...SUBJECT, title: 'Water cycle quiz', opensAt: minutes(-1), closesAt: minutes(60) })).json().test.id as string;
  return { owner, teacher, art, student, classId, testId, orgId: owner.orgId };
}

async function allow(orgId: string, perMonth: number) {
  await sys((trx) => sql`UPDATE subscriptions SET limit_overrides = limit_overrides || jsonb_build_object('ai_requests_per_month', ${perMonth}::int) WHERE org_id = ${orgId}`.execute(trx));
}

const q = (o: Record<string, unknown>) => ({ prompt: 'Q?', choices: [], correct_choices: [], is_true: null, accepted_answers: [], marking_guide: null, points: 1, explanation: 'Why.', ...o });
const REPLY = {
  questions: [
    q({ type: 'single', prompt: 'ما الذي يحوّل الماء إلى بخار؟', choices: ['الحرارة', 'البرودة', 'الضغط'], correct_choices: [0], explanation: 'التبخر يحتاج إلى حرارة.' }),
    q({ type: 'true_false', prompt: 'يتكثف بخار الماء عندما يبرد.', is_true: true }),
    q({ type: 'short', prompt: 'ما اسم تحوّل الماء من سائل إلى غاز؟', accepted_answers: ['التبخر', 'تبخر'], points: 2 }),
    // Two correct choices on a one-answer question: left out.
    q({ type: 'single', prompt: 'Broken', choices: ['A', 'B'], correct_choices: [0, 1] }),
    // A type that was not asked for: left out.
    q({ type: 'essay', prompt: 'Explain.', marking_guide: 'Evaporation, condensation.', points: 4 }),
  ],
};
const BODY = { topic: 'دورة الماء في الطبيعة', lessonText: 'يتبخر الماء من البحار بفعل حرارة الشمس ثم يتكثف في السحب.', count: 5, types: ['single', 'true_false', 'short'], difficulty: 'easy', language: 'ar' };
const url = (s: { orgId: string; testId: string }) => `/api/orgs/${s.orgId}/tests/${s.testId}/suggest-questions`;

describe('question suggestions', () => {
  it('are off until the school has AI requests; the test page says whether to offer them', async () => {
    const s = await school();
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}`)).json().ai).toBeNull();
    const res = await s.teacher.client.post(url(s), BODY);
    expect([res.statusCode, res.json().error.code]).toEqual([402, 'FEATURE_NOT_IN_PLAN']);
    expect(sim.requests).toHaveLength(0);
  });

  it('send the topic, lesson text, grade and subject; return checked questions; save nothing', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}`)).json().ai).toEqual({ left: 10 });
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(REPLY) });

    const res = await s.teacher.client.post(url(s), BODY);
    expect(res.statusCode, res.body).toBe(200);
    const { suggestions, dropped, model } = res.json();
    expect(model).toBe('gemini-2.5-pro');
    expect(dropped).toBe(2);
    expect(suggestions).toEqual([
      { type: 'single', prompt: 'ما الذي يحوّل الماء إلى بخار؟', options: [{ id: 'a', text: 'الحرارة' }, { id: 'b', text: 'البرودة' }, { id: 'c', text: 'الضغط' }], points: 1, key: ['a'], explanation: 'التبخر يحتاج إلى حرارة.' },
      { type: 'true_false', prompt: 'يتكثف بخار الماء عندما يبرد.', options: [], points: 1, key: true, explanation: 'Why.' },
      { type: 'short', prompt: 'ما اسم تحوّل الماء من سائل إلى غاز؟', options: [], points: 2, key: ['التبخر', 'تبخر'], explanation: 'Why.' },
    ]);

    const sent = JSON.stringify(sim.requests[0]!.body);
    for (const part of ['دورة الماء في الطبيعة', 'يتبخر الماء من البحار', 'grade 5 of 12 (primary 5)', 'Science (العلوم)', 'Modern Standard Arabic', 'Water cycle quiz']) expect(sent).toContain(part);
    expect(sent).not.toContain('Salma');

    // Nothing was saved; one AI request was counted and logged for this feature.
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}`)).json()).toMatchObject({ questions: [], ai: { left: 9 } });
    const log = await sys((trx) => trx.selectFrom('ai_requests').select(['feature', 'status', 'user_id']).where('org_id', '=', s.orgId).execute());
    expect(log).toEqual([{ feature: 'test_questions', status: 'ok', user_id: expect.any(String) }]);

    // The teacher keeps a suggestion by adding it like any question.
    const { explanation: _explanation, ...keep } = suggestions[0];
    expect((await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${s.testId}/questions`, keep)).statusCode).toBe(201);
  });

  it('only for the subject\'s teachers and the school\'s admins, before any student starts', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.art.client.post(url(s), BODY)).json().error.code).toBe('NOT_SUBJECT_TEACHER');
    expect((await s.art.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}`)).json().ai).toBeNull();
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(REPLY) });
    expect((await s.owner.client.post(url(s), BODY)).statusCode).toBe(200);

    // Once a student has started, questions cannot change, so there is nothing to suggest for.
    await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${s.testId}/questions`, { type: 'true_false', prompt: 'Rain is water.', options: [], points: 1, key: true });
    await s.teacher.client.post(`/api/orgs/${s.orgId}/tests/${s.testId}/publish`);
    const student = await studentLogin(h, s.student);
    expect((await student.post(`/api/student/tests/${s.testId}/start`, {})).statusCode).toBe(200);
    const res = await s.teacher.client.post(url(s), BODY);
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'TEST_STARTED']);
    expect(sim.requests).toHaveLength(1);
  });

  it('ask for no more questions than the test has room for', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    await sys((trx) =>
      trx.insertInto('test_questions').values(Array.from({ length: 99 }, (_, i) => ({ org_id: s.orgId, test_id: s.testId, position: i, type: 'true_false' as const, prompt: `Q${i}`, options: '[]', points: 1 }))).execute(),
    );
    sim.script('gemini', { kind: 'ok', text: JSON.stringify(REPLY) });
    const res = await s.teacher.client.post(url(s), { ...BODY, count: 5 });
    expect(res.json().suggestions).toHaveLength(1);
    expect(JSON.stringify(sim.requests[0]!.body)).toContain('Write 1 question,');
    await sys((trx) => trx.insertInto('test_questions').values({ org_id: s.orgId, test_id: s.testId, position: 99, type: 'true_false', prompt: 'Q99', options: '[]', points: 1 }).execute());
    expect((await s.teacher.client.post(url(s), BODY)).json().error.code).toBe('TOO_MANY_QUESTIONS');
  });

  it('refuse a request without question types or with too much lesson text', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    expect((await s.teacher.client.post(url(s), { ...BODY, types: [] })).statusCode).toBe(400);
    expect((await s.teacher.client.post(url(s), { ...BODY, lessonText: 'x'.repeat(12_001) })).statusCode).toBe(400);
    expect(sim.requests).toHaveLength(0);
  });

  it('pass on the AI service\'s answer when it fails, and give the request back', async () => {
    const s = await school();
    await allow(s.orgId, 10);
    sim.script('gemini', { kind: 'refusal' }, { kind: 'error', status: 400 });
    expect((await s.teacher.client.post(url(s), BODY)).json().error.code).toBe('AI_REFUSED');
    expect((await s.teacher.client.post(url(s), BODY)).json().error.code).toBe('AI_FAILED');
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/tests/${s.testId}`)).json().ai).toEqual({ left: 9 });
  });
});
