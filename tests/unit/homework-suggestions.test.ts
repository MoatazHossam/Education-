import { describe, expect, it } from 'vitest';
import { portableSchema } from '../../src/ai/schema.js';
import { HomeworkSuggestBody, homeworkPrompt, SuggestedHomework, toHomeworkSuggestion } from '../../src/classroom/homework-suggestions.js';

const CTX = { grade: 8, subjectEn: 'Science', subjectAr: 'العلوم', books: ['Science, Prep 2 (MoE)', 'Lab notebook'] };

describe('homework suggestion prompt', () => {
  it('gives the grade, stage, subject, books, topic, lesson text, kind, time and language', () => {
    const req = HomeworkSuggestBody.parse({ subjectEn: 'Science', topic: 'The water cycle', lessonText: 'Water evaporates from seas…', kind: 'reading', minutes: 20, language: 'ar' });
    const { system, prompt } = homeworkPrompt(CTX, req);
    expect(system).toContain('grade 8 of 12 (preparatory 2)');
    expect(system).toContain('Science (العلوم)');
    expect(system).toContain('Modern Standard Arabic');
    expect(system).toContain('about 20 minutes');
    expect(system).toMatch(/reading: a passage or pages to read/);
    expect(system).toMatch(/never invent page numbers/);
    expect(system).toMatch(/photos of their notebook/);
    expect(prompt).toContain('Books of this subject in the class\'s curriculum: Science, Prep 2 (MoE); Lab notebook');
    expect(prompt).toContain('Topic: The water cycle');
    expect(prompt).toContain('<<<\nWater evaporates from seas…\n>>>');
  });

  it('uses the defaults, says when there is no lesson text, and writes English when asked', () => {
    const req = HomeworkSuggestBody.parse({ subjectEn: 'Physics', topic: 'Ohm\'s law', language: 'en' });
    expect([req.kind, req.minutes, req.lessonText]).toEqual(['practice', 30, '']);
    const { system, prompt } = homeworkPrompt({ ...CTX, grade: 11, books: [] }, req);
    expect(system).toContain('(secondary 2)');
    expect(system).toContain('clear, simple English');
    expect(system).toMatch(/practice: exercises or problems/);
    expect(prompt).toContain('The teacher gave no lesson text');
    expect(prompt).not.toContain('Books of this subject');
  });

  it('asks for a reply every provider can be held to, within the homework form\'s limits', () => {
    const schema = portableSchema(SuggestedHomework) as { required: string[]; additionalProperties: boolean };
    expect(schema.required).toEqual(['title', 'instructions', 'estimated_minutes', 'teacher_notes']);
    expect(schema.additionalProperties).toBe(false);
    expect(SuggestedHomework.safeParse({ title: 'x'.repeat(201), instructions: 'Do it.', estimated_minutes: 20, teacher_notes: '' }).success).toBe(false);
    expect(SuggestedHomework.safeParse({ title: 'T', instructions: 'x'.repeat(5001), estimated_minutes: 20, teacher_notes: '' }).success).toBe(false);
  });

  it('trims the suggestion and names its fields for the page', () => {
    expect(toHomeworkSuggestion({ title: ' Water ', instructions: ' 1. Read.\n2. Draw. ', estimated_minutes: 25, teacher_notes: ' Stages. ' })).toEqual({
      title: 'Water',
      instructions: '1. Read.\n2. Draw.',
      estimatedMinutes: 25,
      teacherNotes: 'Stages.',
    });
  });
});
