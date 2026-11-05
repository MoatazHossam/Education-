import { loadConfig, loadMigrationConfig } from '../config.js';
import { createDatabase } from './index.js';
import { seedCatalog, seedPlans } from './seed.js';
import { seedDemoData } from './seed-demo.js';

// Usage: seed-cli [--catalog-only]
// Plans and the 2026/2027 catalogue are safe to seed anywhere (idempotent).
// Demo organizations/users are created only outside production.
// --catalog-only (the migrate job) reads only the migration settings; demo data needs the app's (its keys).
async function main() {
  const catalogOnly = process.argv.includes('--catalog-only');
  const config = loadMigrationConfig();
  const db = createDatabase(config.databaseUrl, { poolMax: 2, ssl: config.DATABASE_SSL });
  try {
    await seedPlans(db, config.BILLING_CURRENCY);
    const catalog = await seedCatalog(db);
    console.log(`Plans seeded. Catalogue ${catalog.created ? 'created' : 'already present'} (${catalog.versionId}).`);
    if (!catalogOnly) {
      if (config.isProduction) throw new Error('Refusing to create demo data in production');
      const demo = await seedDemoData(db, loadConfig(), catalog.versionId);
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
