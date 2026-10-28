// Information flows once through the platform: chosen books → class → homework → gradebook → student.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { icon } from '../icons.js';

export default function flow(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(6.3);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '140px' } }, h('div', { class: 'eyebrow' }, 'ENTERED ONCE · USED EVERYWHERE'), h('div', { class: 'title-ar', style: { fontSize: '60px' } }, 'المعلومة تُكتب مرة واحدة'));
  const n = p.nodes.length;
  const xs = p.nodes.map((_, i) => 1560 - i * ((1560 - 360) / (n - 1)));
  const Y = 520;
  const track = h('div', { class: 'abs', style: { left: '360px', width: '1200px', top: `${Y - 2}px`, height: '4px', background: 'rgba(237,242,250,0.12)', borderRadius: '2px' } });
  const fill = h('div', { class: 'abs', style: { right: '360px', top: `${Y - 2}px`, height: '4px', background: 'linear-gradient(270deg, var(--sky), var(--mint))', borderRadius: '2px', width: '0px' } });
  const dot = h('div', { class: 'abs', style: { top: `${Y - 14}px`, width: '28px', height: '28px', borderRadius: '50%', background: '#fff', boxShadow: '0 0 30px 10px rgba(141,182,239,0.7)', marginLeft: '-14px' } });
  const nodes = p.nodes.map((nd, i) => h('div', { class: 'abs', style: { left: `${xs[i] - 110}px`, top: `${Y - 80}px`, width: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center' } },
    h('div', { class: 'disc', style: { width: '160px', height: '160px', borderRadius: '50%', background: 'var(--night-2)', border: '2px solid rgba(141,182,239,0.4)', display: 'grid', placeItems: 'center', color: 'var(--sky)' } }, icon(nd.icon, 70, 1.5)),
    h('div', { style: { fontSize: '34px', fontWeight: '600', color: 'var(--on-night)', whiteSpace: 'nowrap' } }, nd.ar),
    h('div', { class: 'mono', style: { fontSize: '15px', color: 'var(--on-night-muted)', textTransform: 'uppercase' } }, nd.en)));
  const footer = h('div', { class: 'abs', style: { left: '0', right: '0', top: '850px', display: 'flex', justifyContent: 'center', gap: '22px', direction: 'rtl' } },
    ...p.footer.ar.split(' · ').map((x) => h('span', { class: 'chip', style: { fontSize: '30px', padding: '12px 26px' } }, x)));
  const el = h('div', { class: 'scene dark' }, bg.el, head, track, fill, ...nodes, dot, footer, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      nodes.forEach((nd, i) => enter(nd, t, lineT(0) + 0.3 + i * 0.35, { dy: 30, d: 0.7, scale: 0.08 }));
      const t0 = lineT(1);
      const t1 = t0 + (scene.lines[1]?.d ?? 4) * 0.92;
      const k = ease.inOutSine(prog(t, t0, t1));
      const x = 1560 - k * 1200;
      fill.style.width = `${(k * 1200).toFixed(1)}px`;
      dot.style.left = `${x.toFixed(1)}px`;
      dot.style.opacity = String(t >= t0 ? clamp((t1 + 1.5 - t) / 0.6) : 0);
      nodes.forEach((nd, i) => {
        const lit = t >= t0 && x <= xs[i] + 4;
        const disc = nd.firstChild;
        disc.style.borderColor = lit ? 'var(--mint)' : 'rgba(141,182,239,0.4)';
        disc.style.boxShadow = lit ? '0 0 50px rgba(111,208,160,0.35)' : 'none';
        disc.style.color = lit ? 'var(--mint)' : 'var(--sky)';
      });
      enter(footer, t, lineT(p.footer.at) + 0.2, { dy: 16, d: 0.7 });
      [...footer.children].forEach((c, i) => enter(c, t, lineT(p.footer.at) + 0.3 + i * 0.45, { dy: 14, d: 0.5 }));
    },
  };
}
