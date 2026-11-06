import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The ops scripts' start and status (docs/DEPLOYMENT_GUIDE.md §8.2) say what keeps an installation from
// running: an empty required setting, or a failed database update with the migrate command's own message.
// The Linux functions run here against a stand-in for `docker compose`; the Windows script is checked to
// do the same with the same names and markers.
const sh = readFileSync('ops/midad.sh', 'utf8');
const ps = readFileSync('ops/midad.ps1', 'utf8');
const cli = readFileSync('src/db/migrate-cli.ts', 'utf8');
const fn = (name: string) => {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(sh);
  expect(m, name).not.toBeNull();
  return m![0];
};
const dir = mkdtempSync(join(tmpdir(), 'midad-ops-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs `body` with the script's functions, a settings file and a `dc` that answers as `docker compose` would. */
function run(settings: string, dc: { state?: string; name?: string; log?: string }, body: string): { out: string; err: string; code: number } {
  const id = Math.random().toString(36).slice(2);
  const env = join(dir, `env-${id}`);
  const log = join(dir, `log-${id}`);
  writeFileSync(env, settings);
  writeFileSync(log, dc.log ?? '');
  const fake = `dc() {
    case "$*" in
      *"ps -a --format {{.State}} {{.ExitCode}} migrate"*) printf '%s\\n' ${JSON.stringify(dc.state ?? '')} ;;
      *"ps -a --format {{.Name}} migrate"*) printf '%s\\n' ${JSON.stringify(dc.name ?? '')} ;;
      *"logs --since 2026-11-06T16:00:00.1Z --no-log-prefix --no-color migrate"*) cat ${JSON.stringify(log)} ;;
    esac
  }
  started_at() { printf '2026-11-06T16:00:00.1Z'; }`;
  const script = [
    'set -euo pipefail',
    `ENV_FILE=${JSON.stringify(env)} ENV_NAME=dev MANAGED=0`,
    // kv_get as the script reads its settings: the value of KEY= in the file.
    'envget() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }',
    "say() { printf '%s\\n' \"$*\"; }",
    "warn() { printf 'Warning: %s\\n' \"$*\" >&2; }",
    "die() { printf 'Error: %s\\n' \"$*\" >&2; exit 1; }",
    fake,
    fn('missing_settings'),
    fn('system_role_note'),
    fn('explain_problems'),
    body,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { out: r.stdout, err: r.stderr, code: r.status ?? -1 };
}

const COMPLETE = ['SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'POSTGRES_SUPERUSER_PASSWORD', 'DB_NAME', 'DB_OWNER_USER', 'DB_OWNER_PASSWORD', 'DB_APP_USER', 'DB_APP_PASSWORD', 'DB_SYSTEM_PASSWORD', 'DB_BACKUP_PASSWORD']
  .map((k) => `${k}=x${k.length}`)
  .join('\n');
const withoutSystem = COMPLETE.split('\n').filter((l) => !l.startsWith('DB_SYSTEM_PASSWORD=')).join('\n');
const GUIDE = 'docs/DEPLOYMENT_GUIDE.md §3.3 "Installations made before migration 0019"';

describe('ops scripts: what keeps an installation from running', () => {
  it('names an empty DB_SYSTEM_PASSWORD with the guide section an older database also needs', () => {
    const r = run(withoutSystem, {}, 'mapfile -t m < <(missing_settings); printf "%s" "${m[*]}$(system_role_note "${m[@]}")"');
    expect(r.out.split('\n')[0]).toBe('DB_SYSTEM_PASSWORD');
    expect(r.out).toContain(GUIDE);
    // Another missing setting alone gets no such note.
    const other = run(COMPLETE.replace(/^SESSION_SECRET=.*$/m, 'SESSION_SECRET='), {}, 'mapfile -t m < <(missing_settings); printf "%s" "${m[*]}$(system_role_note "${m[@]}")"');
    expect(other.out).toBe('SESSION_SECRET');
    expect(run(COMPLETE, {}, 'missing_settings').out).toBe('');
  });

  it('start refuses, saying the setting and the section', () => {
    const check = fn('check_env').replace(/\n {2}if \[\[ \$ENV_NAME == prod \]\]; then[\s\S]*$/, '\n}');
    const r = run(withoutSystem, {}, `${check}\ncheck_env`);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Error: set these in ');
    expect(r.err).toMatch(/first: DB_SYSTEM_PASSWORD\n {2}The system role came with migration 0019/);
    expect(r.err).toContain(GUIDE);
  });

  it('status shows the database update’s own message when it failed, and where its full log is', () => {
    const log = [
      'Database already up to date',
      'migrate: The database has no role "midad_system" (the system role, SYSTEM_DB_ROLE). A database set up before migration 0019 lacks it: …',
      'migrate: Nothing was changed in the database.',
      '',
    ].join('\n');
    const r = run(COMPLETE, { state: 'exited 1', name: 'midad-migrate-1', log }, 'explain_problems');
    expect(r.code).toBe(0);
    expect(r.err).toContain('Warning: the database update (the migrate service) failed, so the app does not start:\n  The database has no role "midad_system"');
    expect(r.err).toContain('\n  Nothing was changed in the database.\n');
    expect(r.err).not.toContain('Database already up to date');
    expect(r.out).toBe('  Full log: docker logs midad-migrate-1\n');
  });

  it('status falls back to the first error line of another failure, and says nothing when the update succeeded', () => {
    const log = 'Database already up to date\nerror: role "midad_system" does not exist\n    at /app/node_modules/pg/lib/client.js:694:17\n';
    const r = run(COMPLETE, { state: 'exited 1', name: 'midad-migrate-1', log }, 'explain_problems');
    expect(r.err).toContain('\n  error: role "midad_system" does not exist\n');
    expect(r.err).not.toContain('client.js');
    for (const state of ['exited 0', 'running', '']) {
      const ok = run(COMPLETE, { state, name: 'midad-migrate-1', log }, 'explain_problems');
      expect(ok, state).toEqual({ out: '', err: '', code: 0 });
    }
    // Missing settings are said by status too, as a warning.
    expect(run(withoutSystem, {}, 'explain_problems').err).toMatch(/^Warning: empty in .*: DB_SYSTEM_PASSWORD \(the app cannot run without them\)\n {2}The system role/);
  });

  it('the Windows script does the same, and both read the marker the migrate command writes', () => {
    const keys = (src: string) => [...src.matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]!);
    const shKeys = (fn('missing_settings').match(/\b[A-Z][A-Z_]{3,}\b/g) ?? []).filter((k) => k !== 'MANAGED' && k !== 'ENV_NAME');
    const psFn = /^function Get-MissingSettings \{[\s\S]*?^\}$/m.exec(ps)?.[0] ?? '';
    expect(keys(psFn)).toEqual(shKeys);
    expect(ps).toMatch(/^function Show-Status \{[\s\S]*?^ {2}Show-Problems$[\s\S]*?^\}$/m);
    // A start that fails at the database update explains it too, instead of compose's one line.
    expect(sh).toMatch(/^ {2}if ! dc "\$\{args\[@\]\}"; then\n {4}explain_problems\n {4}die /m);
    expect(ps).toMatch(/^ {2}DC \$a -AllowFail\n {2}if \(\$script:Code -ne 0\) \{\n {4}Show-Problems\n {4}Die /m);
    // Only the last run's log: each start runs migrate again in the same container.
    expect(ps).toContain("$since = @('--since', $started)");
    expect(sh).toMatch(/^show_status\(\) \{[\s\S]*?^ {2}explain_problems$[\s\S]*?^\}$/m);
    expect(ps).toMatch(/Check-Env \{\n {2}\$missing = Get-MissingSettings\n {2}if \(\$missing\.Count\) \{ Die .*\$\(Get-SystemRoleNote \$missing\)/);
    expect(ps).toContain('"Installations made before migration 0019`" shows.');
    // The marker: written by migrate-cli on each line of a setup problem, removed by both scripts.
    expect(cli).toContain(".replace(/^/gm, 'migrate: ')");
    expect(sh).toContain("grep '^migrate: ' | sed 's/^migrate: //'");
    expect(ps).toContain("$_.StartsWith('migrate: ') } | ForEach-Object { $_.Substring(9) }");
    expect('migrate: '.length).toBe(9);
  });
});
