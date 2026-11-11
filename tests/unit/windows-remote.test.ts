import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Remote control from Windows (ops/windows-remote, docs/DEPLOYMENT_GUIDE.md §8.12): the server helper's actions,
// run here on a folder laid out as an installation with a stand-in for ops/midad.sh, and the batch files'
// wiring (Windows itself is not available here: the files are checked as text).
const KIT = 'ops/windows-remote';
const HELPER = `${KIT}/server/midad-remote.sh`;
const helper = readFileSync(HELPER, 'utf8');
const engine = readFileSync(`${KIT}/midad-remote.bat`, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'midad-remote-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An installation: ops/midad.sh prints its arguments (and exits with MIDAD_RC), plus backups, a log and a schedule. */
function install(name: string) {
  const root = join(dir, name);
  mkdirSync(join(root, 'ops'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'backups'), { recursive: true });
  writeFileSync(join(root, 'ops/midad.sh'), 'echo "midad.sh $*"; exit "${MIDAD_RC:-0}"\n');
  writeFileSync(join(root, 'scripts/rolling-restart.sh'), 'echo "rolling-restart ENV_FILE=$ENV_FILE in $PWD"\n');
  writeFileSync(join(root, '.env.production'), 'APP_URL=https://midad.example.com\n');
  writeFileSync(join(root, '.env.backup'), 'REPORT_TIME_ZONE=Africa/Cairo\n');
  writeFileSync(join(root, 'VERSION'), 'c0b1c0ba6d43c6dc184d74fa14b8641475a9b065 2026-11-10\n');
  return { root, backups: join(root, 'backups'), log: join(root, 'backup.log'), cron: join(root, 'cron'), flag: join(root, 'reboot-required') };
}
type Inst = ReturnType<typeof install>;

function run(inst: Inst, body: string, input = '', env: Record<string, string> = {}): { out: string; err: string; code: number } {
  const script = [
    `source ${JSON.stringify(HELPER)}`,
    `DIR=${JSON.stringify(inst.root)} LOG=${JSON.stringify(inst.log)} CRON_FILE=${JSON.stringify(inst.cron)} REBOOT_FLAG=${JSON.stringify(inst.flag)}`,
    'setup_env; cd "$DIR"',
    body,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', input, env: { ...process.env, TZ: 'UTC', ...env } });
  return { out: r.stdout, err: r.stderr, code: r.status ?? -1 };
}

describe('windows remote helper: the actions', () => {
  it('runs the installation\'s own commands, with --yes where the nightly jobs use it', () => {
    const s = install('a');
    expect(run(s, 'act_status').out).toBe('midad.sh status --env prod\n');
    expect(run(s, 'act_start').out).toBe('midad.sh start --env prod --yes\n');
    expect(run(s, 'act_report').out).toBe('midad.sh report --env prod\n');
    expect(run(s, 'act_restart').out).toBe(`rolling-restart ENV_FILE=.env.production in ${s.root}\n`);
    // The development installation has no second instance: stop, then start.
    expect(run(s, 'ENV_NAME=dev; setup_env; act_restart').out).toBe('midad.sh stop --env dev --yes\nmidad.sh start --env dev --yes\n');
  });

  it('backs up and tests a backup into the log the daily report reads, and keeps their exit code', () => {
    const s = install('b');
    expect(run(s, 'act_backup').out).toBe('midad.sh backup --env prod --yes\n');
    expect(run(s, 'act_verify').out).toBe('midad.sh restore --env prod --yes --from local --only-verify\n');
    const failed = run(s, 'act_backup && echo "went on"', '', { MIDAD_RC: '3' });
    expect(failed.code).toBe(3);
    expect(failed.out).not.toContain('went on');
    expect(readFileSync(s.log, 'utf8').split('\n').filter(Boolean)).toEqual([
      'midad.sh backup --env prod --yes', 'midad.sh restore --env prod --yes --from local --only-verify', 'midad.sh backup --env prod --yes',
    ]);
  });

  it('stops Midad and restarts the server only when asked twice', () => {
    const s = install('c');
    expect(run(s, 'act_stop', 'n\n').out).toBe('Nothing was stopped.\n');
    expect(run(s, 'act_stop', '\n').out).toBe('Nothing was stopped.\n');
    expect(run(s, 'act_stop', 'y\n').out).toBe('midad.sh stop --env prod --yes\n');
    const stubs = 'systemctl() { echo "systemctl $*"; [[ $1 != is-enabled ]] || return 0; }';
    const no = run(s, `${stubs}\nact_reboot`, 'yes\n');
    expect(no.out).toContain('Not restarted.');
    expect(no.out).not.toContain('systemctl reboot');
    writeFileSync(s.flag, '');
    const yes = run(s, `${stubs}\nact_reboot`, 'Reboot\n');
    expect(yes.out).toContain('The server asks for a restart to finish its updates');
    expect(yes.out).toContain('Midad starts again by itself');
    expect(yes.out.trim().split('\n').pop()).toBe('systemctl reboot');
    expect(run(s, 'systemctl() { [[ $1 != is-enabled ]] || return 1; echo "systemctl $*"; }\nact_reboot', 'reboot\n').out).toContain('after the restart, run Start');
  });

  it('lists the system updates, says when Docker restarts, and installs only on yes', () => {
    const s = install('d');
    const apt = (list: string) => [
      'apt-get() { echo "apt-get $*"; }',
      `apt() { printf 'Listing... Done\\n%s' ${JSON.stringify(list)}; }`,
    ].join('\n');
    expect(run(s, `${apt('')}\nact_updates`).out).toContain('The server is up to date.\nNo server restart is needed.');
    const docker = 'docker-ce/noble 5:28.5.2-1~ubuntu.24.04~noble amd64 [upgradable from: 5:28.5.1-1~ubuntu.24.04~noble]\n';
    const no = run(s, `${apt(docker)}\nact_updates`, 'n\n');
    expect(no.out).toContain('These include Docker: the website stops for about a minute');
    expect(no.out).toContain('Nothing was installed.');
    expect(no.out).not.toContain('apt-get -y');
    const yes = run(s, `${apt('perl/noble-updates 5.38.2-3.2ubuntu0.7 amd64 [upgradable from: 5.38.2-3.2ubuntu0.6]\n')}\nact_updates`, 'y\n');
    expect(yes.out).toContain('The website keeps running while they install.');
    expect(yes.out).toContain('apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade');
  });

  it('lists this installation\'s backups with their checksums, the last tests, errors and the schedule', () => {
    const s = install('e');
    const names = ['midad-backup-prod-20261109T021501Z.tar.enc', 'midad-backup-prod-20261111T021501Z.tar.enc', 'midad-backup-prod-20261110T021501Z.tar.enc', 'midad-backup-dev-20261112T000000Z.tar.enc'];
    for (const n of names) writeFileSync(join(s.backups, n), `archive ${n}`);
    spawnSync('bash', ['-c', `cd ${JSON.stringify(s.backups)} && for f in *.tar.enc; do sha256sum "$f" > "$f.sha256"; done`]);
    writeFileSync(join(s.backups, names[0]!), 'damaged');
    rmSync(join(s.backups, `${names[2]}.sha256`));
    writeFileSync(s.log, [
      'The backup can be restored. (The scratch database midad_check_20261108190102 was removed.)',
      'Error: could not reach the backup server',
      'The backup can be restored. (The scratch database midad_check_20261111080427 was removed.)',
    ].join('\n'));
    writeFileSync(s.cron, '# Midad\nMAILTO=ops@example.com\n15 0 * * * root cd /opt/midad && ops/backup.sh --env prod --yes\n');
    const r = run(s, 'act_backups');
    expect(r.code, r.err).toBe(0);
    const rows = r.out.split('\n').filter((l) => l.includes('midad-backup-'));
    expect(rows.map((l) => l.split(/\s+/).pop())).toEqual([names[1], names[2], names[0]]); // newest first, dev left out
    expect(rows[0]).toContain(' ok ');
    expect(rows[1]).toContain('no checksum');
    expect(rows[2]).toContain('DAMAGED');
    expect(r.out).toContain('Restore tests that worked (the last 3):\n  2026-11-08 21:01\n  2026-11-11 10:04\n'); // UTC names, Cairo times
    expect(r.out).toContain('  Error: could not reach the backup server');
    expect(r.out).toContain('  15 0 * * * root cd /opt/midad');
    expect(r.out).not.toContain('# Midad');
    expect(run(install('e2'), 'act_backups').out).toContain('Backups in');
  });

  it('copies only this installation\'s backups, with their checksums, into the SSH user\'s home', () => {
    const s = install('f');
    for (const n of ['midad-backup-prod-20261110T021501Z.tar.enc', 'midad-backup-prod-20261111T021501Z.tar.enc', 'midad-backup-dev-20261111T000000Z.tar.enc']) {
      writeFileSync(join(s.backups, n), `archive ${n}`);
      writeFileSync(join(s.backups, `${n}.sha256`), `x  ${n}\n`);
    }
    const home = join(dir, 'home-f');
    mkdirSync(join(home, '.midad-download'), { recursive: true });
    writeFileSync(join(home, '.midad-download', 'left-from-last-time'), '');
    const stubs = [
      `getent() { echo "tester:x:1000:1000::${home}:/bin/bash"; }`,
      'install() { mkdir -p "${@: -1}"; }',
      'chown() { echo "chown $*"; }',
    ].join('\n');
    const r = run(s, `${stubs}\nact_download_prepare`, '', { SUDO_USER: 'tester' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`chown -R tester ${home}/.midad-download`);
    expect(r.out).toContain('2 backups ready to download');
    expect(readdirSync(join(home, '.midad-download')).sort()).toEqual([
      'midad-backup-prod-20261110T021501Z.tar.enc', 'midad-backup-prod-20261110T021501Z.tar.enc.sha256',
      'midad-backup-prod-20261111T021501Z.tar.enc', 'midad-backup-prod-20261111T021501Z.tar.enc.sha256',
    ]);
    expect(run(s, `${stubs}\nact_download_prepare`, '', { SUDO_USER: '' }).err).toContain('run it with sudo from your own account');
    expect(run(install('f2'), `${stubs}\nact_download_prepare`, '', { SUDO_USER: 'tester' }).err).toContain('no backup in');
  });

  it('the monitor shows status, resources, the server and the newest backup', () => {
    const s = install('g');
    writeFileSync(join(s.backups, 'midad-backup-prod-20261111T021501Z.tar.enc'), 'archive');
    const stubs = 'docker() { case $1 in compose) echo c1; echo c2 ;; stats) echo "stats ${*: -2}" ;; esac; }';
    const r = run(s, `${stubs}\nmonitor_once`);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^Midad on .+, \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(Africa\/Cairo\)\nmidad\.sh status --env prod\n/);
    expect(r.out).toContain('== Resources\nstats c1 c2');
    expect(r.out).toMatch(/Disk \/: \d+% used/);
    expect(r.out).toMatch(/Memory: \d+ MB free of \d+ MB/);
    expect(r.out).toMatch(/== Newest backup\nmidad-backup-prod-20261111T021501Z\.tar\.enc: .*, 7B, checksum no checksum/);
  });

  it('checks the installation for the setup on the PC', () => {
    const s = install('h');
    const ok = run(s, 'docker() { return 0; }\nact_check');
    expect(ok.out).toBe(`midad-remote 1\nMidad in ${s.root}: c0b1c0ba6d43c6dc184d74fa14b8641475a9b065 2026-11-10\nDocker: running\nBackups: 0 in ${s.root}/backups\n`);
    writeFileSync(join(s.root, 'VERSION'), '$Format:%H %cs$\n');
    expect(run(s, 'docker() { return 0; }\nact_check').out).toContain('version not recorded');
    expect(run(s, 'docker() { return 1; }\nact_check').err).toContain('Docker is not running');
    expect(run(s, 'ENV_NAME=dev; setup_env; act_check').err).toContain('.env.docker not found: is --env right?');
  });
});

describe('windows remote helper: menu and arguments', () => {
  it('the menu runs the chosen actions until Leave, and carries on after one fails', () => {
    const s = install('m');
    const r = run(s, 'act_menu', '1\n\n99\n9\n\n0\n');
    expect(r.code, r.err).toBe(0);
    expect(r.out.match(/Midad control panel/g)).toHaveLength(4);
    expect(r.out).toContain('midad.sh status --env prod\n');
    expect(r.out).toContain('Type a number from the list.');
    expect(r.out).toContain('midad.sh start --env prod --yes\n');
    const failing = run(s, 'act_menu', '1\n\n', { MIDAD_RC: '1' });
    expect(failing.code).toBe(0); // the input ended: the menu leaves
    expect(failing.out).toContain('(It stopped with an error: see above.)');
    expect(failing.out.match(/Midad control panel/g)).toHaveLength(2);
  });

  it('refuses an unknown action, a missing installation and running without sudo', () => {
    const s = install('n');
    const main = (args: string, stubs = '') => spawnSync('bash', ['-c', `source ${JSON.stringify(HELPER)}\n${stubs}\nmain ${args}`], { encoding: 'utf8' });
    expect(main('--version-x').stderr).toContain('unknown option --version-x');
    expect(main('dance').stderr).toContain('unknown action dance');
    expect(main('status report').stderr).toContain('one action at a time');
    expect(main('version', 'id() { echo 1000; }').stdout).toBe('midad-remote 1\n');
    expect(main('status', 'id() { echo 1000; }').stderr).toContain('run it with sudo: sudo midad-remote status');
    expect(main(`--dir ${join(dir, 'nothing')} status`, 'id() { echo 0; }').stderr).toContain('no Midad installation in');
    expect(main(`--dir ${s.root} --env test status`, 'id() { echo 0; }').stderr).toContain('--env must be prod or dev');
    expect(main(`--dir ${s.root} status`, 'id() { echo 0; }').stdout).toBe('midad.sh status --env prod\n');
    expect(main('--help').stdout).toContain('sudo midad-remote [--dir /opt/midad] [--env prod|dev] [ACTION]');
  });

  it('every menu entry and every documented action is an action', () => {
    const acts = [...helper.matchAll(/^act_(\w+)\(\)/gm)].map((m) => m[1]!.replace(/_/g, '-'));
    const menu = [...helper.matchAll(/^ {2}"([a-z-]+)\|/gm)].map((m) => m[1]!);
    expect(menu.length).toBe(12);
    for (const a of menu) expect(acts).toContain(a);
    const usage = helper.split('\nset -euo pipefail')[0]!;
    for (const a of acts.filter((a) => a !== 'menu')) expect(usage, a).toMatch(new RegExp(`(#|\\s{2})\\s*${a}\\s`));
  });
});

describe('windows remote: batch files', () => {
  const bats = readdirSync(KIT).filter((f) => f.endsWith('.bat'));
  const local = ['setup', 'download', 'shell'];
  const acts = [...helper.matchAll(/^act_(\w+)\(\)/gm)].map((m) => m[1]!.replace(/_/g, '-'));

  it('are plain ASCII with Windows line endings', () => {
    expect(bats.length).toBe(17);
    for (const f of bats) {
      const text = readFileSync(join(KIT, f), 'utf8');
      expect(text, f).toMatch(/^@echo off\r\n/);
      expect(text.replace(/\r\n/g, ''), f).not.toMatch(/[\r\n]/);
      expect(text, f).toMatch(/^[\x20-\x7e\r\n]*$/);
    }
  });

  it('each "Midad - ..." file runs one action the engine or the helper has', () => {
    const files = bats.filter((f) => f.startsWith('Midad - '));
    expect(files.length).toBe(15);
    const used = files.map((f) => {
      const m = /^call "%~dp0midad-remote\.bat" ([a-z-]+)\r$/m.exec(readFileSync(join(KIT, f), 'utf8'));
      expect(m, f).not.toBeNull();
      return m![1]!;
    });
    for (const a of used) expect(local.includes(a) || (acts.includes(a) && !['download-prepare', 'check', 'version'].includes(a)), a).toBe(true);
    for (const a of local) expect(engine).toContain(`if /i "%MR_ACTION%"=="${a}" goto ${a}\r`);
    // Every helper action a person starts has its file (reboot only from the control panel, behind a typed word).
    for (const a of acts.filter((a) => !['menu', 'download-prepare', 'check', 'version', 'reboot'].includes(a))) expect(used, a).toContain(a);
  });

  it('the engine jumps only to labels it has, and keeps paths out of parenthesized blocks', () => {
    const labels = new Set([...engine.matchAll(/^:([a-z_]+)\r$/gm)].map((m) => m[1]));
    const code = engine.split('\r\n').filter((l) => !/^(rem|echo)\b/i.test(l)).join('\n');
    const targets = [...code.matchAll(/\b(?:goto|call) :?([a-z_]+)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(20);
    for (const t of targets) expect(labels.has(t), t).toBe(true);
    // A ( block breaks on a path with a ")" in it, like "Program Files (x86)".
    expect(engine).not.toMatch(/\(\r$/m);
    // The PowerShell check is one double-quoted argument: no double quote or percent sign inside it.
    const ps = engine.split('\r\n').find((l) => l.startsWith('powershell.exe'))!;
    expect(ps.match(/"/g)).toHaveLength(2);
    expect(ps).not.toContain('%');
    // The server-side commands sent over SSH stay inside one double-quoted argument.
    for (const l of engine.split('\r\n').filter((l) => /^(type .*\| )?ssh /.test(l))) expect(l.match(/"/g)?.length ?? 0, l).toBeGreaterThanOrEqual(2);
  });

  it('the settings example has placeholders the engine refuses, and filled-in settings never reach the repository', () => {
    const example = readFileSync(`${KIT}/midad-settings.example.bat`, 'utf8');
    expect(example).toContain('set "MIDAD_HOST=server.example.com"');
    expect(example).toContain('set "MIDAD_USER=your-user"');
    expect(engine).toContain('if /i "%MIDAD_HOST%"=="server.example.com" goto bad_settings');
    expect(engine).toContain('if /i "%MIDAD_USER%"=="your-user" goto bad_settings');
    expect(readFileSync('.gitignore', 'utf8')).toContain('\nops/windows-remote/midad-settings.bat\n');
    for (const name of [...example.matchAll(/^set "(MIDAD_\w+)=/gm)].map((m) => m[1])) expect(engine, name).toContain(`%${name}%`);
  });
});
