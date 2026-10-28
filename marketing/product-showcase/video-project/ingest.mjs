// Brings the narrator's recordings into the films. Looks in <dir> (default ../audio/recorded) for, per scene,
// one file per line (<cut>/<sceneId>-NN.wav) or one file for the whole scene (<cut>/<sceneId>.wav); any format
// FFmpeg reads. audio/ingest.py cleans and trims each take into ../audio/narration/<cut>/, where the timeline
// reads it, and writes a report; a line list for the speech-recognition check (lib/asr_check.py) is written too.
//   node ingest.mjs [20|3|all] [--dir <recordings>]
// Then: node build.mjs prepare 20 … and the usual builds; lines without a recording keep their previous take.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrationFile } from './lib/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const which = args[0] && !args[0].startsWith('--') ? args[0] : 'all';
const dir = resolve(opt('dir', join(ROOT, 'audio', 'recorded')));
const AUDIO = new Set(['.wav', '.flac', '.aif', '.aiff', '.mp3', '.m4a']);

// Recordings by lower-case name without extension, whatever the folder depth or case.
const found = new Map();
const walk = (d) => {
  if (!existsSync(d)) return;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (AUDIO.has(extname(e.name).toLowerCase())) found.set(`${d.split('/').pop()}/${e.name.slice(0, -extname(e.name).length)}`.toLowerCase(), p);
  }
};
walk(dir);
console.log(`${found.size} recordings in ${dir}`);

const cuts = which === 'all' ? ['showcase-20', 'showcase-3'] : [`showcase-${which}`];
const scenes = [];
const asr = [];
for (const cut of cuts) {
  const script = await import(`./script/${cut}.mjs`);
  for (const s of script.scenes) {
    if (!s.lines.length) continue;
    const lines = s.lines.map((l, k) => {
      const nn = String(k + 1).padStart(2, '0');
      const text = l.say ?? l.ar;
      const out = narrationFile(ROOT, cut, s.id, k);
      asr.push({ id: `${cut}/${s.id}-${nn}`, text, file: out });
      return { id: `${cut}/${s.id}-${nn}`, source: found.get(`${cut}/${s.id}-${nn}`.toLowerCase()) ?? null, out, letters: text.replace(/[^ء-ي]/g, '').length };
    });
    scenes.push({ id: `${cut}/${s.id}`, source: found.get(`${cut}/${s.id}`.toLowerCase()) ?? null, lines });
  }
}
const work = join(ROOT, 'build', 'ingest');
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'manifest.json'), JSON.stringify({ scenes }, null, 1));
writeFileSync(join(work, 'asr-lines.json'), JSON.stringify(asr));
const r = spawnSync(process.env.PIPER_PYTHON ?? 'python3', [join(HERE, 'audio', 'ingest.py'), join(work, 'manifest.json'), join(work, 'report.json')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
