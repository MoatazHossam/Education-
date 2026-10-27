import { createHash } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { sql } from 'kysely';
import sharp from 'sharp';
import { recordAudit } from '../audit/audit.js';
import type { AppConfig } from '../config.js';
import { withSystemContext, type Database, type Executor } from '../db/index.js';
import type { ClassroomFileType } from '../db/types.js';
import { notify } from '../notifications/email.js';
import { MAX_FILE_BYTES } from './files.js';

// The worker checks every homework file before anyone can open it (docs/CLASSROOM.md §5):
//  1. with FILE_SCAN=clamav, ClamAV scans the bytes as uploaded (clamd's INSTREAM over TCP);
//  2. photos are turned upright, made at most PHOTO_MAX_SIDE pixels on their longer side and
//     encoded again, which also drops their metadata (a phone photo's EXIF can hold where it
//     was taken). PDFs are kept as they are.
// A file with a virus, or a photo that cannot be read, loses its bytes; the row stays so the
// pages can say what happened. The uploader is told, and for a virus the school's owners and
// admins too, and the audit log records it. Nobody opens a file until it is ready.

export const PHOTO_MAX_SIDE = 2000;
/** Larger images (in pixels) are refused before they are decoded. */
const MAX_INPUT_PIXELS = 100_000_000;
const CLAMD_TIMEOUT_MS = 30_000;
const CLAMD_CHUNK_BYTES = 64 * 1024;
/** Files checked per pass; the worker runs the next pass at once when a pass was full. */
export const FILE_CHECK_BATCH = 20;

// ------------------------------------------------------------ virus scanning

export type ScanResult = { clean: true } | { clean: false; virus: string };

export interface VirusScanner {
  scan(data: Buffer): Promise<ScanResult>;
  ping(): Promise<boolean>;
}

/** Sends one clamd command and reads its reply, which ends with a NUL byte ("z" commands). */
function clamdCall(host: string, port: number, timeoutMs: number, send: (socket: Socket) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, reply?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(reply!);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`clamd did not answer within ${timeoutMs / 1000} s`)));
    socket.on('connect', () => send(socket));
    socket.on('data', (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      const end = all.indexOf(0);
      if (end >= 0) finish(null, all.subarray(0, end).toString('utf8').trim());
    });
    socket.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8').trim()));
    socket.on('error', (err) => finish(err));
  });
}

/** ClamAV's daemon over TCP. Throws when clamd cannot be reached or reports an error. */
export function clamdScanner(host: string, port: number, timeoutMs = CLAMD_TIMEOUT_MS): VirusScanner {
  return {
    async scan(data) {
      const reply = await clamdCall(host, port, timeoutMs, (socket) => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += CLAMD_CHUNK_BYTES) {
          const chunk = data.subarray(i, i + CLAMD_CHUNK_BYTES);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      if (reply === 'stream: OK') return { clean: true };
      const found = /^stream: (.+) FOUND$/.exec(reply);
      if (found) return { clean: false, virus: found[1]!.slice(0, 200) };
      throw new Error(`clamd: ${reply || 'no answer'}`.slice(0, 300));
    },
    async ping() {
      try {
        return (await clamdCall(host, port, 5_000, (socket) => socket.write('zPING\0'))) === 'PONG';
      } catch {
        return false;
      }
    },
  };
}

/** The scanner FILE_SCAN asks for, or null when files are not scanned. */
export function fileScanner(config: Pick<AppConfig, 'FILE_SCAN' | 'CLAMAV_HOST' | 'CLAMAV_PORT'>): VirusScanner | null {
  return config.FILE_SCAN === 'clamav' && config.CLAMAV_HOST ? clamdScanner(config.CLAMAV_HOST, config.CLAMAV_PORT) : null;
}

// ------------------------------------------------------------ photos

const SHARP_FORMAT: Record<Exclude<ClassroomFileType, 'application/pdf'>, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

/** For the worker: one image at a time, nothing cached between files. */
export function limitImageWork(): void {
  sharp.concurrency(1);
  sharp.cache(false);
}

/**
 * The photo turned upright (by its EXIF orientation), at most PHOTO_MAX_SIDE pixels on its
 * longer side (never enlarged), encoded again in the same format without metadata.
 * Throws when the bytes are not a readable image of that format.
 */
export async function preparePhoto(data: Buffer, type: Exclude<ClassroomFileType, 'application/pdf'>): Promise<Buffer> {
  // Lenient with small defects a browser would show anyway (a bad checksum); the pixels are encoded
  // again, so nothing of the original file but its picture is kept. Truncated files are refused.
  const input = () => sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'truncated' });
  const meta = await input().metadata();
  if (meta.format !== SHARP_FORMAT[type]) throw new Error(`not a ${SHARP_FORMAT[type]} image`);
  const resized = () => input().rotate().resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  let out: Buffer;
  if (type === 'image/jpeg') out = await resized().jpeg({ quality: 82 }).toBuffer();
  else if (type === 'image/webp') out = await resized().webp({ quality: 80 }).toBuffer();
  else {
    out = await resized().png({ compressionLevel: 9 }).toBuffer();
    // A palette PNG can grow when decoded; fall back to a palette again rather than refuse it.
    if (out.length > MAX_FILE_BYTES) out = await resized().png({ compressionLevel: 9, palette: true }).toBuffer();
  }
  if (out.length > MAX_FILE_BYTES) throw new Error('the photo is larger than 5 MB after resizing');
  return out;
}

// ------------------------------------------------------------ the worker pass

export interface FileCheckResult {
  ready: number;
  infected: number;
  unreadable: number;
  /** Scans of older files (uploaded before scanning was on). */
  rescanned: number;
  /** Scanner errors; the file stays pending and is tried again on the next pass. */
  failed: number;
  error?: string;
}

type PendingFile = {
  id: string;
  org_id: string;
  homework_id: string | null;
  submission_id: string | null;
  name: string;
  content_type: ClassroomFileType;
  size_bytes: number;
  sha256: string;
  data: Buffer | null;
  uploaded_by: string | null;
};

const FILE_COLUMNS = ['id', 'org_id', 'homework_id', 'submission_id', 'name', 'content_type', 'size_bytes', 'sha256', 'data', 'uploaded_by'] as const;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Counts a failed scan on the file, which stays as it was; returns the error for the worker's log. */
async function scanFailed(exec: Executor, id: string, err: unknown): Promise<string> {
  const error = errorText(err);
  await exec
    .updateTable('classroom_files')
    .set({ check_attempts: sql<number>`check_attempts + 1`, check_error: error })
    .where('id', '=', id)
    .execute();
  return error;
}

/** Where a file belongs: its homework, class and the student or teacher who uploaded it. */
async function fileContext(exec: Executor, f: PendingFile) {
  const homeworkId = f.homework_id ?? (await exec.selectFrom('homework_submissions').select('homework_id').where('id', '=', f.submission_id!).executeTakeFirstOrThrow()).homework_id;
  const hw = await exec
    .selectFrom('homework as h')
    .innerJoin('classes as c', 'c.id', 'h.class_id')
    .select(['h.id', 'h.title', 'c.name as className'])
    .where('h.id', '=', homeworkId)
    .executeTakeFirstOrThrow();
  const uploader = f.uploaded_by
    ? await exec.selectFrom('users').select(['id', 'name', 'kind', 'locale', 'status']).where('id', '=', f.uploaded_by).executeTakeFirst()
    : undefined;
  return { hw, uploader };
}

const UPLOADER_TEXT = {
  infected: {
    en: (name: string, title: string) => ({ title: 'A file you uploaded was deleted', body: `“${name}” (homework “${title}”) contained a virus and was deleted. Check your device with an antivirus program, then upload the work again.` }),
    ar: (name: string, title: string) => ({ title: 'حُذف ملف رفعته', body: `كان الملف «${name}» (الواجب «${title}») يحتوي على فيروس فحُذف. افحص جهازك ببرنامج مكافحة الفيروسات، ثم ارفع العمل مرة أخرى.` }),
  },
  unreadable: {
    en: (name: string, title: string) => ({ title: 'A photo you uploaded could not be read', body: `“${name}” (homework “${title}”) could not be opened as a photo and was deleted. Take the photo again and upload it.` }),
    ar: (name: string, title: string) => ({ title: 'تعذّرت قراءة صورة رفعتها', body: `تعذّر فتح «${name}» (الواجب «${title}») كصورة فحُذفت. التقط الصورة مرة أخرى وارفعها.` }),
  },
} as const;

/** Deletes the bytes of a file that must not be opened, and tells who needs to know. */
async function block(exec: Executor, f: PendingFile, status: 'infected' | 'unreadable', detail: { virus?: string; error?: string }, scanned: boolean): Promise<void> {
  const now = new Date();
  await exec
    .updateTable('classroom_files')
    .set({ status, data: null, virus_name: detail.virus ?? null, check_error: detail.error ?? null, scanned_at: scanned ? now : null, checked_at: now })
    .where('id', '=', f.id)
    .execute();
  const { hw, uploader } = await fileContext(exec, f);
  if (uploader && uploader.status === 'active') {
    const text = UPLOADER_TEXT[status][uploader.locale](f.name, hw.title);
    const link = uploader.kind === 'student' ? `/student/homework/${hw.id}` : `/org/${f.org_id}/homework/${hw.id}`;
    await notify(exec, { userId: uploader.id, orgId: f.org_id, kind: `file_${status}`, title: text.title, body: text.body, link });
  }
  if (status === 'infected') {
    const admins = await exec
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.locale'])
      .where('m.org_id', '=', f.org_id)
      .where('m.role', 'in', ['owner', 'admin'])
      .where('u.status', '=', 'active')
      .execute();
    const who = uploader?.name ?? '—';
    for (const a of admins) {
      if (a.id === uploader?.id) continue;
      await notify(exec, {
        userId: a.id,
        orgId: f.org_id,
        kind: 'file_infected',
        title: a.locale === 'ar' ? 'عُثر على فيروس في ملف واجب' : 'A virus was found in a homework file',
        body:
          a.locale === 'ar'
            ? `حُذف الملف «${f.name}» الذي رفعه ${who} للواجب «${hw.title}» (${hw.className}). قد يكون الجهاز الذي جاء منه مصابًا.`
            : `“${f.name}”, uploaded by ${who} for “${hw.title}” (${hw.className}), was deleted. The device it came from may be infected.`,
        link: `/org/${f.org_id}/homework/${hw.id}`,
      });
    }
  }
  await recordAudit(exec, { type: 'system' }, {
    orgId: f.org_id,
    action: status === 'infected' ? 'classroom.file_infected' : 'classroom.file_unreadable',
    targetType: 'classroom_file',
    targetId: f.id,
    metadata: {
      name: f.name,
      contentType: f.content_type,
      size: f.size_bytes,
      sha256: f.sha256,
      homeworkId: hw.id,
      ...(f.submission_id ? { submissionId: f.submission_id } : {}),
      uploadedBy: f.uploaded_by,
      ...(detail.virus ? { virus: detail.virus } : {}),
      ...(detail.error ? { error: detail.error } : {}),
    },
  });
}

/** Checks one pending file (row locked by the caller). */
async function checkPending(exec: Executor, f: PendingFile, scanner: VirusScanner | null): Promise<'ready' | 'infected' | 'unreadable' | { failed: string }> {
  const data = f.data!;
  if (scanner) {
    let result: ScanResult;
    try {
      result = await scanner.scan(data);
    } catch (err) {
      return { failed: await scanFailed(exec, f.id, err) };
    }
    if (!result.clean) {
      await block(exec, f, 'infected', { virus: result.virus }, true);
      return 'infected';
    }
  }
  const now = new Date();
  const scannedAt = scanner ? now : null;
  if (f.content_type === 'application/pdf') {
    await exec.updateTable('classroom_files').set({ status: 'ready', scanned_at: scannedAt, checked_at: now, check_error: null }).where('id', '=', f.id).execute();
    return 'ready';
  }
  let photo: Buffer;
  try {
    photo = await preparePhoto(data, f.content_type);
  } catch (err) {
    await block(exec, f, 'unreadable', { error: errorText(err) }, Boolean(scanner));
    return 'unreadable';
  }
  await exec
    .updateTable('classroom_files')
    .set({
      status: 'ready',
      data: photo,
      size_bytes: photo.length,
      sha256: createHash('sha256').update(photo).digest('hex'),
      original_size_bytes: f.size_bytes,
      scanned_at: scannedAt,
      checked_at: now,
      check_error: null,
    })
    .where('id', '=', f.id)
    .execute();
  return 'ready';
}

/**
 * One worker pass: checks pending files, oldest first (fewest failed scans first), each in its own transaction with the
 * row locked (two workers never check the same file). With a scanner, then scans files that
 * are open but were never scanned (uploaded before scanning was on); they stay open meanwhile.
 * Stops at the first scanner error, so a stopped scanner is not called for every file.
 */
export async function runClassroomFileChecks(db: Database, scanner: VirusScanner | null, batch = FILE_CHECK_BATCH): Promise<FileCheckResult> {
  const result: FileCheckResult = { ready: 0, infected: 0, unreadable: 0, rescanned: 0, failed: 0 };
  for (let i = 0; i < batch; i++) {
    const outcome = await withSystemContext(db, async (trx) => {
      // Fewest failed scans first: a file the scanner keeps failing on does not hold up the others.
      const f = await trx.selectFrom('classroom_files').select(FILE_COLUMNS).where('status', '=', 'pending').orderBy('check_attempts').orderBy('created_at').limit(1).forUpdate().skipLocked().executeTakeFirst();
      return f ? checkPending(trx, f, scanner) : null;
    });
    if (!outcome) break;
    if (typeof outcome === 'object') {
      result.failed++;
      result.error = outcome.failed;
      return result;
    }
    result[outcome]++;
  }
  if (!scanner) return result;
  for (let i = result.ready + result.infected + result.unreadable; i < batch; i++) {
    const outcome = await withSystemContext(db, async (trx) => {
      const f = await trx
        .selectFrom('classroom_files')
        .select(FILE_COLUMNS)
        .where('status', '=', 'ready')
        .where('scanned_at', 'is', null)
        .orderBy('check_attempts')
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!f) return null;
      let scan: ScanResult;
      try {
        scan = await scanner.scan(f.data!);
      } catch (err) {
        return { failed: await scanFailed(trx, f.id, err) };
      }
      if (!scan.clean) {
        await block(trx, f, 'infected', { virus: scan.virus }, true);
        return 'infected';
      }
      await trx.updateTable('classroom_files').set({ scanned_at: new Date(), check_error: null }).where('id', '=', f.id).execute();
      return 'rescanned' as const;
    });
    if (!outcome) break;
    if (typeof outcome === 'object') {
      result.failed++;
      result.error = outcome.failed;
      break;
    }
    result[outcome]++;
  }
  return result;
}
