import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IMPORT_MESSAGES, problem } from '../../src/lib/import-problems.js';

// The Arabic interface shows a file problem from its code (public/js/dom.js problemText).
function arabic(): Record<string, string> {
  const src = readFileSync(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
  const body = src.slice(0, src.indexOf('const DICTS'));
  return (new Function(`${body}; return ar;`)() as Record<string, string>);
}
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('problems in an imported file', () => {
  it('fills the English text from the parameters', () => {
    expect(problem('roster_username_repeats', { username: 'ok.one', line: 2 })).toEqual({
      code: 'roster_username_repeats', params: { username: 'ok.one', line: 2 }, message: 'username "ok.one" repeats line 2',
    });
    expect(problem('roster_empty')).toEqual({ code: 'roster_empty', params: {}, message: 'The file is empty' });
  });

  it('has an Arabic text for every code, with the same placeholders, and none left over', () => {
    const ar = arabic();
    for (const [code, en] of Object.entries(IMPORT_MESSAGES)) {
      const text = ar[`import.${code}`];
      expect(text, code).toBeTruthy();
      expect(placeholders(text!), code).toBe(placeholders(en));
    }
    const extra = Object.keys(ar).filter((k) => k.startsWith('import.') && !(k.slice(7) in IMPORT_MESSAGES));
    expect(extra).toEqual([]);
    // The roster import refuses an unreadable file as a whole, with these codes.
    expect(ar['err.FILE_NOT_UTF8']).toBe(ar['import.not_utf8']);
    expect(ar['err.CSV_INVALID']).toBeTruthy();
  });
});
