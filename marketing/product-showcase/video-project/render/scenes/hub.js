// One platform, many institutions: an update reaches all of them at once; a future AI module plugs in.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { icon, logoMark } from '../icons.js';

export default function hub(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(12.6);
  const progress = ctx.progress(scene);
  const C = { x: 960, y: 560 };
  const R = 330;
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '110px' } }, h('div', { class: 'eyebrow' }, 'CENTRAL MAINTENANCE'), h('div', { class: 'title-ar', style: { fontSize: '54px' } }, 'تحديث واحد يصل إلى الجميع'));
  const mark = logoMark(150);
  const core = h('div', { class: 'abs', style: { left: `${C.x - 110}px`, top: `${C.y - 110}px`, width: '220px', height: '220px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(31,78,140,0.25)', border: '2px solid rgba(141,182,239,0.6)' } }, mark);
  const ring = h('div', { class: 'abs', style: { left: `${C.x}px`, top: `${C.y}px`, width: '0', height: '0', borderRadius: '50%', border: '3px solid rgba(141,182,239,0.6)' } });
  const nodes = Array.from({ length: p.schools }, (_, i) => {
    const a = -Math.PI / 2 + (i / p.schools) * Math.PI * 2;
    const x = C.x + Math.cos(a) * R;
    const y = C.y + Math.sin(a) * R * 0.82;
    return h('div', { class: 'abs', style: { left: `${x - 52}px`, top: `${y - 52}px`, width: '104px', height: '104px', borderRadius: '24px', display: 'grid', placeItems: 'center', background: 'rgba(11,18,32,0.8)', border: '1.5px solid rgba(237,242,250,0.25)', color: 'var(--on-night)' } }, icon('school', 54, 1.5));
  });
  const addon = h('div', { class: 'abs', style: { left: '170px', top: '700px', width: '420px', padding: '20px 24px', borderRadius: '20px', border: '2.5px dashed var(--violet)', color: 'var(--on-night)', background: 'rgba(201,162,230,0.08)', display: 'flex', gap: '14px', alignItems: 'center', direction: 'rtl' } },
    h('span', { style: { color: 'var(--violet)' } }, icon('sparkle', 46, 1.5)), h('div', {}, h('div', { style: { fontSize: '28px', fontWeight: '600' } }, p.addon.ar), h('div', { class: 'mono', style: { fontSize: '14px', color: 'var(--on-night-muted)' } }, p.addon.en.toUpperCase())));
  const link = h('div', { class: 'abs', style: { left: '590px', top: '752px', height: '0', borderTop: '2.5px dashed var(--violet)', transformOrigin: 'left' } });
  const el = h('div', { class: 'scene dark' }, bg.el, head, ring, ...nodes, core, link, addon, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      enter(core, t, 0.3, { scale: 0.3, dy: 0, d: 0.8 });
      nodes.forEach((n, i) => enter(n, t, 0.6 + i * 0.12, { scale: 0.4, dy: 0, d: 0.6 }));
      // Update waves from the centre, every 2.2 s while the first line plays.
      const t0 = lineT(0) + 0.8;
      const k = t >= t0 ? ((t - t0) % 2.2) / 2.2 : 0;
      const r = ease.out(k) * R * 1.05;
      ring.style.width = ring.style.height = `${(r * 2).toFixed(1)}px`;
      ring.style.marginLeft = ring.style.marginTop = `${(-r).toFixed(1)}px`;
      ring.style.opacity = String(t >= t0 ? (1 - k) * 0.9 : 0);
      nodes.forEach((n) => { n.style.borderColor = t >= t0 && k > 0.85 ? 'var(--mint)' : 'rgba(237,242,250,0.25)'; n.style.color = t >= t0 && k > 0.85 ? 'var(--mint)' : 'var(--on-night)'; });
      enter(addon, t, lineT(p.addon.at) + 0.3, { dx: -40, dy: 0, d: 0.7 });
      link.style.width = '230px';
      link.style.transform = `scaleX(${ease.out(prog(t, lineT(p.addon.at) + 0.8, lineT(p.addon.at) + 1.6)).toFixed(4)})`;
      link.style.opacity = String(clamp(prog(t, lineT(p.addon.at) + 0.8, lineT(p.addon.at) + 1.0)));
    },
  };
}
