// The three layers of the platform: curriculum, classroom, institution.
import { enter, h } from '../anim.js';

const TONES = [['var(--sky)', 'rgba(141,182,239,0.16)'], ['var(--mint)', 'rgba(111,208,160,0.14)'], ['var(--violet)', 'rgba(201,162,230,0.14)']];

export default function layers(scene, ctx) {
  const bg = ctx.bgInk(5.2);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '110px' } }, h('div', { class: 'eyebrow' }, 'ONE PLATFORM · THREE LAYERS'), h('div', { class: 'title-ar', style: { fontSize: '60px' } }, 'منصة واحدة، ثلاث طبقات'));
  const bands = scene.p.layers.map((l, i) => {
    const [fg, soft] = TONES[i];
    return h('div', { class: 'abs', style: { right: '230px', left: '230px', top: `${300 + i * 228}px`, height: '196px', borderRadius: '24px', background: `linear-gradient(270deg, ${soft}, rgba(237,242,250,0.03))`, border: '1px solid rgba(237,242,250,0.14)', borderInlineStart: `8px solid ${fg}`, display: 'flex', alignItems: 'center', gap: '50px', padding: '0 44px', direction: 'rtl' } },
      h('div', { style: { width: '300px', flex: 'none' } },
        h('div', { class: 'mono', style: { fontSize: '18px', color: fg, letterSpacing: '0.16em' } }, `0${i + 1} · ${l.en.toUpperCase()}`),
        h('div', { style: { fontSize: '62px', fontWeight: '700', color: 'var(--on-night)' } }, l.ar)),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px' } }, ...l.items.map((x) => h('span', { class: 'chip', style: { fontSize: '26px' } }, x))));
  });
  const el = h('div', { class: 'scene dark' }, bg.el, head, ...bands, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      bands.forEach((b, i) => {
        const t0 = lineT(i + 1) - 0.1;
        enter(b, t, t0, { dx: 80, dy: 0, d: 0.8 });
        [...b.lastChild.children].forEach((c, j) => enter(c, t, t0 + 0.5 + j * 0.18, { dy: 10, d: 0.45 }));
        // Once all three are shown, the one being described stays brightest.
        const active = scene.lines.findIndex((l) => t >= l.t && t < l.t + l.d + 0.4) - 1;
        if (t > lineT(1) && active >= 0 && active !== i && t < lineT(3) + 0.2) b.style.opacity = String(Math.min(Number(b.style.opacity), 0.55));
      });
    },
  };
}
