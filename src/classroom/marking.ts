import { randomInt } from 'node:crypto';
import type { AnswerKey, GivenAnswer, QuestionOption, QuestionType } from '../db/types.js';

// Rules for online tests (docs/ONLINE_TESTS.md §4): what a question and an
// answer may hold, how answers are marked automatically, and when a student's
// time runs out. Pure functions; no AI is involved in marking.

const OPTION_ID = /^[a-j]$/;
const EDGE_PUNCTUATION = /^[\s.,;:!?،؛؟"'«»()[\]\-–—]+|[\s.,;:!?،؛؟"'«»()[\]\-–—]+$/g;

/**
 * Normalises a typed answer so that spelling variants a teacher would accept
 * compare equal: case, spaces, edge punctuation, Arabic diacritics and
 * tatweel, alef forms (أ إ آ ٱ → ا), ى → ي, ة → ه, and Arabic-Indic digits.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .trim();
}

export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  points: number;
  key: AnswerKey;
}

/** Why a question cannot be saved, or null. */
export function questionProblem(q: QuestionInput): string | null {
  if (!q.prompt.trim()) return 'The question needs text';
  if (!(q.points > 0) || Math.round(q.points * 100) !== q.points * 100) return 'Points must be above 0, with at most two decimals';
  const choice = q.type === 'single' || q.type === 'multiple';
  if (choice) {
    if (q.options.length < 2 || q.options.length > 10) return 'Give 2 to 10 choices';
    const ids = q.options.map((o) => o.id);
    if (ids.some((id) => !OPTION_ID.test(id)) || new Set(ids).size !== ids.length) return 'Choices need distinct ids a to j';
    if (q.options.some((o) => !o.text.trim() || o.text.length > 500)) return 'Each choice needs text (at most 500 characters)';
    if (!Array.isArray(q.key) || q.key.some((k) => typeof k !== 'string' || !ids.includes(k)) || new Set(q.key).size !== q.key.length) return 'Mark the correct choice';
    if (q.type === 'single' && q.key.length !== 1) return 'Mark exactly one correct choice';
    if (q.type === 'multiple' && q.key.length < 1) return 'Mark at least one correct choice';
    return null;
  }
  if (q.options.length) return 'Only choice questions have choices';
  if (q.type === 'true_false') return typeof q.key === 'boolean' ? null : 'Say whether the statement is true or false';
  if (q.type === 'short') {
    if (!Array.isArray(q.key) || q.key.length < 1 || q.key.length > 20) return 'Give 1 to 20 accepted answers';
    if (q.key.some((k) => typeof k !== 'string' || !normalizeAnswer(k) || k.length > 200)) return 'Accepted answers need text (at most 200 characters)';
    return null;
  }
  // essay
  if (typeof q.key !== 'object' || q.key === null || Array.isArray(q.key)) return 'Invalid marking guide';
  const guide = (q.key as { guide: unknown }).guide;
  return guide === null || (typeof guide === 'string' && guide.length <= 2000) ? null : 'The marking guide can be at most 2,000 characters';
}

/** Whether a student's answer has the right shape for the question (else it is refused, not marked). */
export function answerProblem(type: QuestionType, options: QuestionOption[], answer: unknown): string | null {
  const ids = options.map((o) => o.id);
  switch (type) {
    case 'single':
      return typeof answer === 'string' && ids.includes(answer) ? null : 'Choose one of the choices';
    case 'multiple':
      return Array.isArray(answer) && answer.length <= ids.length && answer.every((a) => typeof a === 'string' && ids.includes(a)) && new Set(answer).size === answer.length
        ? null
        : 'Choose among the choices';
    case 'true_false':
      return typeof answer === 'boolean' ? null : 'Choose true or false';
    case 'short':
      return typeof answer === 'string' && answer.length <= 500 ? null : 'Answers can be at most 500 characters';
    case 'essay':
      return typeof answer === 'string' && answer.length <= 10_000 ? null : 'Answers can be at most 10,000 characters';
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Points for an answer, or null when a teacher must mark it (an answered essay).
 * Multiple choice gives partial credit: (right choices − wrong choices) ÷ correct
 * choices, never below 0. A missing answer scores 0.
 */
export function autoMark(type: QuestionType, points: number, key: AnswerKey, answer: GivenAnswer | undefined): number | null {
  if (type === 'essay') return answer === undefined || (typeof answer === 'string' && !answer.trim()) ? 0 : null;
  if (answer === undefined) return 0;
  switch (type) {
    case 'single':
      return Array.isArray(key) && key[0] === answer ? points : 0;
    case 'true_false':
      return answer === key ? points : 0;
    case 'multiple': {
      if (!Array.isArray(key) || !Array.isArray(answer) || !key.length) return 0;
      const right = answer.filter((a) => key.includes(a)).length;
      const wrong = answer.length - right;
      return round2(Math.max(0, ((right - wrong) / key.length) * points));
    }
    case 'short': {
      if (!Array.isArray(key) || typeof answer !== 'string') return 0;
      const given = normalizeAnswer(answer);
      return given && key.some((k) => normalizeAnswer(k) === given) ? points : 0;
    }
  }
}

/** When an attempt must end: the time limit from its start or the test's end, whichever is first, plus extra time. */
export function attemptDeadline(test: { closes_at: Date; closed_early_at: Date | null; duration_minutes: number | null }, startedAt: Date, extraMinutes: number): Date {
  const end = test.closed_early_at && test.closed_early_at < test.closes_at ? test.closed_early_at : test.closes_at;
  const limit = test.duration_minutes ? new Date(startedAt.getTime() + test.duration_minutes * 60_000) : end;
  const base = limit < end ? limit : end;
  return new Date(base.getTime() + extraMinutes * 60_000);
}

export function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A start code to read out in the room: 6 characters without look-alikes. */
export function newAccessCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}
