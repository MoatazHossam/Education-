import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Entitlements } from '../billing/entitlements.js';
import type { Executor } from '../db/index.js';
import type { ClassroomFileType } from '../db/types.js';
import { AppError, badRequest } from '../lib/errors.js';

// Files on homework and submissions (docs/CLASSROOM.md §5): photos of written
// work and PDFs. The browser sends the raw bytes; the type is decided from the
// first bytes, never from the browser's claim, and only four types are kept.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_ITEM = 5;
/** Content types the upload routes accept as raw bodies. */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/octet-stream'];

const EXT: Record<ClassroomFileType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export function sniffType(buf: Buffer): ClassroomFileType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** A display name without paths or control characters, ending in the real type's extension. */
export function cleanFileName(raw: string | undefined, type: ClassroomFileType): string {
  let name = '';
  try {
    name = decodeURIComponent(raw ?? '');
  } catch {
    name = '';
  }
  name = name
    .replace(/^.*[\\/]/, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 180);
  const ext = EXT[type];
  const base = name.replace(/\.[^.]{1,8}$/, '') || 'file';
  return `${base}.${ext}`;
}

/** The uploaded bytes and their checked type and name (raw body; name in X-File-Name, URL-encoded). */
export function readUpload(req: FastifyRequest): { data: Buffer; type: ClassroomFileType; name: string } {
  const data = Buffer.isBuffer(req.body) ? req.body : null;
  if (!data || data.length === 0) throw badRequest('Choose a file to upload');
  if (data.length > MAX_FILE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB');
  const type = sniffType(data);
  if (!type) throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'Upload a photo (JPEG, PNG or WebP) or a PDF');
  const header = req.headers['x-file-name'];
  return { data, type, name: cleanFileName(typeof header === 'string' ? header : undefined, type) };
}

export async function storageUsedBytes(exec: Executor, orgId: string): Promise<number> {
  const r = await exec.selectFrom('classroom_files').select((eb) => eb.fn.coalesce(eb.fn.sum<string>('size_bytes'), eb.val('0')).as('n')).where('org_id', '=', orgId).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Call under lockOrg so two uploads cannot pass the limit together. */
export async function assertStorageAvailable(exec: Executor, orgId: string, ent: Entitlements, adding: number): Promise<void> {
  const mb = ent.limits.max_storage_mb;
  if (mb === null || mb === undefined) return;
  const used = await storageUsedBytes(exec, orgId);
  if (used + adding > mb * 1024 * 1024) {
    throw new AppError(402, 'STORAGE_LIMIT_REACHED', `Your school’s file storage (${mb} MB) is full. Delete old files or ask us for more space.`, { limit: 'max_storage_mb', max: mb });
  }
}

export async function saveFile(
  exec: Executor,
  f: { orgId: string; homeworkId?: string; submissionId?: string; upload: { data: Buffer; type: ClassroomFileType; name: string }; uploadedBy: string },
): Promise<{ id: string; name: string; contentType: ClassroomFileType; size: number }> {
  const row = await exec
    .insertInto('classroom_files')
    .values({
      org_id: f.orgId,
      homework_id: f.homeworkId ?? null,
      submission_id: f.submissionId ?? null,
      name: f.upload.name,
      content_type: f.upload.type,
      size_bytes: f.upload.data.length,
      sha256: createHash('sha256').update(f.upload.data).digest('hex'),
      data: f.upload.data,
      uploaded_by: f.uploadedBy,
    })
    .returning(['id', 'name', 'content_type', 'size_bytes'])
    .executeTakeFirstOrThrow();
  return { id: row.id, name: row.name, contentType: row.content_type, size: row.size_bytes };
}

export async function filesOf(exec: Executor, where: { homeworkId: string } | { submissionId: string }) {
  const rows = await exec
    .selectFrom('classroom_files')
    .select(['id', 'name', 'content_type', 'size_bytes', 'created_at'])
    .$if('homeworkId' in where, (q) => q.where('homework_id', '=', (where as { homeworkId: string }).homeworkId))
    .$if('submissionId' in where, (q) => q.where('submission_id', '=', (where as { submissionId: string }).submissionId))
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.content_type, size: r.size_bytes, createdAt: r.created_at }));
}

/**
 * Sends a stored file. Images open in the browser; PDFs download. The sandbox
 * policy keeps any script inside a file from running with the app's origin.
 */
export function sendFile(reply: FastifyReply, file: { name: string; content_type: ClassroomFileType; data: Buffer }) {
  const inline = file.content_type !== 'application/pdf';
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return reply
    .header('content-type', file.content_type)
    .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    .header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(file.data);
}
