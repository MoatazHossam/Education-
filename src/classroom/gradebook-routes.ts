import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, recordAudit, requestMeta } from '../audit/audit.js';
import { inOrg } from '../auth/guards.js';
import type { Locale } from '../db/types.js';
import type { AppContext } from '../http/context.js';
import { toCsv } from '../lib/csv.js';
import { parse, zUuid } from '../lib/validation.js';
import { asStudent } from '../students/context.js';
import { buildGradebook, gradebookSubjects, type GradeCell, type GradeItem } from './gradebook.js';
import { classAccess, classStudents } from './service.js';

// The gradebook for teachers and "My grades" for students (docs/CLASSROOM.md §10).
// Read only: marks are given on the homework and test pages.

const ClassParams = z.object({ orgId: z.string(), classId: zUuid });
const Query = z.object({ subject: z.string().trim().max(120).optional(), format: z.enum(['json', 'csv']).default('json') });

const CSV_WORDS: Record<Locale, { student: string; username: string; average: string; missing: string; status: Record<Exclude<GradeCell['status'], 'marked'>, string> }> = {
  en: { student: 'Student', username: 'Username', average: 'Average %', missing: 'Missing', status: { to_mark: 'To mark', returned: 'Returned', missing: 'Missing', working: 'Working', pending: '' } },
  ar: { student: 'الطالب', username: 'اسم المستخدم', average: 'المتوسط ٪', missing: 'فات موعده', status: { to_mark: 'للتصحيح', returned: 'أُعيد', missing: 'فات موعده', working: 'يعمل الآن', pending: '' } },
};

function csvName(text: string): string {
  return text.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'class';
}

function itemHeading(it: GradeItem): string {
  return `${it.title} (${it.date.toISOString().slice(0, 10)}, /${it.maxPoints})`;
}

export function registerGradebookRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Any teacher of the class and the school's admins: the same people who can open its homework and tests.
  app.get('/api/orgs/:orgId/classes/:classId/gradebook', async (req, reply) => {
    const { orgId, classId } = parse(ClassParams, req.params);
    const q = parse(Query, req.query);
    const out = await inOrg(ctx, req, orgId, 'viewer', async (trx, access) => {
      const { cls } = await classAccess(trx, access, classId);
      const subjects = await gradebookSubjects(trx, classId);
      const subject = subjects.find((s) => s.subjectEn === q.subject) ?? (q.subject ? null : subjects[0] ?? null);
      const students = await classStudents(trx, classId);
      const book = subject ? await buildGradebook(trx, { classId, subjectEn: subject.subjectEn, studentIds: students.map((s) => s.userId), studentView: false }) : { items: [], rows: students.map((st) => ({ studentId: st.userId, cells: [], average: null, missing: 0 })) };
      if (q.format === 'csv') {
        await recordAudit(trx, actorFromRequest(req), { orgId, action: 'class.gradebook_exported', targetType: 'class', targetId: classId, metadata: { name: cls.name, subject: subject?.subjectEn ?? null, students: students.length } }, requestMeta(req));
      }
      return { cls, subjects, subject, students, book, locale: access.user.locale };
    });
    const { cls, subjects, subject, students, book } = out;
    const rows = students.map((s, i) => ({ name: s.name, username: s.username, ...book.rows[i]! }));
    if (q.format === 'csv') {
      const w = CSV_WORDS[out.locale];
      const csv = toCsv([
        [w.student, w.username, ...book.items.map(itemHeading), w.average, w.missing],
        ...rows.map((r) => [r.name, r.username, ...r.cells.map((c) => (c.status === 'marked' ? c.points : w.status[c.status])), r.average, r.missing]),
      ]);
      const name = `gradebook-${csvName(cls.name)}-${csvName(subject?.subjectEn ?? 'none')}.csv`;
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(csv);
    }
    return { class: { id: cls.id, name: cls.name, grade: cls.grade }, subjects, subject, items: book.items, students: rows };
  });

  // The student's own marks in each class and subject, once they are theirs to see.
  app.get('/api/student/grades', async (req) =>
    asStudent(ctx, req, async (trx, { user }) => {
      const classes = await trx.selectFrom('classes').select(['id', 'name']).orderBy('name').execute();
      const subjects = [];
      for (const cls of classes) {
        for (const s of await gradebookSubjects(trx, cls.id)) {
          const book = await buildGradebook(trx, { classId: cls.id, subjectEn: s.subjectEn, studentIds: [user.id], studentView: true });
          if (!book.items.length) continue;
          const row = book.rows[0]!;
          subjects.push({
            classId: cls.id,
            className: cls.name,
            ...s,
            average: row.average,
            missing: row.missing,
            items: book.items.map((it, i) => ({ ...it, ...row.cells[i]! })),
          });
        }
      }
      return { subjects };
    }),
  );
}
