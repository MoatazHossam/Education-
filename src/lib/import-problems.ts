// Problems found in an uploaded file: the roster import (src/students/service.ts)
// and the catalogue sheet import (src/catalog/sheet.ts). Each problem carries a
// stable code and its parameters next to the English text, so the interface shows
// it in its own language (public/js/i18n.js, keys "import.<code>"); API clients
// keep reading `message`. tests/unit/import-problems.test.ts checks that every
// code has an Arabic text with the same placeholders.

export const IMPORT_MESSAGES = {
  // Either file
  not_utf8: 'The file is not UTF-8. In Excel, save it as "CSV UTF-8 (Comma delimited)".',
  csv_quote: 'A quoted field is not closed',
  csv_unreadable: 'The file could not be read as CSV',

  // Roster import (school staff)
  roster_empty: 'The file is empty',
  roster_missing_column: 'Missing column "{column}"',
  roster_no_students: 'The file has no students',
  roster_too_many: 'At most {max} students per file. Split the file and import each part.',
  roster_username: 'username: Use 3–40 letters, digits, dots, dashes or underscores, starting and ending with a letter or digit',
  roster_name: 'name: required, at most 120 characters',
  roster_grade: 'grade: a number from 1 to 12',
  roster_scope: 'scope: no scope named "{scope}"',
  roster_username_taken: 'username "{username}" is already used at your school',
  roster_username_repeats: 'username "{username}" repeats line {line}',

  // Catalogue sheet import (platform administrators)
  sheet_missing_columns: 'Missing columns: {columns}. Start from a downloaded sheet.',
  sheet_too_many_rows: 'The sheet has more than {max} rows',
  sheet_row_type: 'row_type must be "subject" or "material"',
  sheet_unknown_subject: 'Unknown subject_id',
  sheet_new_subject: 'Unknown subject_id. New subjects are added in the editor.',
  sheet_unknown_material: 'Unknown material_id',
  sheet_mark_status: 'verification_status must be unverified, verified or needs_review',
  sheet_verified_source: 'A verified entry needs verification_source',
  sheet_review_note: 'An entry that needs review needs verification_note',
  sheet_too_long: '{field} is longer than {max} characters',
  sheet_url: 'verification_url must be an http(s) link',
  sheet_subject_twice: 'This subject appears twice',
  sheet_material_twice: 'This material appears twice',
  sheet_grade: 'grade must be 1–12',
  sheet_one_of: '{field} must be one of {values}',
  sheet_code: 'code must be 1–40 letters, digits, - or _',
  sheet_length: '{field} must be 1–{max} characters',
  sheet_material_move: 'Moving a material to another subject is not supported',
  sheet_published: 'Published versions are read-only: only the verification columns can change ({fields} changed)',
  sheet_subject_clash: 'Another subject in this grade and track already has this block and code',
  sheet_title_clash: 'Another material of this subject already has this title',
  sheet_context_ignored: '{n} material rows have edited subject columns; those are ignored. Change subjects on their subject rows.',
} as const;

export type ProblemCode = keyof typeof IMPORT_MESSAGES;
export type ProblemParams = Record<string, string | number>;

export interface Problem {
  code: ProblemCode;
  params: ProblemParams;
  /** The English text, for API clients and the English interface. */
  message: string;
}

export function problem(code: ProblemCode, params: ProblemParams = {}): Problem {
  const message = IMPORT_MESSAGES[code].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  return { code, params, message };
}
