import { sql } from 'kysely';
import { withSystemContext, type Database } from '../db/index.js';
import { decryptSecret, encryptSecret, envelopeKeyId, keyId, type KeyRing } from '../lib/crypto.js';

// Rotation of DATA_ENCRYPTION_KEY (docs/DEPLOYMENT_GUIDE.md, "Rotating
// DATA_ENCRYPTION_KEY"). With the new key as DATA_ENCRYPTION_KEY and the old one
// in DATA_ENCRYPTION_KEYS_PREVIOUS, the application reads both; this rewrites
// every encrypted value with the new key so the old one can be retired. Values
// are read and written in batches; a value changed meanwhile (for example a
// member enabling two-factor sign-in) is left alone, since the application
// already wrote it with the current key. Plaintexts stay in memory only.

/** Every column holding a value encrypted with encryptSecret. */
export const ENCRYPTED_COLUMNS = [
  { table: 'users', column: 'mfa_secret_enc' },
  { table: 'users', column: 'mfa_pending_secret_enc' },
  { table: 'webhook_endpoints', column: 'secret_enc' },
] as const;

export interface ColumnReport {
  table: string;
  column: string;
  total: number;
  /** Values already written with the current key. */
  current: number;
  /** Values written with another configured key: re-encrypted (or, when checking, to re-encrypt). */
  rewrapped: number;
  /** Ids of values no configured key decrypts (left unchanged). */
  unreadable: string[];
  /** Values per key id ("v1" for envelopes from before key ids were recorded). */
  byKey: Record<string, number>;
}

const BATCH = 200;
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** Re-encrypts every value with the ring's current key (`write: false` only reports what it would do). */
export async function rotateDataKeys(db: Database, ring: KeyRing, opts: { write: boolean }): Promise<ColumnReport[]> {
  const currentId = keyId(ring.current);
  const reports: ColumnReport[] = [];
  for (const { table, column } of ENCRYPTED_COLUMNS) {
    const report: ColumnReport = { table, column, total: 0, current: 0, rewrapped: 0, unreadable: [], byKey: {} };
    let after = NO_ID;
    for (;;) {
      const rows = await withSystemContext(db, async (trx) => {
        const { rows } = await sql<{ id: string; value: string }>`
          SELECT id, ${sql.ref(column)} AS value FROM ${sql.table(table)}
          WHERE ${sql.ref(column)} IS NOT NULL AND id > ${after}
          ORDER BY id LIMIT ${BATCH}`.execute(trx);
        return rows;
      });
      if (!rows.length) break;
      after = rows[rows.length - 1]!.id;
      const updates: { id: string; from: string; to: string }[] = [];
      for (const r of rows) {
        const kid = envelopeKeyId(r.value) ?? 'v1';
        report.total++;
        report.byKey[kid] = (report.byKey[kid] ?? 0) + 1;
        if (kid === currentId) {
          report.current++;
          continue;
        }
        let plain: string;
        try {
          plain = decryptSecret(ring, r.value);
        } catch {
          report.unreadable.push(r.id);
          continue;
        }
        if (opts.write) updates.push({ id: r.id, from: r.value, to: encryptSecret(ring, plain) });
        else report.rewrapped++;
      }
      if (updates.length) {
        await withSystemContext(db, async (trx) => {
          for (const u of updates) {
            const res = await sql`
              UPDATE ${sql.table(table)} SET ${sql.ref(column)} = ${u.to}
              WHERE id = ${u.id} AND ${sql.ref(column)} = ${u.from}`.execute(trx);
            if (Number(res.numAffectedRows ?? 0) > 0) report.rewrapped++;
          }
        });
      }
    }
    reports.push(report);
  }
  return reports;
}
