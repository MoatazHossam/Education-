import type { CatalogMaterial, CatalogSubject, CatalogTree } from '../catalog/service.js';

// Matching entries between two catalogue versions. Entries have new ids in every
// version, so they are matched by natural key: a subject by grade, track, block
// and code (falling back to grade, track and code when the block was renamed and
// that is unambiguous on both sides); a material by exact title within its
// subject, then by title ignoring case and spacing.

const strictKey = (s: CatalogSubject) => `${s.grade}|${s.track}|${s.block}|${s.code}`;
const looseKey = (s: CatalogSubject) => `${s.grade}|${s.track}|${s.code}`;
const normTitle = (title: string) => title.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

function uniqueIndex<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const seen = new Map<string, T | null>();
  for (const it of items) seen.set(key(it), seen.has(key(it)) ? null : it);
  return new Map([...seen].filter((e): e is [string, T] => e[1] !== null));
}

/** Finds a source subject's counterpart in the target version, if any. */
export function subjectMatcher(source: CatalogTree, target: CatalogTree): (s: CatalogSubject) => CatalogSubject | undefined {
  const byStrict = uniqueIndex(target.subjects, strictKey);
  const looseTarget = uniqueIndex(target.subjects, looseKey);
  const looseSource = uniqueIndex(source.subjects, looseKey);
  return (s) => byStrict.get(strictKey(s)) ?? (looseSource.get(looseKey(s)) === s ? looseTarget.get(looseKey(s)) : undefined);
}

/** Pairs each source material of a subject with at most one target material. */
export function matchMaterials(from: CatalogMaterial[], to: CatalogMaterial[]): Map<string, { target: CatalogMaterial; loose: boolean }> {
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
