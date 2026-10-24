import { describe, expect, it } from 'vitest';
import { CsvError, csvCell, parseCsv, toCsv, unguardCell, UTF8_BOM } from '../../src/lib/csv.js';

describe('CSV for spreadsheet round trips', () => {
  it('round-trips quotes, delimiters, line breaks, Arabic text and guarded formulas', () => {
    const rows = [
      ['id', 'title', 'note'],
      ['1', 'Connect Plus — "language schools", 2 periods', 'line one\nline two'],
      ['2', 'اللغة العربية; الصف الأول', '=HYPERLINK("http://evil")'],
      ['3', '', '-5 periods'],
    ];
    const text = toCsv(rows);
    expect(text.startsWith(UTF8_BOM)).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const back = parseCsv(text).map((r) => r.map(unguardCell));
    expect(back).toEqual(rows);
  });

  it('reads files saved by Excel: semicolons, CRLF, trailing blank lines, no BOM', () => {
    const excel = 'id;title;note\r\n1;"Gem; 2nd ed.";\r\n2;Bit by Bit;x\r\n;;\r\n\r\n';
    expect(parseCsv(excel)).toEqual([['id', 'title', 'note'], ['1', 'Gem; 2nd ed.', ''], ['2', 'Bit by Bit', 'x']]);
  });

  it('rejects an unterminated quote and leaves ordinary apostrophes alone', () => {
    expect(() => parseCsv('a,b\n1,"open')).toThrow(CsvError);
    expect(unguardCell("'Tis a title")).toBe("'Tis a title");
    expect(csvCell(null)).toBe('');
    expect(csvCell('@user')).toBe("'@user");
  });
});
