// The thumbnail: the product's name and promise beside two real screens — the teacher's live test
// monitor and the student's test on a phone — in the video's design. Drawn by thumbnail.mjs.
import { h } from './anim.js';
import { bgInk, browserWindow, phoneFrame, setSrc } from './parts.js';
import { wordmark } from './scenes/logo.js';

export default async function thumbnail(stage, media) {
  const weights = [300, 400, 600, 700];
  await Promise.all([...weights.map((w) => document.fonts.load(`${w} 40px "Readex Pro"`, 'نص Text')), document.fonts.load('400 20px "Plex Mono"')]);
  const bg = bgInk(1.4);
  bg.update(0);
  const win = browserWindow({ x: 70, y: 250, w: 880, title: 'اختبار الوحدة الثانية · المتابعة المباشرة' });
  const ph = phoneFrame({ x: 820, y: 318, w: 270 });
  win.el.style.transform = 'perspective(2400px) rotateY(9deg)';
  win.el.style.transformOrigin = 'left center';
  const { ar, en } = wordmark(0.82);
  en.style.textAlign = 'right';
  const chip = (t) => h('span', { style: { border: '1.5px solid rgba(141,182,239,0.55)', borderRadius: '999px', padding: '8px 22px', fontSize: '27px', color: 'var(--on-night)' } }, t);
  const text = h('div', { class: 'abs', style: { right: '110px', top: '210px', width: '700px', direction: 'rtl' } },
    h('div', { style: { fontSize: '19px', color: 'var(--on-night-muted)', marginBottom: '26px', direction: 'ltr', textAlign: 'right' } },
      h('span', { class: 'mono', style: { letterSpacing: '0.2em' } }, 'PRODUCT SHOWCASE · '), h('span', { style: { fontSize: '24px' } }, 'عرض المنتج')),
    ar, en,
    h('div', { style: { fontSize: '50px', fontWeight: '600', color: '#fff', lineHeight: '1.35', marginTop: '54px' } }, 'من قرار المنهج', h('br'), 'إلى درجة الطالب'),
    h('div', { style: { display: 'flex', gap: '14px', marginTop: '40px' } }, chip('المنهج'), chip('الفصل'), chip('المؤسسة')));
  stage.append(h('div', { class: 'scene' }, bg.el, win.el, ph.el, text));
  await Promise.all([setSrc(win.imgA, media('monitor/003.jpg')), setSrc(ph.imgA, media('student-test/006.jpg'))]);
  // The monitor's header and table, filling the window.
  win.view.style.transformOrigin = '100% 0';
  win.view.style.transform = 'scale(1.32)';
  win.imgB.style.opacity = '0';
  ph.imgB.style.opacity = '0';
  await document.fonts.ready;
}
