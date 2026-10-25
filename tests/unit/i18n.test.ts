import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Loads the browser i18n module's dictionaries without a DOM.
async function dicts(): Promise<Record<'en' | 'ar', Record<string, string>>> {
  const src = readFileSync(new URL('../../public/js/i18n.js', import.meta.url), 'utf8');
  const body = src.slice(0, src.indexOf('const DICTS'));
  return new Function(`${body}; return { en, ar };`)() as Record<'en' | 'ar', Record<string, string>>;
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
}

describe('UI translations', () => {
  it('Arabic covers every English key and placeholders match', async () => {
    const { en, ar } = await dicts();
    const missing = Object.keys(en).filter((k) => !(k in ar));
    expect(missing).toEqual([]);
    for (const k of Object.keys(en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      if (k === 'picker.subject') continue; // Arabic singular form has no number
      expect(ph(ar[k]!), k).toBe(ph(en[k]!));
    }
  });

  it('every statically referenced key exists', async () => {
    const { en } = await dicts();
    const used = new Set<string>();
    for (const f of jsFiles(new URL('../../public/js', import.meta.url).pathname)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]!);
    }
    const dynamic = ['role.owner', 'role.admin', 'role.editor', 'role.viewer', 'track.all', 'track.moe', 'track.sec', 'track.bac', 'track.ta', 'track.intl',
      'kind.moe', 'kind.lang', 'kind.ext', 'kind.prog', 'kind.exam', 'status.scored', 'status.pass', 'status.act', 'billing.stateName.trialing', 'billing.stateName.active',
      'billing.stateName.past_due', 'billing.stateName.free', 'invoice.kind.renewal', 'invoice.status.void', 'legend.prog', 'picker.subjects', 'plan.year', 'billing.yearly',
      'items.show.all', 'items.show.mine', 'items.show.notes', 'items.show.assigned', 'items.show.unassigned', 'items.show.open', 'items.show.overdue', 'items.show.done',
      'items.status.todo', 'items.status.in_progress', 'items.status.done', 'assignments.show.open', 'assignments.show.done', 'assignments.show.all', 'assignments.none', 'assignments.noneDone'];
    const missing = [...used, ...dynamic].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
