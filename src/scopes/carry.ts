import type { CatalogSubject, CatalogTree } from '../catalog/service.js';
import { matchMaterials, subjectMatcher } from './match.js';

// Carrying a content scope from one catalogue version (usually last academic
// year) to another. Selections are matched by natural key (match.ts).

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

export function planCarryForward(source: CatalogTree, target: CatalogTree, selected: ReadonlySet<string>): CarryPlan {
  const counterpart = subjectMatcher(source, target);
  const subjects: CarrySubject[] = [];

  for (const s of source.subjects) {
    const picked = s.materials.filter((m) => selected.has(m.id));
    if (!picked.length) continue;
    const t = counterpart(s);
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
