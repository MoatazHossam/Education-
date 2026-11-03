import { z } from 'zod';
import { gradeStage, MAX_LESSON_CHARS, writingRule } from '../ai/teaching.js';
import type { LessonContent, PacingContent } from './plans.js';

// Drafts of teaching plans written by the AI provider (docs/TEACHING_PLANS.md §4).
// The member gives a topic (and, optionally, the lesson text) for a lesson plan,
// or the term's start, length and the subject's contents for a pacing plan; the
// draft comes back unsaved and opens in the plan editor, where the member edits
// it and saves it as any plan. No student data is involved.

const zGrade = z.number().int().min(1).max(12);
const zSubjectEn = z.string().trim().min(1).max(120);
const zLanguage = z.enum(['ar', 'en']);

export const LessonSuggestBody = z.object({
  grade: zGrade,
  subjectEn: zSubjectEn,
  topic: z.string().trim().min(3).max(300),
  lessonText: z.string().trim().max(MAX_LESSON_CHARS).default(''),
  durationMinutes: z.number().int().min(20).max(180).default(45),
  language: zLanguage,
});
export type LessonSuggestRequest = z.infer<typeof LessonSuggestBody>;

export const PacingSuggestBody = z.object({
  grade: zGrade,
  subjectEn: zSubjectEn,
  startDate: z.iso.date().refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'Choose a date between 2000 and 2100'),
  weeks: z.number().int().min(1).max(40),
  periodsPerWeek: z.number().int().min(1).max(15).default(4),
  /** The units and lessons to cover, in the teacher's words (for example the book's table of contents). */
  contents: z.string().trim().max(8000).default(''),
  language: zLanguage,
});
export type PacingSuggestRequest = z.infer<typeof PacingSuggestBody>;

export interface PlanContext {
  grade: number;
  subjectEn: string;
  subjectAr: string;
  /** Titles of the subject's books in the scope. */
  books: string[];
}

/** The lesson plan asked of the provider; its limits fit the plan editor's. */
export const SuggestedLesson = z.object({
  title: z.string().min(1).max(200),
  objectives: z.array(z.string().min(1).max(500)).min(1).max(8),
  materials: z.array(z.string().min(1).max(300)).max(10),
  warm_up: z.string().max(2000),
  activities: z.array(z.object({ title: z.string().min(1).max(200), minutes: z.number().int().min(1).max(180), description: z.string().max(3000) })).min(1).max(10),
  questions: z.array(z.string().min(1).max(500)).max(10),
  assessment: z.string().max(2000),
  homework: z.string().max(2000),
  differentiation: z.string().max(2000),
});

/** The pacing plan asked of the provider: exactly one entry per week. */
export function suggestedPacing(weeks: number) {
  return z.object({
    title: z.string().min(1).max(200),
    weeks: z.array(z.object({ topics: z.string().min(1).max(1000), objectives: z.string().max(1000), notes: z.string().max(1000) })).length(weeks),
  });
}

const BOOK_RULE = '- Refer to a book only by the titles given; never invent page numbers, exercise numbers, dates, holidays or links.';

function booksLine(ctx: PlanContext): string | null {
  return ctx.books.length ? `Books of this subject in the school's curriculum: ${ctx.books.join('; ')}` : null;
}

function classLine(ctx: PlanContext): string {
  return `The class is in grade ${ctx.grade} of 12 (${gradeStage(ctx.grade)}); the subject is ${ctx.subjectEn} (${ctx.subjectAr}).`;
}

/** Instructions and task for a lesson plan. The lesson text is the member's own material. */
export function lessonPrompt(ctx: PlanContext, req: LessonSuggestRequest): { system: string; prompt: string } {
  const system = [
    'You help teachers in Egyptian schools prepare lesson plans. A teacher reviews and edits the plan before using it.',
    classLine(ctx),
    writingRule(req.language, 'title, objectives, materials, activities, questions and every other part'),
    'Rules:',
    `- The lesson lasts ${req.durationMinutes} minutes: the activities' minutes add up to about that, warm-up included.`,
    '- Base the plan on the topic and, when the teacher gives lesson text, on that text only. Do not add facts that are not in it.',
    '- objectives: what students will be able to do by the end, each starting with a verb that can be observed (name, explain, solve…).',
    '- activities: in teaching order, each with a short title, its minutes and what the teacher and students do.',
    '- materials: only what an ordinary Egyptian classroom has (board, book, notebooks, simple objects).',
    '- questions: questions the teacher asks during or at the end of the lesson to check understanding.',
    '- assessment: how the teacher sees whether the objectives were reached.',
    '- homework: a short task for home, or an empty string.',
    '- differentiation: support for students who struggle and extension for those who finish early.',
    '- title: short (at most 10 words), naming the topic.',
    BOOK_RULE,
    '- Never include personal data or names of real students.',
  ].join('\n');
  const prompt = [
    booksLine(ctx),
    `Topic: ${req.topic}`,
    req.lessonText ? `Lesson text from the teacher:\n<<<\n${req.lessonText}\n>>>` : 'The teacher gave no lesson text: use what the curriculum normally teaches on this topic at this grade.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, prompt };
}

/** Instructions and task for a pacing plan. The contents are the member's own list. */
export function pacingPrompt(ctx: PlanContext, req: PacingSuggestRequest): { system: string; prompt: string } {
  const system = [
    'You help teachers in Egyptian schools plan how to spread a subject\'s curriculum over the weeks of a term. A teacher reviews and edits the plan before using it.',
    classLine(ctx),
    writingRule(req.language, 'title, topics, objectives, notes'),
    'Rules:',
    `- The term has ${req.weeks} teaching weeks, with ${req.periodsPerWeek} periods of this subject a week. Return exactly ${req.weeks} entries in weeks, week 1 first.`,
    '- Each week covers what fits in its periods: split long units over several weeks and group short lessons.',
    '- When the teacher lists the contents, follow their order, cover all of them, and add no unit or lesson that is not in the list.',
    '- When there is no list, follow what the curriculum normally teaches in this subject at this grade, and say in week 1\'s notes that the teacher should check the order against the book.',
    req.weeks >= 6 ? '- Keep the last week for revision and assessment.' : '- The term is short: no separate revision week is needed.',
    '- topics: the units and lessons of the week, briefly. objectives: what students should be able to do by the end of the week. notes: advice for the week (a quiz, practical work, catching up), or an empty string.',
    '- title: short (at most 10 words), naming the subject, grade and term.',
    BOOK_RULE,
  ].join('\n');
  const prompt = [
    booksLine(ctx),
    `The term starts on ${req.startDate}.`,
    req.contents ? `Contents to cover, from the teacher:\n<<<\n${req.contents}\n>>>` : 'The teacher gave no list of contents.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, prompt };
}

const trimmed = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);

export function toLessonDraft(ctx: PlanContext, req: LessonSuggestRequest, reply: z.infer<typeof SuggestedLesson>): { title: string; content: LessonContent } {
  return {
    title: reply.title.trim(),
    content: {
      topic: req.topic,
      durationMinutes: req.durationMinutes,
      books: ctx.books.slice(0, 20),
      objectives: trimmed(reply.objectives),
      materials: trimmed(reply.materials),
      warmUp: reply.warm_up.trim(),
      activities: reply.activities.map((a) => ({ title: a.title.trim(), minutes: a.minutes, description: a.description.trim() })).filter((a) => a.title),
      questions: trimmed(reply.questions),
      assessment: reply.assessment.trim(),
      homework: reply.homework.trim(),
      differentiation: reply.differentiation.trim(),
      notes: '',
    },
  };
}

export function toPacingDraft(ctx: PlanContext, req: PacingSuggestRequest, reply: z.infer<ReturnType<typeof suggestedPacing>>): { title: string; content: PacingContent } {
  return {
    title: reply.title.trim(),
    content: {
      startDate: req.startDate,
      periodsPerWeek: req.periodsPerWeek,
      books: ctx.books.slice(0, 20),
      weeks: reply.weeks.map((w) => ({ topics: w.topics.trim(), objectives: w.objectives.trim(), notes: w.notes.trim() })),
    },
  };
}
