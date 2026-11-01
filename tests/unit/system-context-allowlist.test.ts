import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// withSystemContext runs as the system role, which bypasses Row-Level Security and
// sees every school's data (src/db/index.ts). Each use must be a deliberate, reviewed
// exception. This list is that review: a new call site, or one more in a listed file,
// fails here until it is added with a reason (docs/production/SECURITY_GAP_ANALYSIS.md S-3).
const ALLOWED: Record<string, { calls: number; why: string }> = {
  'src/admin/routes.ts': { calls: 1, why: 'platform administration across schools (platform admins only, MFA)' },
  'src/ai/routes.ts': { calls: 2, why: 'platform admin AI overview across schools; audit of the connection test' },
  'src/api-v1/routes.ts': { calls: 2, why: 'API key lookup before the school is known; last-used time' },
  'src/audit/audit.ts': { calls: 1, why: 'platform-level audit entries (no school context)' },
  'src/auth/routes.ts': { calls: 4, why: 'invitation tokens before membership (register, view, accept); a user’s own audit entries in their data export' },
  'src/billing/routes.ts': { calls: 3, why: 'payment provider webhooks and sandbox checkout (signed)' },
  'src/billing/service.ts': { calls: 2, why: 'worker: subscription lifecycle for every school' },
  'src/classroom/file-checks.ts': { calls: 2, why: 'worker: virus scan queue across schools' },
  'src/classroom/retention.ts': { calls: 1, why: 'worker: list schools with retention periods (deletion runs per school)' },
  'src/classroom/service.ts': { calls: 1, why: 'worker: homework announcements due' },
  'src/classroom/tests-service.ts': { calls: 1, why: 'worker: test deadlines' },
  'src/cli/create-platform-admin.ts': { calls: 2, why: 'command-line: platform admin creation audit' },
  'src/jobs/tasks.ts': { calls: 2, why: 'worker: email outbox and retention cleanup' },
  'src/ops/alerts.ts': { calls: 1, why: 'operational alert checks (counts only)' },
  'src/ops/data-keys.ts': { calls: 2, why: 'command-line: re-encrypting secrets with a new key' },
  'src/orgs/routes.ts': { calls: 1, why: 'organization deletion after the owner check (inOrg)' },
  'src/scopes/digest.ts': { calls: 2, why: 'worker: daily assignment summaries across schools' },
  'src/scopes/reminders.ts': { calls: 2, why: 'worker: due-date reminders across schools' },
  'src/webhooks/service.ts': { calls: 2, why: 'worker: customer webhook deliveries' },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('cross-tenant (system context) call sites', () => {
  it('match the reviewed list', () => {
    const found: Record<string, number> = {};
    for (const file of sourceFiles('src')) {
      const calls = readFileSync(file, 'utf8').match(/\bwithSystemContext\(/g)?.length ?? 0;
      if (calls) found[relative('.', file).split('\\').join('/')] = calls;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.calls])));
  });
});
