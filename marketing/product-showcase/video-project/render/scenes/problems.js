// The challenges, as cards that appear with the narration; a note that they vary by institution.
import { enter, h } from '../anim.js';
import { icon } from '../icons.js';

export default function problems(scene, ctx) {
  const bg = ctx.bgInk(1.1);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '120px' } }, h('div', { class: 'eyebrow' }, 'THE CHALLENGE'), h('div', { class: 'title-ar', style: { fontSize: '60px' } }, 'أين تضيع الصورة؟'));
  const cards = scene.p.cards.map((c) => h('div', { style: { height: '250px', borderRadius: '22px', background: 'rgba(237,242,250,0.05)', border: '1px solid rgba(237,242,250,0.13)', padding: '34px 36px', display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--on-night)' } },
    h('div', { style: { width: '74px', height: '74px', borderRadius: '50%', background: 'rgba(224,118,107,0.16)', color: 'var(--coral)', display: 'grid', placeItems: 'center' } }, icon(c.icon, 42, 1.6)),
    h('div', { style: { fontSize: '40px', fontWeight: '600' } }, c.ar), h('div', { class: 'mono', style: { fontSize: '16px', color: 'var(--on-night-muted)', textTransform: 'uppercase', direction: 'ltr', textAlign: 'right' } }, c.en)));
  const grid = h('div', { class: 'abs', style: { right: '230px', left: '230px', top: '330px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px', direction: 'rtl' } }, ...cards);
  const note = scene.p.note ? h('div', { class: 'abs', style: { left: '0', right: '0', top: '915px', textAlign: 'center', fontSize: '26px', color: 'var(--on-night-muted)' } }, h('div', {}, scene.p.note.ar), h('div', { class: 'mono', style: { fontSize: '15px', marginTop: '6px', direction: 'ltr' } }, scene.p.note.en)) : null;
  const when = new Array(cards.length).fill(Infinity);
  scene.p.beats.forEach((group, k) => group.forEach((ci, j) => { when[ci] = Math.min(when[ci], (scene.lines[k]?.t ?? 0) + 0.15 + j * 0.45); }));
  const el = h('div', { class: 'scene dark' }, bg.el, head, grid, note, progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      cards.forEach((c, i) => enter(c, t, when[i], { dy: 34, d: 0.7, scale: 0.04 }));
      if (note) enter(note, t, (scene.lines[scene.p.note.at]?.t ?? 0) + 0.3, { dy: 12, d: 0.8 });
    },
  };
}
