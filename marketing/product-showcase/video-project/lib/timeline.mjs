// Builds the timeline of one cut from its script: scene times, the narration line times (from the
// recorded narration when it exists, otherwise estimated), the demonstrations laid out against them,
// and the audio events (narration, music cues, sound effects).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { naturalDuration, planDemo } from './demo-plan.mjs';
import { estimateSeconds } from './estimate.mjs';
import { wavDuration } from './wav.mjs';

export const FPS = 30;
const GAP = 0.42;

export function narrationFile(root, cut, sceneId, k) {
  return join(root, 'audio', 'narration', cut, `${sceneId}-${String(k + 1).padStart(2, '0')}.wav`);
}

export async function buildTimeline({ root, script, cut, shots }) {
  const scenes = [];
  let t = 0;
  let narrated = 0;
  let estimated = 0;
  for (const [i, s] of script.scenes.entries()) {
    const prev = script.scenes[i - 1];
    const lines = s.lines.map((l, k) => {
      const file = narrationFile(root, cut, s.id, k);
      const has = existsSync(file);
      const d = has ? wavDuration(readFileSync(file)) : estimateSeconds(l.say ?? l.ar);
      if (has) narrated++; else estimated++;
      return { ...l, d, file: has ? file : null };
    });
    const lead = s.lead ?? 0.5;
    const tail = s.tail ?? 0.8;
    let lt = lead;
    for (const l of lines) { l.t = lt; lt += l.d + GAP; }
    let dur = lines.length ? lt - GAP + tail : 0;
    if (s.t === 'demo' || s.t === 'phone') dur = Math.max(dur, naturalDuration(s.p.segments, shots) * 0.85);
    if (s.t === 'montage') dur = Math.max(dur, s.p.items.length * 2.6);
    dur = Math.max(dur, s.min ?? 0);
    dur = Math.round(dur * FPS) / FPS;
    const trans = i === 0 ? 0 : prev.t === s.t && s.t === 'demo' ? 0.4 : 0.6;
    const scene = { id: s.id, t: s.t, ch: s.ch, music: s.music, p: s.p ?? {}, start: t, end: t + dur, dur, trans, lines };
    if (s.t === 'demo' || s.t === 'phone') scene.plan = planDemo(s, shots, lines.map((l) => l.t), dur);
    scenes.push(scene);
    t += dur;
  }
  // Chapter spans for the progress strip.
  for (const s of scenes) {
    const same = scenes.filter((x) => x.ch === s.ch);
    s.chStart = same[0].start;
    s.chEnd = same[same.length - 1].end;
  }
  const usedShots = {};
  for (const [id, shot] of Object.entries(shots)) usedShots[id] = { device: shot.device, viewport: shot.viewport, frames: shot.frames.map((f) => ({ file: f.file, label: f.label, title: f.title })) };
  return {
    meta: script.meta,
    cut,
    chapters: script.chapters,
    fps: FPS,
    duration: Math.round(t * FPS) / FPS,
    narration: { recorded: narrated, estimated },
    mediaBase: '../../recordings/',
    shots: usedShots,
    scenes,
  };
}

/** Narration lines with absolute times (subtitles, mixing). */
export function lineList(tl) {
  return tl.scenes.flatMap((s) => s.lines.map((l, k) => ({ scene: s.id, k, t: s.start + l.t, d: l.d, ar: l.ar, en: l.en, file: l.file })));
}
