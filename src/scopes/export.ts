import type { CatalogTree } from '../catalog/service.js';
import { GRADE_NAMES } from '../catalog/legacy-dataset.js';
import { csvCell, UTF8_BOM } from '../lib/csv.js';
import type { ExportAnnotation } from './notes.js';

export interface ExportRow {
  grade: number;
  gradeEn: string;
  gradeAr: string;
  track: string;
  block: string;
  subjectCode: string;
  subjectEn: string;
  subjectAr: string;
  subjectStatus: string;
  materialId: string;
  materialKind: string;
  materialTitle: string;
  subjectVerification: string;
  subjectVerificationSource: string | null;
  subjectReviewedAt: string | null;
  materialVerification: string;
  materialVerificationSource: string | null;
  materialReviewedAt: string | null;
  /** The team's note on the book and who is responsible for it (null when not shared, e.g. support access). */
  note: string | null;
  assignee: string | null;
  status: string | null;
  dueOn: string | null;
}

/** Selected materials in catalogue order (grade → subject → material). */
export function selectedRows(tree: CatalogTree, selected: Set<string>, annotations?: Map<string, ExportAnnotation>): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const s of tree.subjects) {
    for (const m of s.materials) {
      if (!selected.has(m.id)) continue;
      const [gradeEn, gradeAr] = GRADE_NAMES[s.grade] ?? [`Grade ${s.grade}`, ''];
      rows.push({
        grade: s.grade,
        gradeEn,
        gradeAr,
        track: s.track,
        block: s.block,
        subjectCode: s.code,
        subjectEn: s.nameEn,
        subjectAr: s.nameAr,
        subjectStatus: s.status,
        materialId: m.id,
        materialKind: m.kind,
        materialTitle: m.title,
        subjectVerification: s.verification?.status ?? 'unverified',
        subjectVerificationSource: s.verification?.source ?? null,
        subjectReviewedAt: s.verification ? new Date(s.verification.reviewedAt).toISOString() : null,
        materialVerification: m.verification?.status ?? 'unverified',
        materialVerificationSource: m.verification?.source ?? null,
        materialReviewedAt: m.verification ? new Date(m.verification.reviewedAt).toISOString() : null,
        note: annotations?.get(m.id)?.note ?? null,
        assignee: annotations?.get(m.id)?.assignee ?? null,
        status: annotations?.get(m.id)?.status ?? null,
        dueOn: annotations?.get(m.id)?.dueOn ?? null,
      });
    }
  }
  return rows;
}

/** Same layout as the original picker's "Copy list" output. */
export function toText(rows: ExportRow[]): string {
  let s = '';
  let grade = -1;
  let group = '';
  for (const r of rows) {
    if (r.grade !== grade) {
      grade = r.grade;
      group = '';
      s += `\n${r.gradeEn} / ${r.gradeAr}\n`;
    }
    const key = `${r.block} — ${r.subjectEn}`;
    if (key !== group) {
      group = key;
      s += `  • ${key}\n`;
    }
    s += `      - ${r.materialTitle}\n`;
  }
  return s.trim() || 'Nothing selected yet.';
}

const CSV_HEADER = [
  'grade', 'grade_en', 'grade_ar', 'track', 'block', 'subject_code', 'subject_en', 'subject_ar', 'subject_status', 'material_id', 'material_kind', 'material_title',
  'subject_verification', 'subject_verification_source', 'subject_reviewed_at', 'material_verification', 'material_verification_source', 'material_reviewed_at',
  'note', 'assignee', 'status', 'due_on',
];

export function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.grade, r.gradeEn, r.gradeAr, r.track, r.block, r.subjectCode, r.subjectEn, r.subjectAr, r.subjectStatus, r.materialId, r.materialKind, r.materialTitle,
        r.subjectVerification, r.subjectVerificationSource ?? '', r.subjectReviewedAt ?? '', r.materialVerification, r.materialVerificationSource ?? '', r.materialReviewedAt ?? '',
        r.note ?? '', r.assignee ?? '', r.status ?? '', r.dueOn ?? '',
      ]
        .map((c) => csvCell(c))
        .join(','),
    );
  }
  // UTF-8 BOM so Excel renders the Arabic columns correctly.
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

export function toJson(
  scope: { id: string; name: string; description: string | null; updatedAt: Date },
  tree: CatalogTree,
  rows: ExportRow[],
) {
  return {
    scope: { id: scope.id, name: scope.name, description: scope.description, updatedAt: scope.updatedAt },
    catalogVersion: { id: tree.version.id, academicYear: tree.version.academicYear, label: tree.version.label },
    exportedAt: new Date().toISOString(),
    itemCount: rows.length,
    items: rows,
  };
}
