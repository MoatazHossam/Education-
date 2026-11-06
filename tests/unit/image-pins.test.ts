import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Dependency hygiene (production finding S-15): every image the product runs is pinned by digest, so a
// rebuild or a restart gets the same bytes, and Dependabot (.github/dependabot.yml) proposes updates as
// pull requests that go through CI. The CI's actions are pinned by commit SHA.
const read = (file: string) => readFileSync(file, 'utf8');
const PINNED = /^[a-z0-9][a-z0-9./-]*:[\w.-]+@sha256:[0-9a-f]{64}$/;
const fromLines = (file: string) => [...read(file).matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]!);
const composeImages = (file: string) =>
  Object.entries((parse(read(file), { merge: true, logLevel: 'error' }) as { services: Record<string, { image?: string }> }).services)
    .filter(([, s]) => s.image)
    .map(([name, s]) => [name, s.image!] as const);
// Built from this repository's Dockerfile, so it has no digest to pin.
const LOCAL = /^midad:\$\{APP_IMAGE_TAG:-local\}$/;

describe('container images', () => {
  it('the Dockerfile builds every stage from a base image pinned by digest', () => {
    const from = fromLines('Dockerfile');
    expect(from).toHaveLength(3);
    for (const ref of from) expect(ref).toMatch(PINNED);
    expect(new Set(from).size).toBe(1);
    expect(read('Dockerfile')).not.toMatch(/^ARG\s+\w*IMAGE/m);
  });

  it('every image in the compose files is pinned by digest, except the one built here', () => {
    const all = [...composeImages('docker-compose.yml'), ...composeImages('docker-compose.prod.yml')];
    const local = all.filter(([, ref]) => LOCAL.test(ref));
    const others = all.filter(([, ref]) => !LOCAL.test(ref));
    expect(local.map(([name]) => name).sort()).toEqual(['app', 'migrate', 'worker']);
    expect(others.map(([name]) => name).sort()).toEqual(['caddy', 'clamav', 'mailpit', 'postgres']);
    for (const [name, ref] of others) expect(ref, name).toMatch(PINNED);
  });

  it('the Node.js in the image is the one CI tests with', () => {
    const major = /^node:(\d+)-/.exec(fromLines('Dockerfile')[0]!)?.[1];
    expect(major).toBe('22');
    expect(read('.github/workflows/ci.yml')).toMatch(new RegExp(`node-version: ${major}\\n`));
  });
});

describe('operations scripts', () => {
  const sh = read('ops/midad.sh');
  const ps = read('ops/midad.ps1');
  const expected = {
    rclone: fromLines('ops/images.Dockerfile')[0]!,
    postgres: composeImages('docker-compose.yml').find(([n]) => n === 'postgres')![1],
    caddy: composeImages('docker-compose.prod.yml').find(([n]) => n === 'caddy')![1],
  };

  it('pin the images they run outside the stack in ops/images.Dockerfile', () => {
    expect(fromLines('ops/images.Dockerfile')).toEqual([expected.rclone]);
    expect(expected.rclone).toMatch(/^rclone\/rclone:/);
    expect(expected.rclone).toMatch(PINNED);
  });

  it('name no image themselves (comments aside)', () => {
    const code = (src: string) => src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
    for (const src of [sh, ps]) expect(code(src)).not.toMatch(/(rclone\/rclone|postgres|caddy):[\w.-]*\d/);
  });

  it('read each image from the file that pins it (Linux)', () => {
    const fn = /^pinned\(\) \{[\s\S]*?^\}$/m.exec(sh)?.[0];
    expect(fn).toBeDefined();
    const run = (file: string, name: string) => execFileSync('bash', ['-c', `set -euo pipefail; ROOT=$PWD; ${fn}\npinned "$1" "$2"`, 'pinned', file, name], { encoding: 'utf8' });
    expect(run('ops/images.Dockerfile', 'rclone/rclone')).toBe(expected.rclone);
    expect(run('docker-compose.yml', 'postgres')).toBe(expected.postgres);
    expect(run('docker-compose.prod.yml', 'caddy')).toBe(expected.caddy);
    expect(() => execFileSync('bash', ['-c', `set -euo pipefail; ROOT=$PWD; ${fn}\nx=$(pinned docker-compose.yml nothere)`], { stdio: 'pipe' })).toThrow(/no nothere image in docker-compose.yml/);
    expect(sh).toMatch(/^RCLONE_IMAGE=\$\(pinned ops\/images\.Dockerfile rclone\/rclone\)$/m);
    expect(sh).toMatch(/^PG_IMAGE=\$\(pinned docker-compose\.yml postgres\)$/m);
    expect(sh).toMatch(/^TOOL_IMAGE=\$\(pinned docker-compose\.prod\.yml caddy\)$/m);
  });

  it('read each image from the file that pins it (Windows), with the same pattern', () => {
    expect(ps).toMatch(/^\$RcloneImage = Get-PinnedImage 'ops\/images\.Dockerfile' 'rclone\/rclone'$/m);
    expect(ps).toMatch(/^\$PgImage = Get-PinnedImage 'docker-compose\.yml' 'postgres'$/m);
    expect(ps).toMatch(/^\$ToolImage = Get-PinnedImage 'docker-compose\.prod\.yml' 'caddy'$/m);
    // The function's pattern, applied as .NET applies it (these constructs mean the same in JavaScript).
    const pattern = /\$pattern = '(.+)' \+ \[regex\]::Escape\(\$Name\) \+ '(.+)'$/m.exec(ps);
    expect(pattern).not.toBeNull();
    const lookup = (file: string, name: string) => {
      const re = new RegExp(pattern![1]! + name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + pattern![2]!);
      for (const line of read(file).split('\n')) {
        const m = re.exec(line);
        if (m) return m[2];
      }
      return undefined;
    };
    expect(lookup('ops/images.Dockerfile', 'rclone/rclone')).toBe(expected.rclone);
    expect(lookup('docker-compose.yml', 'postgres')).toBe(expected.postgres);
    expect(lookup('docker-compose.prod.yml', 'caddy')).toBe(expected.caddy);
  });
});

describe('dependency updates', () => {
  type Update = {
    'package-ecosystem': string;
    directory: string;
    'target-branch'?: string;
    ignore?: { 'dependency-name': string; 'update-types'?: string[] }[];
  };
  const updates = (parse(read('.github/dependabot.yml')) as { version: number; updates: Update[] }).updates;
  const covered = updates.map((u) => `${u['package-ecosystem']} ${u.directory}`).sort();

  it('Dependabot watches the packages, every pinned image and the CI actions', () => {
    expect(covered).toEqual(['docker /', 'docker /ops', 'docker-compose /', 'github-actions /', 'npm /']);
  });

  it('Dependabot opens its pull requests against main, whatever the default branch', () => {
    for (const u of updates) expect(u['target-branch'], `${u['package-ecosystem']} ${u.directory}`).toBe('main');
  });

  it('Dependabot proposes no new major version of Node.js (nor its types) or PostgreSQL', () => {
    const ignored = (eco: string, dir: string) =>
      updates.find((u) => u['package-ecosystem'] === eco && u.directory === dir)?.ignore?.map((i) => `${i['dependency-name']} ${i['update-types']?.join()}`);
    expect(ignored('docker', '/')).toEqual(['node version-update:semver-major']);
    expect(ignored('npm', '/')).toEqual(['@types/node version-update:semver-major']);
    expect(ignored('docker-compose', '/')).toEqual(['postgres version-update:semver-major']);
  });

  it('every action in CI is pinned by commit SHA, with its release in a comment', () => {
    const uses = [...read('.github/workflows/ci.yml').matchAll(/uses:\s*(.+)$/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});
