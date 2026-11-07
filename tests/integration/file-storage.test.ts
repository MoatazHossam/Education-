import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clamdScanner, runClassroomFileChecks } from '../../src/classroom/file-checks.js';
import { filePlaces, moveFiles } from '../../src/classroom/file-move.js';
import { createFileObjects, fileObjects, runObjectDeletions, type FileObjects } from '../../src/classroom/file-store.js';
import { withSystemContext } from '../../src/db/index.js';
import { rotateDataKeys } from '../../src/ops/data-keys.js';
import { TEST_ENV } from '../helpers/env.js';
import { EICAR, startFakeClamd } from '../helpers/fake-clamd.js';
import { startFakeS3, type FakeS3 } from '../helpers/fake-s3.js';
import { addMember, Client, createHarness, createStudent, enableStudents, resetData, signUp, studentLogin, type Harness } from '../helpers/harness.js';

// Homework files in an S3-compatible bucket (FILE_STORAGE=s3, src/classroom/file-store.ts), here a stand-in bucket
// the real AWS SDK client talks to over HTTP: uploads, opening files, the worker's checks, deletion through the queue,
// failures of the bucket, the move between the database and the bucket, and key rotation.

let s3: FakeS3;
let h: Harness;
let files: FileObjects;
let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
beforeAll(async () => {
  s3 = await startFakeS3();
  clamd = await startFakeClamd();
  h = await createHarness({ RATE_LIMIT_ENABLED: 'false', FILE_STORAGE: 's3', ...s3.env() });
  files = createFileObjects(h.config)!;
});
afterAll(async () => {
  await h.close();
  await s3.close();
  await clamd.close();
});
beforeEach(async () => {
  s3.fail = null;
  s3.objects.clear();
  s3.requests.length = 0;
  clamd.mode = 'scan';
  await resetData(h.ownerDb);
  await sql`TRUNCATE object_deletions`.execute(h.ownerDb);
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n% homework of Sara Ali\ntrailer<<>>\n%%EOF\n', 'latin1');
const scanner = () => clamdScanner('127.0.0.1', clamd.port, 2_000);

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

/** A school with a class of one student, a teacher and published homework. */
async function school() {
  const owner = await signUp(h, { org: 'Delta School' });
  await enableStudents(h, owner.orgId);
  const teacher = await addMember(h, owner.client, owner.orgId, 'viewer');
  const sara = await createStudent(h, owner.client, owner.orgId, { username: 'sara', name: 'Sara Ali', grade: 5 });
  const classId = (await owner.client.post(`/api/orgs/${owner.orgId}/classes`, { name: '5B', grade: 5 })).json().class.id as string;
  await owner.client.request('PUT', `/api/orgs/${owner.orgId}/classes/${classId}/students`, { studentIds: [sara.userId] });
  await owner.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/teachers`, { userId: teacher.userId, subjectEn: 'Science', subjectAr: 'العلوم' });
  const hw = await teacher.client.post(`/api/orgs/${owner.orgId}/classes/${classId}/homework`, {
    subjectEn: 'Science', subjectAr: 'العلوم', title: 'Plant diary', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  expect(hw.statusCode, hw.body).toBe(201);
  const student = await studentLogin(h, sara);
  return { owner, teacher, student, orgId: owner.orgId, hwId: hw.json().homework.id as string };
}

const row = (id: string) => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('classroom_files').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
const queue = () => withSystemContext(h.ownerDb, (trx) => trx.selectFrom('object_deletions').selectAll().orderBy('key').execute());
/** Makes every queued object due now (reservations included), as if their time had passed. */
const allDue = () => sql`UPDATE object_deletions SET due_at = now() - interval '1 second'`.execute(h.ownerDb);
const photo = (w = 3000, hgt = 2000) => sharp({ create: { width: w, height: hgt, channels: 3, background: '#4a7d3b' } }).jpeg({ quality: 90 }).toBuffer();

describe('homework files in the bucket', () => {
  it('keeps an uploaded file in the bucket, encrypted, and opens it once checked', async () => {
    const s = await school();
    const res = await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, PDF, 'worksheet.pdf');
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().file.id as string;
    const stored = await row(id);
    expect(stored.data).toBeNull();
    expect(stored.storage_key).toMatch(new RegExp(`^homework/${s.orgId}/[0-9a-f-]{36}$`));
    expect(stored.storage_dek_enc).toMatch(/^v2\./);
    // The bucket holds only ciphertext: no trace of the file, and not its length either.
    const object = s3.objects.get(stored.storage_key!)!;
    expect(object.subarray(0, 4).toString()).toBe('MDF1');
    expect(object.length).toBe(PDF.length + 4 + 12 + 16);
    expect(object.toString('latin1')).not.toContain('Sara Ali');
    expect(object.toString('latin1')).not.toContain('%PDF');
    // The new object was taken off the deletion queue by the upload's transaction.
    expect(await queue()).toEqual([]);

    expect((await s.student.get(`/api/student/files/${id}`)).json().error.code).toBe('FILE_CHECKING');
    expect(await runClassroomFileChecks(h.db, scanner(), files)).toMatchObject({ ready: 1, failed: 0 });
    expect(clamd.streams.at(-1)!.equals(PDF)).toBe(true); // scanned as uploaded, decrypted
    for (const r of [await s.student.get(`/api/student/files/${id}`), await s.teacher.client.get(`/api/orgs/${s.orgId}/files/${id}`)]) {
      expect(r.statusCode).toBe(200);
      expect(r.rawPayload.equals(PDF)).toBe(true);
      expect(r.headers['content-type']).toBe('application/pdf');
    }
    // It counts towards the school's storage like a file in the database.
    const { storageUsedBytes } = await import('../../src/classroom/files.js');
    expect(await withSystemContext(h.db, (trx) => storageUsedBytes(trx, s.orgId))).toBe(PDF.length);
  });

  it('replaces a photo with the prepared one in a new object and deletes the old object', async () => {
    const s = await school();
    const original = await photo();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, original, 'plant.jpg')).json().file.id as string;
    const before = (await row(id)).storage_key!;
    expect(await runClassroomFileChecks(h.db, null, files)).toMatchObject({ ready: 1 });
    const after = await row(id);
    expect(after.storage_key).not.toBe(before);
    expect(after.data).toBeNull();
    expect(after.original_size_bytes).toBe(original.length);
    // The old object is queued, due now; the worker's pass deletes it.
    expect((await queue()).map((q) => q.key)).toEqual([before]);
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 1, kept: 0, failed: 0 });
    expect([...s3.objects.keys()]).toEqual([after.storage_key]);
    const opened = await s.student.get(`/api/student/files/${id}`);
    expect(opened.statusCode).toBe(200);
    expect(await sharp(opened.rawPayload).metadata()).toMatchObject({ format: 'jpeg', width: 2000, height: 1333 });
    expect(createHash('sha256').update(opened.rawPayload).digest('hex')).toBe(after.sha256);
  });

  it('deletes the object of a removed file only after the removal is committed', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'answers.pdf')).json().file.id as string;
    const key = (await row(id)).storage_key!;
    // A removal that rolls back leaves the object and the queue as they were.
    await expect(
      withSystemContext(h.ownerDb, async (trx) => {
        await trx.deleteFrom('classroom_files').where('id', '=', id).execute();
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await queue()).toEqual([]);
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 0, kept: 0, failed: 0 });
    expect(s3.objects.has(key)).toBe(true);

    expect((await s.student.delete(`/api/student/homework/${s.hwId}/files/${id}`)).statusCode).toBe(200);
    expect((await queue()).map((q) => q.key)).toEqual([key]);
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 1, kept: 0, failed: 0 });
    expect(s3.objects.size).toBe(0);
    expect(await queue()).toEqual([]);
  });

  it('queues the objects of every file when homework, a class or a school is deleted', async () => {
    const s = await school();
    await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, PDF, 'worksheet.pdf');
    await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'answers.pdf');
    expect(s3.objects.size).toBe(2);
    // Removing the school removes its files through the foreign keys; the trigger still sees each row.
    await sql`DELETE FROM organizations WHERE id = ${s.orgId}`.execute(h.ownerDb);
    expect(await queue()).toHaveLength(2);
    expect(await runObjectDeletions(h.db, files.bucket)).toMatchObject({ deleted: 2 });
    expect(s3.objects.size).toBe(0);
  });

  it('refuses an upload while the bucket fails, and leaves nothing behind', async () => {
    const s = await school();
    s3.fail = { methods: ['PUT'], status: 503, code: 'SlowDown' };
    const res = await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'answers.pdf');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('FILE_STORAGE_UNAVAILABLE');
    expect(await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('classroom_files').select('id').execute())).toEqual([]);
    // The reservation stays queued, and is cleared once due (deleting an object that is not there succeeds).
    const [reserved] = await queue();
    expect(reserved!.due_at.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    s3.fail = null;
    await allDue();
    expect(await runObjectDeletions(h.db, files.bucket)).toMatchObject({ deleted: 1, failed: 0 });
    expect(await queue()).toEqual([]);
  });

  it('deletes the object of an upload refused after it was written (too many files)', async () => {
    const s = await school();
    for (let i = 0; i < 5; i++) expect((await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, `p${i}.pdf`)).statusCode).toBe(201);
    const res = await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'sixth.pdf');
    expect(res.json().error.code).toBe('TOO_MANY_FILES');
    expect(s3.objects.size).toBe(6); // written before the count was checked
    const named = new Set((await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('classroom_files').select('storage_key').execute())).map((r) => r.storage_key));
    const [orphan] = await queue();
    expect(named.has(orphan!.key)).toBe(false);
    // Not before its reservation is due.
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 0, kept: 0, failed: 0 });
    await allDue();
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 1, kept: 0, failed: 0 });
    expect([...s3.objects.keys()].sort()).toEqual([...named].sort());
  });

  it('says the file cannot be opened right now while the bucket fails, and the worker waits for it', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'answers.pdf')).json().file.id as string;
    s3.fail = { methods: ['GET'], status: 500, code: 'InternalError' };
    const checked = await runClassroomFileChecks(h.db, scanner(), files);
    expect(checked).toMatchObject({ ready: 0, failed: 1 });
    expect(checked.error).toMatch(/^file storage: /);
    expect(await row(id)).toMatchObject({ status: 'pending', check_attempts: 1 });
    s3.fail = null;
    expect(await runClassroomFileChecks(h.db, scanner(), files)).toMatchObject({ ready: 1 });
    s3.fail = { methods: ['GET'], status: 500, code: 'InternalError' };
    const res = await s.student.get(`/api/student/files/${id}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('FILE_STORAGE_UNAVAILABLE');
  });

  it('does not open an object that was changed or copied in the bucket', async () => {
    const s = await school();
    const a = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'a.pdf')).json().file.id as string;
    const b = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, Buffer.concat([PDF, Buffer.from('% other\n')]), 'b.pdf')).json().file.id as string;
    await runClassroomFileChecks(h.db, null, files);
    const ka = (await row(a)).storage_key!;
    const kb = (await row(b)).storage_key!;
    // One byte changed: the GCM tag no longer matches.
    const tampered = Buffer.from(s3.objects.get(ka)!);
    tampered[20] = tampered[20]! ^ 1;
    s3.objects.set(ka, tampered);
    expect((await s.student.get(`/api/student/files/${a}`)).statusCode).toBe(500);
    // Another file's object put in its place: wrong key, and the name is bound to the contents.
    s3.objects.set(ka, s3.objects.get(kb)!);
    expect((await s.student.get(`/api/student/files/${a}`)).statusCode).toBe(500);
    expect((await s.student.get(`/api/student/files/${b}`)).statusCode).toBe(200);
  });

  it('deletes the object of a file with a virus', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(EICAR)]), 'bad.pdf')).json().file.id as string;
    const key = (await row(id)).storage_key!;
    expect(await runClassroomFileChecks(h.db, scanner(), files)).toMatchObject({ infected: 1 });
    expect(await row(id)).toMatchObject({ status: 'infected', data: null, storage_key: null, storage_dek_enc: null });
    expect((await queue()).map((q) => q.key)).toEqual([key]);
    await runObjectDeletions(h.db, files.bucket);
    expect(s3.objects.size).toBe(0);
  });

  it('retries a failed deletion later and never deletes an object a file names', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'a.pdf')).json().file.id as string;
    const key = (await row(id)).storage_key!;
    await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'b.pdf');
    const other = [...s3.objects.keys()].find((k) => k !== key)!;
    await withSystemContext(h.ownerDb, (trx) => trx.deleteFrom('classroom_files').where('storage_key', '=', other).execute());
    s3.fail = { methods: ['DELETE'], status: 403, code: 'AccessDenied' };
    const failed = await runObjectDeletions(h.db, files.bucket);
    expect(failed).toMatchObject({ deleted: 0, failed: 1 });
    expect(failed.error).toMatch(/AccessDenied/);
    const [waiting] = await queue();
    expect(waiting).toMatchObject({ key: other, attempts: 1 });
    expect(waiting!.due_at.getTime()).toBeGreaterThan(Date.now());
    s3.fail = null;
    // An entry for an object a file names (as after restoring an older database backup) is dropped, not deleted.
    await sql`INSERT INTO object_deletions (key, due_at) VALUES (${key}, now())`.execute(h.ownerDb);
    await allDue();
    expect(await runObjectDeletions(h.db, files.bucket)).toEqual({ deleted: 1, kept: 1, failed: 0 });
    expect([...s3.objects.keys()]).toEqual([key]);
    // Without a bucket configured, the pass only reports what waits.
    await sql`INSERT INTO object_deletions (key, due_at) VALUES ('homework/x', now())`.execute(h.ownerDb);
    expect(await runObjectDeletions(h.db, null)).toEqual({ deleted: 0, kept: 0, failed: 0, waiting: 1 });
  });

  it('moves stored files into the bucket and back, skipping files still being checked', async () => {
    // Files uploaded while FILE_STORAGE=database.
    const dbHarness = await createHarness({ RATE_LIMIT_ENABLED: 'false' });
    try {
      const prev = h;
      h = dbHarness;
      const s = await school();
      const pdfId = (await upload(s.teacher.client, `/api/orgs/${s.orgId}/homework/${s.hwId}/files`, PDF, 'worksheet.pdf')).json().file.id as string;
      const photoId = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, await photo(800, 600), 'plant.jpg')).json().file.id as string;
      await runClassroomFileChecks(h.db, null);
      const pendingId = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'late.pdf')).json().file.id as string;
      h = prev;
      const expected = { [pdfId]: (await row(pdfId)).data!, [photoId]: (await row(photoId)).data! };

      expect(await filePlaces(h.db)).toEqual({ database: { files: 3, bytes: expect.any(Number) }, s3: { files: 0, bytes: 0 }, pending: 1 });
      const toS3 = await moveFiles(h.db, files, 's3');
      expect(toS3).toMatchObject({ moved: 2, skipped: 1, failed: [] });
      expect(await queue()).toEqual([]);
      for (const id of [pdfId, photoId]) {
        const r = await row(id);
        expect(r.data).toBeNull();
        expect((await files.read({ storage_key: r.storage_key!, storage_dek_enc: r.storage_dek_enc! })).equals(expected[id]!)).toBe(true);
      }
      expect((await row(pendingId)).data).not.toBeNull();
      // The application with the bucket's settings opens the teacher's worksheet; one without them cannot.
      const teacher = new Client(h.app);
      teacher.cookies = s.teacher.client.cookies;
      expect((await teacher.get(`/api/orgs/${s.orgId}/files/${pdfId}`)).rawPayload.equals(expected[pdfId]!)).toBe(true);
      expect((await s.teacher.client.get(`/api/orgs/${s.orgId}/files/${pdfId}`)).json().error.code).toBe('FILE_STORAGE_UNAVAILABLE');

      const back = await moveFiles(h.db, files, 'database');
      expect(back).toMatchObject({ moved: 2, skipped: 0, failed: [], objectsDeleted: 2 });
      expect(s3.objects.size).toBe(0);
      for (const id of [pdfId, photoId]) expect((await row(id)).data!.equals(expected[id]!)).toBe(true);
      expect(await filePlaces(h.db)).toMatchObject({ database: { files: 3 }, s3: { files: 0 } });
    } finally {
      await dbHarness.close();
    }
  });

  it('leaves a file where it is when the bucket fails during the move', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'a.pdf')).json().file.id as string;
    await runClassroomFileChecks(h.db, null, files);
    s3.fail = { methods: ['GET'], status: 500, code: 'InternalError' };
    const r = await moveFiles(h.db, files, 'database');
    expect(r.moved).toBe(0);
    expect(r.failed.map((f) => f.id)).toEqual([id]);
    expect(await row(id)).toMatchObject({ data: null, status: 'ready' });
    expect((await row(id)).storage_key).not.toBeNull();
  });

  it('re-encrypts the objects’ keys when DATA_ENCRYPTION_KEY is rotated; objects are not rewritten', async () => {
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'a.pdf')).json().file.id as string;
    await runClassroomFileChecks(h.db, null, files);
    const object = Buffer.from(s3.objects.get((await row(id)).storage_key!)!);
    const newKey = randomBytes(32).toString('base64');
    const ring = { current: newKey, previous: [h.config.DATA_ENCRYPTION_KEY] };
    const report = (await rotateDataKeys(h.db, ring, { write: true })).find((r) => r.table === 'classroom_files')!;
    expect(report).toMatchObject({ column: 'storage_dek_enc', total: 1, rewrapped: 1, unreadable: [] });
    // The new key alone opens it; the object in the bucket is the same.
    const f = await row(id);
    const withNewKey = fileObjects(files.bucket, { current: newKey, previous: [] });
    expect((await withNewKey.read({ storage_key: f.storage_key!, storage_dek_enc: f.storage_dek_enc! })).equals(PDF)).toBe(true);
    expect(s3.objects.get(f.storage_key!)!.equals(object)).toBe(true);
  });

  it('moves files with the command-line tool, reports where they are, and records it', async () => {
    const run = (args: string[], env: Record<string, string> = {}) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/move-files.ts', ...args], { env: { ...process.env, ...TEST_ENV, LOG_LEVEL: 'warn', ...env } });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('exit', (code) => resolve({ code, out }));
      });
    expect(await run([])).toMatchObject({ code: 2, out: expect.stringContaining('Usage: move-files --to s3|database') });
    expect(await run(['--to', 's3'])).toMatchObject({ code: 1, out: expect.stringContaining('No bucket is set') });
    const s = await school();
    const id = (await upload(s.student, `/api/student/homework/${s.hwId}/files`, PDF, 'a.pdf')).json().file.id as string;
    await runClassroomFileChecks(h.db, null, files);
    const check = await run(['--to', 'database', '--check'], s3.env());
    expect(check.code).toBe(0);
    expect(check.out).toContain(`Bucket: bucket midad-test at ${s3.endpoint} (reachable)`);
    expect(check.out).toContain('In the database: 0 files (0.0 MB). In the bucket: 1 files');
    expect(check.out).not.toContain('Note:');
    // Moving to the bucket while new uploads still go into the database: said so.
    expect((await run(['--to', 's3', '--check'], s3.env())).out).toContain('Note: FILE_STORAGE is database, so new uploads still go into the database. Set FILE_STORAGE=s3');
    expect((await row(id)).storage_key).not.toBeNull();
    const moved = await run(['--to', 'database'], s3.env());
    expect(moved.code).toBe(0);
    expect(moved.out).toContain('Moved 1 files');
    expect(moved.out).toContain('Deleted 1 objects from the bucket.');
    expect(moved.out).not.toContain(s3.env().S3_SECRET_ACCESS_KEY!);
    expect((await row(id)).data!.equals(PDF)).toBe(true);
    const audit = await withSystemContext(h.ownerDb, (trx) => trx.selectFrom('audit_logs').select(['action', 'metadata']).where('action', '=', 'admin.files_moved').execute());
    expect(audit).toEqual([{ action: 'admin.files_moved', metadata: { to: 'database', moved: 1, bytes: PDF.length, skipped: 0, failed: 0, objectsDeleted: 1 } }]);
    s3.fail = { methods: ['HEAD'], status: 403, code: 'AccessDenied' };
    expect(await run(['--to', 's3'], s3.env())).toMatchObject({ code: 1, out: expect.stringContaining('cannot be reached') });
  });

  it('checks the access key and the bucket', async () => {
    await expect(files.bucket.check()).resolves.toBeUndefined();
    const wrong = createFileObjects({ ...h.config, S3_BUCKET: 'no-such-bucket' })!;
    await expect(wrong.bucket.check()).rejects.toThrow();
    const badKey = createFileObjects({ ...h.config, S3_ACCESS_KEY_ID: 'SOMEONEELSE' })!;
    await expect(badKey.bucket.put('homework/x', Buffer.from('x'))).rejects.toThrow(/access key/i);
    expect(files.bucket.description).toBe(`bucket midad-test at ${s3.endpoint}`);
  });
});
