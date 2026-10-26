import type { Executor } from '../db/index.js';
import type { Test, TestAttempt } from '../db/types.js';
import { num } from './service.js';
import { resultsVisible, testPhase } from './tests-service.js';

// The gradebook (docs/CLASSROOM.md §10): one class and subject, with a column
// for each marked piece of homework (those with a full mark) and each
// published test, and a row for each student. Staff see every mark given;
// a student sees their own marks only once returned (homework) or shown
// (tests). Nothing here changes a mark.

export type GradeStatus =
  /** A mark: points out of the item's full mark. */
  | 'marked'
  /** Handed in or submitted, not marked yet (or, for a student, results not shown yet). */
  | 'to_mark'
  /** Returned without a mark. */
  | 'returned'
  /** Not handed in by the due time, or a closed test never started. */
  | 'missing'
  /** Taking the test now. */
  | 'working'
  /** Not due yet, or the test is still to come or open. */
  | 'pending';

export interface GradeItem {
  kind: 'homework' | 'test';
  id: string;
  title: string;
  /** The due time (homework) or closing time (tests). */
  date: Date;
  maxPoints: number;
}

export interface GradeCell {
  status: GradeStatus;
  points: number | null;
}

export interface GradeRow {
  studentId: string;
  cells: GradeCell[];
  /** Points over full marks of the marked items, as a percentage with one decimal; null with nothing marked. */
  average: number | null;
  missing: number;
}

export interface ClassSubjectName {
  subjectEn: string;
  subjectAr: string;
}

/** Subjects with something to grade in the class: homework with a full mark, or a published test. */
export async function gradebookSubjects(exec: Executor, classId: string): Promise<ClassSubjectName[]> {
  const hw = await exec.selectFrom('homework').select(['subject_en', 'subject_ar']).distinct().where('class_id', '=', classId).where('max_points', 'is not', null).execute();
  const tests = await exec.selectFrom('tests').select(['subject_en', 'subject_ar']).distinct().where('class_id', '=', classId).where('status', '=', 'published').execute();
  const byName = new Map<string, ClassSubjectName>();
  for (const r of [...hw, ...tests]) byName.set(r.subject_en, { subjectEn: r.subject_en, subjectAr: r.subject_ar });
  return [...byName.values()].sort((a, b) => a.subjectEn.localeCompare(b.subjectEn));
}

/**
 * The columns and one row per student given. `studentView` applies what a
 * student may see: homework marks once returned, test scores once the test's
 * results setting shows them. Queries run in the caller's context, so in a
 * student's request row-level security also limits them to that student.
 */
export async function buildGradebook(
  exec: Executor,
  opts: { classId: string; subjectEn: string; studentIds: string[]; studentView: boolean; now?: Date },
): Promise<{ items: GradeItem[]; rows: GradeRow[] }> {
  const now = opts.now ?? new Date();
  const homework = await exec
    .selectFrom('homework')
    .select(['id', 'title', 'due_at', 'publish_at', 'max_points'])
    .where('class_id', '=', opts.classId)
    .where('subject_en', '=', opts.subjectEn)
    .where('max_points', 'is not', null)
    .where('publish_at', '<=', now)
    .execute();
  const tests = await exec.selectFrom('tests').selectAll().where('class_id', '=', opts.classId).where('subject_en', '=', opts.subjectEn).where('status', '=', 'published').execute();
  const testPoints = new Map<string, number>();
  if (tests.length) {
    const sums = await exec
      .selectFrom('test_questions')
      .select(['test_id', (e) => e.fn.sum<string>('points').as('total')])
      .where('test_id', 'in', tests.map((t) => t.id))
      .groupBy('test_id')
      .execute();
    for (const s of sums) testPoints.set(s.test_id, Number(s.total));
  }

  const ids = opts.studentIds;
  const submissions = homework.length && ids.length
    ? await exec
        .selectFrom('homework_submissions')
        .select(['homework_id', 'student_id', 'status', 'points', 'submitted_at'])
        .where('homework_id', 'in', homework.map((h) => h.id))
        .where('student_id', 'in', ids)
        .execute()
    : [];
  const attempts = tests.length && ids.length
    ? await exec.selectFrom('test_attempts').selectAll().where('test_id', 'in', tests.map((t) => t.id)).where('student_id', 'in', ids).execute()
    : [];

  const items: (GradeItem & { hw?: (typeof homework)[number]; test?: Test })[] = [
    ...homework.map((h) => ({ kind: 'homework' as const, id: h.id, title: h.title, date: h.due_at, maxPoints: Number(h.max_points), hw: h })),
    ...tests.map((t) => ({ kind: 'test' as const, id: t.id, title: t.title, date: t.closes_at, maxPoints: testPoints.get(t.id) ?? 0, test: t })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title));

  // A student reads the questions of a test only once started (row-level security): the full mark then comes from their attempt.
  for (const it of items) {
    if (it.kind === 'test' && !it.maxPoints) it.maxPoints = Number(attempts.find((a) => a.test_id === it.id)?.max_points ?? 0);
  }

  const rows = ids.map((studentId): GradeRow => {
    let earned = 0;
    let possible = 0;
    let missing = 0;
    const cells = items.map((it): GradeCell => {
      const cell = it.kind === 'homework' ? homeworkCell(it, submissions.find((s) => s.homework_id === it.id && s.student_id === studentId), now, opts.studentView) : testCell(it.test!, attempts.filter((a) => a.test_id === it.id && a.student_id === studentId), now, opts.studentView);
      if (cell.status === 'marked' && cell.points !== null && it.maxPoints > 0) {
        earned += cell.points;
        possible += it.maxPoints;
      }
      if (cell.status === 'missing') missing++;
      return cell;
    });
    return { studentId, cells, average: possible ? Math.round((earned / possible) * 1000) / 10 : null, missing };
  });
  return { items: items.map(({ kind, id, title, date, maxPoints }) => ({ kind, id, title, date, maxPoints })), rows };
}

function homeworkCell(
  it: { hw?: { due_at: Date } },
  sub: { status: string; points: string | null } | undefined,
  now: Date,
  studentView: boolean,
): GradeCell {
  if (sub?.status === 'returned') return num(sub.points) === null ? { status: 'returned', points: null } : { status: 'marked', points: num(sub.points) };
  // Staff can give a mark before returning the work; a student sees it once returned.
  if (sub?.status === 'submitted') return !studentView && num(sub.points) !== null ? { status: 'marked', points: num(sub.points) } : { status: 'to_mark', points: null };
  return { status: now > it.hw!.due_at ? 'missing' : 'pending', points: null };
}

function testCell(test: Test, attempts: TestAttempt[], now: Date, studentView: boolean): GradeCell {
  const submitted = attempts.filter((a) => a.status === 'submitted');
  const marked = submitted.filter((a) => !a.needs_marking && a.score !== null && (!studentView || resultsVisible(test, a, now)));
  if (marked.length) return { status: 'marked', points: Math.max(...marked.map((a) => Number(a.score))) };
  if (submitted.length) return { status: 'to_mark', points: null };
  if (attempts.some((a) => a.status === 'in_progress')) return { status: 'working', points: null };
  return { status: testPhase(test, now) === 'closed' ? 'missing' : 'pending', points: null };
}
