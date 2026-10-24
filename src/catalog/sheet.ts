import type { Selectable } from 'kysely';
import type { Executor } from '../db/index.js';
import type { CatalogMaterialsTable, CatalogSubjectsTable, VerificationStatus } from '../db/types.js';
import { CsvError, parseCsv, toCsv, unguardCell } from '../lib/csv.js';

// Spreadsheet round trip for one catalogue version: export every subject and
// material with its verification mark, edit in Excel, import with a preview.
// Imports may change verification marks on drafts and published versions, and
// content (plus new materials in existing subjects) on drafts only. Subjects are
// added and entries deleted in the editor, never by a spreadsheet.

export const SHEET_COLUMNS = [
  'row_type', 'subject_id', 'material_id', 'grade', 'track', 'block', 'code', 'name_en', 'name_ar', 'status', 'note',
  'kind', 'title', 'verification_status', 'verification_source', 'verification_url', 'verification_note',
] as const;
type Column = (typeof SHEET_COLUMNS)[number];

/** Column values of an entry without a mark; content edits reset marks to this. */
export const UNVERIFIED = { verification_status: 'unverified', verification_source: null, verification_url: null, verification_note: null, reviewed_by: null, reviewed_at: null } as const;

const TRACKS = ['moe', 'sec', 'bac', 'ta', 'intl'] as const;
const STATUSES = ['scored', 'pass', 'act'] as const;
const KINDS = ['moe', 'lang', 'ext', 'prog', 'exam'] as const;
const MARKS = ['unverified', 'verified', 'needs_review'] as const;
const MAX_ROWS = 20_000;

type SubjectRow = Selectable<CatalogSubjectsTable>;
type MaterialRow = Selectable<CatalogMaterialsTable>;

export interface SheetState {
  subjects: SubjectRow[];
  materials: MaterialRow[];
}

export interface Mark { status: VerificationStatus; source: string | null; url: string | null; note: string | null }
export interface FieldChange { field: string; from: string | number | null; to: string | number | null }
export interface RowChange {
  row: number;
  kind: 'subject' | 'material';
  /** Null for a material added by the sheet. */
  id: string | null;
  subjectId: string;
  label: string;
  content: FieldChange[];
  values: Record<string, string | number | null>;
  mark: { from: Mark; to: Mark } | null;
  /** Content changed while the mark was left as it was, so the mark is cleared. */
  markCleared: boolean;
}
export interface ImportPlan {
  changes: RowChange[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  summary: { rows: number; unchanged: number; subjectsChanged: number; materialsChanged: number; materialsAdded: number; marksChanged: number; marksCleared: number };
}

export async function loadSheetState(exec: Executor, versionId: string): Promise<SheetState> {
  const [subjects, materials] = await Promise.all([
    exec.selectFrom('catalog_subjects').selectAll().where('version_id', '=', versionId).orderBy('grade').orderBy('sort_order').orderBy('id').execute(),
    exec.selectFrom('catalog_materials').selectAll().where('version_id', '=', versionId).orderBy('sort_order').orderBy('id').execute(),
  ]);
  return { subjects, materials };
}

const markOf = (r: SubjectRow | MaterialRow): Mark => ({ status: r.verification_status, source: r.verification_source, url: r.verification_url, note: r.verification_note });

export function exportSheet(state: SheetState): string {
  const rows: (string | number | null)[][] = [[...SHEET_COLUMNS]];
  const bySubject = new Map<string, MaterialRow[]>();
  for (const m of state.materials) bySubject.set(m.subject_id, [...(bySubject.get(m.subject_id) ?? []), m]);
  const markCells = (r: SubjectRow | MaterialRow) => [r.verification_status, r.verification_source, r.verification_url, r.verification_note];
  for (const s of state.subjects) {
    rows.push(['subject', s.id, '', s.grade, s.track, s.block, s.code, s.name_en, s.name_ar, s.status, s.note, '', '', ...markCells(s)]);
    // Subject columns repeat on material rows so the sheet can be filtered; they are ignored on import.
    for (const m of bySubject.get(s.id) ?? []) {
      rows.push(['material', s.id, m.id, s.grade, s.track, s.block, s.code, s.name_en, s.name_ar, '', '', m.kind, m.title, ...markCells(m)]);
    }
  }
  return toCsv(rows);
}

const blankToNull = (v: string) => (v === '' ? null : v);
const sameMark = (a: Mark, b: Mark) => a.status === b.status && a.source === b.source && a.url === b.url && a.note === b.note;

export function planImport(state: SheetState, csvText: string, opts: { draft: boolean }): ImportPlan {
  const plan: ImportPlan = { changes: [], errors: [], warnings: [], summary: { rows: 0, unchanged: 0, subjectsChanged: 0, materialsChanged: 0, materialsAdded: 0, marksChanged: 0, marksCleared: 0 } };
  const fail = (row: number, message: string) => {
    plan.errors.push({ row, message });
  };
  if (csvText.includes('�')) {
    fail(0, 'The file is not UTF-8. In Excel, save it as "CSV UTF-8 (Comma delimited)".');
    return plan;
  }
  let records: string[][];
  try {
    records = parseCsv(csvText);
  } catch (err) {
    fail(0, err instanceof CsvError ? err.message : 'The file could not be read as CSV');
    return plan;
  }
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = SHEET_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    fail(1, `Missing columns: ${missing.join(', ')}. Start from a downloaded sheet.`);
    return plan;
  }
  if (records.length - 1 > MAX_ROWS) {
    fail(0, `The sheet has more than ${MAX_ROWS} rows`);
    return plan;
  }
  const col = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<Column, number>;

  const subjects = new Map(state.subjects.map((s) => [s.id, s]));
  const materials = new Map(state.materials.map((m) => [m.id, m]));
  const seen = new Set<string>();
  let ignoredContext = 0;

  for (let i = 1; i < records.length; i++) {
    const row = i + 1;
    const get = (c: Column) => unguardCell((records[i]![col[c]] ?? '').trim());
    plan.summary.rows++;
    const type = get('row_type').toLowerCase();
    if (type !== 'subject' && type !== 'material') {
      fail(row, 'row_type must be "subject" or "material"');
      continue;
    }
    const subject = subjects.get(get('subject_id'));
    if (!subject) {
      fail(row, type === 'subject' ? 'Unknown subject_id. New subjects are added in the editor.' : 'Unknown subject_id');
      continue;
    }

    // Verification columns, shared by both row types.
    const mark: Mark = { status: (get('verification_status').toLowerCase() || 'unverified') as VerificationStatus, source: blankToNull(get('verification_source')), url: blankToNull(get('verification_url')), note: blankToNull(get('verification_note')) };
    const rowErrors: string[] = [];
    if (!MARKS.includes(mark.status)) rowErrors.push('verification_status must be unverified, verified or needs_review');
    if (mark.status === 'unverified') Object.assign(mark, { source: null, url: null, note: null });
    if (mark.status === 'verified' && !mark.source) rowErrors.push('A verified entry needs verification_source');
    if (mark.status === 'needs_review' && !mark.note) rowErrors.push('An entry that needs review needs verification_note');
    if (mark.source && mark.source.length > 300) rowErrors.push('verification_source is longer than 300 characters');
    if (mark.note && mark.note.length > 1000) rowErrors.push('verification_note is longer than 1000 characters');
    if (mark.url && (!/^https?:\/\/\S+$/.test(mark.url) || mark.url.length > 2000)) rowErrors.push('verification_url must be an http(s) link');

    let change: RowChange;
    if (type === 'subject') {
      if (seen.has(subject.id)) rowErrors.push('This subject appears twice');
      seen.add(subject.id);
      const grade = Number(get('grade'));
      const v = { grade, track: get('track'), block: get('block'), code: get('code'), name_en: get('name_en'), name_ar: get('name_ar'), status: get('status'), note: blankToNull(get('note')) };
      if (!Number.isInteger(grade) || grade < 1 || grade > 12) rowErrors.push('grade must be 1–12');
      if (!(TRACKS as readonly string[]).includes(v.track)) rowErrors.push(`track must be one of ${TRACKS.join(', ')}`);
      if (!(STATUSES as readonly string[]).includes(v.status)) rowErrors.push(`status must be one of ${STATUSES.join(', ')}`);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(v.code)) rowErrors.push('code must be 1–40 letters, digits, - or _');
      for (const [f, max] of [['block', 300], ['name_en', 200], ['name_ar', 200]] as const) if (!v[f] || v[f].length > max) rowErrors.push(`${f} must be 1–${max} characters`);
      if (v.note && v.note.length > 1000) rowErrors.push('note is longer than 1000 characters');
      const content = (Object.keys(v) as (keyof typeof v)[]).filter((f) => v[f] !== subject[f]).map((f) => ({ field: f, from: subject[f], to: v[f] }));
      change = { row, kind: 'subject', id: subject.id, subjectId: subject.id, label: `Grade ${subject.grade} · ${subject.name_en}`, content, values: v, mark: null, markCleared: false };
      if (!sameMark(markOf(subject), mark)) change.mark = { from: markOf(subject), to: mark };
    } else {
      const id = get('material_id');
      const existing = id ? materials.get(id) : undefined;
      if (id && !existing) {
        fail(row, 'Unknown material_id');
        continue;
      }
      if (existing && existing.subject_id !== subject.id) rowErrors.push('Moving a material to another subject is not supported');
      if (existing) {
        if (seen.has(existing.id)) rowErrors.push('This material appears twice');
        seen.add(existing.id);
      }
      const v = { kind: get('kind'), title: get('title') };
      if (!(KINDS as readonly string[]).includes(v.kind)) rowErrors.push(`kind must be one of ${KINDS.join(', ')}`);
      if (!v.title || v.title.length > 300) rowErrors.push('title must be 1–300 characters');
      const context = { grade: String(subject.grade), track: subject.track, block: subject.block, code: subject.code, name_en: subject.name_en, name_ar: subject.name_ar } as const;
      if ((Object.keys(context) as (keyof typeof context)[]).some((f) => get(f) !== '' && get(f) !== context[f]) || get('status') || get('note')) ignoredContext++;
      const content = existing
        ? (['kind', 'title'] as const).filter((f) => v[f] !== existing[f]).map((f) => ({ field: f, from: existing[f], to: v[f] }))
        : [{ field: 'kind', from: null, to: v.kind }, { field: 'title', from: null, to: v.title }];
      change = { row, kind: 'material', id: existing?.id ?? null, subjectId: subject.id, label: v.title || existing?.title || '', content, values: v, mark: null, markCleared: false };
      const from: Mark = existing ? markOf(existing) : { status: 'unverified', source: null, url: null, note: null };
      if (!sameMark(from, mark)) change.mark = { from, to: mark };
    }

    if (change.content.length && !opts.draft) rowErrors.push(`Published versions are read-only: only the verification columns can change (${change.content.map((c) => c.field).join(', ')} changed)`);
    for (const message of rowErrors) fail(row, message);
    if (!change.content.length && !change.mark) {
      plan.summary.unchanged++;
      continue;
    }
    // Content changes clear an existing mark unless the same row also updates the mark.
    if (change.id && change.content.length && !change.mark) {
      const current = change.kind === 'subject' ? subjects.get(change.id)! : materials.get(change.id)!;
      change.markCleared = current.verification_status !== 'unverified';
    }
    plan.changes.push(change);
  }
  if (ignoredContext) plan.warnings.push({ row: 0, message: `${ignoredContext} material rows have edited subject columns; those are ignored. Change subjects on their subject rows.` });

  // Natural keys must stay unique after the changes.
  const changed = new Map(plan.changes.filter((c) => c.id).map((c) => [c.id!, c]));
  const subjectKeys = new Map<string, number>();
  const subjectKey = (s: SubjectRow) => {
    const v = (changed.get(s.id)?.values ?? s) as Record<string, string | number | null>;
    return `${v.grade}|${v.track}|${v.block}|${v.code}`;
  };
  for (const s of state.subjects) subjectKeys.set(subjectKey(s), (subjectKeys.get(subjectKey(s)) ?? 0) + 1);
  for (const c of plan.changes.filter((x) => x.kind === 'subject')) {
    if ((subjectKeys.get(subjectKey(subjects.get(c.id!)!)) ?? 0) > 1) fail(c.row, 'Another subject in this grade and track already has this block and code');
  }
  const titles = new Map<string, number>();
  for (const m of state.materials) {
    const key = `${m.subject_id}|${changed.get(m.id)?.values.title ?? m.title}`;
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  for (const c of plan.changes.filter((x) => x.kind === 'material' && !x.id)) {
    const key = `${c.subjectId}|${c.values.title}`;
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  for (const c of plan.changes.filter((x) => x.kind === 'material')) {
    if ((titles.get(`${c.subjectId}|${c.values.title}`) ?? 0) > 1) fail(c.row, 'Another material of this subject already has this title');
  }

  plan.errors.sort((a, b) => a.row - b.row);
  for (const c of plan.changes) {
    if (c.kind === 'subject' && c.content.length) plan.summary.subjectsChanged++;
    if (c.kind === 'material' && c.id && c.content.length) plan.summary.materialsChanged++;
    if (c.kind === 'material' && !c.id) plan.summary.materialsAdded++;
    if (c.mark) plan.summary.marksChanged++;
    if (c.markCleared) plan.summary.marksCleared++;
  }
  return plan;
}

/**
 * Writes a plan without errors. Returns the materials newly flagged for review,
 * grouped by note (directly or through their subject), for customer notifications.
 */
export async function applyImport(exec: Executor, versionId: string, plan: ImportPlan, reviewerId: string | null): Promise<Map<string, string[]>> {
  const now = new Date();
  const markValues = (m: Mark) =>
    m.status === 'unverified' ? UNVERIFIED : { verification_status: m.status, verification_source: m.source, verification_url: m.url, verification_note: m.note, reviewed_by: reviewerId, reviewed_at: now };
  const flagged = new Map<string, string[]>();
  const flag = (note: string, ids: string[]) => flagged.set(note, [...(flagged.get(note) ?? []), ...ids]);
  const isNewFlag = (c: RowChange) => c.mark && c.mark.to.status === 'needs_review' && (c.mark.from.status !== 'needs_review' || c.mark.from.note !== c.mark.to.note);
  const nextOrder = new Map<string, number>();

  for (const c of plan.changes) {
    const mark = c.mark ? markValues(c.mark.to) : c.markCleared ? UNVERIFIED : {};
    if (c.kind === 'subject') {
      const v = c.values as { grade: number; track: (typeof TRACKS)[number]; block: string; code: string; name_en: string; name_ar: string; status: (typeof STATUSES)[number]; note: string | null };
      const content = Object.fromEntries(c.content.map((f) => [f.field, v[f.field as keyof typeof v]]));
      await exec.updateTable('catalog_subjects').set({ ...content, ...mark }).where('id', '=', c.id!).where('version_id', '=', versionId).execute();
      if (isNewFlag(c)) {
        const ofSubject = await exec.selectFrom('catalog_materials').select('id').where('subject_id', '=', c.id!).execute();
        flag(c.mark!.to.note!, ofSubject.map((m) => m.id));
      }
      continue;
    }
    const v = c.values as { kind: (typeof KINDS)[number]; title: string };
    let id = c.id;
    if (id) {
      const content = Object.fromEntries(c.content.map((f) => [f.field, v[f.field as keyof typeof v]]));
      await exec.updateTable('catalog_materials').set({ ...content, ...mark }).where('id', '=', id).where('version_id', '=', versionId).execute();
    } else {
      if (!nextOrder.has(c.subjectId)) {
        const max = await exec.selectFrom('catalog_materials').select((eb) => eb.fn.max('sort_order').as('m')).where('subject_id', '=', c.subjectId).executeTakeFirst();
        nextOrder.set(c.subjectId, Number(max?.m ?? -1) + 1);
      }
      const sortOrder = nextOrder.get(c.subjectId)!;
      nextOrder.set(c.subjectId, sortOrder + 1);
      const row = await exec
        .insertInto('catalog_materials')
        .values({ subject_id: c.subjectId, version_id: versionId, kind: v.kind, title: v.title, sort_order: sortOrder, ...mark })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    }
    if (isNewFlag(c)) flag(c.mark!.to.note!, [id]);
  }
  return flagged;
}
