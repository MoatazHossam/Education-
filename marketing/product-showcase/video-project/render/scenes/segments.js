// Target customers: one card per segment with its need, what the platform offers, and whether it is
// supported today or a later expansion. The segment being described is highlighted.
import { ease, enter, h, prog } from '../anim.js';
import { icon } from '../icons.js';
import { status } from '../parts.js';

export default function segments(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(7.7);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '200px', top: '90px' } }, h('div', { class: 'eyebrow' }, 'WHO IT IS FOR'), h('div', { class: 'title-ar', style: { fontSize: '58px' } }, 'لمن صُمّمت المنصة؟'));
  const cards = p.segments.map((s) => {
    const later = s.status === 'later';
    return h('div', { style: { borderRadius: '24px', background: later ? 'rgba(201,162,230,0.06)' : 'rgba(237,242,250,0.06)', border: `1px ${later ? 'dashed' : 'solid'} ${later ? 'rgba(201,162,230,0.5)' : 'rgba(237,242,250,0.16)'}`, padding: '30px 28px', display: 'flex', flexDirection: 'column', gap: '18px', color: 'var(--on-night)', height: '700px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('div', { style: { width: '80px', height: '80px', borderRadius: '20px', background: later ? 'rgba(201,162,230,0.16)' : 'rgba(141,182,239,0.14)', color: later ? 'var(--violet)' : 'var(--sky)', display: 'grid', placeItems: 'center' } }, icon(s.icon, 46, 1.6)),
        status(later ? 'later' : 'now', later ? { ar: 'توسّع لاحق', en: 'Later' } : null)),
      h('div', { style: { fontSize: '33px', fontWeight: '700', lineHeight: '1.35', minHeight: '134px' } }, s.ar),
      h('div', { class: 'mono', style: { fontSize: '14px', color: 'var(--on-night-muted)', textTransform: 'uppercase', direction: 'ltr', textAlign: 'right' } }, s.en),
      h('div', { style: { fontSize: '25px', color: later ? 'var(--violet)' : 'var(--amber)', lineHeight: '1.5', borderInlineStart: '3px solid currentColor', paddingInlineStart: '14px' } }, `«${s.need}»`),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: 'auto' } }, ...s.offer.map((o) => h('span', { class: 'chip', style: { fontSize: '21px', padding: '6px 13px', ...(later ? { background: 'rgba(201,162,230,0.08)', borderColor: 'rgba(201,162,230,0.3)' } : {}) } }, o))));
  });
  const grid = h('div', { class: 'abs', style: { right: '200px', left: '200px', top: '260px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '26px', direction: 'rtl', transformOrigin: '50% 40%' } }, ...cards);
  const el = h('div', { class: 'scene dark' }, bg.el, head, grid, progress.el);
  const beats = p.beats;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      // The board drifts slowly closer through the scene: no long still picture while a segment is described.
      grid.style.transform = `scale(${(1 + 0.025 * ease.inOutSine(prog(t, 0, scene.dur))).toFixed(4)})`;
      // Which segment is being described now.
      let k = -1;
      scene.lines.forEach((l, i) => { if (t >= l.t - 0.2) k = i; });
      const focus = k >= 0 ? beats[k] ?? -1 : -1;
      const prev = k > 0 ? beats[k - 1] ?? -1 : -1;
      const blend = k >= 0 ? ease.inOutSine(prog(t, scene.lines[k].t - 0.2, scene.lines[k].t + 0.5)) : 1;
      cards.forEach((c, i) => {
        const o = enter(c, t, 0.4 + i * 0.3, { dy: 40, d: 0.8 });
        const level = (f) => (f === -1 || f === i ? 1 : 0.34);
        const lv = level(prev) + (level(focus) - level(prev)) * blend;
        c.style.opacity = (o * lv).toFixed(3);
        const s = (f) => (f === i ? 1.03 : 1);
        c.style.transform = `${c.style.transform} scale(${(s(prev) + (s(focus) - s(prev)) * blend).toFixed(4)})`;
      });
    },
  };
}
