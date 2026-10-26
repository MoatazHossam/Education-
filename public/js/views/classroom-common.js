// Helpers shared by the classroom pages (classes and homework, online tests).
import { errorMessage, fmtNum, toast } from '../dom.js';
import { locale, t } from '../i18n.js';

export const subjectName = (x) => (locale() === 'ar' ? x.subjectAr : x.subjectEn);

/** Runs an action from a button; a failure becomes an error toast. */
export const act = async (fn) => { try { await fn(); } catch (err) { toast(errorMessage(err), 'error'); } };

/** "datetime-local" value for a date, in the browser's time zone. */
export function localInput(d) {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Subjects this member may set work for in a class: their own; for admins every subject of the class. */
export function settableSubjects(data) {
  const fromCatalogue = (en) => data.subjects.find((s) => s.nameEn === en);
  const own = data.teaching.map((x) => ({ nameEn: x.subjectEn, nameAr: x.subjectAr, materials: fromCatalogue(x.subjectEn)?.materials ?? [] }));
  if (!data.admin) return own;
  const all = [...own];
  for (const x of data.teachers) if (!all.some((s) => s.nameEn === x.subjectEn)) all.push({ nameEn: x.subjectEn, nameAr: x.subjectAr, materials: fromCatalogue(x.subjectEn)?.materials ?? [] });
  for (const s of data.subjects) if (!all.some((a) => a.nameEn === s.nameEn)) all.push(s);
  return all;
}

/** "1 point", "6 points"; in Arabic the noun follows the number (درجة واحدة، درجتان، 3 درجات، 11 درجة). */
export function pointsText(n) {
  if (n === 1) return t('tests.points1');
  if (n === 2) return t('tests.points2');
  if (Number.isInteger(n) && n >= 3 && n <= 10) return t('tests.pointsFew', { n: fmtNum(n) });
  return t('tests.pointsN', { n: fmtNum(n) });
}
