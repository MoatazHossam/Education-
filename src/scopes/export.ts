import type { CatalogTree } from '../catalog/service.js';
import { GRADE_NAMES } from '../catalog/legacy-dataset.js';

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
}

/** Selected materials in catalogue order (grade → subject → material). */
export function selectedRows(tree: CatalogTree, selected: Set<string>): ExportRow[] {
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

// Spreadsheet formula injection guard (OWASP CSV Injection): prefix risky leading characters.
function csvCell(value: string | number): string {
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CSV_HEADER = ['grade', 'grade_en', 'grade_ar', 'track', 'block', 'subject_code', 'subject_en', 'subject_ar', 'subject_status', 'material_id', 'material_kind', 'material_title'];

export function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [r.grade, r.gradeEn, r.gradeAr, r.track, r.block, r.subjectCode, r.subjectEn, r.subjectAr, r.subjectStatus, r.materialId, r.materialKind, r.materialTitle]
        .map(csvCell)
        .join(','),
    );
  }
  // UTF-8 BOM so Excel renders the Arabic columns correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
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
