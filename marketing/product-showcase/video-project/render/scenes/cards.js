// A title and a row of cards (principles, what each user gains, what is ready).
import { enter, h } from '../anim.js';
import { icon } from '../icons.js';
import { status } from '../parts.js';

export default function cards(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(4.4);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '170px', display: 'flex', alignItems: 'center', gap: '28px' } },
    h('div', {}, h('div', { class: 'eyebrow' }, p.title.en.toUpperCase()), h('div', { class: 'title-ar', style: { fontSize: '66px' } }, p.title.ar)),
    p.status ? status(p.status) : null);
  const n = p.cards.length;
  const cards = p.cards.map((c) => h('div', { style: { borderRadius: '24px', background: 'linear-gradient(180deg, rgba(237,242,250,0.08), rgba(237,242,250,0.03))', border: '1px solid rgba(237,242,250,0.14)', padding: '40px 32px', display: 'flex', flexDirection: 'column', gap: '22px', minHeight: '330px', color: 'var(--on-night)' } },
    h('div', { style: { width: '86px', height: '86px', borderRadius: '22px', background: 'rgba(141,182,239,0.14)', color: 'var(--sky)', display: 'grid', placeItems: 'center' } }, icon(c.icon, 48, 1.6)),
    h('div', { style: { fontSize: n > 4 ? '36px' : '40px', fontWeight: '600', lineHeight: '1.35' } }, c.ar),
    h('div', { class: 'mono', style: { fontSize: '16px', color: 'var(--on-night-muted)', textTransform: 'uppercase', direction: 'ltr', textAlign: 'right', lineHeight: '1.5' } }, c.en)));
  const row = h('div', { class: 'abs', style: { right: '230px', left: '230px', top: '420px', display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: '28px', direction: 'rtl' } }, ...cards);
  const when = new Array(n).fill(Infinity);
  p.beats.forEach((group, k) => group.forEach((ci, j) => { when[ci] = Math.min(when[ci], (scene.lines[k]?.t ?? 0) + 0.15 + j * 0.4); }));
  const el = h('div', { class: 'scene dark' }, bg.el, head, row, progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      cards.forEach((c, i) => enter(c, t, when[i], { dy: 40, d: 0.75, scale: 0.05 }));
    },
  };
}
