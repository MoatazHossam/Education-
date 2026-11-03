import { describe, expect, it } from 'vitest';
import { portableSchema } from '../../src/ai/schema.js';
import { LessonContent, PacingContent } from '../../src/scopes/plans.js';
import {
  LessonSuggestBody, lessonPrompt, PacingSuggestBody, pacingPrompt, SuggestedLesson, suggestedPacing, toLessonDraft, toPacingDraft,
} from '../../src/scopes/plan-suggestions.js';

const CTX = { grade: 4, subjectEn: 'Science', subjectAr: 'العلوم', books: ['Science, Primary 4 (MoE)'] };

const LESSON_REPLY = {
  title: ' The water cycle ',
  objectives: [' Name the stages of the water cycle ', ''],
  materials: ['Kettle', 'Cold plate'],
  warm_up: 'Where does rain come from?',
  activities: [
    { title: 'Warm-up', minutes: 5, description: 'Questions.' },
    { title: ' Demonstration ', minutes: 20, description: ' Boil water under a cold plate. ' },
    { title: '  ', minutes: 5, description: 'Dropped: no title.' },
  ],
  questions: ['What is evaporation?'],
  assessment: 'Exit ticket.',
  homework: 'Draw the cycle.',
  differentiation: 'Picture cards for support.',
};

describe('lesson plan drafts', () => {
  it('give the grade, subject, books, topic, lesson text, length and language', () => {
    const req = LessonSuggestBody.parse({ grade: 4, subjectEn: 'Science', topic: 'The water cycle', lessonText: 'Water evaporates…', durationMinutes: 50, language: 'ar' });
    const { system, prompt } = lessonPrompt(CTX, req);
    expect(system).toContain('grade 4 of 12 (primary 4)');
    expect(system).toContain('Science (العلوم)');
    expect(system).toContain('Modern Standard Arabic');
    expect(system).toContain('The lesson lasts 50 minutes');
    expect(system).toMatch(/never invent page numbers/);
    expect(prompt).toContain('Books of this subject in the school\'s curriculum: Science, Primary 4 (MoE)');
    expect(prompt).toContain('Topic: The water cycle');
    expect(prompt).toContain('<<<\nWater evaporates…\n>>>');
  });

  it('use a 45-minute lesson and say when there is no lesson text', () => {
    const req = LessonSuggestBody.parse({ grade: 4, subjectEn: 'Science', topic: 'Plants', language: 'en' });
    expect([req.durationMinutes, req.lessonText]).toEqual([45, '']);
    const { system, prompt } = lessonPrompt({ ...CTX, books: [] }, req);
    expect(system).toContain('clear, simple English');
    expect(prompt).toContain('The teacher gave no lesson text');
    expect(prompt).not.toContain('Books of this subject');
  });

  it('ask for a reply every provider can be held to', () => {
    const schema = portableSchema(SuggestedLesson) as { required: string[]; additionalProperties: boolean };
    expect(schema.required).toEqual(['title', 'objectives', 'materials', 'warm_up', 'activities', 'questions', 'assessment', 'homework', 'differentiation']);
    expect(schema.additionalProperties).toBe(false);
    expect(SuggestedLesson.safeParse({ ...LESSON_REPLY, activities: [] }).success).toBe(false);
  });

  it('become a plan the editor can save: trimmed, empty items left out, the scope\'s books added', () => {
    const req = LessonSuggestBody.parse({ grade: 4, subjectEn: 'Science', topic: 'The water cycle', language: 'en' });
    const draft = toLessonDraft(CTX, req, LESSON_REPLY);
    expect(draft.title).toBe('The water cycle');
    expect(draft.content).toMatchObject({
      topic: 'The water cycle', durationMinutes: 45, books: ['Science, Primary 4 (MoE)'], objectives: ['Name the stages of the water cycle'], notes: '',
      activities: [{ title: 'Warm-up', minutes: 5, description: 'Questions.' }, { title: 'Demonstration', minutes: 20, description: 'Boil water under a cold plate.' }],
    });
    expect(LessonContent.parse(draft.content)).toEqual(draft.content);
  });
});

describe('pacing plan drafts', () => {
  const base = { grade: 4, subjectEn: 'Science', startDate: '2026-09-27', weeks: 8, contents: 'Unit 1: Living things\nUnit 2: Matter', language: 'en' };

  it('give the term, the periods, the contents and exactly how many weeks', () => {
    const req = PacingSuggestBody.parse(base);
    expect(req.periodsPerWeek).toBe(4);
    const { system, prompt } = pacingPrompt(CTX, req);
    expect(system).toContain('The term has 8 teaching weeks, with 4 periods of this subject a week. Return exactly 8 entries in weeks');
    expect(system).toContain('Keep the last week for revision');
    expect(system).toMatch(/add no unit or lesson that is not in the list/);
    expect(prompt).toContain('The term starts on 2026-09-27.');
    expect(prompt).toContain('<<<\nUnit 1: Living things\nUnit 2: Matter\n>>>');
  });

  it('leave out the revision week in a short term and say when there is no list', () => {
    const { system, prompt } = pacingPrompt(CTX, PacingSuggestBody.parse({ ...base, weeks: 3, contents: '', language: 'ar' }));
    expect(system).toContain('no separate revision week');
    expect(system).toContain('Modern Standard Arabic');
    expect(prompt).toContain('The teacher gave no list of contents.');
  });

  it('hold the provider to one entry per week', () => {
    const schema = suggestedPacing(3);
    const week = { topics: 'Unit 1', objectives: '', notes: '' };
    expect(schema.safeParse({ title: 'Term 1', weeks: [week, week, week] }).success).toBe(true);
    expect(schema.safeParse({ title: 'Term 1', weeks: [week, week] }).success).toBe(false);
    expect(schema.safeParse({ title: 'Term 1', weeks: [week, week, week, week] }).success).toBe(false);
    expect((portableSchema(schema) as { required: string[] }).required).toEqual(['title', 'weeks']);
  });

  it('become a plan the editor can save, from the requested start', () => {
    const req = PacingSuggestBody.parse({ ...base, weeks: 2 });
    const draft = toPacingDraft(CTX, req, { title: ' Science, term 1 ', weeks: [{ topics: ' Unit 1 ', objectives: 'Classify', notes: '' }, { topics: 'Revision', objectives: '', notes: ' Quiz ' }] });
    expect(draft).toEqual({
      title: 'Science, term 1',
      content: { startDate: '2026-09-27', periodsPerWeek: 4, books: ['Science, Primary 4 (MoE)'], weeks: [{ topics: 'Unit 1', objectives: 'Classify', notes: '' }, { topics: 'Revision', objectives: '', notes: 'Quiz' }] },
    });
    expect(PacingContent.parse(draft.content)).toEqual(draft.content);
  });

  it('refuse terms that are too long or start on a date that does not exist', () => {
    expect(PacingSuggestBody.safeParse({ ...base, weeks: 41 }).success).toBe(false);
    expect(PacingSuggestBody.safeParse({ ...base, startDate: '2026-02-30' }).success).toBe(false);
    expect(PacingSuggestBody.safeParse({ ...base, periodsPerWeek: 0 }).success).toBe(false);
  });
});
