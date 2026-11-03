import { z } from 'zod';
import { hasRole, type OrgAccess } from '../auth/guards.js';
import { loadCatalogTree } from '../catalog/service.js';
import type { Executor } from '../db/index.js';
import type { ScopesTable, TeachingPlanKind } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { zUuid } from '../lib/validation.js';

// Teaching plans of a curriculum scope (docs/TEACHING_PLANS.md, migration 0018):
// lesson plans and pacing plans for a grade and subject of the scope. Any member
// may read them and write their own; the author and the school's admins may
// change or remove one. Plans are written by hand or start from a draft by the
// AI provider (plan-suggestions.ts); either way the member saves what they
// reviewed. No student data is involved.

export const PLAN_KINDS = ['lesson', 'pacing'] as const satisfies readonly TeachingPlanKind[];
/** Plans one scope may hold. */
export const MAX_PLANS_PER_SCOPE = 500;

const text = (max: number) => z.string().trim().max(max).default('');
const lines = (maxItems: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).default([]);
const zDate = z.iso.date().refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'Choose a date between 2000 and 2100');

export const LessonActivity = z.strictObject({
  title: z.string().trim().min(1).max(200),
  minutes: z.number().int().min(1).max(240),
  description: text(3000),
});

/** A lesson plan: what the lesson aims at and how the period is spent. */
export const LessonContent = z.strictObject({
  topic: z.string().trim().min(1).max(300),
  durationMinutes: z.number().int().min(10).max(240),
  books: lines(20, 300),
  objectives: lines(12, 500),
  materials: lines(15, 300),
  warmUp: text(2000),
  activities: z.array(LessonActivity).max(15).default([]),
  questions: lines(15, 500),
  assessment: text(2000),
  homework: text(2000),
  differentiation: text(2000),
  notes: text(3000),
});
export type LessonContent = z.infer<typeof LessonContent>;

export const PacingWeek = z.strictObject({
  topics: text(1000),
  objectives: text(1000),
  notes: text(1000),
});

/** A pacing plan: the subject's curriculum spread over the weeks of a term, from its first week. */
export const PacingContent = z.strictObject({
  startDate: zDate,
  periodsPerWeek: z.number().int().min(1).max(15),
  books: lines(20, 300),
  weeks: z.array(PacingWeek).min(1).max(52),
});
export type PacingContent = z.infer<typeof PacingContent>;

export const zPlanTitle = z.string().trim().min(1).max(200);
export const zPlanLanguage = z.enum(['ar', 'en']);
const zGrade = z.number().int().min(1).max(12);
const zSubjectEn = z.string().trim().min(1).max(120);

const common = { grade: zGrade, subjectEn: zSubjectEn, title: zPlanTitle, language: zPlanLanguage, aiAssisted: z.boolean().default(false) };
export const PlanBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lesson'), ...common, content: LessonContent }),
  z.object({ kind: z.literal('pacing'), ...common, content: PacingContent }),
]);
export const PlanPatch = z
  .object({ title: zPlanTitle.optional(), language: zPlanLanguage.optional(), content: z.record(z.string(), z.unknown()).optional() })
  .refine((b) => b.title !== undefined || b.language !== undefined || b.content !== undefined, { message: 'Nothing to change', path: ['title'] });

/** Checks a plan's content against its kind, with the field errors a form can show. */
export function parseContent(kind: TeachingPlanKind, content: unknown): LessonContent | PacingContent {
  const res = (kind === 'lesson' ? LessonContent : PacingContent).safeParse(content);
  if (!res.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request contains invalid data', res.error.issues.map((i) => ({ path: ['content', ...i.path].join('.'), message: i.message })));
  }
  return res.data;
}

export interface ScopeSubject {
  nameEn: string;
  nameAr: string;
  /** Titles of the subject's books selected in the scope. */
  books: string[];
}

/** Grades and subjects with books selected in the scope: what plans can be written for. */
export async function scopeSubjects(exec: Executor, scope: Pick<ScopesTable, 'catalog_version_id'> & { id: string }) {
  const tree = await loadCatalogTree(exec, scope.catalog_version_id, { allowUnpublished: true });
  const selected = new Set((await exec.selectFrom('scope_items').select('material_id').where('scope_id', '=', scope.id).execute()).map((r) => r.material_id));
  const grades = new Map<number, Map<string, ScopeSubject>>();
  for (const s of tree.subjects) {
    const books = s.materials.filter((m) => selected.has(m.id)).map((m) => m.title);
    if (!books.length) continue;
    const subjects = grades.get(s.grade) ?? new Map<string, ScopeSubject>();
    const entry = subjects.get(s.nameEn) ?? { nameEn: s.nameEn, nameAr: s.nameAr, books: [] };
    entry.books.push(...books);
    subjects.set(s.nameEn, entry);
    grades.set(s.grade, subjects);
  }
  return {
    academicYear: tree.version.academicYear,
    grades: [...grades.entries()].sort(([a], [b]) => a - b).map(([grade, subjects]) => ({ grade, subjects: [...subjects.values()] })),
  };
}

/** The subject of a grade in the scope, or a 400 naming what to choose. */
export async function scopeSubject(exec: Executor, scope: Pick<ScopesTable, 'catalog_version_id'> & { id: string }, grade: number, subjectEn: string): Promise<ScopeSubject> {
  const subject = (await scopeSubjects(exec, scope)).grades.find((g) => g.grade === grade)?.subjects.find((s) => s.nameEn === subjectEn);
  if (!subject) throw new AppError(400, 'INVALID_SUBJECT', 'Choose a grade and subject with books selected in this scope');
  return subject;
}

const PLAN_COLUMNS = [
  'p.id', 'p.scope_id', 'p.kind', 'p.grade', 'p.subject_en', 'p.subject_ar', 'p.title', 'p.language', 'p.content', 'p.ai_assisted',
  'p.created_by', 'p.created_at', 'p.updated_at', 'a.name as createdByName', 'b.name as updatedByName',
] as const;

function planQuery(exec: Executor) {
  return exec
    .selectFrom('teaching_plans as p')
    .leftJoin('users as a', 'a.id', 'p.created_by')
    .leftJoin('users as b', 'b.id', 'p.updated_by')
    .select([...PLAN_COLUMNS]);
}
type PlanRow = Awaited<ReturnType<ReturnType<typeof planQuery>['executeTakeFirstOrThrow']>>;

/** The author and the school's admins may change or remove a plan. */
export function canEditPlan(access: OrgAccess, plan: { created_by: string | null }): boolean {
  return plan.created_by === access.user.id || hasRole(access.role, 'admin');
}

/** What a list shows of a plan's content. */
function summary(kind: TeachingPlanKind, content: Record<string, unknown>) {
  return kind === 'lesson'
    ? { topic: String(content.topic ?? ''), durationMinutes: Number(content.durationMinutes ?? 0) }
    : { startDate: String(content.startDate ?? ''), weeks: Array.isArray(content.weeks) ? content.weeks.length : 0 };
}

function planHead(row: PlanRow, access: OrgAccess) {
  return {
    id: row.id,
    scopeId: row.scope_id,
    kind: row.kind,
    grade: row.grade,
    subjectEn: row.subject_en,
    subjectAr: row.subject_ar,
    title: row.title,
    language: row.language,
    aiAssisted: row.ai_assisted,
    createdBy: row.createdByName,
    updatedBy: row.updatedByName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: canEditPlan(access, row),
  };
}

export function planView(row: PlanRow, access: OrgAccess) {
  return { ...planHead(row, access), content: row.content };
}

export async function listPlans(exec: Executor, access: OrgAccess, scopeId: string) {
  const rows = await planQuery(exec).where('p.scope_id', '=', scopeId).orderBy('p.grade').orderBy('p.subject_en').orderBy('p.kind').orderBy('p.title').orderBy('p.created_at').execute();
  return rows.map((r) => ({ ...planHead(r, access), summary: summary(r.kind, r.content) }));
}

export async function getPlan(exec: Executor, scopeId: string, planId: string): Promise<PlanRow> {
  const row = zUuid.safeParse(planId).success ? await planQuery(exec).where('p.id', '=', planId).where('p.scope_id', '=', scopeId).executeTakeFirst() : undefined;
  if (!row) throw notFound('Plan');
  return row;
}

export async function planCount(exec: Executor, scopeId: string): Promise<number> {
  const row = await exec.selectFrom('teaching_plans').select((eb) => eb.fn.countAll<string>().as('n')).where('scope_id', '=', scopeId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

export function assertCanEdit(access: OrgAccess, plan: { created_by: string | null }): void {
  if (!canEditPlan(access, plan)) throw forbidden('Only the plan’s author and the school’s admins can change it', 'NOT_PLAN_AUTHOR');
}
