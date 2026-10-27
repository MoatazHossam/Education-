// Audio events of a cut for audio/mix.py: music cues per scene, narration clips, sound effects.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lineList } from './timeline.mjs';

export function audioEvents(tl, root) {
  const cues = [];
  for (const s of tl.scenes) {
    const last = cues[cues.length - 1];
    if (last && last.cue === s.music) last.t1 = s.end;
    else cues.push({ t0: s.start, t1: s.end, cue: s.music ?? 'demo' });
  }
  const narration = lineList(tl).filter((l) => l.file).map((l) => ({ t: l.t, d: l.d, file: l.file }));
  const sfx = [];
  const dark = (s) => !['demo', 'phone', 'montage', 'split'].includes(s.t);
  tl.scenes.forEach((s, i) => {
    const prev = tl.scenes[i - 1];
    if (s.t === 'chapter') sfx.push({ t: s.start, kind: 'whoosh', gain: 1 });
    else if (prev && dark(prev) !== dark(s)) sfx.push({ t: s.start, kind: 'whoosh', gain: 0.55 });
    if (s.t === 'logo') {
      sfx.push({ t: s.start - 1.6, kind: 'riser' });
      sfx.push({ t: s.start + 1.0, kind: 'impact' });
    }
    if (s.t === 'endcard') {
      const swap = (s.lines[s.p.slogan?.at ?? 0]?.t ?? 0) - 0.4;
      sfx.push({ t: s.start + swap + 0.75, kind: 'impact', gain: 0.6 });
    }
    if (s.plan) for (const c of s.plan.clicks) sfx.push({ t: s.start + c.t, kind: 'click', pan: 0.5 });
  });
  // music/<cut>-override.wav, when present, replaces the generated score.
  const override = root ? join(root, 'music', `${tl.cut}-override.wav`) : null;
  return { duration: tl.duration, cues, narration, sfx, musicOverride: override && existsSync(override) ? override : null };
}
