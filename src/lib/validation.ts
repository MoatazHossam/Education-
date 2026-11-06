import { z } from 'zod';
import { COMMON_PASSWORDS } from './common-passwords.js';
import { AppError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'The request contains invalid data',
      // A check that names its problem (zPassword) passes it on as `code`, for the interface's translation.
      result.error.issues.map((i) => {
        const code = i.code === 'custom' ? (i.params as { code?: unknown } | undefined)?.code : undefined;
        return { path: i.path.join('.'), message: i.message, ...(typeof code === 'string' ? { code } : {}) };
      }),
    );
  }
  return result.data;
}

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

// Passwords people choose (staff, and students changing the one their school gave them), after NIST
// SP 800-63B: length rather than composition rules, and no password that is common or easy to guess
// (production finding S-6). The list is local (src/lib/common-passwords.ts); nothing is sent anywhere.
const COMMON = new Set(COMMON_PASSWORDS.split('\n'));
// Words that, with only digits and symbols added, make a password guessed early: the commonest bases,
// and words of this service (NIST's "context-specific words"). Compared after removing everything but
// letters, so "Password2026!" and "مِداد@12345" are refused.
const GUESSABLE_WORDS = new Set([
  'password', 'passwort', 'motdepasse', 'qwerty', 'qwertyuiop', 'azerty', 'asdfgh', 'asdfghjkl', 'zxcvbnm', 'abc', 'abcdef', 'abcd',
  'admin', 'administrator', 'welcome', 'letmein', 'iloveyou', 'login', 'user', 'test', 'changeme', 'secret',
  'football', 'monkey', 'dragon', 'master', 'sunshine', 'princess', 'shadow', 'superman', 'baseball', 'trustno',
  'midad', 'مداد', 'school', 'student', 'teacher', 'class', 'classroom', 'madrasa', 'madrasah', 'مدرسة', 'طالب', 'معلم',
]);

export type PasswordProblem = 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'PASSWORD_TOO_COMMON';

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  PASSWORD_TOO_SHORT: 'Password must be at least 10 characters',
  PASSWORD_TOO_LONG: 'Password must be at most 128 characters',
  PASSWORD_TOO_COMMON: 'This password is too common or easy to guess. Choose a longer phrase that is not a common word with numbers added.',
};

/** Why a new password is refused, or null. */
export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < 10) return 'PASSWORD_TOO_SHORT';
  if (password.length > 128) return 'PASSWORD_TOO_LONG';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'PASSWORD_TOO_COMMON';
  // One character repeated.
  if (new Set(lower).size === 1) return 'PASSWORD_TOO_COMMON';
  // Letters only (Arabic vowel marks are not letters, so they go too).
  const letters = lower.replace(/[^\p{L}]/gu, '');
  if (GUESSABLE_WORDS.has(letters)) return 'PASSWORD_TOO_COMMON';
  return null;
}

/** A new password. The issue carries its problem as `code`, which `parse` passes on for the interface's translation. */
export const zPassword = z.string().superRefine((password, ctx) => {
  const problem = passwordProblem(password);
  if (problem) ctx.addIssue({ code: 'custom', message: PASSWORD_MESSAGES[problem], params: { code: problem } });
});

export const zName = z.string().trim().min(1).max(120);
export const zUuid = z.uuid();
export const zLocale = z.enum(['en', 'ar']);
