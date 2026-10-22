import { z } from 'zod';
import { AppError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'The request contains invalid data',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
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

// NIST SP 800-63B: length over composition rules; reject the most common choices.
const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou123', 'administrator',
  'welcome123', 'passw0rd123', 'letmein1234', 'football123', 'abc1234567', 'p@ssw0rd123', 'qwerty12345',
]);

export const zPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'This password is too common');

export const zName = z.string().trim().min(1).max(120);
export const zUuid = z.uuid();
export const zLocale = z.enum(['en', 'ar']);
