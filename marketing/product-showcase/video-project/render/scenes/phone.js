// The student portal on a phone: recorded frames of the real application on a 390 × 844 screen, the
// feature's name and the points the narration makes; optionally the same page on a computer behind it.
import { enter, h } from '../anim.js';
import { browserWindow, caption, phoneFrame, setSrc } from '../parts.js';
import { screenPlayer } from '../screen.js';

export default function phone(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgPaper();
  const progress = ctx.progress(scene);
  const ph = phoneFrame({ x: p.side ? 760 : 560, y: 108, w: 400 });
  const player = screenPlayer(scene.plan, ph, ctx, { phone: true });
  const cap = caption(p);
  let side = null;
  if (p.side) {
    side = browserWindow({ x: 90, y: 350, w: 600 });
    const shot = ctx.shot(p.side.shot);
    side.file = shot.frames[p.side.frame ?? shot.frames.length - 1];
    side.tab.textContent = side.file.title;
  }
  const lineT = (k) => scene.lines[Math.min(k, scene.lines.length - 1)]?.t ?? 0;
  const pts = (p.points ?? []).map((pt) => ({ el: h('div', { class: 'pt' }, h('i'), h('span', {}, pt.ar)), at: pt.at }));
  const list = h('div', { class: 'points', style: { right: '170px', top: '330px', width: p.side ? '560px' : '720px' } }, ...pts.map((x) => x.el));
  // Notes sit under the points, beside the phone (a centred callout would cover the phone).
  const notes = (p.notes ?? []).map((n) => ({
    el: h('div', { class: `callout side ${n.kind === 'dev' ? 'dev' : ''}`, style: { right: '170px', width: p.side ? '560px' : '720px' } }, h('span', {}, n.ar), h('span', { class: 'en' }, n.en)),
    t0: lineT(n.at) + 0.4,
  }));
  const el = h('div', { class: 'scene' }, bg.el, side ? side.el : null, ph.el, cap, list, ...notes.map((n) => n.el), progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(cap, t, 0.15, { dy: -14, d: 0.6 });
      enter(ph.el, t, 0, { dy: 40, d: 0.8 });
      const waits = [];
      if (side) {
        enter(side.el, t, 0.5, { dx: -40, dy: 0, d: 0.9 });
        const w = setSrc(side.imgA, ctx.media(side.file.file));
        if (w) waits.push(w);
      }
      for (const x of pts) {
        const sameBefore = pts.filter((y) => y.at === x.at).indexOf(x);
        enter(x.el, t, lineT(x.at) + 0.25 + sameBefore * 0.35, { dx: 30, dy: 0, d: 0.55 });
      }
      for (const n of notes) enter(n.el, t, n.t0, { dy: 20, d: 0.5 });
      const w = player.update(t);
      if (w) waits.push(w);
      return waits.length ? Promise.all(waits) : null;
    },
  };
}
