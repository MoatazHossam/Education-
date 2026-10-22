import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';
import { seedCatalog, seedPlans } from './seed.js';
import { seedDemoData } from './seed-demo.js';

// Usage: seed-cli [--catalog-only]
// Plans and the 2026/2027 catalogue are safe to seed anywhere (idempotent).
// Demo organizations/users are created only outside production.
async function main() {
  const config = loadConfig();
  const db = createDatabase(config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL, { poolMax: 2, ssl: config.DATABASE_SSL });
  try {
    await seedPlans(db, config.BILLING_CURRENCY);
    const catalog = await seedCatalog(db);
    console.log(`Plans seeded. Catalogue ${catalog.created ? 'created' : 'already present'} (${catalog.versionId}).`);
    if (!process.argv.includes('--catalog-only')) {
      if (config.isProduction) throw new Error('Refusing to create demo data in production');
      const demo = await seedDemoData(db, config, catalog.versionId);
      console.log(demo.message);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
