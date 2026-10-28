// The invitation to the pilot, then the name, the brand line and the call to action.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { logoMark } from '../icons.js';
import { wordmark } from './logo.js';

export default function endcard(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(15.5);
  const invite = h('div', { class: 'abs', style: { left: '0', right: '0', top: '300px', textAlign: 'center' } },
    h('div', { class: 'eyebrow', style: { fontSize: '22px' } }, p.invite.en.toUpperCase()),
    h('div', { class: 'title-ar', style: { fontSize: '88px', marginTop: '10px' } }, p.invite.ar));
  const who = ['المدارس', 'مجموعات المدارس', 'شركات التعليم والنشر', 'الشركاء والمستثمرون'].map((x) => h('span', { class: 'chip', style: { fontSize: '30px', padding: '12px 26px' } }, x));
  const whoRow = h('div', { class: 'abs', style: { left: '0', right: '0', top: '560px', display: 'flex', justifyContent: 'center', gap: '20px', direction: 'rtl' } }, ...who);
  const mark = logoMark(150);
  mark.style.cssText += 'position:absolute;left:885px;top:170px;';
  const { ar, en } = wordmark(0.92);
  const name = h('div', { class: 'abs', style: { left: '0', right: '0', top: '360px', display: 'flex', flexDirection: 'column', alignItems: 'center' } }, ar, en);
  const slogan = h('div', { class: 'abs', style: { left: '0', right: '0', top: '600px', textAlign: 'center', fontSize: '40px', color: 'var(--on-night)', fontWeight: '500' } }, p.slogan.ar);
  const sloganEn = h('div', { class: 'abs', style: { left: '0', right: '0', top: '665px', textAlign: 'center', fontSize: '22px', color: 'var(--on-night-muted)', direction: 'ltr' } }, p.slogan.en);
  const cta = h('div', { class: 'abs', style: { left: '0', right: '0', top: '770px', display: 'flex', justifyContent: 'center' } },
    h('div', { style: { background: 'var(--margin)', color: '#fff', borderRadius: '16px', padding: '18px 36px', fontSize: '32px', fontWeight: '600', boxShadow: '0 20px 50px rgba(192,71,59,0.35)' } }, p.cta.ar, h('span', { class: 'mono', style: { fontSize: '16px', marginInlineStart: '18px', opacity: '0.9' } }, p.cta.en.toUpperCase())));
  const black = h('div', { class: 'abs', style: { inset: '0', background: '#000', opacity: '0' } });
  const el = h('div', { class: 'scene dark' }, bg.el, invite, whoRow, mark, name, slogan, sloganEn, cta, black);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      const swap = lineT(p.slogan.at) - 0.4;
      enter(invite, t, 0.2, { dy: 26, d: 0.8, exit: swap, blur: 6 });
      who.forEach((c, i) => enter(c, t, lineT(0) + 1.2 + i * 0.5, { dy: 16, d: 0.5, exit: swap }));
      const k = ease.outBack(prog(t, swap + 0.3, swap + 1.2));
      mark.style.opacity = String(clamp(prog(t, swap + 0.3, swap + 0.7)));
      mark.style.transform = `scale(${(0.6 + 0.4 * k).toFixed(4)})`;
      enter(ar, t, swap + 0.6, { dy: 20, d: 0.8, blur: 6 });
      enter(en, t, swap + 0.9, { dy: 14, d: 0.8 });
      enter(slogan, t, lineT(p.slogan.at) + 0.4, { dy: 14, d: 0.8 });
      enter(sloganEn, t, lineT(p.slogan.at) + 0.9, { dy: 10, d: 0.8 });
      enter(cta, t, lineT(p.cta.at) + 0.1, { dy: 18, d: 0.7 });
      black.style.opacity = String(ease.inOutSine(prog(t, scene.dur - 1.6, scene.dur)));
    },
  };
}
