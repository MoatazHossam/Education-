// Where the product stands: verified test figures, and what remains before a commercial launch.
import { ease, enter, h, prog } from '../anim.js';

export default function readiness(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(13.4);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '120px' } }, h('div', { class: 'eyebrow' }, 'READINESS · VERIFIED LOCALLY'), h('div', { class: 'title-ar', style: { fontSize: '58px' } }, 'أين نقف اليوم؟'));
  const tiles = p.stats.map((s) => {
    const num = h('div', { class: 'ltr', style: { fontSize: '104px', fontWeight: '700', color: 'var(--mint)', lineHeight: '1', fontVariantNumeric: 'tabular-nums' } }, '0');
    return { num, target: Number(s.big), el: h('div', { style: { padding: '28px 32px', borderRadius: '22px', background: 'rgba(237,242,250,0.06)', border: '1px solid rgba(111,208,160,0.4)', display: 'grid', gap: '10px' } },
      num, h('div', { style: { fontSize: '30px', color: 'var(--on-night)' } }, s.ar), h('div', { class: 'mono', style: { fontSize: '14px', color: 'var(--on-night-muted)', textTransform: 'uppercase', direction: 'ltr', textAlign: 'right' } }, s.en)) };
  });
  const col = h('div', { class: 'abs', style: { right: '230px', left: '230px', top: '290px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '26px', direction: 'rtl' } }, ...tiles.map((x) => x.el));
  const rem = h('div', { class: 'abs', style: { left: '230px', right: '230px', top: '620px', padding: '30px 38px', borderRadius: '24px', border: '1.5px solid rgba(231,189,104,0.55)', background: 'rgba(231,189,104,0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 40px', direction: 'rtl' } },
    h('div', { style: { fontSize: '36px', fontWeight: '700', color: 'var(--amber)', gridColumn: '1 / -1' } }, p.remaining.title),
    ...p.remaining.items.map((x) => h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', fontSize: '31px', color: 'var(--on-night)' } }, h('i', { style: { width: '30px', height: '30px', borderRadius: '8px', border: '2.5px solid var(--amber)', display: 'block', flex: 'none' } }), x)));
  const el = h('div', { class: 'scene dark' }, bg.el, head, col, rem, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      tiles.forEach((x, i) => {
        const t0 = lineT(0) + 0.6 + i * 0.6;
        enter(x.el, t, t0, { dy: 30, d: 0.6 });
        x.num.textContent = String(Math.round(x.target * ease.out(prog(t, t0, t0 + 1.4))));
      });
      enter(rem, t, lineT(p.remaining.at) + 0.2, { dy: 30, d: 0.7 });
      [...rem.children].slice(1).forEach((c, i) => enter(c, t, lineT(p.remaining.at) + 0.6 + i * 0.55, { dy: 12, d: 0.5 }));
    },
  };
}
