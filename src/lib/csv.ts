// CSV for spreadsheet round trips (RFC 4180): quoted fields, doubled quotes,
// line breaks inside quotes, CRLF or LF, and an optional UTF-8 byte-order mark.
// Excel in some locales separates fields with ";", so the delimiter is taken
// from the header line.

export const UTF8_BOM = '\uFEFF';

// Spreadsheet formula injection guard (OWASP CSV Injection): risky leading
// characters get an apostrophe on export, removed again on import.
const RISKY = /^[=+\-@\t\r]/;

/** One cell; quoted when it contains a quote, either delimiter or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (RISKY.test(v)) v = `'${v}`;
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function unguardCell(value: string): string {
  return value.startsWith("'") && RISKY.test(value.slice(1)) ? value.slice(1) : value;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return UTF8_BOM + rows.map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n') + '\r\n';
}

export class CsvError extends Error {}

/** Parses CSV text into rows of cells. Throws CsvError on an unterminated quote. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(UTF8_BOM) ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cell += ch;
    i++;
  }
  if (quoted) throw new CsvError('A quoted field is not closed');
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop blank lines (Excel adds them at the end).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
