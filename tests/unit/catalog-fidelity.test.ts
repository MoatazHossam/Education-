import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildLegacyDataset } from '../../src/catalog/legacy-dataset.js';

// Executes the data section of the original artifact (no DOM needed) and
// compares it with the TypeScript port used to seed the catalogue.
function runLegacyData() {
  const html = readFileSync(new URL('../../legacy/egypt-curriculum-picker.html', import.meta.url), 'utf8');
  const start = html.indexOf('const GN = ');
  const end = html.indexOf('// ---------- UI ----------');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const sandbox: { result?: unknown } = {};
  runInNewContext(`${html.slice(start, end)}\nresult = items;`, sandbox);
  return sandbox.result as { g: number; track: string; block: string; sid: string; name: string; ar: string; st: string; mats: { k: string; t: string }[]; note?: string }[];
}

describe('legacy catalogue fidelity', () => {
  const legacy = runLegacyData();
  const port = buildLegacyDataset().subjects;

  it('has the same 231 subject rows and 1,038 selectable materials', () => {
    expect(legacy).toHaveLength(231);
    expect(port).toHaveLength(231);
    const count = (n: number, s: { materials?: unknown[]; mats?: unknown[] }) => n + (s.materials ?? s.mats ?? []).length;
    expect(legacy.reduce(count, 0)).toBe(1038);
    expect(port.reduce(count, 0)).toBe(1038);
  });

  it('matches every subject and material in order, except the documented intl kind correction', () => {
    port.forEach((s, i) => {
      const l = legacy[i]!;
      expect({ g: s.grade, track: s.track, block: s.block, sid: s.code, name: s.nameEn, ar: s.nameAr, st: s.status, note: s.note }).toEqual({
        g: l.g, track: l.track, block: l.block, sid: l.sid, name: l.name, ar: l.ar, st: l.st, note: l.note ?? null,
      });
      expect(s.materials.map((m) => m.title)).toEqual(l.mats.map((m) => m.t));
      s.materials.forEach((m, j) => {
        const lk = l.mats[j]!.k;
        const isProgramme = s.track === 'intl' && !s.code.startsWith('id');
        if (isProgramme) expect({ moe: 'prog', lang: 'exam' }[lk]).toBe(m.kind);
        else expect(m.kind).toBe(lk);
      });
    });
  });

  it('keeps the legacy selection keys unique (grade|track|block|sid|title)', () => {
    const keys = port.flatMap((s) => s.materials.map((m) => `${s.grade}|${s.track}|${s.block}|${s.code}|${m.title}`));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
