// A quick sequence of real screens with their names (supporting features).
import { ease, enter, h, prog } from '../anim.js';
import { browserWindow, setSrc } from '../parts.js';

export default function montage(scene, ctx) {
  const bg = ctx.bgPaper();
  const progress = ctx.progress(scene);
  const items = scene.p.items.map((it) => {
    const shot = ctx.shot(it.shot);
    let fi = typeof it.frame === 'number' ? (it.frame < 0 ? shot.frames.length + it.frame : it.frame) : shot.frames.findIndex((f) => f.label === it.frame);
    if (fi < 0) fi = shot.frames.length - 1;
    const w = browserWindow({ x: 256, y: 168, w: 1408 });
    w.tab.textContent = shot.frames[fi].title;
    const chip = h('div', { class: 'caption', style: { top: '52px' } }, h('div', { class: 't' }, h('span', { class: 'ar' }, it.ar), h('span', { class: 'en' }, it.en)));
    return { w, file: shot.frames[fi].file, chip };
  });
  const el = h('div', { class: 'scene' }, bg.el, ...items.flatMap((x) => [x.w.el, x.chip]), progress.el);
  const each = scene.dur / items.length;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      const waits = [];
      items.forEach((x, i) => {
        const t0 = i * each;
        const t1 = i === items.length - 1 ? scene.dur + 5 : (i + 1) * each + 0.5;
        const vis = t >= t0 - 0.01 && t < t1;
        x.w.el.style.display = vis ? 'block' : 'none';
        x.chip.style.display = vis ? 'flex' : 'none';
        if (!vis) return;
        enter(x.w.el, t, t0, { dy: i === 0 ? 30 : 0, d: i === 0 ? 0.7 : 0.5, scale: i === 0 ? 0 : 0.02 });
        enter(x.chip, t, t0 + 0.1, { dy: -12, d: 0.5 });
        x.w.el.style.zIndex = String(10 + i);
        x.chip.style.zIndex = String(30 + i);
        const z = 1 + 0.05 * ease.inOutSine(prog(t, t0, t0 + each + 0.5));
        x.w.imgA.style.transform = `scale(${z.toFixed(4)})`;
        x.w.imgA.style.transformOrigin = '60% 30%';
        const w = setSrc(x.w.imgA, ctx.media(x.file));
        if (w) waits.push(w);
      });
      return waits.length ? Promise.all(waits) : null;
    },
  };
}
