import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COMMON_PASSWORDS } from '../../src/lib/common-passwords.js';
import { AppError } from '../../src/lib/errors.js';
import { parse, PASSWORD_MESSAGES, passwordProblem, zPassword, type PasswordProblem } from '../../src/lib/validation.js';

// New passwords (production finding S-6): length, a local list of common passwords, and common words
// with only digits or symbols added.

describe('common password list', () => {
  const list = COMMON_PASSWORDS.split('\n');

  it('is the pinned NCSC list cut to the lengths a password may have, lowercased, without duplicates', () => {
    expect(list).toHaveLength(9113);
    expect(new Set(list).size).toBe(list.length);
    expect(list.every((p) => p.length >= 10 && p.length <= 128 && p === p.toLowerCase())).toBe(true);
    expect(list.slice(0, 3)).toEqual(['1234567890', '1q2w3e4r5t', 'qwertyuiop']);
  });
});

describe('new passwords', () => {
  it.each([
    ['password123', 'in the list'],
    ['PassWord123', 'in the list, any case'],
    ['qwertyuiop', 'in the list'],
    ['1234567890', 'in the list'],
    ['iloveyou123', 'in the list'],
    ['Password2026!', 'a common word with digits and symbols'],
    ['Welcome#2026', 'a common word with digits and symbols'],
    ['midad123456', 'the service name'],
    ['مِداد@12345', 'the service name in Arabic, with vowel marks'],
    ['School2026!!', 'a word of this service'],
    ['aaaaaaaaaaaaaa', 'one character repeated'],
  ])('refuses %s (%s)', (password) => {
    expect(passwordProblem(password)).toBe('PASSWORD_TOO_COMMON');
  });

  it('refuses one that is too short or too long, before anything else', () => {
    expect(passwordProblem('password')).toBe('PASSWORD_TOO_SHORT');
    expect(passwordProblem('x'.repeat(129))).toBe('PASSWORD_TOO_LONG');
    expect(passwordProblem('x'.repeat(128))).toBe('PASSWORD_TOO_COMMON');
  });

  it.each(['correct-horse-battery-staple', 'a-long-enough-new-password', 'Nile at dawn, 2026', 'شجرة الليمون في الحديقة', '7391046285', 'Password is not my secret'])(
    'accepts %s',
    (password) => {
      expect(passwordProblem(password)).toBeNull();
    },
  );

  it('reports the problem as a code with the field, for the interface to translate', () => {
    const err = (() => {
      try {
        parse(z.object({ password: zPassword }), { password: 'password123' });
      } catch (e) {
        return e;
      }
    })() as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect([err.statusCode, err.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(err.details).toEqual([{ path: 'password', code: 'PASSWORD_TOO_COMMON', message: PASSWORD_MESSAGES.PASSWORD_TOO_COMMON }]);
    // Other checks have no code.
    const other = (() => {
      try {
        parse(z.object({ n: z.number() }), { n: 'x' });
      } catch (e) {
        return e;
      }
    })() as AppError;
    expect((other.details as object[])[0]).not.toHaveProperty('code');
  });

  it('every problem has an English and an Arabic message in the interface', () => {
    const src = readFileSync(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
    const { en, ar } = new Function(`${src.slice(0, src.indexOf('const DICTS'))}; return { en, ar };`)() as Record<'en' | 'ar', Record<string, string>>;
    for (const code of Object.keys(PASSWORD_MESSAGES) as PasswordProblem[]) {
      expect(en[`err.${code}`], code).toBe(PASSWORD_MESSAGES[code]);
      expect(ar[`err.${code}`], code).toMatch(/[؀-ۿ]/);
    }
  });
});
