// Where AI stands today, stated plainly: a status board, row by row with the narration.
import { enter, h } from '../anim.js';
import { icon } from '../icons.js';

export default function aistatus(scene, ctx) {
  const bg = ctx.bgInk(9.3);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '300px', top: '150px' } }, h('div', { class: 'eyebrow' }, 'ARTIFICIAL INTELLIGENCE · STATUS TODAY'), h('div', { class: 'title-ar', style: { fontSize: '62px' } }, 'الذكاء الاصطناعي: أين نقف اليوم؟'));
  const rows = scene.p.rows.map((r) => h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 34px', borderRadius: '18px', background: 'rgba(237,242,250,0.05)', border: '1px solid rgba(237,242,250,0.13)', direction: 'rtl' } },
    h('div', {}, h('div', { style: { fontSize: '34px', color: 'var(--on-night)', fontWeight: '500' } }, r.ar), h('div', { class: 'mono', style: { fontSize: '15px', color: 'var(--on-night-muted)', textTransform: 'uppercase', direction: 'ltr', textAlign: 'right' } }, r.en)),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(231,189,104,0.12)', color: 'var(--amber)', border: '1px solid rgba(231,189,104,0.45)', borderRadius: '999px', padding: '10px 24px', fontSize: '28px', whiteSpace: 'nowrap' } },
      icon('clock', 30, 1.8), h('span', {}, r.v.ar), h('span', { class: 'mono', style: { fontSize: '15px', opacity: '0.85' } }, r.v.en.toUpperCase()))));
  const list = h('div', { class: 'abs', style: { right: '300px', left: '300px', top: '370px', display: 'grid', gap: '22px' } }, ...rows);
  const el = h('div', { class: 'scene dark' }, bg.el, head, list, progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      rows.forEach((r, i) => {
        const same = scene.p.rows.filter((x, j) => j < i && x.at === scene.p.rows[i].at).length;
        enter(r, t, lineT(scene.p.rows[i].at) + 0.2 + same * 0.6, { dx: 50, dy: 0, d: 0.7 });
      });
    },
  };
}
