import type { CatalogSubject, CatalogTree } from '../catalog/service.js';
import { toCsv } from '../lib/csv.js';
import { matchMaterials, subjectMatcher } from './match.js';

// Comparing two content scopes of one organization. On the same catalogue
// version materials are compared by id; across versions (e.g. last year's plan
// against this year's) they are matched by natural key (match.ts), so a book
// renamed only in case or spacing still counts as the same book.

export type Side = 'a' | 'b' | 'both';

export interface ComparedMaterial {
  title: string;
  kind: string;
  side: Side;
  aId: string | null;
  bId: string | null;
  /** The title in B's catalogue when it differs (renamed in case or spacing). */
  titleInB?: string;
  /** Across versions: the book has no counterpart in the other scope's catalogue. */
  notInOtherCatalog?: true;
}

export interface ComparedSubject {
  grade: number;
  track: string;
  block: string;
  code: string;
  nameEn: string;
  nameAr: string;
  /** Across versions: the subject exists only in this scope's catalogue. */
  onlyIn?: 'a' | 'b';
  materials: ComparedMaterial[];
}

export interface Comparison {
  sameVersion: boolean;
  subjects: ComparedSubject[];
  summary: { onlyA: number; onlyB: number; both: number };
}

const info = (s: CatalogSubject) => ({ grade: s.grade, track: s.track, block: s.block, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr });

/** Every subject with a selected material in either scope, in catalogue order by grade. */
export function compareScopes(treeA: CatalogTree, selA: ReadonlySet<string>, treeB: CatalogTree, selB: ReadonlySet<string>): Comparison {
  const sameVersion = treeA.version.id === treeB.version.id;
  const counterpart = sameVersion ? (s: CatalogSubject) => s : subjectMatcher(treeA, treeB);
  const matchedB = new Set<string>();
  const subjects: ComparedSubject[] = [];

  for (const sa of treeA.subjects) {
    const sb = counterpart(sa);
    if (sb) matchedB.add(sb.id);
    const pairs = !sb ? new Map() : sameVersion ? new Map(sa.materials.map((m) => [m.id, { target: m, loose: false }])) : matchMaterials(sa.materials, sb.materials);
    const materials: ComparedMaterial[] = [];
    for (const m of sa.materials) {
      const p = pairs.get(m.id);
      const inA = selA.has(m.id);
      const inB = p ? selB.has(p.target.id) : false;
      if (!inA && !inB) continue;
      materials.push({
        title: m.title, kind: m.kind, side: inA && inB ? 'both' : inA ? 'a' : 'b', aId: m.id, bId: p?.target.id ?? null,
        ...(p && p.target.title !== m.title ? { titleInB: p.target.title } : {}),
        ...(p ? {} : { notInOtherCatalog: true as const }),
      });
    }
    if (sb) {
      const paired = new Set([...pairs.values()].map((p) => p.target.id));
      for (const t of sb.materials) {
        if (!paired.has(t.id) && selB.has(t.id)) materials.push({ title: t.title, kind: t.kind, side: 'b', aId: null, bId: t.id, notInOtherCatalog: true });
      }
    }
    if (materials.length) subjects.push({ ...info(sa), ...(sb ? {} : { onlyIn: 'a' as const }), materials });
  }
  for (const sb of treeB.subjects) {
    if (matchedB.has(sb.id)) continue;
    const materials = sb.materials.filter((m) => selB.has(m.id)).map((m): ComparedMaterial => ({ title: m.title, kind: m.kind, side: 'b', aId: null, bId: m.id, notInOtherCatalog: true }));
    if (materials.length) subjects.push({ ...info(sb), onlyIn: 'b', materials });
  }
  subjects.sort((x, y) => x.grade - y.grade); // stable: catalogue order within a grade, B-only subjects last

  const count = (side: Side) => subjects.reduce((n, s) => n + s.materials.filter((m) => m.side === side).length, 0);
  return { sameVersion, subjects, summary: { onlyA: count('a'), onlyB: count('b'), both: count('both') } };
}

/** The comparison as a spreadsheet: one row per material, a yes/no column per scope. */
export function comparisonCsv(cmp: Comparison, a: { name: string; academicYear: string }, b: { name: string; academicYear: string }): string {
  const note = (m: ComparedMaterial) =>
    m.titleInB ? `Titled "${m.titleInB}" in ${b.name}`
      : m.notInOtherCatalog ? `Not in the ${m.side === 'a' ? b.academicYear : a.academicYear} catalogue` : '';
  const rows: (string | number)[][] = [['grade', 'track', 'block', 'subject', 'subject_ar', 'material', 'kind', `${a.name} (${a.academicYear})`, `${b.name} (${b.academicYear})`, 'note']];
  for (const s of cmp.subjects) {
    for (const m of s.materials) {
      rows.push([s.grade, s.track, s.block, s.nameEn, s.nameAr, m.title, m.kind, m.side === 'b' ? 'no' : 'yes', m.side === 'a' ? 'no' : 'yes', note(m)]);
    }
  }
  return toCsv(rows);
}
