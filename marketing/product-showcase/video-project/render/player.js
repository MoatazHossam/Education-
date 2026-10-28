// The player: given a timeline (lib/timeline.mjs), draws the frame for any time t. The renderer calls
// __seek(t) for every frame and takes a screenshot; nothing depends on the wall clock.
import { bgInk, bgPaper, progressStrip } from './parts.js';

const templates = {};
const live = new Map();
let TL;
let stage;
let captionEl = null;

const ctx = {
  bgInk, bgPaper,
  progress: (scene) => progressStrip(scene, TL.chapters),
  media: (path) => `${TL.mediaBase}${path}`,
  shot: (id) => TL.shots[id],
  timeline: () => TL,
};

window.__init = async (timeline) => {
  TL = timeline;
  stage = document.getElementById('stage');
  for (const name of new Set(TL.scenes.map((s) => s.t))) templates[name] = (await import(`./scenes/${name}.js`)).default;
  const weights = [200, 300, 400, 500, 600, 700];
  await Promise.all([...weights.map((w) => document.fonts.load(`${w} 40px "Readex Pro"`, 'نص Text')), document.fonts.load('400 20px "Plex Mono"'), document.fonts.load('500 20px "Plex Mono"')]);
  await document.fonts.ready;
  if (TL.captions) {
    // Preview cut without recorded narration: the narration is shown as captions.
    captionEl = document.createElement('div');
    captionEl.className = 'burned-caption';
    stage.append(captionEl);
    const tag = document.createElement('div');
    tag.className = 'preview-tag';
    tag.textContent = 'معاينة بلا تعليق صوتي · PREVIEW — NO NARRATION';
    stage.append(tag);
  }
  return true;
};

/** Scenes drawn at time t: the current one, and the previous one while the current fades in over it. */
function activeAt(t) {
  const out = [];
  TL.scenes.forEach((s, i) => {
    const next = TL.scenes[i + 1];
    const until = s.end + (next ? next.trans : 0);
    if (t >= s.start - 1e-6 && t < until) out.push(i);
  });
  return out;
}

window.__seek = async (t) => {
  const active = activeAt(t);
  for (const [i, inst] of live) {
    if (!active.includes(i)) {
      inst.el.remove();
      live.delete(i);
    }
  }
  const waits = [];
  for (const i of active) {
    const s = TL.scenes[i];
    if (!live.has(i)) {
      const inst = templates[s.t](s, ctx);
      inst.el.classList.add('scene');
      inst.el.style.zIndex = String(i + 1);
      stage.append(inst.el);
      live.set(i, inst);
    }
    const inst = live.get(i);
    const lt = t - s.start;
    const w = inst.update(lt);
    if (w) waits.push(w);
    const op = s.trans > 0 ? Math.min(1, Math.max(0, lt / s.trans)) : 1;
    inst.el.style.opacity = op.toFixed(3);
  }
  if (captionEl) {
    const c = TL.captions.find((x) => t >= x.t0 && t < x.t1);
    captionEl.textContent = c ? c.text : '';
    captionEl.style.opacity = c ? '1' : '0';
  }
  await Promise.all(waits);
  return active.map((i) => TL.scenes[i].id);
};
