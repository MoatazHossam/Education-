// From today to the roadmap: available now, the pilot next, then the planned capabilities.
import { ease, enter, h, prog } from '../anim.js';
import { status } from '../parts.js';

const TONE = { now: 'var(--mint)', dev: 'var(--amber)', later: 'var(--violet)' };

export default function roadmap(scene, ctx) {
  const p = scene.p;
  const bg = ctx.bgInk(14.2);
  const progress = ctx.progress(scene);
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: '110px' } }, h('div', { class: 'eyebrow' }, 'WHAT COMES NEXT'), h('div', { class: 'title-ar', style: { fontSize: '58px' } }, 'الخطوة التالية وخارطة الطريق'));
  const xs = [1450, 960, 470];
  const track = h('div', { class: 'abs', style: { left: '470px', width: '980px', top: '353px', height: '4px', background: 'rgba(237,242,250,0.14)' } });
  const fill = h('div', { class: 'abs', style: { right: '470px', top: '353px', height: '4px', background: 'linear-gradient(270deg, var(--mint), var(--amber), var(--violet))', width: '0' } });
  const st = p.steps.map((s, i) => {
    const dot = h('div', { class: 'abs', style: { left: `${xs[i] - 22}px`, top: '333px', width: '44px', height: '44px', borderRadius: '50%', background: 'var(--night)', border: `4px solid ${TONE[s.kind]}` } });
    const card = h('div', { class: 'abs', style: { left: `${xs[i] - 235}px`, top: '420px', width: '470px', padding: '26px 28px', borderRadius: '22px', background: 'rgba(237,242,250,0.05)', border: `1.5px ${s.kind === 'later' ? 'dashed' : 'solid'} ${TONE[s.kind]}`, display: 'grid', gap: '14px', direction: 'rtl', color: 'var(--on-night)' } },
      h('div', { style: { display: 'grid', gap: '10px', justifyItems: 'start' } }, h('div', { style: { fontSize: '38px', fontWeight: '700', whiteSpace: 'nowrap' } }, s.ar), status(s.kind)),
      ...s.items.map((x) => h('div', { style: { fontSize: '27px', display: 'flex', gap: '12px', alignItems: 'center' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: TONE[s.kind], flex: 'none' } }), x)));
    return { dot, card };
  });
  const el = h('div', { class: 'scene dark' }, bg.el, head, track, fill, ...st.flatMap((x) => [x.dot, x.card]), progress.el);
  const lineT = (k) => scene.lines[k]?.t ?? 0;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      st.forEach((x, i) => {
        const t0 = lineT(p.beats[i]) + (i === 1 ? 1.2 : 0.2);
        enter(x.dot, t, t0, { scale: 0.5, dy: 0, d: 0.5 });
        enter(x.card, t, t0 + 0.15, { dy: 30, d: 0.7 });
        [...x.card.children].slice(1).forEach((c, j) => enter(c, t, t0 + 0.6 + j * (i === 2 ? 0.75 : 0.3), { dy: 10, d: 0.45 }));
      });
      const k = ease.inOutSine(prog(t, lineT(0) + 1.0, lineT(1) + 1.5));
      fill.style.width = `${(k * 980).toFixed(1)}px`;
    },
  };
}
