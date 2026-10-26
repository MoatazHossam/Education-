import { describe, expect, it } from 'vitest';
import { answerProblem, attemptDeadline, autoMark, newAccessCode, normalizeAnswer, questionProblem, shuffled } from '../../src/classroom/marking.js';

describe('online test marking', () => {
  it('normalises typed answers the way a teacher would accept them, in Arabic and English', () => {
    expect(normalizeAnswer('  The  Nile. ')).toBe('the nile');
    expect(normalizeAnswer('«القاهرة»')).toBe('القاهره');
    // Diacritics, tatweel, alef forms, ta marbuta, alef maqsura.
    expect(normalizeAnswer('الْقَاهِرَة')).toBe(normalizeAnswer('القاهره'));
    expect(normalizeAnswer('أسوان')).toBe(normalizeAnswer('اسوان'));
    expect(normalizeAnswer('إسماعيلية')).toBe(normalizeAnswer('اسماعيليه'));
    expect(normalizeAnswer('مصـــر')).toBe('مصر');
    expect(normalizeAnswer('مستشفى')).toBe(normalizeAnswer('مستشفي'));
    // Arabic-Indic digits and decimal separator.
    expect(normalizeAnswer('١٢٫٥')).toBe('12.5');
    expect(normalizeAnswer('۴۲')).toBe('42');
    expect(normalizeAnswer('?!')).toBe('');
  });

  it('marks each question type; multiple choice gives partial credit, never below zero', () => {
    expect(autoMark('single', 2, ['b'], 'b')).toBe(2);
    expect(autoMark('single', 2, ['b'], 'a')).toBe(0);
    expect(autoMark('true_false', 1, false, false)).toBe(1);
    expect(autoMark('true_false', 1, false, true)).toBe(0);
    expect(autoMark('multiple', 3, ['a', 'c'], ['a', 'c'])).toBe(3);
    expect(autoMark('multiple', 3, ['a', 'c'], ['a'])).toBe(1.5);
    expect(autoMark('multiple', 3, ['a', 'c'], ['a', 'b'])).toBe(0);
    expect(autoMark('multiple', 3, ['a', 'c'], ['a', 'b', 'd'])).toBe(0);
    expect(autoMark('multiple', 2, ['a', 'b', 'c'], ['a', 'b'])).toBe(1.33);
    expect(autoMark('short', 2, ['Aswan', 'أسوان'], 'اسوان')).toBe(2);
    expect(autoMark('short', 2, ['Aswan'], ' aswan. ')).toBe(2);
    expect(autoMark('short', 2, ['Aswan'], 'Luxor')).toBe(0);
    // Unanswered: 0. An answered essay waits for the teacher; an empty one scores 0.
    expect(autoMark('single', 2, ['b'], undefined)).toBe(0);
    expect(autoMark('essay', 5, { guide: null }, 'My essay')).toBeNull();
    expect(autoMark('essay', 5, { guide: null }, '   ')).toBe(0);
    expect(autoMark('essay', 5, { guide: null }, undefined)).toBe(0);
  });

  it('checks questions and answers before they are saved', () => {
    const opts = [{ id: 'a', text: 'Cairo' }, { id: 'b', text: 'Aswan' }];
    expect(questionProblem({ type: 'single', prompt: 'Capital?', options: opts, points: 1, key: ['a'] })).toBeNull();
    expect(questionProblem({ type: 'single', prompt: 'Capital?', options: opts, points: 1, key: ['a', 'b'] })).toMatch(/exactly one/);
    expect(questionProblem({ type: 'single', prompt: 'Capital?', options: [opts[0]!], points: 1, key: ['a'] })).toMatch(/2 to 10/);
    expect(questionProblem({ type: 'multiple', prompt: 'x', options: opts, points: 1, key: ['z'] })).toMatch(/correct choice/);
    expect(questionProblem({ type: 'true_false', prompt: 'x', options: [], points: 1, key: ['a'] })).toMatch(/true or false/);
    expect(questionProblem({ type: 'short', prompt: 'x', options: [], points: 1, key: [] })).toMatch(/1 to 20/);
    expect(questionProblem({ type: 'essay', prompt: 'x', options: [], points: 1.5, key: { guide: 'Mention two causes' } })).toBeNull();
    expect(questionProblem({ type: 'essay', prompt: 'x', options: [], points: 0, key: { guide: null } })).toMatch(/Points/);
    expect(answerProblem('single', opts, 'b')).toBeNull();
    expect(answerProblem('single', opts, 'z')).not.toBeNull();
    expect(answerProblem('multiple', opts, ['a', 'a'])).not.toBeNull();
    expect(answerProblem('true_false', [], 'true')).not.toBeNull();
    expect(answerProblem('short', [], 'x'.repeat(501))).not.toBeNull();
  });

  it('ends an attempt at the time limit or the test’s end, whichever comes first, plus extra time', () => {
    const start = new Date('2026-11-01T08:00:00Z');
    const test = { closes_at: new Date('2026-11-01T09:00:00Z'), closed_early_at: null, duration_minutes: 30 };
    expect(attemptDeadline(test, start, 0).toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect(attemptDeadline(test, new Date('2026-11-01T08:45:00Z'), 0).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(attemptDeadline(test, new Date('2026-11-01T08:45:00Z'), 10).toISOString()).toBe('2026-11-01T09:10:00.000Z');
    expect(attemptDeadline({ ...test, duration_minutes: null }, start, 0).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(attemptDeadline({ ...test, closed_early_at: new Date('2026-11-01T08:10:00Z') }, start, 0).toISOString()).toBe('2026-11-01T08:10:00.000Z');
  });

  it('shuffles without losing items and makes readable start codes', () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    const s = shuffled(list);
    expect([...s].sort((a, b) => a - b)).toEqual(list);
    expect(newAccessCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});
