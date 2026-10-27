import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/auth/sessions.js';
import { Client, createHarness, enableStudents, resetData, signUp, type Harness } from '../helpers/harness.js';

// A school's students usually reach the app from one address (the school's NAT). The limits on
// what students do in the portal count per student, and the flood guard lets many signed-in
// people share an address while still holding each account, and each forged cookie, to its own
// allowance (docs/STUDENT_ACCOUNTS.md §9).

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

const SCHOOL_IP = '10.230.0.1';

/** A school with `n` students in one class and a published test open now; every student signed in from SCHOOL_IP. */
async function examRoom(n: number) {
  const owner = await signUp(h, { org: 'Network School' });
  await enableStudents(h, owner.orgId, 500);
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '6A', grade: 6 })).json().class.id as string;
  const csv = ['username,name,grade', ...Array.from({ length: n }, (_, i) => `pupil${i},Pupil ${i},6`)].join('\n');
  const imported = (await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv, apply: true })).json();
  expect(imported.created).toHaveLength(n);
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: imported.created.map((s: { userId: string }) => s.userId) });
  const testId = (
    await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/tests`, {
      subjectEn: 'Science', subjectAr: 'العلوم', title: 'Network quiz',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    })
  ).json().test.id as string;
  await owner.client.post(`/api/orgs/${owner.orgId}/tests/${testId}/questions`, { type: 'true_false', prompt: 'The Nile flows north.', points: 1, key: true });
  expect((await owner.client.post(`/api/orgs/${owner.orgId}/tests/${testId}/publish`)).statusCode).toBe(200);
  const students: Client[] = [];
  for (const s of imported.created as { username: string; password: string }[]) {
    const c = new Client(h.app, SCHOOL_IP);
    const res = await c.post('/api/auth/student-login', { school: imported.schoolCode, username: s.username, password: s.password });
    expect(res.statusCode, res.body).toBe(200);
    await c.refresh();
    students.push(c);
  }
  return { owner, testId, students };
}

describe('one school network', () => {
  it('each student has their own allowance on the test routes, however many share the address', async () => {
    const { testId, students } = await examRoom(65);
    // Counted per address, starting was limited to 60 in 15 minutes for the whole school.
    const attempts: string[] = [];
    for (const s of students) {
      const res = await s.post(`/api/student/tests/${testId}/start`);
      expect(res.statusCode, res.body).toBe(200);
      attempts.push(res.json().attemptId);
    }
    for (const [i, s] of students.entries()) expect((await s.post(`/api/student/attempts/${attempts[i]}/heartbeat`)).statusCode).toBe(200);

    // One student is still held to the limit: 60 starts in 15 minutes.
    const one = students[0]!;
    const codes: number[] = [];
    for (let i = 0; i < 60; i++) codes.push((await one.post(`/api/student/tests/${testId}/start`)).statusCode);
    expect(codes.slice(0, 59).every((c) => c === 200)).toBe(true);
    expect(codes[59]).toBe(429);
    // …and another student at the same address is not affected.
    expect((await students[1]!.post(`/api/student/tests/${testId}/start`)).statusCode).toBe(200);
  });

  it('the flood guard lets many accounts share an address, and stops one account or a forged cookie at 600 a minute', async () => {
    const { students } = await examRoom(2);
    const [a, b] = students as [Client, Client];
    const run = async (c: Client, n: number) => {
      const codes: number[] = [];
      for (let i = 0; i < n; i++) codes.push((await c.get('/api/student/home')).statusCode);
      return codes;
    };
    // 800 requests from one address in a minute: past the old 600 for the address, fine per account.
    expect((await run(a, 400)).every((c) => c === 200)).toBe(true);
    expect((await run(b, 400)).every((c) => c === 200)).toBe(true);
    // Each account stops at 600 (the second student had made 400 + 2 for sign-in and the token).
    const more = await run(a, 200);
    expect(more.filter((c) => c === 429).length).toBeGreaterThan(0);
    const limited = await a.get('/api/student/home');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await b.get('/api/student/home')).statusCode).toBe(200);

    // A cookie that is not a session gets no allowance of its own: it is counted for its address.
    const forger = '10.230.0.2';
    const cookie = `${sessionCookieName(h.config)}=forged-${Date.now()}`;
    const codes: number[] = [];
    for (let i = 0; i < 601; i++) codes.push((await h.app.inject({ method: 'GET', url: '/api/student/home', remoteAddress: forger, headers: { cookie } })).statusCode);
    expect(codes.slice(0, 600).every((c) => c === 401)).toBe(true);
    expect(codes[600]).toBe(429);
    // Changing the forged value on every request does not help either.
    const rotated = await h.app.inject({ method: 'GET', url: '/api/student/home', remoteAddress: forger, headers: { cookie: `${sessionCookieName(h.config)}=other-${Date.now()}` } });
    expect(rotated.statusCode).toBe(429);
  });
});
