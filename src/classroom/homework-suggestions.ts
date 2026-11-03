import { z } from 'zod';
import { gradeStage, MAX_LESSON_CHARS, writingRule } from '../ai/teaching.js';
import { zSubjectName } from './service.js';

// Homework suggested by the AI provider (docs/CLASSROOM.md §13). The teacher gives
// a topic and, optionally, the lesson text; the provider writes a title and the
// instructions students will read, plus notes for the teacher. Nothing is saved
// here: the suggestion fills the new-homework form, and the teacher edits and
// sets it as any homework. No student data is involved.


export const HOMEWORK_KINDS = ['practice', 'reading', 'writing', 'research', 'review'] as const;

export const HomeworkSuggestBody = z.object({
  subjectEn: zSubjectName,
  topic: z.string().trim().min(3).max(300),
  lessonText: z.string().trim().max(MAX_LESSON_CHARS).default(''),
  kind: z.enum(HOMEWORK_KINDS).default('practice'),
  /** About how long a student should spend on it. */
  minutes: z.number().int().min(10).max(120).default(30),
  language: z.enum(['ar', 'en']),
});
export type HomeworkSuggestRequest = z.infer<typeof HomeworkSuggestBody>;

/** The reply asked of the provider; its limits match the homework form's. */
export const SuggestedHomework = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().min(1).max(5000),
  estimated_minutes: z.number().int().min(5).max(240),
  teacher_notes: z.string().max(2000),
});

export interface HomeworkContext {
  grade: number;
  subjectEn: string;
  subjectAr: string;
  /** Titles of the subject's books in the class's curriculum scope. */
  books: string[];
}

export interface HomeworkSuggestion {
  title: string;
  instructions: string;
  estimatedMinutes: number;
  /** For the teacher only; not saved with the homework. */
  teacherNotes: string;
}

const KIND_RULES: Record<(typeof HOMEWORK_KINDS)[number], string> = {
  practice: 'practice: exercises or problems on the lesson, from easier to harder, with what to write for each.',
  reading: 'reading: a passage or pages to read (from the lesson or the class book) followed by a few questions to answer.',
  writing: 'writing: a short written piece (a paragraph, a summary, a description) with what it must include.',
  research: 'research: a small task to find out something at home (from the book, family or observation), with what to bring back. No internet searching required.',
  review: 'review: revision of the lesson before a test: key points to go over and a few questions to check them.',
};

/** Instructions and task for the provider. The lesson text is the teacher's own material. */
export function homeworkPrompt(ctx: HomeworkContext, req: HomeworkSuggestRequest): { system: string; prompt: string } {
  const system = [
    'You help teachers in Egyptian schools write homework for their classes. A teacher reviews and edits the homework before any student sees it.',
    `The class is in grade ${ctx.grade} of 12 (${gradeStage(ctx.grade)}); the subject is ${ctx.subjectEn} (${ctx.subjectAr}).`,
    writingRule(req.language, 'title, instructions, notes'),
    'Rules:',
    '- Base the homework on the topic and, when the teacher gives lesson text, on that text only. Do not add facts that are not in it.',
    '- instructions: addressed to the student, in short numbered steps, suited to the grade, doable at home without special equipment.',
    `- Size it for about ${req.minutes} minutes of a typical student's work; estimated_minutes is your estimate.`,
    '- Students hand in their work as text or as photos of their notebook: ask for work that fits that.',
    '- Refer to a book only by the titles given; never invent page numbers, exercise numbers or links.',
    '- title: short (at most 10 words), naming the topic.',
    '- teacher_notes: for the teacher only: what the homework checks, and the expected answers or the points a good answer makes.',
    '- Never include personal data or names of real students.',
    `Homework kind: ${KIND_RULES[req.kind]}`,
  ].join('\n');
  const prompt = [
    ctx.books.length ? `Books of this subject in the class's curriculum: ${ctx.books.join('; ')}` : null,
    `Topic: ${req.topic}`,
    req.lessonText ? `Lesson text from the teacher:\n<<<\n${req.lessonText}\n>>>` : 'The teacher gave no lesson text: use what the curriculum normally teaches on this topic at this grade.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, prompt };
}

export function toHomeworkSuggestion(reply: z.infer<typeof SuggestedHomework>): HomeworkSuggestion {
  return {
    title: reply.title.trim(),
    instructions: reply.instructions.trim(),
    estimatedMinutes: reply.estimated_minutes,
    teacherNotes: reply.teacher_notes.trim(),
  };
}
