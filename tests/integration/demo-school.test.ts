import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDemoSchool, removeDemoSchool, taggedEmail } from '../../src/cli/demo-school.js';
import { withSystemContext } from '../../src/db/index.js';
import { Client, createHarness, resetData, type Harness } from '../helpers/harness.js';

// The demo school command (src/cli/demo-school.ts): a whole school built through the app's own API,
// then removed through it. Rate limits on, as in production.
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'true' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const OPERATOR = 'ops.person@example.test';
const sys = <T>(fn: Parameters<typeof withSystemContext<T>>[1]) => withSystemContext(h.ownerDb, fn);

describe('demo school', () => {
  it('tags the operator’s address', () => {
    expect(taggedEmail('Ops.Person@Example.test', 'midad-demo-owner')).toBe('ops.person+midad-demo-owner@example.test');
    expect(taggedEmail('ops+old@example.test', 'midad-demo-teacher1')).toBe('ops+midad-demo-teacher1@example.test');
  });

  it('builds a complete school through the API, refuses a second one, and removes it all', async () => {
    const r = await createDemoSchool(h.app, h.db, { email: OPERATOR, lang: 'ar' });
    expect(r.schoolName).toBe('مدرسة النور النموذجية (عرض تجريبي)');
    expect(r.staff.map((s) => s.email)).toEqual([
      'ops.person+midad-demo-owner@example.test', 'ops.person+midad-demo-teacher1@example.test', 'ops.person+midad-demo-teacher2@example.test',
    ]);
    expect(r.students).toHaveLength(12);
    expect(new Set(r.students.map((s) => s.password)).size).toBe(12);

    const orgId = r.orgId;
    const org = await sys((trx) => trx.selectFrom('organizations').select(['locale', 'time_zone', 'country']).where('id', '=', orgId).executeTakeFirstOrThrow());
    expect(org).toEqual({ locale: 'ar', time_zone: 'Africa/Cairo', country: 'EG' });
    const sub = await sys((trx) => trx.selectFrom('subscriptions').selectAll().where('org_id', '=', orgId).executeTakeFirstOrThrow());
    expect(sub).toMatchObject({ plan_id: 'professional', status: 'active', current_period_end: null, limit_overrides: { max_students: 40 } });

    // The owner sees what a school would have built.
    const owner = new Client(h.app);
    expect((await owner.post('/api/auth/login', { email: r.staff[0]!.email, password: r.staff[0]!.password })).statusCode).toBe(200);
    await owner.refresh();
    const members = (await owner.get(`/api/orgs/${orgId}/members`)).json().members as { role: string }[];
    expect(members.map((m) => m.role).sort()).toEqual(['editor', 'owner', 'viewer']);
    const scopes = (await owner.get(`/api/orgs/${orgId}/scopes`)).json().scopes as { id: string; itemCount: number; notes: number; assigned: number }[];
    const p4Books = await sys((trx) => trx.selectFrom('catalog_materials as m').innerJoin('catalog_subjects as s', 's.id', 'm.subject_id').innerJoin('catalog_versions as v', 'v.id', 's.version_id')
      .select((eb) => eb.fn.countAll<string>().as('n')).where('v.status', '=', 'published').where('s.grade', '=', 4).where('s.track', '=', 'moe').executeTakeFirstOrThrow());
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({ itemCount: Number(p4Books.n), notes: 4, assigned: 4 });
    const classes = (await owner.get(`/api/orgs/${orgId}/classes`)).json().classes as { id: string; name: string }[];
    expect(classes.map((c) => c.name).sort()).toEqual(['الرابع أ', 'الرابع ب']);
    const classA = classes.find((c) => c.name === 'الرابع أ')!.id;

    // Homework: one marked and returned to five, one handed in by three, one still open.
    const hw = await sys((trx) => trx.selectFrom('homework').select(['id', 'title', 'max_points']).where('org_id', '=', orgId).orderBy('created_at').execute());
    expect(hw).toHaveLength(3);
    const subs = await sys((trx) => trx.selectFrom('homework_submissions').select(['homework_id', 'status', 'points']).where('org_id', '=', orgId).execute());
    const of = (id: string) => subs.filter((s) => s.homework_id === id);
    expect(of(hw[0]!.id).filter((s) => s.status === 'returned').map((s) => Number(s.points)).sort((a, b) => a - b)).toEqual([5, 7, 8, 9, 10]);
    expect(of(hw[0]!.id).filter((s) => s.status !== 'returned')).toHaveLength(1);
    expect(of(hw[1]!.id)).toHaveLength(3);
    expect(of(hw[2]!.id)).toHaveLength(0);

    // The quiz: six submitted attempts, essays marked, results released; the exam waits for its day.
    const tests = await sys((trx) => trx.selectFrom('tests').select(['id', 'kind', 'status', 'results_released_at', 'opens_at']).where('org_id', '=', orgId).orderBy('created_at').execute());
    expect(tests.map((t) => t.kind)).toEqual(['quiz', 'exam']);
    expect(tests[0]!.results_released_at).not.toBeNull();
    expect(tests[1]!.opens_at.getTime()).toBeGreaterThan(Date.now());
    const attempts = await sys((trx) => trx.selectFrom('test_attempts').select(['status', 'score']).where('test_id', '=', tests[0]!.id).execute());
    expect(attempts).toHaveLength(6);
    expect(attempts.every((a) => a.status === 'submitted' && a.score !== null)).toBe(true);

    // The gradebook and a student's own view show the marks.
    const book = (await owner.get(`/api/orgs/${orgId}/classes/${classA}/gradebook?subject=Mathematics`)).json();
    // Homework 2 has no marks yet, so the maths gradebook holds the homework and the quiz; the quiz scores show.
    expect(book.items.map((i: { kind: string }) => i.kind)).toEqual(['homework', 'test']);
    expect((book.students as { cells: { status: string }[] }[]).filter((s) => s.cells[1]!.status === 'marked')).toHaveLength(6);
    const ahmed = r.students[0]!;
    const student = new Client(h.app);
    expect((await student.post('/api/auth/student-login', { school: r.schoolCode, username: ahmed.username, password: ahmed.password })).statusCode).toBe(200);
    await student.refresh();
    const grades = (await student.get('/api/student/grades')).json();
    expect(JSON.stringify(grades)).toContain('9');
    expect(((await student.get('/api/student/curriculum')).json().subjects as unknown[]).length).toBeGreaterThan(0);

    const plans = await sys((trx) => trx.selectFrom('teaching_plans').select('kind').where('org_id', '=', orgId).execute());
    expect(plans.map((p) => p.kind).sort()).toEqual(['lesson', 'pacing']);

    // Emails: only the two invitations went out, to the operator's tagged addresses.
    const mail = await sys((trx) => trx.selectFrom('email_outbox').select(['to_email', 'template']).execute());
    expect(mail.map((m) => m.template).sort()).toEqual(['invitation', 'invitation']);
    expect(mail.every((m) => m.to_email.startsWith('ops.person+midad-demo-'))).toBe(true);

    await expect(createDemoSchool(h.app, h.db, { email: OPERATOR, lang: 'ar' })).rejects.toThrow(/already exists/);

    const removed = await removeDemoSchool(h.app, h.db, { email: OPERATOR });
    expect(removed.schools).toEqual([r.schoolName]);
    expect(removed.accounts).toHaveLength(3);
    expect(await sys((trx) => trx.selectFrom('organizations').select('id').where('id', '=', orgId).execute())).toEqual([]);
    const left = await sys((trx) => trx.selectFrom('users').select('email').execute());
    expect(left).toEqual([]);
    await expect(removeDemoSchool(h.app, h.db, { email: OPERATOR })).rejects.toThrow(/No demo school/);
  }, 120_000);

  it('builds the English version too', async () => {
    const r = await createDemoSchool(h.app, h.db, { email: OPERATOR, lang: 'en' });
    expect(r.schoolName).toBe('Al Noor Model School (demo)');
    expect(r.students.map((s) => s.className)).toEqual([...Array(8).fill('4A'), ...Array(4).fill('4B')]);
  }, 120_000);
});
