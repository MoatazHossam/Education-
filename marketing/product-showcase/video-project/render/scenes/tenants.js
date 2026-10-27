// Multi-tenancy: organizations share one database, each sees only its own rows.
import { clamp, ease, enter, h, prog } from '../anim.js';
import { icon } from '../icons.js';

const COLORS = ['#8db6ef', '#6fd0a0', '#e7bd68'];

export default function tenants(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(8.1);
  const progress = ctx.progress(scene);
  const xs = [1380, 960, 540];
  const tcards = p.tenants.map((name, i) => h('div', { class: 'abs', style: { left: `${xs[i] - 190}px`, top: '160px', width: '380px', padding: '22px', borderRadius: '20px', background: 'rgba(237,242,250,0.06)', border: `1px solid ${COLORS[i]}66`, display: 'flex', gap: '16px', alignItems: 'center', color: 'var(--on-night)', direction: 'rtl' } },
    h('div', { style: { color: COLORS[i] } }, icon('school', 46, 1.6)), h('div', { style: { fontSize: '27px', fontWeight: '600' } }, name)));
  const lines = p.tenants.map((_, i) => h('div', { class: 'abs', style: { left: `${xs[i] - 1}px`, top: '268px', width: '3px', height: '0px', background: COLORS[i], borderRadius: '2px' } }));
  const db = h('div', { class: 'abs', style: { left: '360px', width: '1200px', top: '470px', height: '380px', borderRadius: '30px', background: 'rgba(11,18,32,0.7)', border: '1px solid rgba(237,242,250,0.18)', padding: '78px 50px 30px', display: 'grid', gap: '18px' } },
    h('div', { class: 'abs', style: { right: '40px', top: '22px', display: 'flex', gap: '12px', alignItems: 'center', color: 'var(--on-night-muted)', fontSize: '24px' } }, icon('db', 34, 1.5), 'قاعدة بيانات واحدة · PostgreSQL'),
    ...p.tenants.map((name, i) => h('div', { class: 'row', style: { height: '68px', borderRadius: '14px', background: `${COLORS[i]}22`, border: `1px solid ${COLORS[i]}66`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', color: 'var(--on-night)', fontSize: '24px', direction: 'rtl' } },
      h('span', {}, `صفوف «${name}» فقط`), h('span', { style: { color: COLORS[i], display: 'flex', gap: '10px', alignItems: 'center', fontSize: '20px' } }, icon('lock', 28, 1.7), h('span', { class: 'mono' }, 'RLS')))));
  const block = h('div', { class: 'abs', style: { left: `${xs[0] - 20}px`, top: '300px', color: 'var(--coral)', display: 'grid', placeItems: 'center' } }, icon('x', 64, 2.4));
  const cross = h('div', { class: 'abs', style: { top: '330px', height: '3px', background: 'repeating-linear-gradient(90deg, var(--coral) 0 14px, transparent 14px 24px)', transformOrigin: 'right' } });
  const label = h('div', { class: 'abs', style: { left: '0', right: '0', top: '900px', textAlign: 'center', fontSize: '30px', color: 'var(--on-night)' } }, p.label.ar, h('div', { class: 'mono', style: { fontSize: '16px', color: 'var(--on-night-muted)', marginTop: '6px' } }, p.label.en.toUpperCase()));
  const el = h('div', { class: 'scene dark' }, bg.el, ...lines, ...tcards, db, cross, block, label, progress.el);
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      tcards.forEach((c, i) => enter(c, t, 0.2 + i * 0.25, { dy: -20, d: 0.7 }));
      enter(db, t, 0.6, { dy: 30, d: 0.8 });
      [...db.children].slice(1).forEach((r, i) => enter(r, t, 1.2 + i * 0.3, { dx: 40, dy: 0, d: 0.6 }));
      lines.forEach((l, i) => { l.style.height = `${(ease.out(prog(t, 1.4 + i * 0.3, 2.2 + i * 0.3)) * (230 + i * 86)).toFixed(1)}px`; });
      // An attempt to read another organization's rows is refused.
      const a = prog(t, 3.4, 4.4);
      cross.style.left = `${xs[1]}px`;
      cross.style.width = `${xs[0] - xs[1] - 30}px`;
      cross.style.transform = `scaleX(${ease.out(a).toFixed(4)})`;
      cross.style.opacity = String(clamp(a * 4) * (1 - prog(t, 7, 7.6)));
      const b = ease.outBack(prog(t, 4.3, 4.9));
      block.style.opacity = String(clamp(prog(t, 4.3, 4.5)) * (1 - prog(t, 7, 7.6)));
      block.style.transform = `scale(${(0.4 + 0.6 * b).toFixed(3)})`;
      enter(label, t, 2.0, { dy: 12, d: 0.7 });
    },
  };
}
