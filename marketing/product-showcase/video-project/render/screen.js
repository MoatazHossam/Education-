// Plays a demo plan (lib/demo-plan.mjs) into a window or a phone: the real frames with their
// cross-fades, the pointer, click ripples or taps, and the camera.
import { clamp, ease, h, lerp, prog } from './anim.js';
import { cursorEl, setSrc } from './parts.js';

function at(list, t) {
  let i = -1;
  for (let k = 0; k < list.length; k++) if (list[k].t <= t + 1e-6) i = k; else break;
  return i;
}

export function camAt(cams, t) {
  const i = at(cams, t);
  if (i < 0) return cams[0];
  const a = cams[i];
  const b = cams[i + 1];
  if (!b || b.t <= a.t) return a;
  const k = ease.inOutSine(prog(t, a.t, b.t));
  return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z: lerp(a.z, b.z, k) };
}

export function screenPlayer(plan, holder, ctx, { phone = false } = {}) {
  const { imgA, imgB, view } = holder;
  const scale = holder.vw / plan.W;
  const cursor = phone ? null : cursorEl();
  if (cursor) view.append(cursor);
  const ripples = plan.clicks.map(() => h('div', { class: phone ? 'tap' : 'ripple', style: { opacity: '0' } }));
  view.append(...ripples);
  view.style.transformOrigin = '0 0';
  return {
    scale,
    update(t) {
      const waits = [];
      const c = camAt(plan.cams, t);
      view.style.transform = `translate(${(holder.vw / 2 - c.z * c.cx * scale).toFixed(2)}px, ${(holder.vh / 2 - c.z * c.cy * scale).toFixed(2)}px) scale(${c.z.toFixed(4)})`;
      // Frames
      const i = Math.max(0, at(plan.frames, t));
      const f = plan.frames[i];
      if (f) {
        const k = f.fade > 0 ? ease.out(prog(t, f.t, f.t + f.fade)) : 1;
        const prev = plan.frames[i - 1];
        const w1 = setSrc(imgA, ctx.media(f.src));
        if (w1) waits.push(w1);
        if (k < 1 && prev) {
          const w2 = setSrc(imgB, ctx.media(prev.src));
          if (w2) waits.push(w2);
          imgB.style.opacity = '1';
        } else imgB.style.opacity = '0';
        imgA.style.opacity = k.toFixed(3);
        if (holder.tab) holder.tab.textContent = f.title || '';
      }
      // Pointer
      if (cursor) {
        const j = at(plan.cursor, t);
        let vis = 0;
        if (j >= 0) {
          const a = plan.cursor[j];
          const b = plan.cursor[j + 1];
          let x = a.x;
          let y = a.y;
          if (b && a.v && b.v && b.t > a.t) {
            const k = ease.inOut(prog(t, a.t, b.t));
            x = lerp(a.x, b.x, k);
            // A slight arc, as a hand moves.
            y = lerp(a.y, b.y, k) - Math.sin(Math.PI * k) * Math.min(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.08);
          }
          vis = a.v ? clamp((t - (plan.cursor.find((c) => c.v)?.t ?? 0)) / 0.25) : 0;
          cursor.style.transform = `translate(${(x * scale - 4).toFixed(2)}px, ${(y * scale - 3).toFixed(2)}px)`;
        }
        cursor.style.opacity = vis.toFixed(3);
      }
      // Clicks
      plan.clicks.forEach((c, n) => {
        const k = prog(t, c.t, c.t + 0.55);
        const el = ripples[n];
        if (k <= 0 || k >= 1) { el.style.opacity = '0'; return; }
        el.style.left = `${(c.x * scale).toFixed(1)}px`;
        el.style.top = `${(c.y * scale).toFixed(1)}px`;
        el.style.opacity = (0.95 * (1 - k)).toFixed(3);
        el.style.transform = `scale(${(0.4 + ease.out(k) * 0.9).toFixed(3)})`;
      });
      return waits.length ? Promise.all(waits) : null;
    },
  };
}
