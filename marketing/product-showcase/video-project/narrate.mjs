// Generates the narration with a synthetic voice: one WAV per line, written where the timeline looks for
// recorded takes (audio/narration/<cut>/<sceneId>-NN.wav). A human recording can replace any file.
//
//   node narrate.mjs <20|3> --engine azure [--voice ar-SA-ZariyahNeural] [--rate 0%] [--force] [--only sceneId]
//   node narrate.mjs <20|3> --engine piper --voice <model.onnx> [--length-scale 1.12] [--sentence-silence 0.3]
//                    [--tempo 1] [--tashkeel] [--force] [--only sceneId]
//   node narrate.mjs samples --engine azure --voices ar-SA-ZariyahNeural,ar-EG-SalmaNeural,...
//
// The text is the diacritized line (or its spoken form, `say`), read in pausal form at each pause. Azure needs
// AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the environment; Piper runs in audio/narrate.py with the Python
// named by PIPER_PYTHON (default: python3).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { azureConfig, synthesize } from './lib/azure-tts.mjs';
import { narrationFile } from './lib/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const engine = opt('engine', 'azure');
const only = opt('only');
const force = args.includes('--force');

// Pausal form (الوقف بالسكون), as a narrator reads: before a pause the final short vowel or tanween is not
// voiced; tanween al-fath on alif is read as a long "aa". The script and subtitles keep the full diacritics.
const WORD_END = /^(.*[\u0621-\u064A\u0671])([\u064B-\u0652\u0670]*)([^\u0670\u0621-\u0652\u0671]*)$/u;
function waqf(word) {
  const m = WORD_END.exec(word);
  if (!m) return word;
  const [, body, marks, tail] = m;
  // Tanween al-fath before a final alif or alif maqsura: drop the tanween, the alif gives the long vowel.
  if (!marks && /[\u0627\u0649]$/u.test(body)) return body.replace(/\u064B(?=[\u064B-\u0652]*[\u0627\u0649]$)/u, '') + tail;
  // Otherwise drop the final short vowel or tanween, keeping a shadda or sukun.
  return body + marks.replace(/[\u064B-\u0650]/gu, '') + tail;
}
const PAUSE = /[\u060C.\u061B:\u061F!,]$/u;
// Punctuation the voice reads well: the dash becomes a pause, quotation marks are dropped.
const speakable = (t) => {
  const words = t.replace(/\s*—\s*/g, '، ').replace(/[«»]/g, '').replace(/\s+/g, ' ').trim().split(' ');
  return words.map((w, i) => (PAUSE.test(w) || i === words.length - 1 ? waqf(w) : w)).join(' ');
};

// Trims the voice's own leading and trailing silence; the timeline sets the gaps between lines.
function trim(raw, out) {
  const filter = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse';
  const f = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', filter, '-c:a', 'pcm_s16le', `${out}.tmp.wav`]);
  if (f.status !== 0) throw new Error(String(f.stderr));
  renameSync(`${out}.tmp.wav`, out);
  rmSync(raw, { force: true });
}

function speakAzure(items, voice, rate) {
  const conf = azureConfig();
  items.forEach((it, n) => {
    synthesize({ text: it.text, voice, rate, out: `${it.out}.raw.wav` }, conf);
    trim(`${it.out}.raw.wav`, it.out);
    process.stdout.write(`\r${n + 1}/${items.length}`);
  });
  console.log();
}

// Voice samples: two lines of the 20-minute script in each voice, to choose one by ear.
if (args[0] === 'samples') {
  const { scenes } = await import('./script/showcase-20.mjs');
  const lines = [scenes.find((s) => s.id === 'c1-open').lines[0], scenes.find((s) => s.id === 'c2-layers').lines[1]];
  const dir = join(ROOT, 'audio', 'voice-samples');
  mkdirSync(dir, { recursive: true });
  for (const voice of opt('voices', 'ar-SA-ZariyahNeural,ar-EG-SalmaNeural,ar-AE-FatimaNeural').split(',')) {
    const parts = lines.map((l, i) => ({ text: speakable(l.say ?? l.ar), out: join(dir, `${voice}-${i + 1}.wav`) }));
    speakAzure(parts, voice, opt('rate', '0%'));
    const list = join(dir, `${voice}.txt`);
    writeFileSync(list, parts.map((p) => `file '${p.out}'`).join('\n'));
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-af', 'apad=pad_dur=0.6', join(dir, `${voice}.wav`)]);
    for (const p of parts) rmSync(p.out, { force: true });
    rmSync(list, { force: true });
    console.log(`→ audio/voice-samples/${voice}.wav`);
  }
  process.exit(0);
}

const cut = `showcase-${args[0]}`;
const { scenes } = await import(`./script/${cut}.mjs`);
const todo = [];
let kept = 0;
for (const s of scenes) {
  if (only && s.id !== only) continue;
  for (const [k, l] of s.lines.entries()) {
    const out = narrationFile(ROOT, cut, s.id, k);
    if (existsSync(out) && !force) { kept++; continue; }
    mkdirSync(dirname(out), { recursive: true });
    todo.push({ text: speakable(l.say ?? l.ar), out });
  }
}
console.log(`${cut}: ${todo.length} lines to speak, ${kept} already present`);
if (!todo.length) process.exit(0);

if (engine === 'azure') {
  speakAzure(todo, opt('voice', 'ar-SA-ZariyahNeural'), opt('rate', '0%'));
} else if (engine === 'piper') {
  const voice = opt('voice');
  if (!voice || !existsSync(voice)) { console.error('--engine piper needs --voice <model.onnx>'); process.exit(1); }
  const list = join(ROOT, 'build', cut, 'narration-lines.json');
  mkdirSync(dirname(list), { recursive: true });
  writeFileSync(list, JSON.stringify(todo));
  const py = ['-I', join(HERE, 'audio', 'narrate.py'), list, '--voice', voice, '--length-scale', opt('length-scale', '1.12'), '--sentence-silence', opt('sentence-silence', '0.3'), '--tempo', opt('tempo', '1'), ...(args.includes('--tashkeel') ? ['--tashkeel'] : [])];
  const r = spawnSync(process.env.PIPER_PYTHON ?? 'python3', py, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.error(`unknown engine ${engine}`);
  process.exit(1);
}
