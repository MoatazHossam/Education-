// Stills from the production: the thumbnail, a frame of each motion-graphic scene (graphics/), and a
// selection of the recorded product screens (screenshots/).
//   node stills.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { buildTimeline } from './lib/timeline.mjs';
import { serve } from './lib/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const shots = JSON.parse(readFileSync(join(ROOT, 'recordings', 'shots.json'), 'utf8'));

// Graphic scenes of the 20-minute cut, taken once their elements are all in (fraction of the scene).
const GRAPHICS = [
  ['c1-problems', 0.95], ['c1-reveal', 0.9], ['c2-origin', 0.95], ['c2-layers', 0.95], ['c2-flow', 0.9], ['c3-segments', 0.97],
  ['c4-isolation', 0.9], ['c5-teacher-value', 0.95], ['c6-student-value', 0.95], ['c6-ai-status', 0.95], ['c6-ai-vision', 0.95], ['c7-isolation', 0.95], ['c7-deploy', 0.95],
  ['c7-central', 0.9], ['c7-value', 0.95], ['c8-ready', 0.95], ['c8-roadmap', 0.95], ['c8-invite', 0.9],
];
// Recorded screens: [recording, frame, file name].
const SCREENS = [
  ['pick-books', 9, '01-curriculum-picker'], ['verify-subject', 2, '02-catalogue-verification'], ['scopes', -1, '03-compare-scopes'],
  ['notes', 7, '04-notes-and-assignees'], ['carry', 3, '05-carry-to-next-year'], ['student-import', -1, '06-roster-import'],
  ['homework-mark', -1, '07-homework-marking'], ['monitor', 3, '08-live-test-monitor'], ['test-results', -1, '09-test-results'],
  ['gradebook', 0, '10-gradebook'], ['student-test', 6, '11-student-test-phone'], ['student-grades', 3, '12-student-grades-phone'],
  ['settings', -1, '13-support-access-and-integrations'], ['admin-overview', -1, '14-platform-console'],
];

const { server, url } = await serve(ROOT);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));

  // Thumbnail
  await page.goto(`${url}/video-project/render/player.html`);
  await page.evaluate(async () => {
    const { default: thumbnail } = await import('./thumbnail.js');
    await thumbnail(document.getElementById('stage'), (p) => `../../recordings/${p}`);
  });
  await page.screenshot({ path: join(ROOT, 'Education_SaaS_Thumbnail.png') });
  console.log('→ Education_SaaS_Thumbnail.png');

  // Graphics
  const script = await import('./script/showcase-20.mjs');
  const tl = await buildTimeline({ root: ROOT, script, cut: 'showcase-20', shots });
  await page.goto(`${url}/video-project/render/player.html`);
  await page.waitForFunction(() => typeof window.__init === 'function');
  await page.evaluate((t) => window.__init(t), tl);
  mkdirSync(join(ROOT, 'graphics'), { recursive: true });
  for (const [id, at] of GRAPHICS) {
    const s = tl.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`no scene ${id}`);
    await page.evaluate((t) => window.__seek(t), s.start + s.dur * at);
    await sharp(await page.screenshot()).jpeg({ quality: 88, mozjpeg: true }).toFile(join(ROOT, 'graphics', `${id}.jpg`));
  }
  console.log(`→ graphics/ (${GRAPHICS.length})`);
} finally {
  await browser.close();
  server.close();
}

// Screens: the recordings themselves, at 1920 px wide (phones at 780 px).
mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
for (const [id, frame, name] of SCREENS) {
  const sh = shots[id];
  if (!sh) throw new Error(`no recording ${id}`);
  const f = sh.frames[frame < 0 ? sh.frames.length + frame : frame];
  await sharp(join(ROOT, 'recordings', f.file)).resize({ width: sh.device === 'phone' ? 780 : 1920 }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(ROOT, 'screenshots', `${name}.jpg`));
}
console.log(`→ screenshots/ (${SCREENS.length})`);
