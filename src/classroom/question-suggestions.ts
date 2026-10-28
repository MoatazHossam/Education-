import { z } from 'zod';
import type { AnswerKey, QuestionOption, QuestionType } from '../db/types.js';
import { questionProblem } from './marking.js';

// Questions suggested by the AI provider for a test (docs/ONLINE_TESTS.md §14).
// The teacher gives a topic and, optionally, the lesson text; the provider
// writes questions in the shape below; each one is turned into the test's own
// question form and checked by the same rules as a question typed by hand.
// Nothing is saved here: the teacher reviews the suggestions and adds the ones
// they keep through the normal question routes. No student data is involved.

export const SUGGEST_TYPES = ['single', 'multiple', 'true_false', 'short', 'essay'] as const satisfies readonly QuestionType[];
const LETTERS = 'abcdefghij';
/** Characters of lesson text a teacher may give. */
export const MAX_LESSON_CHARS = 12_000;

export const SuggestBody = z.object({
  topic: z.string().trim().min(3).max(300),
  lessonText: z.string().trim().max(MAX_LESSON_CHARS).default(''),
  count: z.number().int().min(1).max(10).default(5),
  types: z
    .array(z.enum(SUGGEST_TYPES))
    .min(1)
    .max(SUGGEST_TYPES.length)
    .transform((t) => [...new Set(t)]),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  language: z.enum(['ar', 'en']),
});
export type SuggestRequest = z.infer<typeof SuggestBody>;

/**
 * The reply asked of the provider. Every field is present for every type (the
 * providers' strict JSON modes need that); the ones that do not apply are empty
 * or null.
 */
export const SuggestedQuestions = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(SUGGEST_TYPES),
        prompt: z.string().min(1).max(2000),
        choices: z.array(z.string().min(1).max(500)).max(10),
        correct_choices: z.array(z.number().int().min(0).max(9)).max(10),
        is_true: z.boolean().nullable(),
        accepted_answers: z.array(z.string().min(1).max(200)).max(20),
        marking_guide: z.string().max(2000).nullable(),
        points: z.number().min(0.5).max(20),
        explanation: z.string().max(1000),
      }),
    )
    .max(10),
});
type Suggested = z.infer<typeof SuggestedQuestions>['questions'][number];

export interface SuggestionContext {
  grade: number;
  subjectEn: string;
  subjectAr: string;
  /** Titles of the subject's books in the class's curriculum scope. */
  books: string[];
  testTitle: string;
  kind: 'quiz' | 'exam';
}

export interface Suggestion {
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  points: number;
  key: AnswerKey;
  /** Why the answer is right, for the teacher only; not saved with the question. */
  explanation: string;
}

const TYPE_RULES: Record<(typeof SUGGEST_TYPES)[number], string> = {
  single: 'single: one correct choice. 3 or 4 short choices, exactly one correct (its index in correct_choices), plausible wrong choices, no "all of the above" or "none of the above".',
  multiple: 'multiple: several correct choices. 4 or 5 choices, at least two correct (their indexes in correct_choices).',
  true_false: 'true_false: one clear statement that is either true or false (is_true). Avoid negatives and words like "always" that make it a trick.',
  short: 'short: a question answered in one word or a short phrase. List in accepted_answers every form a teacher would accept (up to 10), e.g. with and without the article.',
  essay: 'essay: an open question answered in a few sentences. marking_guide lists the points a full answer makes and how the marks are shared.',
};

const STAGE = (grade: number) => (grade <= 6 ? `primary ${grade}` : grade <= 9 ? `preparatory ${grade - 6}` : `secondary ${grade - 9}`);

/** Instructions and task for the provider. The lesson text is the teacher's own material. */
export function suggestionPrompt(ctx: SuggestionContext, req: SuggestRequest): { system: string; prompt: string } {
  const language =
    req.language === 'ar'
      ? 'Write everything (questions, choices, answers, guides, explanations) in Modern Standard Arabic, with correct spelling (hamzas, ta marbuta, alif maqsura). Keep numbers as digits.'
      : 'Write everything (questions, choices, answers, guides, explanations) in clear, simple English.';
  const system = [
    'You help teachers in Egyptian schools write questions for their online tests. A teacher reviews and edits every question before any student sees it.',
    `The class is in grade ${ctx.grade} of 12 (${STAGE(ctx.grade)}); the subject is ${ctx.subjectEn} (${ctx.subjectAr}).`,
    language,
    'Rules:',
    '- Base every question on the topic and, when the teacher gives lesson text, on that text only. Do not add facts that are not in it. If the material supports fewer good questions than asked, write fewer.',
    '- Each question checks one idea, suits the grade, has one defensible answer, and does not depend on another question.',
    '- Points: 1 for single and true_false, 2 for multiple and short, 3 to 5 for essay.',
    '- explanation: one or two sentences for the teacher on why the answer is right (students do not see it).',
    '- Fields that do not apply to a question type are empty lists or null.',
    '- Never include personal data or names of real students.',
    'Question types:',
    ...req.types.map((t) => `- ${TYPE_RULES[t]}`),
  ].join('\n');
  const difficulty = { easy: 'easy (recall and understanding)', medium: 'medium (application)', hard: 'hard (analysis and reasoning)', mixed: 'a mix of easy, medium and hard' }[req.difficulty];
  const prompt = [
    `Test: ${ctx.testTitle} (${ctx.kind})`,
    ctx.books.length ? `Books of this subject in the class's curriculum: ${ctx.books.join('; ')}` : null,
    `Topic: ${req.topic}`,
    `Write ${req.count} question${req.count === 1 ? '' : 's'}, difficulty ${difficulty}, using these types: ${req.types.join(', ')} (spread across them).`,
    req.lessonText ? `Lesson text from the teacher:\n<<<\n${req.lessonText}\n>>>` : 'The teacher gave no lesson text: use what the curriculum normally teaches on this topic at this grade.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, prompt };
}

/** The suggestion in the test's question form, or null when it breaks the question rules or was not asked for. */
export function toSuggestion(q: Suggested, allowed: readonly QuestionType[]): Suggestion | null {
  if (!allowed.includes(q.type)) return null;
  const choice = q.type === 'single' || q.type === 'multiple';
  const options: QuestionOption[] = choice ? q.choices.map((text, i) => ({ id: LETTERS[i]!, text: text.trim() })) : [];
  let key: AnswerKey;
  if (choice) key = [...new Set(q.correct_choices)].filter((i) => i < options.length).sort((a, b) => a - b).map((i) => LETTERS[i]!);
  else if (q.type === 'true_false') {
    if (q.is_true === null) return null;
    key = q.is_true;
  } else if (q.type === 'short') key = [...new Set(q.accepted_answers.map((a) => a.trim()).filter(Boolean))];
  else key = { guide: q.marking_guide?.trim() || null };
  const candidate = { type: q.type, prompt: q.prompt.trim(), options, points: Math.round(q.points * 100) / 100, key };
  if (candidate.prompt.length > 2000 || questionProblem(candidate)) return null;
  return { ...candidate, explanation: q.explanation.trim() };
}
