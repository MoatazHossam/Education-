// The product reveal: the logo mark builds itself, then the name in Arabic and English.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { logoMark } from '../icons.js';

export function wordmark(size = 1) {
  const ar = h('div', { style: { fontSize: `${112 * size}px`, fontWeight: '700', color: 'var(--on-night)', borderInlineStart: `${8 * size}px solid var(--margin)`, paddingInlineStart: `${30 * size}px`, lineHeight: '1.2', whiteSpace: 'nowrap' } }, 'مِداد');
  const en = h('div', { class: 'ltr', style: { fontSize: `${50 * size}px`, fontWeight: '300', color: 'var(--sky)', letterSpacing: '0.02em', marginTop: `${6 * size}px`, textAlign: 'center' } }, 'Midad');
  return { ar, en };
}

export default function logo(scene, ctx) {
  const bg = ctx.bgInk(2.2);
  const mark = logoMark(200);
  mark.style.cssText += 'position:absolute;left:860px;top:220px;filter:drop-shadow(0 30px 60px rgba(31,78,140,0.55));';
  const svg = mark.querySelector('svg');
  const parts = ['.lm-margin', '.lm-l1', '.lm-l2', '.lm-l3'].map((s) => svg.querySelector(s));
  const { ar, en } = wordmark(1);
  const name = h('div', { class: 'abs', style: { left: '0', right: '0', top: '470px', display: 'flex', flexDirection: 'column', alignItems: 'center' } }, ar, en);
  const tag = h('div', { class: 'abs', style: { left: '0', right: '0', top: '720px', textAlign: 'center', fontSize: '34px', color: 'var(--on-night-muted)' } }, scene.p.tagline.ar);
  const tagEn = h('div', { class: 'abs eyebrow', style: { left: '0', right: '0', top: '780px', textAlign: 'center' } }, scene.p.tagline.en);
  const sweep = h('div', { class: 'abs', style: { top: '460px', height: '170px', width: '260px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)', mixBlendMode: 'screen' } });
  const el = h('div', { class: 'scene dark' }, bg.el, mark, name, tag, tagEn, sweep);
  return {
    el,
    update(t) {
      bg.update(t);
      const k = ease.outBack(prog(t, 0.2, 1.1));
      mark.style.opacity = String(clamp(prog(t, 0.2, 0.6)));
      mark.style.transform = `scale(${(0.6 + 0.4 * k).toFixed(4)})`;
      parts[0].style.transformOrigin = '8px 5px';
      parts[0].style.transform = `scaleY(${ease.out(prog(t, 0.7, 1.3)).toFixed(4)})`;
      parts.slice(1).forEach((p, i) => { p.style.transformOrigin = '12px 0'; p.style.transform = `scaleX(${ease.out(prog(t, 1.0 + i * 0.15, 1.5 + i * 0.15)).toFixed(4)})`; });
      enter(ar, t, 1.45, { dy: 24, d: 0.8, blur: 8 });
      enter(en, t, 1.75, { dy: 18, d: 0.8 });
      enter(tag, t, 2.3, { dy: 14, d: 0.8 });
      enter(tagEn, t, 2.6, { dy: 10, d: 0.8 });
      const s = prog(t, 2.6, 3.6);
      sweep.style.left = `${(560 + s * 800).toFixed(1)}px`;
      sweep.style.opacity = String(s > 0 && s < 1 ? 1 : 0);
    },
  };
}
