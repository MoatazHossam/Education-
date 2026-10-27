// The cold open: fragments of the tools a school year is often spread across, drifting; then the
// questions of the narration in large type.
import { clamp, ease, enter, h, prog, rand } from '../anim.js';
import { icon } from '../icons.js';

const SPOTS = [[1380, 170], [330, 210], [1420, 640], [190, 690], [1080, 830], [680, 110]];

export default function cold(scene, ctx) {
  const bg = ctx.bgInk(0.4);
  const frags = scene.p.fragments.map((f, i) => {
    const el = h('div', { class: 'abs', style: { left: `${SPOTS[i][0]}px`, top: `${SPOTS[i][1]}px`, display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 26px', borderRadius: '18px', background: 'rgba(237,242,250,0.06)', border: '1px solid rgba(237,242,250,0.14)', color: 'var(--on-night)', fontSize: '28px', whiteSpace: 'nowrap', direction: 'rtl' } },
      icon(f.icon, 40, 1.5), h('span', {}, f.ar), h('span', { class: 'mono', style: { fontSize: '14px', color: 'var(--on-night-muted)' } }, f.en.toUpperCase()));
    return { el, seed: i + 1 };
  });
  const groups = scene.p.words.map((g) => g.map((w) => h('div', { style: { fontSize: '96px', fontWeight: '700', color: 'var(--on-night)', whiteSpace: 'nowrap', lineHeight: '1.3' } }, w)));
  const holders = groups.map((g) => h('div', { class: 'abs', style: { left: '0', right: '0', top: '330px', display: 'flex', justifyContent: 'center', gap: '70px', direction: 'rtl' } }, ...g));
  const year = h('div', { class: 'abs', style: { left: '0', right: '0', top: '470px', textAlign: 'center' } },
    h('div', { class: 'eyebrow', style: { fontSize: '22px' } }, 'ACADEMIC YEAR'), h('div', { class: 'ltr', style: { fontSize: '120px', fontWeight: '200', color: 'var(--on-night)', letterSpacing: '0.04em' } }, '2026 / 2027'));
  const el = h('div', { class: 'scene dark' }, bg.el, ...frags.map((f) => f.el), year, ...holders);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      const intro = ease.out(prog(t, 0.2, 2.2));
      frags.forEach((f, i) => {
        const r = rand(f.seed);
        const dx = Math.sin(t * 0.25 + r * 6) * 26;
        const dy = Math.cos(t * 0.21 + r * 5) * 18;
        const o = clamp(prog(t, 0.3 + i * 0.25, 1.3 + i * 0.25)) * (t > lineT(1) - 0.3 ? 0.42 : 0.92);
        f.el.style.opacity = o.toFixed(3);
        f.el.style.transform = `translate(${dx.toFixed(1)}px, ${(dy + (1 - intro) * 30).toFixed(1)}px)`;
      });
      enter(year, t, 0.6, { dy: 20, d: 1.4, exit: lineT(1) - 0.1, blur: 10 });
      holders.forEach((hd, gi) => {
        const t0 = lineT(gi + 1);
        const t1 = gi + 2 < scene.lines.length ? lineT(gi + 2) : scene.dur + 5;
        groups[gi].forEach((w, wi) => enter(w, t, t0 + 0.1 + wi * 0.85, { dy: 30, d: 0.7, exit: t1, blur: 8 }));
      });
    },
  };
}
