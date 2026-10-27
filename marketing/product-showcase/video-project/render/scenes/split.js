// The origin story: the original single-page artifact, then today's product, side by side.
import { ease, enter, h, prog } from '../anim.js';
import { browserWindow, setSrc } from '../parts.js';
import { icon } from '../icons.js';

export default function split(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgPaper();
  const progress = ctx.progress(scene);
  const mk = (side, x) => {
    const shot = ctx.shot(side.shot);
    const f = shot.frames[side.frame < 0 ? shot.frames.length + side.frame : side.frame];
    const w = browserWindow({ x, y: 290, w: 800, tag: side.tag });
    w.tab.textContent = f.title;
    const label = h('div', { class: 'abs', style: { left: `${x}px`, width: '800px', top: '180px', textAlign: 'right' } },
      h('div', { style: { fontSize: '36px', fontWeight: '700', color: 'var(--ink)' } }, side.ar), h('div', { class: 'mono', style: { fontSize: '16px', color: 'var(--muted)', direction: 'ltr', textAlign: 'right' } }, side.en.toUpperCase()));
    return { w, f, label };
  };
  const right = mk({ ...p.left, tag: 'ORIGINAL · الأصل' }, 990); // the start (read first, on the right)
  const left = mk(p.right, 130);
  const arrow = h('div', { class: 'abs', style: { left: '918px', top: '470px', color: 'var(--margin)' } }, icon('arrow', 84, 1.6));
  const tags = h('div', { class: 'abs', style: { left: '990px', width: '800px', top: '780px', display: 'flex', gap: '14px', justifyContent: 'flex-start', direction: 'rtl' } },
    ...p.tags.items.map((x) => h('span', { style: { background: '#fbe9e7', color: '#8f1f18', borderRadius: '10px', padding: '8px 16px', fontSize: '24px', display: 'inline-flex', gap: '8px', alignItems: 'center' } }, icon('x', 22, 2.2), x)));
  const el = h('div', { class: 'scene' }, bg.el, right.label, right.w.el, left.label, left.w.el, arrow, tags, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  const todayAt = lineT(3) - 0.2;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(right.label, t, 0.2, { dy: 16, d: 0.7 });
      enter(right.w.el, t, 0.3, { dy: 40, d: 0.9 });
      enter(tags, t, lineT(p.tags.at) + 0.2, { dy: 12, d: 0.6 });
      [...tags.children].forEach((c, i) => enter(c, t, lineT(p.tags.at) + 0.3 + i * 0.5, { dy: 10, d: 0.5 }));
      enter(left.label, t, todayAt, { dy: 16, d: 0.7 });
      enter(left.w.el, t, todayAt + 0.1, { dx: -60, dy: 0, d: 0.9 });
      enter(arrow, t, todayAt + 0.4, { dx: 30, dy: 0, d: 0.6 });
      // A slow push-in on both pictures.
      for (const [side, t0] of [[right, 0.3], [left, todayAt]]) {
        const z = 1 + 0.06 * ease.inOutSine(prog(t, t0, t0 + 14));
        side.w.imgA.style.transform = `scale(${z.toFixed(4)})`;
        side.w.imgA.style.transformOrigin = '70% 30%';
      }
      return Promise.all([setSrc(right.w.imgA, ctx.media(right.f.file)), setSrc(left.w.imgA, ctx.media(left.f.file))].filter(Boolean));
    },
  };
}
