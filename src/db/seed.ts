import { sql } from 'kysely';
import { PLAN_DEFINITIONS } from '../billing/plans.js';
import { buildLegacyDataset, type Dataset } from '../catalog/legacy-dataset.js';
import { withSystemContext, type Database, type Trx } from './index.js';

export async function seedPlans(db: Database, currency: string): Promise<void> {
  await withSystemContext(db, async (trx) => {
    for (const p of PLAN_DEFINITIONS) {
      // Insert only: never overwrite prices an operator has changed at runtime.
      await trx
        .insertInto('plans')
        .values({
          id: p.id,
          name: p.name,
          description: p.description,
          price_monthly_cents: p.priceMonthlyCents,
          price_yearly_cents: p.priceYearlyCents,
          currency,
          limits: JSON.stringify(p.limits),
          features: JSON.stringify(p.features),
          is_public: p.isPublic,
          is_self_serve: p.isSelfServe,
          sort_order: p.sortOrder,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    }
  });
}

export async function insertCatalogVersion(
  trx: Trx,
  dataset: Dataset,
  opts: { status: 'draft' | 'published'; createdBy?: string | null },
): Promise<string> {
  const version = await trx
    .insertInto('catalog_versions')
    .values({
      academic_year: dataset.academicYear,
      label: dataset.label,
      status: opts.status,
      notice: dataset.notice,
      grade_notes: JSON.stringify(dataset.gradeNotes),
      published_at: opts.status === 'published' ? new Date() : null,
      created_by: opts.createdBy ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  if (dataset.sources.length) {
    await trx
      .insertInto('catalog_sources')
      .values(dataset.sources.map((s, i) => ({ version_id: version.id, title: s.title, url: s.url, sort_order: i })))
      .execute();
  }

  // Batch inserts: subjects first, then all materials in one statement per chunk.
  const subjectRows = await trx
    .insertInto('catalog_subjects')
    .values(
      dataset.subjects.map((s, i) => ({
        version_id: version.id,
        grade: s.grade,
        track: s.track,
        block: s.block,
        code: s.code,
        name_en: s.nameEn,
        name_ar: s.nameAr,
        status: s.status,
        note: s.note,
        sort_order: i,
      })),
    )
    .returning(['id', 'sort_order'])
    .execute();
  const idByOrder = new Map(subjectRows.map((r) => [r.sort_order, r.id]));
  const materials = dataset.subjects.flatMap((s, i) =>
    s.materials.map((m, j) => ({ subject_id: idByOrder.get(i)!, version_id: version.id, kind: m.kind, title: m.title, sort_order: j })),
  );
  for (let i = 0; i < materials.length; i += 500) {
    await trx.insertInto('catalog_materials').values(materials.slice(i, i + 500)).execute();
  }
  return version.id;
}

/** Seeds the 2026/2027 catalogue from the legacy dataset unless that year already exists. */
export async function seedCatalog(db: Database): Promise<{ versionId: string; created: boolean }> {
  const dataset = buildLegacyDataset();
  return withSystemContext(db, async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('seed_catalog'))`.execute(trx);
    const existing = await trx
      .selectFrom('catalog_versions')
      .select('id')
      .where('academic_year', '=', dataset.academicYear)
      .orderBy('created_at')
      .executeTakeFirst();
    if (existing) return { versionId: existing.id, created: false };
    const versionId = await insertCatalogVersion(trx, dataset, { status: 'published' });
    return { versionId, created: true };
  });
}
