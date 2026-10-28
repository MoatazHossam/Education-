import { describe, expect, it } from 'vitest';
import { portableSchema } from '../../src/ai/schema.js';
import { SuggestBody, SuggestedQuestions, suggestionPrompt, toSuggestion } from '../../src/classroom/question-suggestions.js';

const CTX = { grade: 8, subjectEn: 'Science', subjectAr: 'العلوم', books: ['Science, Prep 2 (MoE)', 'Lab notebook'], testTitle: 'Unit 2 quiz', kind: 'quiz' as const };
const base = { prompt: 'Q', choices: [] as string[], correct_choices: [] as number[], is_true: null, accepted_answers: [] as string[], marking_guide: null, points: 1, explanation: ' Because. ' };
const ALL = ['single', 'multiple', 'true_false', 'short', 'essay'] as const;

describe('question suggestion prompt', () => {
  it('gives the grade, stage, subject, books, topic, lesson text, count, types and language', () => {
    const req = SuggestBody.parse({ topic: 'The water cycle', lessonText: 'Water evaporates from seas…', count: 4, types: ['single', 'true_false', 'single'], difficulty: 'easy', language: 'ar' });
    expect(req.types).toEqual(['single', 'true_false']);
    const { system, prompt } = suggestionPrompt(CTX, req);
    expect(system).toContain('grade 8 of 12 (preparatory 2)');
    expect(system).toContain('Science (العلوم)');
    expect(system).toContain('Modern Standard Arabic');
    expect(system).toMatch(/single: one correct choice/);
    expect(system).toMatch(/true_false:/);
    expect(system).not.toMatch(/essay:/);
    expect(system).toMatch(/on that text only/);
    expect(prompt).toContain('Books of this subject in the class\'s curriculum: Science, Prep 2 (MoE); Lab notebook');
    expect(prompt).toContain('Topic: The water cycle');
    expect(prompt).toContain('Write 4 questions, difficulty easy (recall and understanding), using these types: single, true_false');
    expect(prompt).toContain('<<<\nWater evaporates from seas…\n>>>');
  });

  it('says when there is no lesson text, and writes English when asked', () => {
    const { system, prompt } = suggestionPrompt({ ...CTX, grade: 11, books: [] }, SuggestBody.parse({ topic: 'Ohm\'s law', count: 1, types: ['short'], language: 'en' }));
    expect(system).toContain('(secondary 2)');
    expect(system).toContain('clear, simple English');
    expect(prompt).toContain('Write 1 question,');
    expect(prompt).toContain('The teacher gave no lesson text');
    expect(prompt).not.toContain('Books of this subject');
  });

  it('asks for a reply every provider can be held to', () => {
    const schema = portableSchema(SuggestedQuestions) as { properties: { questions: { items: { required: string[]; additionalProperties: boolean } } } };
    expect(schema.properties.questions.items.required).toEqual(['type', 'prompt', 'choices', 'correct_choices', 'is_true', 'accepted_answers', 'marking_guide', 'points', 'explanation']);
    expect(schema.properties.questions.items.additionalProperties).toBe(false);
    expect(() => SuggestBody.parse({ topic: 'ok topic', types: [], language: 'ar' })).toThrow();
    expect(() => SuggestBody.parse({ topic: 'ok topic', types: ['single'], language: 'ar', lessonText: 'x'.repeat(12_001) })).toThrow();
  });
});

describe('a suggestion in the test\'s question form', () => {
  it('turns choices into lettered options and correct indexes into the key', () => {
    expect(toSuggestion({ ...base, type: 'single', prompt: ' Which? ', choices: ['A', 'B ', 'C'], correct_choices: [1], points: 1.234 }, ALL)).toEqual({
      type: 'single', prompt: 'Which?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], points: 1.23, key: ['b'], explanation: 'Because.',
    });
    expect(toSuggestion({ ...base, type: 'multiple', choices: ['A', 'B', 'C', 'D'], correct_choices: [3, 0, 3], points: 2 }, ALL)?.key).toEqual(['a', 'd']);
  });

  it('keeps true or false, accepted answers and the marking guide', () => {
    expect(toSuggestion({ ...base, type: 'true_false', is_true: false }, ALL)?.key).toBe(false);
    expect(toSuggestion({ ...base, type: 'short', accepted_answers: [' النيل', 'نهر النيل', 'النيل'] }, ALL)?.key).toEqual(['النيل', 'نهر النيل']);
    expect(toSuggestion({ ...base, type: 'essay', marking_guide: '  Two points: … ', points: 4 }, ALL)?.key).toEqual({ guide: 'Two points: …' });
    expect(toSuggestion({ ...base, type: 'essay', marking_guide: '   ' }, ALL)?.key).toEqual({ guide: null });
  });

  it('leaves out what breaks the question rules or was not asked for', () => {
    expect(toSuggestion({ ...base, type: 'single', choices: ['A', 'B'], correct_choices: [0, 1] }, ALL)).toBeNull(); // two correct
    expect(toSuggestion({ ...base, type: 'single', choices: ['A', 'B'], correct_choices: [5] }, ALL)).toBeNull(); // index outside the choices
    expect(toSuggestion({ ...base, type: 'single', choices: ['A'], correct_choices: [0] }, ALL)).toBeNull(); // one choice
    expect(toSuggestion({ ...base, type: 'true_false', is_true: null }, ALL)).toBeNull();
    expect(toSuggestion({ ...base, type: 'short', accepted_answers: [] }, ALL)).toBeNull();
    expect(toSuggestion({ ...base, type: 'single', prompt: '  ', choices: ['A', 'B'], correct_choices: [0] }, ALL)).toBeNull();
    expect(toSuggestion({ ...base, type: 'essay' }, ['single'])).toBeNull();
  });
});
