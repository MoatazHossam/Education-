import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clamdScanner, runClassroomFileChecks } from '../../src/classroom/file-checks.js';
import { withSystemContext } from '../../src/db/index.js';
import { evaluate, ServerErrorCounter } from '../../src/ops/alerts.js';
import { EICAR, startFakeClamd } from '../helpers/fake-clamd.js';
import { addMember, Client, createHarness, createStudent, enableStudents, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

// Homework files are checked by the worker before anyone can open them (docs/CLASSROOM.md §5):
// a virus scan with ClamAV (here a stand-in that speaks clamd's protocol), and photos resized
// and stripped of their metadata. Blocked files lose their bytes and the right people are told.

let h: Harness;
let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
beforeAll(async () => {
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
  clamd = await startFakeClamd();
});
afterAll(async () => {
  await clamd.close();
  await h.close();
});
beforeEach(async () => {
  clamd.mode = 'scan';
  await resetData(h.ownerDb);
});

const scanner = () => clamdScanner('127.0.0.1', clamd.port, 2_000);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

async function upload(client: Client, url: string, data: Buffer, name: string) {
  return h.app.inject({
    method: 'POST',
    url,
    remoteAddress: client.ip,
    headers: {
      cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(client.csrf ? { 'x-csrf-token': client.csrf } : {}),
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
    },
    payload: data,
  });
}

/** A school with a class of one student (Arabic interface), a teacher (viewer) and published homework. */
async function school() {
  const owner = await signUp(h, { org: 'Delta School' });
  await enableStudents(h, owner.orgId);
  const admin = await addMember(h, owner.client, owner.orgId, 'admin');
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const sara = await createStudent(h, owner.client, owner.orgId, { username: 'sara', name: 'Sara Ali', grade: 5 });
  await h.ownerDb.updateTable('users').set({ locale: 'ar' }).where('id', '=', sara.userId).execute();
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '5B', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [sara.userId] });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, subjectEn: 'Science', subjectAr: 'العلوم' });
  const hw = await teacher.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/homework`, {
    subjectEn: 'Science', subjectAr: 'العلوم', title: 'Plant diary', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  expect(hw.statusCode, hw.body).toBe(201);
  const student = await studentLogin(h, sara);
  return { owner, admin, teacher, sara, student, orgId: owner.orgId, hwId: hw.json().homework.id as string };
}

const row = (id: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('classroom_files').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
const notificationsOf = async (c: Client, student = false) => (await c.get(student ? '/api/student/notifications' : '/api/notifications')).json().notifications as { kind: string; title: string; body: string; link: string }[];

describe('checking homework files', () => {
  it('scans every file and resizes photos before anyone can open them', async () => {
    const s = await school();
    const worksheet = (await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, PDF, 'worksheet.pdf')).json().file;
    expect(worksheet.status).toBe('pending');
    const photo = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#4a7d3b' } })
      .jpeg({ quality: 90 })
      .withExif({ IFD0: { Make: 'PhoneMaker' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 2/1 0/1' } })
      .toBuffer();
    const mine = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, photo, 'plant.jpg')).json().file;

    // Nobody opens them yet: not the student, not the teacher.
    expect((await s.student.get(`/api/student/files/${worksheet.id}`)).json().error.code).toBe('FILE_CHECKING');
    expect((await s.student.get(`/api/student/files/${mine.id}`)).statusCode).toBe(409);
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/files/${worksheet.id}`)).json().error.code).toBe('FILE_CHECKING');
    expect((await s.student.get(`/api/student/homework/${s.hwId}`)).json().files[0]).toMatchObject({ name: 'worksheet.pdf', status: 'pending' });

    expect(await runClassroomFileChecks(h.db, scanner())).toEqual({ ready: 2, infected: 0, unreadable: 0, rescanned: 0, failed: 0 });
    expect(clamd.streams.slice(-2).map((b) => b.length)).toEqual([PDF.length, photo.length]); // scanned as uploaded

    const pdf = await s.student.get(`/api/student/files/${worksheet.id}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.equals(PDF)).toBe(true); // PDFs are kept as they are
    const resized = await s.student.get(`/api/student/files/${mine.id}`);
    const meta = await sharp(resized.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['jpeg', 2000, 1500, undefined]);
    expect(resized.rawPayload.toString('latin1')).not.toContain('PhoneMaker');
    const stored = await row(mine.id);
    expect(stored).toMatchObject({ status: 'ready', size_bytes: resized.rawPayload.length, original_size_bytes: photo.length, check_attempts: 0 });
    expect(stored.scanned_at).not.toBeNull();
    const { createHash } = await import('node:crypto');
    expect(stored.sha256).toBe(createHash('sha256').update(resized.rawPayload).digest('hex'));
    const listed = (await s.student.get(`/api/student/homework/${s.hwId}`)).json().submission.files[0];
    expect(listed).toMatchObject({ status: 'ready', size: resized.rawPayload.length, uploadedSize: photo.length });
  });

  it('deletes a file with a virus, tells the uploader, the owner and admins, and records it', async () => {
    const s = await school();
    // A "PDF" carrying the antivirus test string (the stand-in finds it anywhere in the file).
    const bad = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(EICAR)]), 'answers.pdf')).json().file;
    const usedBefore = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('classroom_files').select('size_bytes').executeTakeFirstOrThrow());
    expect(usedBefore.size_bytes).toBeGreaterThan(0);

    expect(await runClassroomFileChecks(h.db, scanner())).toMatchObject({ ready: 0, infected: 1 });
    const stored = await row(bad.id);
    expect(stored).toMatchObject({ status: 'infected', data: null, virus_name: 'Eicar-Test-Signature' });
    const open = await s.student.get(`/api/student/files/${bad.id}`);
    expect([open.statusCode, open.json().error.code]).toEqual([409, 'FILE_INFECTED']);
    expect((await s.student.get(`/api/student/homework/${s.hwId}`)).json().submission.files[0]).toMatchObject({ name: 'answers.pdf', status: 'infected' });

    // The student is told in Arabic; the owner and the admin are told; the teacher (not an admin) is not.
    const toSara = await notificationsOf(s.student, true);
    expect(toSara[0]).toMatchObject({ kind: 'file_infected', title: 'حُذف ملف رفعته', link: `/student/homework/${s.hwId}` });
    expect(toSara[0]!.body).toContain('answers.pdf');
    for (const c of [s.owner.client, s.admin.client]) {
      const n = (await notificationsOf(c)).find((x) => x.kind === 'file_infected');
      expect(n).toMatchObject({ title: 'A virus was found in a homework file', link: `/org/${s.orgId}/homework/${s.hwId}` });
      expect(n!.body).toContain('Sara Ali');
    }
    expect((await notificationsOf(s.teacher.client)).some((x) => x.kind === 'file_infected')).toBe(false);

    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'actor_type', 'target_id', 'metadata']).where('action', '=', 'classroom.file_infected').execute());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: 'system', target_id: bad.id, metadata: { name: 'answers.pdf', virus: 'Eicar-Test-Signature', sha256: stored.sha256, uploadedBy: s.sara.userId } });

    // It takes no storage, and the student can delete it from the draft.
    const used = await withSystemContext(h.ownerDb, (trx) => sql<{ n: string }>`SELECT coalesce(sum(size_bytes) FILTER (WHERE data IS NOT NULL), 0) AS n FROM classroom_files`.execute(trx));
    expect(Number(used.rows[0]!.n)).toBe(0);
    expect((await s.student.delete(`/api/student/homework/${s.hwId}/files/${bad.id}`)).statusCode).toBe(200);
  });

  it('a photo that cannot be read is deleted and its uploader told; nobody else is', async () => {
    const s = await school();
    const broken = (await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 3)]), 'board.jpg')).json().file;
    expect(await runClassroomFileChecks(h.db, null)).toMatchObject({ unreadable: 1 });
    expect(await row(broken.id)).toMatchObject({ status: 'unreadable', data: null, scanned_at: null });
    expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/files/${broken.id}`)).json().error.code).toBe('FILE_UNREADABLE');
    expect((await notificationsOf(s.teacher.client))[0]).toMatchObject({ kind: 'file_unreadable', title: 'A photo you uploaded could not be read', link: `/org/${s.orgId}/homework/${s.hwId}` });
    expect((await notificationsOf(s.owner.client)).some((x) => x.kind.startsWith('file_'))).toBe(false);
    expect((await notificationsOf(s.student, true)).some((x) => x.kind.startsWith('file_'))).toBe(false);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select('action').where('action', 'like', 'classroom.file_%').execute());
    expect(audit.map((a) => a.action)).toEqual(['classroom.file_unreadable']);
  });

  it('when the scanner fails, files wait and are tried again; an alert fires after 10 minutes', async () => {
    const s = await school();
    const f = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'essay.pdf')).json().file;
    const other = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'essay2.pdf')).json().file;
    clamd.mode = 'error';
    const failed = await runClassroomFileChecks(h.db, scanner());
    expect(failed).toMatchObject({ ready: 0, failed: 1 }); // stops at the first error
    expect(failed.error).toMatch(/clamd: stream: Can't allocate memory ERROR/);
    expect(await row(f.id)).toMatchObject({ status: 'pending', check_attempts: 1 });
    expect((await row(other.id)).check_attempts).toBe(0);
    // The next try takes the file not tried yet, so one file the scanner fails on holds up no other.
    await runClassroomFileChecks(h.db, scanner());
    expect([(await row(f.id)).check_attempts, (await row(other.id)).check_attempts]).toEqual([1, 1]);

    const errors = new ServerErrorCounter();
    expect((await evaluate(h.db, h.config, errors)).map((o) => o.key)).not.toContain('file_checks_stalled');
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE classroom_files SET created_at = now() - interval '11 minutes'`.execute(trx));
    const stalled = (await evaluate(h.db, h.config, errors)).find((o) => o.key === 'file_checks_stalled');
    expect(stalled).toMatchObject({ summary: '2 homework files have waited more than 10 minutes to be checked', details: { waitingFiles: 2 } });

    clamd.mode = 'scan';
    expect(await runClassroomFileChecks(h.db, scanner())).toMatchObject({ ready: 2, failed: 0 });
    expect(await row(f.id)).toMatchObject({ status: 'ready', check_error: null, check_attempts: 1 });
    expect((await evaluate(h.db, h.config, errors)).map((o) => o.key)).not.toContain('file_checks_stalled');
  });

  it('without a scanner, photos are still resized; once scanning is on, older files are scanned and stay open meanwhile', async () => {
    const s = await school();
    const sheet = (await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, PDF, 'sheet.pdf')).json().file;
    const png = await sharp({ create: { width: 2600, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const pic = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, png, 'graph.png')).json().file;
    expect(await runClassroomFileChecks(h.db, null)).toEqual({ ready: 2, infected: 0, unreadable: 0, rescanned: 0, failed: 0 });
    expect(await row(sheet.id)).toMatchObject({ status: 'ready', scanned_at: null });
    expect(await sharp((await s.student.get(`/api/student/files/${pic.id}`)).rawPayload).metadata()).toMatchObject({ format: 'png', width: 2000, height: 462 });

    // Scanning turned on later: the files open as before while they wait, then each is scanned once.
    await withSystemContext(h.ownerDb, (trx) => sql`UPDATE classroom_files SET data = ${Buffer.concat([PDF, Buffer.from(EICAR)])} WHERE id = ${sheet.id}`.execute(trx));
    expect((await s.student.get(`/api/student/files/${sheet.id}`)).statusCode).toBe(200);
    expect(await runClassroomFileChecks(h.db, scanner())).toMatchObject({ ready: 0, infected: 1, rescanned: 1 });
    expect(await row(sheet.id)).toMatchObject({ status: 'infected', data: null });
    expect((await row(pic.id)).scanned_at).not.toBeNull();
    expect((await s.student.get(`/api/student/files/${sheet.id}`)).json().error.code).toBe('FILE_INFECTED');
    expect(await runClassroomFileChecks(h.db, scanner())).toEqual({ ready: 0, infected: 0, unreadable: 0, rescanned: 0, failed: 0 });
  });

  it('two workers never check the same file', async () => {
    const s = await school();
    for (let i = 0; i < 4; i++) await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, `p${i}.pdf`);
    clamd.streams.length = 0;
    const [a, b] = await Promise.all([runClassroomFileChecks(h.db, scanner()), runClassroomFileChecks(h.db, scanner())]);
    expect(a.ready + b.ready).toBe(4);
    expect(clamd.streams).toHaveLength(4);
  });
});
