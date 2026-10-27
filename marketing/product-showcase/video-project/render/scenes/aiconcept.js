// A labelled concept, not a product screen: how an educational assistant could sit in the student
// portal, with its rules. Dashed lines and the banner mark it as future vision throughout.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { icon } from '../icons.js';

export default function aiconcept(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(10.1);
  const progress = ctx.progress(scene);
  const banner = h('div', { class: 'abs', style: { left: '0', right: '0', top: '70px', display: 'flex', justifyContent: 'center' } },
    h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', border: '2px dashed var(--amber)', color: 'var(--amber)', borderRadius: '16px', padding: '14px 30px', fontSize: '32px', fontWeight: '600', background: 'rgba(231,189,104,0.08)' } },
      icon('sparkle', 36, 1.6), p.banner.ar, h('span', { class: 'mono', style: { fontSize: '17px', letterSpacing: '0.14em' } }, p.banner.en.toUpperCase())));
  const C = { x: 960, y: 500 };
  const center = h('div', { class: 'abs', style: { left: `${C.x - 150}px`, top: `${C.y - 150}px`, width: '300px', height: '300px', borderRadius: '50%', border: '3px dashed rgba(201,162,230,0.8)', background: 'radial-gradient(circle, rgba(201,162,230,0.22), rgba(201,162,230,0.04))', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--on-night)' } },
    h('div', {}, h('div', { style: { color: 'var(--violet)', display: 'flex', justifyContent: 'center' } }, icon('sparkle', 64, 1.4)), h('div', { style: { fontSize: '34px', fontWeight: '700' } }, p.center.ar), h('div', { class: 'mono', style: { fontSize: '14px', color: 'var(--on-night-muted)' } }, p.center.en.toUpperCase())));
  const node = (x, y, label, en, tone) => h('div', { class: 'abs', style: { left: `${x - 170}px`, top: `${y - 42}px`, width: '340px', textAlign: 'center', padding: '16px 18px', borderRadius: '16px', border: `2px dashed ${tone}`, color: 'var(--on-night)', background: 'rgba(11,18,32,0.6)' } },
    h('div', { style: { fontSize: '28px', fontWeight: '600' } }, label), h('div', { class: 'mono', style: { fontSize: '13px', color: 'var(--on-night-muted)', textTransform: 'uppercase' } }, en));
  const inputs = p.inputs.map((x, i) => ({ el: node(1580, 330 + i * 170, x.ar, x.en, 'rgba(141,182,239,0.7)'), y: 330 + i * 170 }));
  const uses = p.uses.map((x, i) => ({ el: node(340, 290 + i * 140, x.ar, x.en, 'rgba(111,208,160,0.7)'), y: 290 + i * 140, at: x.at }));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '1920'); svg.setAttribute('height', '1080');
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  const path = (x1, y1, x2, y2, color) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`);
    e.setAttribute('fill', 'none'); e.setAttribute('stroke', color); e.setAttribute('stroke-width', '2.5'); e.setAttribute('stroke-dasharray', '10 9');
    svg.append(e);
    return e;
  };
  const inPaths = inputs.map((x) => path(1410, x.y, C.x + 150, C.y, 'rgba(141,182,239,0.55)'));
  const usePaths = uses.map((x) => path(C.x - 150, C.y, 510, x.y, 'rgba(111,208,160,0.55)'));
  const rules = p.rules.map((r) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px', border: `2px dashed ${r.at === 4 ? 'var(--coral)' : 'rgba(231,189,104,0.6)'}`, color: 'var(--on-night)', borderRadius: '14px', padding: '12px 20px', fontSize: '26px', background: 'rgba(11,18,32,0.6)' } },
    icon(r.at === 4 ? 'teacher' : 'shield', 30, 1.7), r.ar));
  const ruleRow = h('div', { class: 'abs', style: { left: '120px', right: '120px', top: '880px', display: 'flex', justifyContent: 'center', gap: '18px', direction: 'rtl', flexWrap: 'wrap' } }, ...rules);
  const el = h('div', { class: 'scene dark' }, bg.el, svg, banner, center, ...inputs.map((x) => x.el), ...uses.map((x) => x.el), ruleRow, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(banner, t, 0.1, { dy: -16, d: 0.7 });
      enter(center, t, lineT(0) + 0.6, { scale: 0.2, dy: 0, d: 0.9 });
      center.style.boxShadow = `0 0 ${(40 + 30 * Math.sin(t * 1.6)).toFixed(1)}px rgba(201,162,230,0.35)`;
      const ia = lineT(p.inputsAt ?? 1);
      inputs.forEach((x, i) => enter(x.el, t, ia + 0.2 + i * 0.4, { dx: 40, dy: 0, d: 0.6 }));
      inPaths.forEach((e, i) => { e.style.opacity = String(clamp(prog(t, ia + 0.5 + i * 0.4, ia + 1.1 + i * 0.4))); e.style.strokeDashoffset = String(-t * 30); });
      uses.forEach((x, i) => enter(x.el, t, lineT(x.at) + 0.2 + i * 0.45, { dx: -40, dy: 0, d: 0.6 }));
      usePaths.forEach((e, i) => { e.style.opacity = String(clamp(prog(t, lineT(uses[i].at) + 0.4 + i * 0.45, lineT(uses[i].at) + 1 + i * 0.45))); e.style.strokeDashoffset = String(t * 30); });
      rules.forEach((r, i) => {
        const same = p.rules.filter((x, j) => j < i && x.at === p.rules[i].at).length;
        enter(r, t, lineT(p.rules[i].at) + 0.3 + same * 0.7, { dy: 20, d: 0.6 });
      });
      const hl = scene.lines[p.highlightAt ?? 4] ? lineT(p.highlightAt ?? 4) : lineT(scene.lines.length - 1) + 1.5;
      const k = ease.out(prog(t, hl, hl + 0.8));
      rules[rules.length - 1].style.boxShadow = `0 0 ${(k * 34).toFixed(1)}px rgba(224,118,107,0.55)`;
    },
  };
}
