import { recordPlatformAudit } from '../audit/audit.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { keyId } from '../lib/crypto.js';
import { rotateDataKeys } from '../ops/data-keys.js';

// Usage: rotate-data-key [--check]
// Re-encrypts the secrets kept encrypted at rest (two-factor secrets, webhook
// signing secrets) with DATA_ENCRYPTION_KEY, reading values written with any key
// in DATA_ENCRYPTION_KEYS_PREVIOUS. --check only reports. Exits with 1 when a
// value cannot be read with the configured keys.
// Runbook: docs/DEPLOYMENT_GUIDE.md, "Rotating DATA_ENCRYPTION_KEY".

async function main() {
  const check = process.argv.includes('--check');
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, { poolMax: 2, ssl: config.DATABASE_SSL });
  try {
    const ring = config.dataKeys;
    console.log(`Current key: ${keyId(ring.current)}${ring.previous.length ? `; previous keys: ${ring.previous.map(keyId).join(', ')}` : '; no previous keys'}`);
    const reports = await rotateDataKeys(db, ring, { write: !check });
    for (const r of reports) {
      const keys = Object.entries(r.byKey).map(([k, n]) => `${k}: ${n}`).join(', ') || 'none';
      console.log(`${r.table}.${r.column}: ${r.total} values (${keys}); ${r.current} with the current key; ${r.rewrapped} ${check ? 'to re-encrypt' : 're-encrypted'}; ${r.unreadable.length} unreadable`);
    }
    const unreadable = reports.flatMap((r) => r.unreadable.map((id) => `${r.table}.${r.column} ${id}`));
    const pending = reports.reduce((n, r) => n + r.rewrapped, 0);
    if (!check) {
      await recordPlatformAudit(db, { type: 'system', email: 'cli' }, {
        action: 'admin.data_key_rotated',
        metadata: { currentKey: keyId(ring.current), reencrypted: pending, unreadable: unreadable.length },
      });
    }
    if (unreadable.length) {
      console.error(`\n${unreadable.length} values cannot be read with the configured keys (left unchanged). Add the key they were written with to DATA_ENCRYPTION_KEYS_PREVIOUS and run again:\n${unreadable.slice(0, 20).join('\n')}`);
      process.exitCode = 1;
    } else if (check && pending) {
      console.log('\nRun without --check to re-encrypt them with the current key.');
    } else if (ring.previous.length) {
      console.log('\nEvery value uses the current key. Remove DATA_ENCRYPTION_KEYS_PREVIOUS and restart; keep the old key with any backup made before the rotation.');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
