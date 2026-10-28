// Builds a cut of the showcase from the script, the recordings and (when present) the narration.
//
//   node build.mjs prepare <20|3>            timeline, audio events, subtitles (SRT)
//   node build.mjs audio   <20|3>            score + sound effects + narration → build/<cut>/mix.wav
//   node build.mjs video   <20|3> <1080|2160> [--captions] [--workers n]
//   node build.mjs mux     <20|3> <1080|2160> [--captions]
//   node build.mjs all     <20|3> <1080|2160> [--captions]
//
// --captions burns the Arabic narration into the picture (the preview cut while no narration is
// recorded). Outputs go to marketing/product-showcase/ (see PRODUCTION_STATUS.md for their names).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioEvents } from './lib/events.mjs';
import { toSrt } from './lib/srt.mjs';
import { buildTimeline, lineList } from './lib/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const [step, cutArg, heightArg] = process.argv.slice(2);
const flags = process.argv.slice(2);
const captions = flags.includes('--captions');
const workers = flags.includes('--workers') ? flags[flags.indexOf('--workers') + 1] : '4';
const cut = `showcase-${cutArg}`;
const height = Number(heightArg ?? 1080);
const work = join(ROOT, 'build', cut);
mkdirSync(work, { recursive: true });

const NAMES = {
  'showcase-20': { 2160: 'Education_SaaS_Product_Showcase_20min.mp4', 1080: 'Education_SaaS_Product_Showcase_1080p.mp4', srt: '' },
  'showcase-3': { 2160: 'Education_SaaS_Product_Showcase_3min_4K.mp4', 1080: 'Education_SaaS_Product_Showcase_3min.mp4', srt: '-3min' },
};

async function timeline() {
  const script = await import(`./script/${cut}.mjs`);
  const shots = JSON.parse(readFileSync(join(ROOT, 'recordings', 'shots.json'), 'utf8'));
  return buildTimeline({ root: ROOT, script, cut, shots });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

async function prepare() {
  const tl = await timeline();
  const lines = lineList(tl);
  writeFileSync(join(work, 'events.json'), JSON.stringify(audioEvents(tl, ROOT), null, 1));
  const tag = NAMES[cut].srt;
  writeFileSync(join(ROOT, `arabic${tag}.srt`), toSrt(lines, 'ar'));
  writeFileSync(join(ROOT, `arabic${tag}-plain.srt`), toSrt(lines, 'ar-plain'));
  writeFileSync(join(ROOT, `english${tag}.srt`), toSrt(lines, 'en'));
  writeFileSync(join(work, 'timeline.json'), JSON.stringify({ ...tl, shots: undefined }, null, 1));
  console.log(`${cut}: ${tl.scenes.length} scenes, ${lines.length} narration lines, ${(tl.duration / 60).toFixed(2)} min; narration recorded ${tl.narration.recorded}, estimated ${tl.narration.estimated}`);
  return tl;
}

async function audio() {
  if (!existsSync(join(work, 'events.json'))) await prepare();
  mkdirSync(join(ROOT, 'music'), { recursive: true });
  run('python3', [join(HERE, 'audio', 'mix.py'), join(work, 'events.json'), join(work, 'mix.wav'), '--music-stem', join(ROOT, 'music', `${cut}-score.wav`)]);
}

function video() {
  const args = [join(HERE, 'render.mjs'), cutArg, String(height), '--workers', workers, '--out', join(work, `video-${height}${captions ? '-captions' : ''}.mp4`)];
  if (captions) args.push('--captions');
  run('node', args);
}

function loudness(file, target) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=I=${target}:TP=-2:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const json = r.stderr.slice(r.stderr.lastIndexOf('{'));
  return JSON.parse(json.slice(0, json.indexOf('}') + 1));
}

async function mux() {
  const tl = JSON.parse(readFileSync(join(work, 'timeline.json'), 'utf8'));
  const voiced = tl.narration.recorded > 0;
  const target = voiced ? -16 : -18;
  const m = loudness(join(work, 'mix.wav'), target);
  const af = `loudnorm=I=${target}:TP=-2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
  let name = NAMES[cut][height];
  if (!voiced) name = name.replace(/\.mp4$/, '_PREVIEW_no-narration.mp4');
  const out = join(ROOT, name);
  run('ffmpeg', ['-v', 'error', '-y', '-i', join(work, `video-${height}${captions ? '-captions' : ''}.mp4`), '-i', join(work, 'mix.wav'),
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', af, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-metadata', `title=${tl.meta.titleEn}`, '-metadata:s:a:0', 'language=ara', '-movflags', '+faststart', '-shortest', out]);
  console.log(`→ ${out}`);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate', '-of', 'compact', out], { encoding: 'utf8' });
  console.log(probe.trim());
  if (cut === 'showcase-20' && height === 1080) copyFileSync(join(work, 'mix.wav'), join(ROOT, 'audio', 'showcase-20-mix.wav'));
}

mkdirSync(join(ROOT, 'audio'), { recursive: true });
if (step === 'prepare') await prepare();
else if (step === 'audio') await audio();
else if (step === 'video') video();
else if (step === 'mux') await mux();
else if (step === 'all') { await prepare(); await audio(); video(); await mux(); }
else { console.error('usage: node build.mjs <prepare|audio|video|mux|all> <20|3> [1080|2160] [--captions]'); process.exit(1); }
