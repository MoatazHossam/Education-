import { describe, expect, it } from 'vitest';
import type { CatalogSubject, CatalogTree } from '../../src/catalog/service.js';
import { planCarryForward } from '../../src/scopes/carry.js';

type Mat = [id: string, title: string, kind?: string];
function subject(id: string, over: Partial<CatalogSubject>, mats: Mat[]): CatalogSubject {
  return {
    id, grade: 10, track: 'bac', block: 'Bakaloria — core', code: 'ar', nameEn: 'Arabic', nameAr: 'اللغة العربية', status: 'scored', note: null, verification: null,
    materials: mats.map(([mid, title, kind]) => ({ id: mid, title, kind: (kind ?? 'moe') as CatalogSubject['materials'][number]['kind'], verification: null })),
    ...over,
  };
}
function tree(subjects: CatalogSubject[]): CatalogTree {
  return {
    version: { id: 'v', academicYear: '2026/2027', label: '', status: 'published', notice: null, gradeNotes: {}, publishedAt: null, updatedAt: new Date() },
    grades: [], sources: [], subjects, counts: { subjects: subjects.length, materials: 0, verification: { subjectsVerified: 0, subjectsNeedReview: 0, materialsVerified: 0, materialsNeedReview: 0 } },
  };
}

describe('carry forward: matching a scope to another catalogue version', () => {
  const source = tree([
    subject('s-ar', {}, [['a1', 'Ministry textbook'], ['a2', 'Al-Adwaa', 'ext'], ['a3', 'El-Emtehan', 'ext']]),
    subject('s-ma', { code: 'ma', nameEn: 'Mathematics', nameAr: 'الرياضيات', block: 'Bakaloria — science' }, [['m1', 'Ministry textbook'], ['m2', 'Sela7 El-Telmeez', 'ext']]),
    subject('s-ph', { code: 'ph', nameEn: 'Philosophy' }, [['p1', 'Ministry book']]),
    subject('s-un', { code: 'un' }, [['u1', 'Not selected']]),
  ]);
  const target = tree([
    // Same key; one book renamed only in case/spacing, one replaced by a new edition, a new book added.
    subject('t-ar', { status: 'pass', note: 'Now pass/fail' }, [['b1', 'Ministry textbook'], ['b2', 'al-adwaa  ', 'ext'], ['b3', 'El-Emtehan 2027', 'ext'], ['b4', 'Qatr El-Nada', 'ext']]),
    // Block renamed: matched by grade + track + code.
    subject('t-ma', { code: 'ma', nameEn: 'Mathematics', nameAr: 'الرياضيات', block: 'Bakaloria — first-year science' }, [['n1', 'Ministry textbook'], ['n2', 'Sela7 El-Telmeez', 'ext']]),
    // Philosophy removed.
  ]);
  const selected = new Set(['a1', 'a2', 'a3', 'm1', 'm2', 'p1']);
  const plan = planCarryForward(source, target, selected);

  it('carries exact and loosely matching titles, and lists missing books with new candidates', () => {
    const ar = plan.subjects.find((s) => s.source.id === 's-ar')!;
    expect(ar.target?.id).toBe('t-ar');
    expect(ar.carried).toEqual([
      { fromId: 'a1', toId: 'b1', title: 'Ministry textbook', kind: 'moe' },
      { fromId: 'a2', toId: 'b2', title: 'al-adwaa  ', kind: 'ext', renamedFrom: 'Al-Adwaa' },
    ]);
    expect(ar.missing).toEqual([{ fromId: 'a3', title: 'El-Emtehan', kind: 'ext' }]);
    expect(ar.added.map((m) => m.id)).toEqual(['b3', 'b4']);
    expect(ar.changes).toEqual([
      { field: 'status', from: 'scored', to: 'pass' },
      { field: 'note', from: null, to: 'Now pass/fail' },
    ]);
  });

  it('follows a subject whose block was renamed when its code is unambiguous', () => {
    const ma = plan.subjects.find((s) => s.source.id === 's-ma')!;
    expect(ma.target?.id).toBe('t-ma');
    expect(ma.carried.map((c) => c.toId)).toEqual(['n1', 'n2']);
    expect(ma.changes).toEqual([{ field: 'block', from: 'Bakaloria — science', to: 'Bakaloria — first-year science' }]);
  });

  it('reports removed subjects, ignores unselected ones, and summarises', () => {
    const ph = plan.subjects.find((s) => s.source.id === 's-ph')!;
    expect(ph.target).toBeNull();
    expect(ph.missing.map((m) => m.fromId)).toEqual(['p1']);
    expect(plan.subjects.some((s) => s.source.id === 's-un')).toBe(false);
    expect(plan.summary).toEqual({ selected: 6, carried: 4, missing: 2, added: 2, subjectsChanged: 2, subjectsRemoved: 1 });
  });

  it('does not guess when the loose subject key is ambiguous', () => {
    const src = tree([subject('x1', { block: 'Old A' }, [['x', 'Book']]), subject('x2', { block: 'Old B' }, [['y', 'Book']])]);
    const dst = tree([subject('z1', { block: 'New A' }, [['z', 'Book']])]);
    const p = planCarryForward(src, dst, new Set(['x', 'y']));
    expect(p.subjects.every((s) => s.target === null)).toBe(true);
    expect(p.summary.carried).toBe(0);
  });
});
