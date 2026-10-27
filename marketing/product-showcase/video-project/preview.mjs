// Renders single frames for review: node preview.mjs <cut> <out-dir> <scene-id|seconds>[@offset] ...
// e.g. node preview.mjs 20 /tmp/frames c1-reveal@3 c4-signup@5 612.5
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cueList } from './lib/srt.mjs';
import { buildTimeline, lineList } from './lib/timeline.mjs';
import { serve } from './lib/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const [cutArg, out, ...specs] = process.argv.slice(2);
const cut = `showcase-${cutArg}`;
const script = await import(`./script/${cut}.mjs`);
const shots = JSON.parse(readFileSync(join(ROOT, 'recordings', 'shots.json'), 'utf8'));
const tl = await buildTimeline({ root: ROOT, script, cut, shots });
if (process.env.CAPTIONS) { tl.captions = cueList(lineList(tl), 'ar'); tl.previewLabel = true; }
mkdirSync(out, { recursive: true });
const { server, url } = await serve(ROOT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${url}/video-project/render/player.html`);
await page.waitForFunction(() => typeof window.__init === 'function');
await page.evaluate((t) => window.__init(t), tl);
console.log(`duration ${tl.duration.toFixed(1)} s (${(tl.duration / 60).toFixed(2)} min), scenes ${tl.scenes.length}`);
for (const spec of specs) {
  let t;
  const [id, off] = spec.split('@');
  if (/^[\d.]+$/.test(id)) t = Number(id);
  else {
    const s = tl.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`no scene ${id}`);
    t = s.start + (off === undefined ? s.dur / 2 : off.endsWith('%') ? (s.dur * parseFloat(off)) / 100 : Number(off));
  }
  await page.evaluate((t) => window.__seek(t), t);
  const file = join(out, `${spec.replace(/[^\w.@%-]/g, '_')}.png`);
  await page.screenshot({ path: file });
  console.log(file, t.toFixed(2));
}
await browser.close();
server.close();
