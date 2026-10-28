// Shared building blocks of the scenes: backgrounds, the chapter progress strip, status badges,
// captions, the browser window and the phone that show the recorded product.
import { arDigits, clamp, ease, h, prog } from './anim.js';

export const STATUS = {
  now: { ar: 'متاح الآن', en: 'Available now' },
  dev: { ar: 'قيد الاستكمال', en: 'In development' },
  later: { ar: 'رؤية مستقبلية', en: 'Future roadmap' },
  concept: { ar: 'تصوّر مستقبلي', en: 'Concept' },
};

export function status(kind, override) {
  const s = override ?? STATUS[kind];
  return h('span', { class: `status ${kind}` }, h('i'), h('span', {}, s.ar), h('span', { class: 'en' }, s.en));
}

export function bgInk(seed = 0) {
  const a = h('div', { class: 'glow a' });
  const b = h('div', { class: 'glow b' });
  const el = h('div', { class: 'bg-ink' }, h('div', { class: 'grid' }), h('div', { class: 'fade' }), a, b);
  return {
    el,
    update(t) {
      const k = t * 0.05 + seed;
      a.style.transform = `translate(${(1100 + Math.sin(k) * 160).toFixed(1)}px, ${(-260 + Math.cos(k * 0.8) * 120).toFixed(1)}px)`;
      b.style.transform = `translate(${(-200 + Math.cos(k * 0.7) * 140).toFixed(1)}px, ${(520 + Math.sin(k * 0.9) * 100).toFixed(1)}px)`;
    },
  };
}

export function bgPaper() {
  return { el: h('div', { class: 'bg-paper' }, h('div', { class: 'rules' }), h('div', { class: 'margin' }), h('div', { class: 'vignette' })), update() {} };
}

/** The strip at the bottom: one segment per chapter, the current one filling as the chapter plays. */
export function progressStrip(scene, chapters) {
  const segs = chapters.map(() => h('div', { class: 'seg' }, h('b')));
  const ch = chapters[scene.ch - 1];
  const lbl = h('div', { class: 'lbl' }, `${arDigits(String(scene.ch).padStart(2, '0'))} · ${ch.ar}`, h('span', { class: 'mono' }, ch.en.toUpperCase()));
  const el = h('div', { class: 'progress' }, ...segs, lbl);
  return {
    el,
    update(t) {
      segs.forEach((s, i) => {
        const n = i + 1;
        const fill = n < scene.ch ? 1 : n > scene.ch ? 0 : clamp((scene.start + t - scene.chStart) / Math.max(1, scene.chEnd - scene.chStart));
        s.firstChild.style.transform = `scaleX(${fill.toFixed(4)})`;
      });
      el.style.opacity = ease.out(prog(t, 0.2, 0.9)).toFixed(3);
    },
  };
}

/** The feature's name, its English name and its status, above the window. */
export function caption(p) {
  const t = h('div', { class: 't' },
    p.group ? h('span', { class: 'group' }, `${p.group.en} ·`) : null,
    h('span', { class: 'ar' }, p.caption.ar), h('span', { class: 'en' }, p.caption.en));
  return h('div', { class: 'caption' }, t, p.status ? status(p.status) : null);
}

/** A browser window around recorded frames (desktop shots, 16:9). */
export function browserWindow({ x, y, w, title = '', tag = 'DEMO DATA · بيانات تجريبية' }) {
  const vh = Math.round((w * 9) / 16);
  const tab = h('span', {}, title);
  const imgA = h('img', { alt: '' });
  const imgB = h('img', { alt: '' });
  // The camera moves `inner` inside the fixed window: the frame never grows over the captions.
  const inner = h('div', { class: 'inner', style: { width: `${w}px`, height: `${vh}px` } }, imgB, imgA);
  const view = h('div', { class: 'view', style: { width: `${w}px`, height: `${vh}px` } }, inner);
  const bar = h('div', { class: 'bar' }, h('div', { class: 'dots' }, h('i'), h('i'), h('i')), h('div', { class: 'tab' }, tab), h('span', { class: 'demo-tag' }, tag));
  const el = h('div', { class: 'window', style: { left: `${x}px`, top: `${y}px`, width: `${w}px` } }, bar, view);
  return { el, view: inner, imgA, imgB, tab, vw: w, vh, barH: 36 };
}

export function phoneFrame({ x, y, w }) {
  const sh = Math.round((w * 844) / 390);
  const imgA = h('img', { alt: '' });
  const imgB = h('img', { alt: '' });
  const inner = h('div', { class: 'inner', style: { width: `${w}px`, height: `${sh}px` } }, imgB, imgA);
  const screen = h('div', { class: 'screen', style: { width: `${w}px`, height: `${sh}px` } }, inner);
  const el = h('div', { class: 'phone', style: { left: `${x}px`, top: `${y}px` } }, h('div', { class: 'notch' }), screen);
  return { el, view: inner, imgA, imgB, vw: w, vh: sh };
}

/** The pointer drawn over recorded frames (the app is not touched; see capture/recorder.ts). */
export function cursorEl() {
  const el = h('div', { class: 'cursor' });
  el.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5l15 9.2-6.6 1.5 3.8 7.2-2.9 1.5-3.8-7.3L4.8 18.6z" fill="#fff" stroke="#18243a" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  return el;
}

/** Sets an image's source and resolves once it can be drawn. */
export function setSrc(img, url) {
  if (img.dataset.src === url) return null;
  img.dataset.src = url;
  img.src = url;
  return img.decode().catch(() => {});
}
