import { describe, expect, it } from 'vitest';
import { exportSheet, planImport, SHEET_COLUMNS, type SheetState } from '../../src/catalog/sheet.js';
import { parseCsv, toCsv, unguardCell } from '../../src/lib/csv.js';

const noMark = { verification_status: 'unverified' as const, verification_source: null, verification_url: null, verification_note: null, reviewed_by: null, reviewed_at: null };
const subject = (id: string, over: object = {}) => ({ id, version_id: 'v', grade: 4, track: 'moe' as const, block: 'Primary', code: id, name_en: `Subject ${id}`, name_ar: `مادة ${id}`, status: 'scored' as const, note: null, sort_order: 0, ...noMark, ...over });
const material = (id: string, subjectId: string, title: string, over: object = {}) => ({ id, subject_id: subjectId, version_id: 'v', kind: 'moe' as const, title, sort_order: 0, ...noMark, ...over });

const state: SheetState = {
  subjects: [subject('ar'), subject('ma', { verification_status: 'verified', verification_source: 'Decree 1', reviewed_at: new Date() })],
  materials: [
    material('m1', 'ar', 'Ministry textbook'),
    material('m2', 'ar', '=Formula-looking title'),
    material('m3', 'ma', 'Math book', { verification_status: 'verified', verification_source: 'Publisher site', reviewed_at: new Date() }),
  ],
};

/** Exports, applies `edit` to the parsed records (by row number and column name), re-serializes. */
function edited(edit: (set: (row: number, column: string, value: string) => void, records: string[][]) => void) {
  const records = parseCsv(exportSheet(state)).map((r) => r.map(unguardCell));
  const at = (c: string) => records[0]!.indexOf(c);
  edit((row, column, value) => { records[row - 1]![at(column)] = value; }, records);
  return toCsv(records);
}

describe('catalogue spreadsheet', () => {
  it('exports every subject followed by its materials, and an untouched sheet changes nothing', () => {
    const records = parseCsv(exportSheet(state));
    expect(records[0]).toEqual([...SHEET_COLUMNS]);
    expect(records.slice(1).map((r) => `${r[0]}:${r[2] || r[1]}`)).toEqual(['subject:ar', 'material:m1', 'material:m2', 'subject:ma', 'material:m3']);
    const plan = planImport(state, exportSheet(state), { draft: false });
    expect(plan.errors).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.summary).toMatchObject({ rows: 5, unchanged: 5 });
  });

  it('applies marks on a published version and rejects incomplete ones', () => {
    // Row 1 is the header: rows 2–6 are subject ar, m1, m2, subject ma, m3.
    const csv = edited((set) => {
      set(3, 'verification_status', 'verified');
      set(3, 'verification_source', 'Ministerial Decree 123/2026');
      set(4, 'verification_status', 'needs_review');
    });
    const plan = planImport(state, csv, { draft: false });
    expect(plan.errors).toEqual([{ row: 4, code: 'sheet_review_note', params: {}, message: 'An entry that needs review needs verification_note' }]);
    expect(plan.changes[0]).toMatchObject({ row: 3, kind: 'material', id: 'm1', content: [], mark: { to: { status: 'verified', source: 'Ministerial Decree 123/2026' } } });
  });

  it('allows content changes and new materials only in drafts; content changes clear marks left untouched', () => {
    const csv = edited((set, records) => {
      set(6, 'title', 'Math book (2nd ed.)'); // m3 is verified; mark left as it was
      set(5, 'note', 'Revised'); // subject ma is verified; mark updated in the same row
      set(5, 'verification_source', 'Decree 2');
      records.push(['material', 'ar', '', '', '', '', '', '', '', '', '', 'ext', 'New workbook', 'unverified', '', '', '']);
    });
    expect(planImport(state, csv, { draft: false }).errors.map((e) => e.row)).toEqual([5, 6, 7]);
    const plan = planImport(state, csv, { draft: true });
    expect(plan.errors).toEqual([]);
    const byRow = Object.fromEntries(plan.changes.map((c) => [c.row, c]));
    expect(byRow[6]).toMatchObject({ content: [{ field: 'title', from: 'Math book', to: 'Math book (2nd ed.)' }], mark: null, markCleared: true });
    expect(byRow[5]).toMatchObject({ content: [{ field: 'note', from: null, to: 'Revised' }], markCleared: false, mark: { to: { source: 'Decree 2' } } });
    expect(byRow[7]).toMatchObject({ kind: 'material', id: null, subjectId: 'ar', values: { kind: 'ext', title: 'New workbook' } });
    expect(plan.summary).toMatchObject({ subjectsChanged: 1, materialsChanged: 1, materialsAdded: 1, marksChanged: 1, marksCleared: 1 });
  });

  it('round-trips a formula-looking title without reporting a change', () => {
    const csv = exportSheet(state);
    expect(csv).toContain("'=Formula-looking title");
    expect(planImport(state, csv, { draft: true }).changes).toEqual([]);
  });

  it('reports unknown ids, duplicates, moves, title clashes, bad values, encoding and missing columns', () => {
    const csv = edited((set, records) => {
      set(3, 'material_id', '00000000-0000-4000-8000-000000000000');
      records.push([...records[3]!]); // m2 twice (row 7)
      set(6, 'subject_id', 'ar'); // m3 moved to another subject
      set(5, 'grade', '13');
      records.push(['material', 'ar', '', '', '', '', '', '', '', '', '', 'moe', 'Ministry textbook', '', '', '', '']); // clashes with m1
      records.push(['subject', 'new', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    });
    const messages = planImport(state, csv, { draft: true }).errors.map((e) => `${e.row}: ${e.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      '3: Unknown material_id',
      '5: grade must be 1–12',
      '6: Moving a material to another subject is not supported',
      '7: This material appears twice',
      '8: Another material of this subject already has this title',
      '9: Unknown subject_id. New subjects are added in the editor.',
    ]));
    const missing = planImport(state, 'row_type,subject_id\nsubject,ar', { draft: true }).errors[0]!;
    expect(missing).toMatchObject({ row: 1, code: 'sheet_missing_columns', params: { columns: expect.stringMatching(/^material_id, grade, /) } });
    expect(missing.message).toMatch(/^Missing columns: material_id, grade/);
    expect(planImport(state, exportSheet(state).replace('Subject', 'Subj�ct'), { draft: true }).errors[0]).toMatchObject({ row: 0, code: 'not_utf8', message: expect.stringMatching(/not UTF-8/) });
    expect(planImport(state, 'row_type,subject_id\n"subject,ar', { draft: true }).errors[0]).toMatchObject({ row: 0, code: 'csv_quote' });
  });

  it('reads a semicolon-separated sheet saved by Excel in some locales', () => {
    const records = parseCsv(edited((set) => { set(2, 'verification_status', 'verified'); set(2, 'verification_source', 'Decree; 2026'); }));
    const semicolons = records.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
    const plan = planImport(state, semicolons, { draft: false });
    expect(plan.errors).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.mark!.to.source).toBe('Decree; 2026');
  });
});
