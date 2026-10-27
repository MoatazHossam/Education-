// A chapter card: its number, Arabic title and English name, with the product's red margin rule.
import { clamp, ease, enter, h, prog } from '../anim.js';

export default function chapter(scene, ctx) {
  const TL = ctx.timeline();
  const ch = TL.chapters[scene.ch - 1];
  const bg = ctx.bgInk(scene.ch * 1.7);
  const num = h('div', { class: 'abs mono', style: { right: '300px', top: '300px', fontSize: '150px', fontWeight: '500', color: 'transparent', WebkitTextStroke: '2px rgba(141,182,239,0.75)', letterSpacing: '0.04em', direction: 'ltr' } }, String(scene.ch).padStart(2, '0'));
  const bar = h('div', { class: 'abs', style: { right: '262px', top: '310px', width: '8px', height: '420px', background: 'var(--margin)', transformOrigin: 'top', borderRadius: '4px' } });
  const title = h('div', { class: 'abs title-ar', style: { right: '300px', top: '500px', fontSize: '96px', whiteSpace: 'nowrap' } }, ch.ar);
  const en = h('div', { class: 'abs eyebrow', style: { right: '304px', top: '650px', fontSize: '24px' } }, `CHAPTER ${String(scene.ch).padStart(2, '0')} · ${ch.en}`);
  const dots = h('div', { class: 'abs', style: { right: '300px', top: '740px', display: 'flex', gap: '14px', direction: 'rtl' } },
    ...TL.chapters.map((c) => h('i', { style: { width: '12px', height: '12px', borderRadius: '50%', display: 'block', background: c.n === scene.ch ? 'var(--margin)' : c.n < scene.ch ? 'rgba(237,242,250,0.55)' : 'rgba(237,242,250,0.18)' } })));
  const el = h('div', { class: 'scene dark' }, bg.el, bar, num, title, en, dots);
  return {
    el,
    update(t) {
      bg.update(t);
      bar.style.transform = `scaleY(${ease.outQuint(prog(t, 0.1, 1.0)).toFixed(4)})`;
      enter(num, t, 0.2, { dx: 60, dy: 0, d: 0.9 });
      const k = ease.out(prog(t, 0.45, 1.25));
      title.style.clipPath = `inset(-20px 0 -20px ${(100 - k * 100).toFixed(2)}%)`;
      title.style.opacity = String(clamp(k * 3));
      enter(en, t, 0.9, { dy: 14, d: 0.7 });
      enter(dots, t, 1.1, { dy: 10, d: 0.6 });
    },
  };
}
