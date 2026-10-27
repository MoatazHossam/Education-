// Generates the narration with an open-source voice (Piper): one WAV per line, written where the timeline
// looks for recorded takes (audio/narration/<cut>/<sceneId>-NN.wav). A human recording can replace any file.
//   node narrate.mjs <20|3> --voice <model.onnx> [--length-scale 1.12] [--force] [--only sceneId] [--tashkeel]
// The text is the diacritized line (or its spoken form, `say`); synthesis is in audio/narrate.py.
// PIPER_PYTHON points at the Python that has piper-tts installed (default: python3).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrationFile } from './lib/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const cut = `showcase-${args[0]}`;
const voice = opt('voice');
if (!voice || !existsSync(voice)) { console.error('usage: node narrate.mjs <20|3> --voice <model.onnx> [--length-scale n] [--force] [--only sceneId] [--tashkeel]'); process.exit(1); }
const only = opt('only');
const force = args.includes('--force');

// Punctuation the voice reads well: the dash becomes a pause, quotation marks are dropped.
const speakable = (t) => t.replace(/\s*—\s*/g, '، ').replace(/[«»]/g, '').replace(/\s+/g, ' ').trim();

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
const list = join(ROOT, 'build', cut, 'narration-lines.json');
mkdirSync(dirname(list), { recursive: true });
writeFileSync(list, JSON.stringify(todo));
const py = ['-I', join(HERE, 'audio', 'narrate.py'), list, '--voice', voice, '--length-scale', opt('length-scale', '1.12'), ...(args.includes('--tashkeel') ? ['--tashkeel'] : [])];
const r = spawnSync(process.env.PIPER_PYTHON ?? 'python3', py, { stdio: 'inherit' });
process.exit(r.status ?? 1);
