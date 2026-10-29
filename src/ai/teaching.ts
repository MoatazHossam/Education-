// Wording shared by the AI features for teachers (docs/AI_LAYER.md §6a), so every
// feature describes a class and asks for a language the same way.

/** The Egyptian school stage of a grade from 1 to 12, as the providers are told it. */
export function gradeStage(grade: number): string {
  return grade <= 6 ? `primary ${grade}` : grade <= 9 ? `preparatory ${grade - 6}` : `secondary ${grade - 9}`;
}

/** The instruction on the reply's language; `parts` names what the reply contains. */
export function writingRule(language: 'ar' | 'en', parts: string): string {
  return language === 'ar'
    ? `Write everything (${parts}) in Modern Standard Arabic, with correct spelling (hamzas, ta marbuta, alif maqsura). Keep numbers as digits.`
    : `Write everything (${parts}) in clear, simple English.`;
}
