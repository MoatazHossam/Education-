import { describe, expect, it } from 'vitest';
import type { CatalogSubject, CatalogTree } from '../../src/catalog/service.js';
import { compareScopes } from '../../src/scopes/compare.js';

type Mat = [id: string, title: string, kind?: string];
function subject(id: string, over: Partial<CatalogSubject>, mats: Mat[]): CatalogSubject {
  return {
    id, grade: 10, track: 'bac', block: 'Bakaloria — core', code: 'ar', nameEn: 'Arabic', nameAr: 'اللغة العربية', status: 'scored', note: null, verification: null,
    materials: mats.map(([mid, title, kind]) => ({ id: mid, title, kind: (kind ?? 'moe') as CatalogSubject['materials'][number]['kind'], verification: null })),
    ...over,
  };
}
function tree(versionId: string, subjects: CatalogSubject[]): CatalogTree {
  return {
    version: { id: versionId, academicYear: '2026/2027', label: '', status: 'published', notice: null, gradeNotes: {}, publishedAt: null, updatedAt: new Date() },
    grades: [], sources: [], subjects, counts: { subjects: subjects.length, materials: 0, verification: { subjectsVerified: 0, subjectsNeedReview: 0, materialsVerified: 0, materialsNeedReview: 0 } },
  };
}

describe('comparing two scopes', () => {
  it('on one catalogue version: only in A, only in B, in both; untouched subjects are left out', () => {
    const t = tree('v1', [
      subject('s-ma', { grade: 4, code: 'ma', nameEn: 'Mathematics' }, [['m1', 'Ministry textbook'], ['m2', 'Workbook', 'ext'], ['m3', 'El-Moaser', 'ext']]),
      subject('s-ar', { grade: 4 }, [['a1', 'Ministry textbook']]),
      subject('s-sc', { grade: 2, code: 'sc', nameEn: 'Science' }, [['c1', 'Ministry textbook']]),
    ]);
    const cmp = compareScopes(t, new Set(['m1', 'm2', 'c1']), t, new Set(['m2', 'm3']));
    expect(cmp.sameVersion).toBe(true);
    expect(cmp.subjects.map((s) => `${s.grade} ${s.nameEn}`)).toEqual(['2 Science', '4 Mathematics']);
    expect(cmp.subjects[1]!.materials.map((m) => `${m.title}:${m.side}`)).toEqual(['Ministry textbook:a', 'Workbook:both', 'El-Moaser:b']);
    expect(cmp.subjects[1]!.materials.every((m) => !m.notInOtherCatalog && !m.titleInB)).toBe(true);
    expect(cmp.summary).toEqual({ onlyA: 2, onlyB: 1, both: 1 });
  });

  it('across catalogue versions: matched by subject and title, with renamed and missing books and subjects marked', () => {
    const lastYear = tree('v1', [
      subject('s-ar', {}, [['a1', 'Ministry textbook'], ['a2', 'Al-Adwaa', 'ext'], ['a3', 'El-Emtehan', 'ext']]),
      subject('s-ma', { code: 'ma', nameEn: 'Mathematics', block: 'Bakaloria — science' }, [['m1', 'Ministry textbook']]),
      subject('s-ph', { code: 'ph', nameEn: 'Philosophy' }, [['p1', 'Ministry book']]),
    ]);
    const thisYear = tree('v2', [
      subject('t-ar', {}, [['b1', 'Ministry textbook'], ['b2', 'al-adwaa  ', 'ext'], ['b3', 'El-Emtehan 2027', 'ext']]),
      subject('t-ma', { code: 'ma', nameEn: 'Mathematics', block: 'Bakaloria — first-year science' }, [['n1', 'Ministry textbook']]),
      subject('t-ps', { grade: 11, code: 'ps', nameEn: 'Psychology' }, [['q1', 'Ministry book']]),
    ]);
    const cmp = compareScopes(lastYear, new Set(['a1', 'a2', 'a3', 'm1', 'p1']), thisYear, new Set(['b1', 'b2', 'b3', 'q1']));
    expect(cmp.sameVersion).toBe(false);
    const ar = cmp.subjects.find((s) => s.code === 'ar')!;
    expect(ar.materials).toEqual([
      { title: 'Ministry textbook', kind: 'moe', side: 'both', aId: 'a1', bId: 'b1' },
      { title: 'Al-Adwaa', kind: 'ext', side: 'both', aId: 'a2', bId: 'b2', titleInB: 'al-adwaa  ' },
      { title: 'El-Emtehan', kind: 'ext', side: 'a', aId: 'a3', bId: null, notInOtherCatalog: true },
      { title: 'El-Emtehan 2027', kind: 'ext', side: 'b', aId: null, bId: 'b3', notInOtherCatalog: true },
    ]);
    // Block renamed: still the same subject; this year's scope left it out.
    expect(cmp.subjects.find((s) => s.code === 'ma')!.materials).toEqual([{ title: 'Ministry textbook', kind: 'moe', side: 'a', aId: 'm1', bId: 'n1' }]);
    expect(cmp.subjects.find((s) => s.code === 'ph')).toMatchObject({ onlyIn: 'a', materials: [{ side: 'a', notInOtherCatalog: true }] });
    expect(cmp.subjects.find((s) => s.code === 'ps')).toMatchObject({ onlyIn: 'b', grade: 11, materials: [{ side: 'b', bId: 'q1' }] });
    expect(cmp.subjects.map((s) => s.code)).toEqual(['ar', 'ma', 'ph', 'ps']);
    expect(cmp.summary).toEqual({ onlyA: 3, onlyB: 2, both: 2 });
  });
});
