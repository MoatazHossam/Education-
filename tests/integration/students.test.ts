import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext, withSystemContext } from '../../src/db/index.js';
import { generateStudentPassword } from '../../src/students/service.js';
import {
  addMember,
  Client,
  createHarness,
  createPlatformAdmin,
  createStudent,
  enableStudents,
  publishedVersionId,
  resetData,
  signUp,
  STUDENT_ROUTES,
  studentLogin,
  type Harness,
} from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

async function school(name = 'School') {
  const owner = await signUp(h, { org: name });
  await enableStudents(h, owner.orgId);
  return owner;
}

/** Material ids of one grade in the published catalogue. */
async function gradeMaterials(versionId: string, grade: number, n: number): Promise<string[]> {
  const rows = await h.ownerDb
    .selectFrom('catalog_materials as m')
    .innerJoin('catalog_subjects as s', 's.id', 'm.subject_id')
    .select('m.id')
    .where('m.version_id', '=', versionId)
    .where('s.grade', '=', grade)
    .orderBy('m.id')
    .limit(n)
    .execute();
  return rows.map((r) => r.id);
}

async function scopeWith(owner: { client: Client; orgId: string }, name: string, materialIds: string[]) {
  const versionId = await publishedVersionId(h);
  const res = await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name, catalogVersionId: versionId });
  expect(res.statusCode).toBe(201);
  const scopeId = res.json().scope.id as string;
  if (materialIds.length) expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scopeId}/items`, { add: materialIds })).statusCode).toBe(200);
  return scopeId;
}

describe('student accounts are off until enabled', () => {
  it('no plan includes them; the staff page says so and creation is refused', async () => {
    const owner = await signUp(h);
    const list = (await owner.client.get(`/api/orgs/${owner.orgId}/students`)).json();
    expect(list).toMatchObject({ enabled: false, limit: 0, used: 0, students: [] });
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/students`, { username: 'amira', name: 'Amira', grade: 7 });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('STUDENTS_NOT_ENABLED');
    const plans = await h.ownerDb.selectFrom('plans').select(['id', 'limits']).execute();
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p.limits.max_students, p.id).toBe(0);
  });

  it('a platform administrator turns them on per school with a limit override, and the limit holds', async () => {
    const owner = await signUp(h);
    const admin = await createPlatformAdmin(h);
    const patch = await admin.patch(`/api/admin/orgs/${owner.orgId}/subscription`, { limitOverrides: { max_students: 2 } });
    expect(patch.statusCode).toBe(200);
    for (const u of ['st1', 'st2']) expect((await owner.client.post(`/api/orgs/${owner.orgId}/students`, { username: u, name: u, grade: 3 })).statusCode).toBe(201);
    const third = await owner.client.post(`/api/orgs/${owner.orgId}/students`, { username: 'st3', name: 'st3', grade: 3 });
    expect(third.statusCode).toBe(402);
    expect(third.json().error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { limit: 'max_students', max: 2, used: 2 } });
    const detail = (await admin.get(`/api/admin/orgs/${owner.orgId}`)).json();
    expect(detail.studentCount).toBe(2);
    // The platform sees a count, never the names.
    expect(JSON.stringify(detail)).not.toContain('"st1"');
  });

  it('a school back on the Free plan loses the override: no sign-in, and open sessions stop working', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const student = await studentLogin(h, s);
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE subscriptions SET plan_id = 'free', status = 'active', trial_ends_at = NULL WHERE org_id = ${owner.orgId}`.execute(trx));
    const cur = await student.get('/api/student/curriculum');
    expect(cur.statusCode).toBe(403);
    expect(cur.json().error.code).toBe('STUDENT_PORTAL_OFF');
    const again = await new Client(h.app).post('/api/auth/student-login', { school: s.school, username: s.username, password: s.password });
    expect(again.statusCode).toBe(403);
    expect(again.json().error.code).toBe('STUDENT_PORTAL_OFF');
  });
});

describe('student sign-in', () => {
  it('signs in with school code, username and password; /me describes the student and school', async () => {
    const owner = await school('Nile School');
    const s = await createStudent(h, owner.client, owner.orgId, { username: 'Omar.Said', name: 'Omar Said', grade: 8 });
    expect(s.username).toBe('omar.said');
    expect(s.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const client = await studentLogin(h, { school: s.school.toUpperCase(), username: ' OMAR.SAID ', password: s.password });
    const me = (await client.get('/api/auth/me')).json();
    expect(me.user).toMatchObject({ kind: 'student', email: null, name: 'Omar Said', isPlatformAdmin: false });
    expect(me.student).toMatchObject({ username: 'omar.said', grade: 8, school: { id: owner.orgId, name: 'Nile School', code: s.school } });
    expect(me.organizations).toEqual([]);
    // Shared school computers: the session ends within 12 hours.
    const session = await h.ownerDb.selectFrom('sessions').select('expires_at').where('user_id', '=', s.userId).executeTakeFirstOrThrow();
    expect(session.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3_600_000 + 5_000);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['org_id', 'action']).where('target_id', '=', s.userId).execute());
    expect(audit).toContainEqual({ org_id: owner.orgId, action: 'auth.student_login' });
  });

  it('gives the same answer for an unknown school, an unknown username and a wrong password', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const tries = [
      { school: 'no-such-school', username: s.username, password: s.password },
      { school: s.school, username: 'nobody', password: s.password },
      { school: s.school, username: s.username, password: 'wrong-password' },
    ];
    for (const body of tries) {
      const res = await new Client(h.app).post('/api/auth/student-login', body);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('cannot sign in through the staff sign-in, and a student username is per school', async () => {
    const a = await school('School A');
    const b = await school('School B');
    const sa = await createStudent(h, a.client, a.orgId, { username: 'same' });
    const sb = await createStudent(h, b.client, b.orgId, { username: 'same' });
    expect(sa.password).not.toBe(sb.password);
    const cross = await new Client(h.app).post('/api/auth/student-login', { school: sb.school, username: 'same', password: sa.password });
    expect(cross.statusCode).toBe(401);
    const staff = await new Client(h.app).post('/api/auth/login', { email: 'same', password: sa.password });
    expect(staff.statusCode).toBe(400);
    expect((await studentLogin(h, sb)).cookies.size).toBe(1);
  });

  it('locks after five wrong passwords; a staff reset lifts the lock and ends existing sessions', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const early = await studentLogin(h, s);
    for (let i = 0; i < 5; i++) await new Client(h.app).post('/api/auth/student-login', { school: s.school, username: s.username, password: 'wrong-password' });
    const locked = await new Client(h.app).post('/api/auth/student-login', { school: s.school, username: s.username, password: s.password });
    expect(locked.statusCode).toBe(401);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/students`)).json().students[0].locked).toBe(true);

    const reset = await owner.client.post(`/api/orgs/${owner.orgId}/students/${s.userId}/reset-password`);
    expect(reset.statusCode).toBe(200);
    const password = reset.json().password as string;
    expect(password).not.toBe(s.password);
    expect((await early.get('/api/auth/me')).statusCode).toBe(401);
    expect((await new Client(h.app).post('/api/auth/student-login', { school: s.school, username: s.username, password: s.password })).statusCode).toBe(401);
    await studentLogin(h, { ...s, password });
  });

  it('a student can change their password; other sessions end', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const one = await studentLogin(h, s);
    const two = await studentLogin(h, s);
    expect((await one.post('/api/student/password', { currentPassword: 'nope', newPassword: 'a-new-password-1' })).statusCode).toBe(400);
    expect((await one.post('/api/student/password', { currentPassword: s.password, newPassword: 'a-new-password-1' })).statusCode).toBe(200);
    expect((await one.get('/api/auth/me')).statusCode).toBe(200);
    expect((await two.get('/api/auth/me')).statusCode).toBe(401);
    await studentLogin(h, { ...s, password: 'a-new-password-1' });
  });
});

describe('a student account reaches only the student portal', () => {
  // Routes anyone may call without an account; a student calling them is no different from a visitor.
  const ANONYMOUS_OK = [
    'GET /healthz', 'GET /readyz', 'POST /api/auth/register', 'POST /api/auth/verify-email', 'POST /api/auth/resend-verification', 'POST /api/auth/login',
    'POST /api/auth/password/forgot', 'POST /api/auth/password/reset', 'GET /api/invitations/:token', 'GET /api/billing/plans',
    'POST /api/billing/webhooks/:provider', 'GET /api/billing/sandbox/checkout', 'POST /api/billing/sandbox/complete',
    'POST /api/auth/logout', 'GET /api/auth/me', ...STUDENT_ROUTES,
  ];

  it('every other route refuses a signed-in student, including their own school\'s staff routes', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const student = await studentLogin(h, s);
    const routes = h.app.routeList.filter((r) => (r.url.startsWith('/api/') || r.url.startsWith('/health') || r.url.startsWith('/ready')) && !r.url.endsWith('*'));
    const checked: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.url}`;
      if (ANONYMOUS_OK.includes(key)) continue;
      const url = r.url.replace(':orgId', owner.orgId).replace(':userId', s.userId).replace(/:\w+/g, '7d3c6c1e-9a39-4f0b-8f43-0d1f7c2b9a11');
      const res = await student.request(r.method as 'GET', url, r.method === 'GET' ? undefined : {});
      checked.push(key);
      expect(res.statusCode, key).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, key).toBeLessThan(500);
      const code = res.json().error?.code;
      // 400 only when input validation fails before any account or data access.
      if (res.statusCode === 400) expect(code, key).toBe('VALIDATION_ERROR');
      if (r.url.startsWith('/api/orgs') || r.url.startsWith('/api/admin/')) {
        expect([403, 400], key).toContain(res.statusCode);
        if (res.statusCode === 403) expect(code, key).toBe('STAFF_ONLY');
      }
    }
    expect(checked.length).toBeGreaterThan(80);
    // Spot checks of account features students do not have.
    for (const [method, url] of [['GET', '/api/auth/sessions'], ['POST', '/api/auth/mfa/setup'], ['GET', '/api/auth/account/export'], ['GET', '/api/notifications'], ['POST', '/api/orgs']] as const) {
      const res = await student.request(method, url, method === 'GET' ? undefined : { name: 'My org' });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('STAFF_ONLY');
    }
  });

  it('staff accounts cannot use the student portal routes', async () => {
    const owner = await school();
    expect((await owner.client.get('/api/student/curriculum')).statusCode).toBe(404);
    expect((await owner.client.patch('/api/student/profile', { locale: 'ar' })).statusCode).toBe(404);
    expect((await new Client(h.app).get('/api/student/curriculum')).statusCode).toBe(401);
  });

  it('the database refuses a membership for a student and a kind change', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    await expect(
      withSystemContext(h.ownerDb, (trx) => sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${owner.orgId}, ${s.userId}, 'viewer')`.execute(trx)),
    ).rejects.toThrow(/staff accounts only/);
    await expect(sql`UPDATE users SET kind = 'staff', email = 'x@example.test' WHERE id = ${s.userId}`.execute(h.ownerDb)).rejects.toThrow(/cannot change/);
    await expect(sql`UPDATE users SET email = 'x@example.test' WHERE id = ${s.userId}`.execute(h.ownerDb)).rejects.toThrow(/users_kind_identity/);
    await expect(sql`UPDATE users SET is_platform_admin = true WHERE id = ${s.userId}`.execute(h.ownerDb)).rejects.toThrow(/users_kind_identity/);
  });
});

describe('school staff manage their students', () => {
  it('admins and the owner only; editors and viewers are refused', async () => {
    const owner = await school();
    const editor = await addMember(h, owner.client, owner.orgId, 'editor');
    const viewer = await addMember(h, owner.client, owner.orgId, 'viewer');
    const admin = await addMember(h, owner.client, owner.orgId, 'admin');
    for (const m of [editor, viewer]) {
      expect((await m.client.get(`/api/orgs/${owner.orgId}/students`)).statusCode).toBe(403);
      expect((await m.client.post(`/api/orgs/${owner.orgId}/students`, { username: 'xx1', name: 'X', grade: 1 })).statusCode).toBe(403);
    }
    const created = await admin.client.post(`/api/orgs/${owner.orgId}/students`, { username: 'xx1', name: 'X', grade: 1 });
    expect(created.statusCode).toBe(201);
    const { password, student } = created.json();
    const dup = await admin.client.post(`/api/orgs/${owner.orgId}/students`, { username: 'XX1', name: 'Y', grade: 2 });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USERNAME_TAKEN');
    const audit = (await owner.client.get(`/api/orgs/${owner.orgId}/audit-logs?action=student.`)).json().entries;
    expect(audit.map((e: { action: string }) => e.action)).toEqual(['student.created']);
    // The password is only in that one response: not in the audit log, the list, or the database.
    expect(JSON.stringify(audit)).not.toContain(password);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/students`)).body).not.toContain(password);
    const row = await h.ownerDb.selectFrom('users').select('password_hash').where('id', '=', student.userId).executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('another school cannot see, change, reset or remove them (404)', async () => {
    const a = await school('School A');
    const b = await school('School B');
    const s = await createStudent(h, a.client, a.orgId);
    expect((await b.client.get(`/api/orgs/${a.orgId}/students`)).statusCode).toBe(404);
    for (const [method, url] of [['PATCH', `/api/orgs/${b.orgId}/students/${s.userId}`], ['POST', `/api/orgs/${b.orgId}/students/${s.userId}/reset-password`], ['DELETE', `/api/orgs/${b.orgId}/students/${s.userId}`]] as const) {
      expect((await b.client.request(method, url, method === 'DELETE' ? undefined : { name: 'Hacked' })).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await b.client.get(`/api/orgs/${b.orgId}/students`)).json().students).toEqual([]);
    // Row-Level Security: in school B's context the row does not exist.
    const rows = await withOrgContext(h.db, { orgId: b.orgId }, (trx) => trx.selectFrom('students').selectAll().execute());
    expect(rows).toEqual([]);
    await studentLogin(h, s);
  });

  it('assigns a scope of the same school only, and edits name and grade', async () => {
    const a = await school('School A');
    const b = await school('School B');
    const scopeA = await scopeWith(a, 'Main', []);
    const scopeB = await scopeWith(b, 'Other', []);
    const s = await createStudent(h, a.client, a.orgId);
    expect((await a.client.patch(`/api/orgs/${a.orgId}/students/${s.userId}`, { scopeId: scopeB })).statusCode).toBe(404);
    expect((await a.client.post(`/api/orgs/${a.orgId}/students`, { username: 'xx2', name: 'X', grade: 1, scopeId: scopeB })).statusCode).toBe(404);
    expect((await a.client.patch(`/api/orgs/${a.orgId}/students/${s.userId}`, { scopeId: scopeA, grade: 9, name: 'Renamed' })).statusCode).toBe(200);
    const row = (await a.client.get(`/api/orgs/${a.orgId}/students`)).json().students[0];
    expect(row).toMatchObject({ name: 'Renamed', grade: 9, scopeId: scopeA, scopeName: 'Main' });
    // Deleting the scope keeps the student, without a curriculum.
    expect((await a.client.delete(`/api/orgs/${a.orgId}/scopes/${scopeA}`)).statusCode).toBe(200);
    expect((await a.client.get(`/api/orgs/${a.orgId}/students`)).json().students[0]).toMatchObject({ scopeId: null, scopeName: null });
  });

  it('removing a student deletes the account and its sessions; deleting the school deletes all its students', async () => {
    const owner = await school();
    const s1 = await createStudent(h, owner.client, owner.orgId);
    const s2 = await createStudent(h, owner.client, owner.orgId);
    const c1 = await studentLogin(h, s1);
    expect((await owner.client.delete(`/api/orgs/${owner.orgId}/students/${s1.userId}`)).statusCode).toBe(200);
    expect((await c1.get('/api/auth/me')).statusCode).toBe(401);
    expect(await h.ownerDb.selectFrom('users').select('id').where('id', '=', s1.userId).executeTakeFirst()).toBeUndefined();
    expect(await h.ownerDb.selectFrom('sessions').select('id').where('user_id', '=', s1.userId).executeTakeFirst()).toBeUndefined();

    const res = await owner.client.request('DELETE', `/api/orgs/${owner.orgId}`, { password: 'correct-horse-battery-staple', confirmName: 'School' });
    expect(res.statusCode).toBe(200);
    expect(await h.ownerDb.selectFrom('users').select('id').where('id', '=', s2.userId).executeTakeFirst()).toBeUndefined();
    expect(await h.ownerDb.selectFrom('users').select('id').where('kind', '=', 'student').execute()).toEqual([]);
  });

  it('platform administrators do not see student accounts in the user list', async () => {
    const owner = await school();
    await createStudent(h, owner.client, owner.orgId, { name: 'Hidden Student' });
    const admin = await createPlatformAdmin(h);
    const users = (await admin.get('/api/admin/users?q=Hidden')).json().users;
    expect(users).toEqual([]);
    const overview = (await admin.get('/api/admin/overview')).json();
    expect(overview.users.students).toBe(1);
  });
});

describe('roster import', () => {
  const header = 'username,name,grade,scope';

  it('previews problems line by line and imports nothing while any remain', async () => {
    const owner = await school();
    await scopeWith(owner, 'Prep 1', []);
    await createStudent(h, owner.client, owner.orgId, { username: 'taken' });
    const csv = [header, 'ok.one,Ok One,7,prep 1', 'Bad Name!,X,7,', 'taken,Y,7,', 'ok.one,Z,7,', 'ok.two,Two,13,', 'ok.three,Three,7,Nope', 'ok.four,,7,'].join('\n');
    const preview = (await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv })).json();
    expect(preview.applied).toBe(false);
    expect(preview.rows.map((r: { username: string }) => r.username)).toEqual(['ok.one']);
    expect(preview.errors.map((e: { line: number; code: string }) => `${e.line} ${e.code}`)).toEqual([
      '3 roster_username', '4 roster_username_taken', '5 roster_username_repeats', '6 roster_grade', '7 roster_scope', '8 roster_name',
    ]);
    expect(preview.errors[2]).toEqual({ line: 5, code: 'roster_username_repeats', params: { username: 'ok.one', line: 2 }, message: 'username "ok.one" repeats line 2' });
    expect(preview.errors[4].params).toEqual({ scope: 'Nope' });
    const apply = await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv, apply: true });
    expect(apply.statusCode).toBe(400);
    expect(apply.json().error.code).toBe('IMPORT_INVALID');
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/students`)).json().used).toBe(1);
  });

  it('reads Excel-style files (semicolons, BOM, Arabic headers) and returns each password once', async () => {
    const owner = await school();
    const scopeId = await scopeWith(owner, 'Main', []);
    const csv = '﻿اسم المستخدم;الاسم;الصف;النطاق\r\nmona;منى أحمد;4;Main\r\nziad;Ziad;4;\r\n';
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv, apply: true });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ applied: true, schoolCode: expect.any(String) });
    expect(body.created).toHaveLength(2);
    const list = (await owner.client.get(`/api/orgs/${owner.orgId}/students`)).json().students;
    expect(list.map((s: { username: string; scopeId: string | null; name: string }) => [s.username, s.name, s.scopeId])).toEqual([['mona', 'منى أحمد', scopeId], ['ziad', 'Ziad', null]]);
    await studentLogin(h, { school: body.schoolCode, username: 'mona', password: body.created[0].password });
    const audit = (await owner.client.get(`/api/orgs/${owner.orgId}/audit-logs?action=student.imported`)).json().entries;
    expect(audit[0].metadata).toEqual({ count: 2 });
  });

  it('refuses a file that would pass the plan limit, as a whole', async () => {
    const owner = await signUp(h);
    await enableStudents(h, owner.orgId, 2);
    const csv = [header, 'aa1,A,1,', 'aa2,A,1,', 'aa3,A,1,'].join('\n');
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv, apply: true });
    expect(res.statusCode).toBe(402);
    expect((await owner.client.get(`/api/orgs/${owner.orgId}/students`)).json().used).toBe(0);
  });

  it('rejects files without the required columns or with too many rows', async () => {
    const owner = await school();
    const noGrade = (await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv: 'username,name\na,b' })).json();
    expect(noGrade.errors).toEqual([{ line: 1, code: 'roster_missing_column', params: { column: 'grade' }, message: 'Missing column "grade"' }]);
    const many = [header, ...Array.from({ length: 301 }, (_, i) => `u${i}x,N,1,`)].join('\n');
    const big = (await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv: many })).json();
    expect(big.errors[0]).toMatchObject({ code: 'roster_too_many', params: { max: 300 }, message: expect.stringContaining('At most 300') });
  });

  it('lists each problem of a line on its own, and names unreadable files with their own codes', async () => {
    const owner = await school();
    const twice = (await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv: `${header}\nBad Name!,,0,` })).json();
    expect(twice.errors.map((e: { line: number; code: string }) => `${e.line} ${e.code}`)).toEqual(['2 roster_username', '2 roster_name', '2 roster_grade']);
    const notUtf8 = await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv: `${header}\nmona,Mon�,4,` });
    expect(notUtf8.statusCode).toBe(400);
    expect(notUtf8.json().error).toMatchObject({ code: 'FILE_NOT_UTF8', message: expect.stringMatching(/not UTF-8/) });
    const open = await owner.client.post(`/api/orgs/${owner.orgId}/students/import`, { csv: `${header}\n"mona,Mona,4,` });
    expect(open.statusCode).toBe(400);
    expect(open.json().error).toMatchObject({ code: 'CSV_INVALID', message: 'A quoted field is not closed' });
  });
});

describe('the student portal', () => {
  it('shows the books of the student\'s grade that are in the assigned scope, and nothing else', async () => {
    const owner = await school('Nile School');
    const versionId = await publishedVersionId(h);
    const g7 = await gradeMaterials(versionId, 7, 6);
    const g8 = await gradeMaterials(versionId, 8, 4);
    const scopeId = await scopeWith(owner, 'Prep', [...g7.slice(0, 4), ...g8]);
    const s = await createStudent(h, owner.client, owner.orgId, { grade: 7, scopeId });
    const student = await studentLogin(h, s);
    const cur = (await student.get('/api/student/curriculum')).json();
    expect(cur.school).toEqual({ name: 'Nile School' });
    expect(cur.scope).toMatchObject({ id: scopeId, name: 'Prep' });
    expect(cur.grade).toMatchObject({ grade: 7 });
    const ids = cur.subjects.flatMap((x: { materials: { id: string }[] }) => x.materials.map((m) => m.id)).sort();
    expect(ids).toEqual(g7.slice(0, 4).sort());
    expect(JSON.stringify(cur)).not.toContain('verification');
  });

  it('without a scope it says so, and other students\' or schools\' data never appears', async () => {
    const a = await school('School A');
    const b = await school('School B');
    const versionId = await publishedVersionId(h);
    const scopeB = await scopeWith(b, 'B scope', await gradeMaterials(versionId, 7, 3));
    await createStudent(h, b.client, b.orgId, { grade: 7, scopeId: scopeB });
    const s = await createStudent(h, a.client, a.orgId, { grade: 7 });
    const cur = (await (await studentLogin(h, s)).get('/api/student/curriculum')).json();
    expect(cur).toMatchObject({ school: { name: 'School A' }, scope: null, subjects: [] });
  });

  it('a student can switch the interface language', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const student = await studentLogin(h, s);
    expect((await student.patch('/api/student/profile', { locale: 'ar' })).statusCode).toBe(200);
    expect((await student.get('/api/auth/me')).json().user.locale).toBe('ar');
  });

  it('a suspended school blocks its students', async () => {
    const owner = await school();
    const s = await createStudent(h, owner.client, owner.orgId);
    const student = await studentLogin(h, s);
    await sql`UPDATE organizations SET status = 'suspended' WHERE id = ${owner.orgId}`.execute(h.ownerDb);
    expect((await student.get('/api/student/curriculum')).json().error.code).toBe('ORG_SUSPENDED');
    const res = await new Client(h.app).post('/api/auth/student-login', { school: s.school, username: s.username, password: s.password });
    expect(res.json().error.code).toBe('ORG_SUSPENDED');
  });
});

describe('generated passwords', () => {
  it('use an unambiguous alphabet and do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const p = generateStudentPassword();
      expect(p).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{4}(-[abcdefghjkmnpqrstuvwxyz23456789]{4}){2}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(2000);
  });
});
