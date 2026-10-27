// A single statement in large type (the central question).
import { enter, h } from '../anim.js';

export default function question(scene, ctx) {
  const bg = ctx.bgInk(3.1);
  const progress = ctx.progress(scene);
  const rows = scene.p.text.map((line, i) => h('div', { style: { fontSize: '76px', fontWeight: i === scene.p.text.length - 1 ? '700' : '600', color: scene.p.accent?.includes(i) ? 'var(--sky)' : 'var(--on-night)', lineHeight: '1.45', whiteSpace: 'nowrap' } }, line));
  const block = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '300px' } }, ...rows);
  const en = h('div', { class: 'abs', style: { right: '266px', top: '700px', width: '1300px', fontSize: '26px', color: 'var(--on-night-muted)', direction: 'ltr', textAlign: 'right' } }, scene.p.en);
  const el = h('div', { class: 'scene dark' }, bg.el, block, en, progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      const t0 = scene.lines[0]?.t ?? 0.4;
      rows.forEach((r, i) => enter(r, t, t0 - 0.2 + i * 0.75, { dy: 30, d: 0.9, blur: 6 }));
      enter(en, t, t0 + 2.2, { dy: 12, d: 0.8 });
    },
  };
}
