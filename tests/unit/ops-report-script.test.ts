import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseHostFacts } from '../../src/ops/report.js';

// ops/midad.sh report (docs/DEPLOYMENT_GUIDE.md §8.11): the Linux functions that measure the backups and the
// version, run here on files laid out as a server's, and the command that hands them to the app. The
// output is read with the same parser the app uses.
const sh = readFileSync('ops/midad.sh', 'utf8');
const fn = (name: string) => {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(sh);
  expect(m, name).not.toBeNull();
  return m![0];
};
const dir = mkdtempSync(join(tmpdir(), 'midad-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function bash(body: string, env: Record<string, string> = {}): { out: string; err: string; code: number } {
  const r = spawnSync('bash', ['-c', ['set -euo pipefail', body].join('\n')], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { out: r.stdout, err: r.stderr, code: r.status ?? -1 };
}
const helpers = (root: string, log: string) => [
  `ROOT=${JSON.stringify(root)} ENV_NAME=prod R_LOG=${JSON.stringify(log)} CONF=${JSON.stringify(join(root, '.env.backup'))}`,
  fn('kv_get'),
  'conf() { kv_get "$CONF" "$1"; }',
  fn('backup_dir'),
  fn('backup_facts'),
  fn('app_version'),
].join('\n');

function server(name: string) {
  const root = join(dir, name);
  const backups = join(root, 'backups');
  mkdirSync(backups, { recursive: true });
  return { root, backups, log: join(root, 'backup.log') };
}

describe('ops report script: backups', () => {
  it('finds this installation\'s newest backup, checks it against its checksum and reads the backup log', () => {
    const s = server('a');
    for (const n of ['midad-backup-prod-20261109T021500Z.tar.enc', 'midad-backup-prod-20261110T021500Z.tar.enc', 'midad-backup-dev-20261111T000000Z.tar.enc']) {
      writeFileSync(join(s.backups, n), `archive ${n}`);
    }
    bash(`cd ${JSON.stringify(s.backups)} && for f in *.tar.enc; do sha256sum "$f" > "$f.sha256"; done`);
    writeFileSync(join(s.root, '.env.backup'), 'BACKUP_COPY_TO=server\nBACKUP_KEEP_DAYS=30\n');
    writeFileSync(s.log, [
      'The backup can be restored. (The scratch database midad_check_20261102034501 was removed.)',
      'Error: could not reach the backup server|port 22',
      '== Done',
      'The backup can be restored. (The scratch database midad_check_20261109034502 was removed.)',
    ].join('\n'));
    const r = bash(`${helpers(s.root, s.log)}\nbackup_facts`);
    expect(r.code, r.err).toBe(0);
    const f = parseHostFacts(r.out);
    expect(f.backup.count).toBe(2); // the development installation's backup is not counted
    expect(f.backup.latest).toMatchObject({ name: 'midad-backup-prod-20261110T021500Z.tar.enc', checksum: 'ok' });
    expect(f.backup.copies).toEqual(['server']);
    expect(f.backup.keepDays).toBe(30);
    expect(f.backup.lastVerifiedAt?.toISOString()).toBe('2026-11-09T03:45:02.000Z');
    expect(f.backup).toMatchObject({ logErrors: 1, lastLogError: 'could not reach the backup serverport 22' });

    // A damaged file, then one without a checksum.
    writeFileSync(join(s.backups, 'midad-backup-prod-20261110T021500Z.tar.enc'), 'damaged');
    expect(parseHostFacts(bash(`${helpers(s.root, s.log)}\nbackup_facts`).out).backup.latest?.checksum).toBe('mismatch');
    rmSync(join(s.backups, 'midad-backup-prod-20261110T021500Z.tar.enc.sha256'));
    expect(parseHostFacts(bash(`${helpers(s.root, s.log)}\nbackup_facts`).out).backup.latest?.checksum).toBe('missing');
  });

  it('says when there is no backup and no successful test, and skips the log when there is none', () => {
    const s = server('b');
    writeFileSync(s.log, 'Error: the checksum of x does not match: the file is damaged\n');
    const f = parseHostFacts(bash(`${helpers(s.root, s.log)}\nbackup_facts`).out);
    expect(f.backup.count).toBe(0);
    expect(f.backup.latest).toBeUndefined();
    expect(f.backup.lastVerifiedAt).toBeNull();
    const noLog = parseHostFacts(bash(`${helpers(s.root, join(s.root, 'missing.log'))}\nbackup_facts`).out);
    expect(noLog.backup.lastVerifiedAt).toBeUndefined();
  });
});

describe('ops report script: version and schedule', () => {
  it('reads the version a package stamped, and nothing from an unstamped file', () => {
    const s = server('c');
    writeFileSync(join(s.root, 'VERSION'), '$Format:%H %cs$\n');
    expect(bash(`${helpers(s.root, s.log)}\napp_version`).out).toBe('unknown');
    writeFileSync(join(s.root, 'VERSION'), '5a802418f32a2ea01fc24775de6c5f7e24c0c5d5 2026-11-10\n');
    expect(bash(`${helpers(s.root, s.log)}\napp_version`).out).toBe('5a802418f32a2ea01fc24775de6c5f7e24c0c5d5 2026-11-10');
  });

  it('runs only at the chosen hour of the chosen zone, and hands the facts and the recipients to the app', () => {
    const stubs = [
      'CLEANUP=() R_HOURS=24 R_LANG="" R_TZ="" R_EMAIL="" R_AT="" R_CLEANUP=1',
      'pick_env() { :; }',
      'conf() { case $1 in REPORT_EMAIL) printf saved@example.com ;; *) ;; esac; }',
      'envget() { printf alerts@example.com; }',
      'die() { printf "Error: %s\\n" "$*" >&2; exit 1; }',
      'report_facts() { echo "host=test"; }',
      'cleanup_facts() { echo "cleanup=images|0B"; }',
      'running() { return 0; }',
      'dc() { printf "dc %s\\n" "$*"; cat; }',
      fn('cmd_report'),
    ].join('\n');
    const now = bash('TZ=Africa/Cairo date +%H').out.trim();
    const other = String((Number(now) + 5) % 24);
    expect(bash(`${stubs}\nR_AT=${other}\ncmd_report`).out).toBe('');
    const ran = bash(`${stubs}\nR_AT=${Number(now)}\nR_EMAIL=faramawi@example.com\ncmd_report`);
    expect(ran.out).toContain('dc exec -T app node dist/cli/ops-report.js --hours 24 --lang ar --time-zone Africa/Cairo --to faramawi@example.com');
    expect(ran.out).toContain('host=test\ncleanup=images|0B');
    // Without --email: the saved address; English and another zone on request; a bad hour refused.
    expect(bash(`${stubs}\nR_LANG=en\nR_TZ=UTC\ncmd_report`).out).toContain('--lang en --time-zone UTC --to saved@example.com');
    expect(bash(`${stubs}\nR_AT=25\ncmd_report`).err).toContain('--at-hour needs an hour from 0 to 23');
  });
});
