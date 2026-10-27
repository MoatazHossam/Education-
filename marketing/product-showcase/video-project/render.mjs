// Renders a cut to video: the player draws every frame in Chromium, frames are piped to FFmpeg
// (H.264), in parallel chunks that are joined without re-encoding. Audio is added by build.mjs.
//   node render.mjs <20|3> <1080|2160> [--from s] [--to s] [--workers n] [--out file]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cueList } from './lib/srt.mjs';
import { buildTimeline, lineList } from './lib/timeline.mjs';
import { serve } from './lib/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const cut = `showcase-${args[0]}`;
const height = Number(args[1] ?? 1080);
const scale = height / 1080;
const workers = Number(opt('workers', 3));
const out = opt('out', join(ROOT, 'build', `${cut}-${height}p-video.mp4`));
const crf = opt('crf', height > 1080 ? '20' : '18');

const script = await import(`./script/${cut}.mjs`);
const shots = JSON.parse(readFileSync(join(ROOT, 'recordings', 'shots.json'), 'utf8'));
const tl = await buildTimeline({ root: ROOT, script, cut, shots });
if (args.includes('--captions')) { tl.captions = cueList(lineList(tl), 'ar'); tl.previewLabel = true; }
const fps = tl.fps;
const from = Math.round(Number(opt('from', 0)) * fps);
const to = Math.min(Math.round(Number(opt('to', tl.duration)) * fps), Math.round(tl.duration * fps));
const total = to - from;
const work = join(ROOT, 'build', `.chunks-${cut}-${height}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
console.log(`${cut}: ${(tl.duration / 60).toFixed(2)} min, frames ${from}–${to} (${total}) at ${height}p, ${workers} workers`);

const { server, url } = await serve(ROOT);
const LAUNCH = { args: (process.env.CHROME_ARGS ?? '--disable-gpu --force-color-profile=srgb').split(' ').filter(Boolean) };
const started = Date.now();
let done = 0;

// One browser per worker: pages of one browser share its compositor, which serialises captures.
async function renderChunk(browser, i, f0, f1) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${url}/video-project/render/player.html`);
  await page.waitForFunction(() => typeof window.__init === 'function');
  await page.evaluate((t) => window.__init(t), tl);
  const cdp = await page.context().newCDPSession(page);
  const file = join(work, `${String(i).padStart(3, '0')}.mp4`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', height > 1080 ? 'medium' : 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-x264-params', 'threads=2', '-r', String(fps), '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  for (let f = f0; f < f1; f++) {
    await page.evaluate((t) => window.__seek(t), f / fps);
    // CDP's capture directly: Playwright's screenshot adds waits this deterministic player does not need.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, optimizeForSpeed: true, captureBeyondViewport: false });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    done++;
    if (done % 300 === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`  ${done}/${total} frames, ${(done / el).toFixed(1)} fps, eta ${((total - done) / (done / el) / 60).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await exited;
  await page.close();
  return file;
}

// Chunks of ~20 s, handed to the workers in order.
const CH = fps * 20;
const chunks = [];
for (let f = from, i = 0; f < to; f += CH, i++) chunks.push([i, f, Math.min(to, f + CH)]);
const files = new Array(chunks.length);
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => {
  const browser = await chromium.launch(LAUNCH);
  while (next < chunks.length) {
    const c = chunks[next++];
    files[c[0]] = await renderChunk(browser, ...c);
  }
  await browser.close();
}));
server.close();
const list = join(work, 'list.txt');
writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
await new Promise((res, rej) => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? res() : rej(new Error(`concat ${c}`)))));
rmSync(work, { recursive: true, force: true });
writeFileSync(out.replace(/\.mp4$/, '.timeline.json'), JSON.stringify({ ...tl, shots: undefined }, null, 1));
console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min → ${out}`);
