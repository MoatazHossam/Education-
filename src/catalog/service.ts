import type { Executor } from '../db/index.js';
import type { MaterialKind, SubjectStatus, Track } from '../db/types.js';
import { notFound } from '../lib/errors.js';
import { GRADE_NAMES } from './legacy-dataset.js';

export interface CatalogMaterial {
  id: string;
  kind: MaterialKind;
  title: string;
}

export interface CatalogSubject {
  id: string;
  grade: number;
  track: Track;
  block: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: SubjectStatus;
  note: string | null;
  materials: CatalogMaterial[];
}

export interface CatalogTree {
  version: { id: string; academicYear: string; label: string; status: string; notice: string | null; gradeNotes: Record<string, string>; publishedAt: Date | null; updatedAt: Date };
  grades: { grade: number; nameEn: string; nameAr: string }[];
  sources: { id: string; title: string; url: string }[];
  subjects: CatalogSubject[];
  counts: { subjects: number; materials: number };
}

// Published versions are immutable, so their trees are cached in memory.
const cache = new Map<string, { updatedAt: number; tree: CatalogTree }>();

export function gradeList() {
  return Object.entries(GRADE_NAMES).map(([g, [en, ar]]) => ({ grade: Number(g), nameEn: en, nameAr: ar }));
}

export async function loadCatalogTree(exec: Executor, versionId: string, opts: { allowUnpublished?: boolean } = {}): Promise<CatalogTree> {
  const version = await exec.selectFrom('catalog_versions').selectAll().where('id', '=', versionId).executeTakeFirst();
  if (!version || (!opts.allowUnpublished && version.status === 'draft')) throw notFound('Catalog version');
  const cached = cache.get(versionId);
  if (version.status !== 'draft' && cached && cached.updatedAt === version.updated_at.getTime()) return cached.tree;

  const [sources, subjects, materials] = await Promise.all([
    exec.selectFrom('catalog_sources').select(['id', 'title', 'url']).where('version_id', '=', versionId).orderBy('sort_order').execute(),
    exec.selectFrom('catalog_subjects').selectAll().where('version_id', '=', versionId).orderBy('grade').orderBy('sort_order').execute(),
    exec.selectFrom('catalog_materials').select(['id', 'subject_id', 'kind', 'title']).where('version_id', '=', versionId).orderBy('subject_id').orderBy('sort_order').execute(),
  ]);
  const bySubject = new Map<string, CatalogMaterial[]>();
  for (const m of materials) {
    let list = bySubject.get(m.subject_id);
    if (!list) bySubject.set(m.subject_id, (list = []));
    list.push({ id: m.id, kind: m.kind, title: m.title });
  }
  const tree: CatalogTree = {
    version: {
      id: version.id,
      academicYear: version.academic_year,
      label: version.label,
      status: version.status,
      notice: version.notice,
      gradeNotes: version.grade_notes,
      publishedAt: version.published_at,
      updatedAt: version.updated_at,
    },
    grades: gradeList(),
    sources,
    subjects: subjects.map((s) => ({
      id: s.id,
      grade: s.grade,
      track: s.track,
      block: s.block,
      code: s.code,
      nameEn: s.name_en,
      nameAr: s.name_ar,
      status: s.status,
      note: s.note,
      materials: bySubject.get(s.id) ?? [],
    })),
    counts: { subjects: subjects.length, materials: materials.length },
  };
  if (version.status !== 'draft') cache.set(versionId, { updatedAt: version.updated_at.getTime(), tree });
  return tree;
}

export function invalidateCatalogCache(versionId?: string): void {
  if (versionId) cache.delete(versionId);
  else cache.clear();
}

export async function listPublishedVersions(exec: Executor) {
  const rows = await exec
    .selectFrom('catalog_versions')
    .select(['id', 'academic_year', 'label', 'status', 'published_at'])
    .where('status', 'in', ['published', 'archived'])
    .orderBy('academic_year', 'desc')
    .orderBy('published_at', 'desc')
    .execute();
  return rows.map((v) => ({ id: v.id, academicYear: v.academic_year, label: v.label, status: v.status, publishedAt: v.published_at }));
}
