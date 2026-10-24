import type { CatalogMaterial, CatalogSubject, CatalogTree } from '../catalog/service.js';

// Carrying a content scope from one catalogue version (usually last academic
// year) to another. Entries have new ids in every version, so selections are
// matched by natural key: a subject by grade, track, block and code (falling
// back to grade, track and code when the block was renamed and that is
// unambiguous on both sides); a material by exact title within its subject,
// then by title ignoring case and spacing.

export interface SubjectChange {
  field: 'nameEn' | 'nameAr' | 'block' | 'status' | 'note';
  from: string | null;
  to: string | null;
}

export interface CarrySubject {
  source: { id: string; grade: number; track: string; block: string; code: string; nameEn: string; nameAr: string };
  /** Null when the subject is not in the target version. */
  target: { id: string; nameEn: string; nameAr: string; status: string; verification: CatalogSubject['verification'] } | null;
  changes: SubjectChange[];
  /** Selected materials found in the target version. `renamedFrom` is set when only the loose title matched. */
  carried: { fromId: string; toId: string; title: string; kind: string; renamedFrom?: string }[];
  /** Selected materials with no counterpart in the target version. */
  missing: { fromId: string; title: string; kind: string }[];
  /** Target materials of this subject with no counterpart in the source version (new books, possible replacements). */
  added: { id: string; title: string; kind: string }[];
}

export interface CarryPlan {
  subjects: CarrySubject[];
  summary: { selected: number; carried: number; missing: number; added: number; subjectsChanged: number; subjectsRemoved: number };
}

const strictKey = (s: CatalogSubject) => `${s.grade}|${s.track}|${s.block}|${s.code}`;
const looseKey = (s: CatalogSubject) => `${s.grade}|${s.track}|${s.code}`;
const normTitle = (title: string) => title.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

function uniqueIndex<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const seen = new Map<string, T | null>();
  for (const it of items) seen.set(key(it), seen.has(key(it)) ? null : it);
  return new Map([...seen].filter((e): e is [string, T] => e[1] !== null));
}

/** Pairs each source material of a subject with at most one target material. */
function matchMaterials(from: CatalogMaterial[], to: CatalogMaterial[]): Map<string, { target: CatalogMaterial; loose: boolean }> {
  const pairs = new Map<string, { target: CatalogMaterial; loose: boolean }>();
  const used = new Set<string>();
  const exact = uniqueIndex(to, (m) => m.title);
  for (const m of from) {
    const t = exact.get(m.title);
    if (t) {
      pairs.set(m.id, { target: t, loose: false });
      used.add(t.id);
    }
  }
  const loose = uniqueIndex(to.filter((t) => !used.has(t.id)), (t) => normTitle(t.title));
  for (const m of from) {
    if (pairs.has(m.id)) continue;
    const t = loose.get(normTitle(m.title));
    if (t && !used.has(t.id)) {
      pairs.set(m.id, { target: t, loose: true });
      used.add(t.id);
    }
  }
  return pairs;
}

export function planCarryForward(source: CatalogTree, target: CatalogTree, selected: ReadonlySet<string>): CarryPlan {
  const byStrict = uniqueIndex(target.subjects, strictKey);
  const looseTarget = uniqueIndex(target.subjects, looseKey);
  const looseSource = uniqueIndex(source.subjects, looseKey);
  const subjects: CarrySubject[] = [];

  for (const s of source.subjects) {
    const picked = s.materials.filter((m) => selected.has(m.id));
    if (!picked.length) continue;
    const t = byStrict.get(strictKey(s)) ?? (looseSource.get(looseKey(s)) === s ? looseTarget.get(looseKey(s)) : undefined);
    const entry: CarrySubject = {
      source: { id: s.id, grade: s.grade, track: s.track, block: s.block, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr },
      target: t ? { id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, status: t.status, verification: t.verification } : null,
      changes: [],
      carried: [],
      missing: [],
      added: [],
    };
    if (!t) {
      entry.missing = picked.map((m) => ({ fromId: m.id, title: m.title, kind: m.kind }));
      subjects.push(entry);
      continue;
    }
    for (const field of ['nameEn', 'nameAr', 'block', 'status', 'note'] as const) {
      if ((s[field] ?? null) !== (t[field] ?? null)) entry.changes.push({ field, from: s[field] ?? null, to: t[field] ?? null });
    }
    const pairs = matchMaterials(s.materials, t.materials);
    for (const m of picked) {
      const p = pairs.get(m.id);
      if (p) entry.carried.push({ fromId: m.id, toId: p.target.id, title: p.target.title, kind: p.target.kind, ...(p.loose ? { renamedFrom: m.title } : {}) });
      else entry.missing.push({ fromId: m.id, title: m.title, kind: m.kind });
    }
    const matchedTargets = new Set([...pairs.values()].map((p) => p.target.id));
    entry.added = t.materials.filter((m) => !matchedTargets.has(m.id)).map((m) => ({ id: m.id, title: m.title, kind: m.kind }));
    subjects.push(entry);
  }

  const sum = (f: (s: CarrySubject) => number) => subjects.reduce((n, s) => n + f(s), 0);
  return {
    subjects,
    summary: {
      selected: sum((s) => s.carried.length + s.missing.length),
      carried: sum((s) => s.carried.length),
      missing: sum((s) => s.missing.length),
      added: sum((s) => s.added.length),
      subjectsChanged: subjects.filter((s) => s.changes.length).length,
      subjectsRemoved: subjects.filter((s) => !s.target).length,
    },
  };
}
