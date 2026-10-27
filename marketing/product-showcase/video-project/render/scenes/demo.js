// A product demonstration in a browser window: the recorded frames of the real application, with the
// feature's name and status, and optional overlays (key figures, a callout, notes).
import { arDigits, enter, h } from '../anim.js';
import { browserWindow, caption } from '../parts.js';
import { screenPlayer } from '../screen.js';

const W = 1408;
const X = (1920 - W) / 2;
const Y = 168;

export default function demo(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgPaper();
  const progress = ctx.progress(scene);
  const win = browserWindow({ x: X, y: Y, w: W });
  const player = screenPlayer(scene.plan, win, ctx);
  const cap = caption(p);
  const overlays = [];
  const lineT = (k) => scene.lines[Math.min(k, scene.lines.length - 1)]?.t ?? 0;
  const lineEnd = (k) => { const l = scene.lines[Math.min(k, scene.lines.length - 1)]; return l ? l.t + l.d : scene.dur; };

  if (p.stats) {
    const row = h('div', { class: 'statrow', style: { right: '200px', top: '640px' } },
      ...p.stats.items.map(([n, label]) => h('div', { class: 's' }, h('b', {}, arDigits(n)), h('span', {}, label))));
    overlays.push({ el: row, t0: lineT(p.stats.at) + 0.3, t1: lineEnd(p.stats.at) + 0.4, stagger: true });
  }
  if (p.callout) {
    const c = h('div', { class: 'callout' }, h('span', {}, p.callout.ar), h('span', { class: 'en' }, p.callout.en));
    overlays.push({ el: c, t0: lineT(p.callout.at) + 0.2, t1: scene.dur + 1, centered: true });
  }
  for (const n of p.notes ?? []) {
    const c = h('div', { class: `callout ${n.kind === 'dev' ? 'dev' : ''}` }, h('span', {}, n.ar), h('span', { class: 'en' }, n.en));
    overlays.push({ el: c, t0: lineT(n.at) + 0.2, t1: lineEnd(n.at) + 1.6, centered: true });
  }

  const el = h('div', { class: 'scene' }, bg.el, win.el, cap, ...overlays.map((o) => o.el), progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(cap, t, 0.15, { dy: -14, d: 0.6 });
      for (const o of overlays) {
        if (o.stagger) {
          [...o.el.children].forEach((ch, i) => enter(ch, t, o.t0 + i * 0.18, { dy: 30, d: 0.55, exit: o.t1 }));
          o.el.style.opacity = '1';
        } else {
          const op = enter(o.el, t, o.t0, { dy: 20, d: 0.5, exit: o.t1 });
          if (o.centered) o.el.style.transform = `translateX(-50%) ${o.el.style.transform}`;
          o.el.style.visibility = op > 0.001 ? 'visible' : 'hidden';
        }
      }
      return player.update(t);
    },
  };
}
