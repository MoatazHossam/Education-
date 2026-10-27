// Architecture, for decision-makers: tenancy and isolation, or deployment, scale and backups.
import { clamp, enter, h, prog } from '../anim.js';
import { icon } from '../icons.js';

const box = (x, y, w, ic, ar, en, tone = 'var(--sky)') => h('div', { class: 'abs', style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, padding: '20px 22px', borderRadius: '20px', background: 'rgba(11,18,32,0.72)', border: `1.5px solid ${tone}`, color: 'var(--on-night)', display: 'flex', gap: '16px', alignItems: 'center', direction: 'rtl' } },
  h('div', { style: { color: tone, flex: 'none' } }, icon(ic, 46, 1.5)), h('div', {}, h('div', { style: { fontSize: '28px', fontWeight: '600', whiteSpace: 'nowrap' } }, ar), en ? h('div', { class: 'mono', style: { fontSize: '13px', color: 'var(--on-night-muted)', textTransform: 'uppercase' } }, en) : null));

function wire(x1, y1, x2, y2) {
  const el = h('div', { class: 'abs', style: { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.max(3, Math.abs(x2 - x1))}px`, height: `${Math.max(3, Math.abs(y2 - y1))}px`, background: 'rgba(141,182,239,0.45)', borderRadius: '2px', transformOrigin: x2 < x1 ? 'right' : y2 > y1 ? 'top' : 'left' } });
  return el;
}

function tenancy() {
  const names = ['مدرسة أ', 'مدرسة ب', 'مركز ج', 'شركة د'];
  const tones = ['#8db6ef', '#6fd0a0', '#e7bd68', '#c9a2e6'];
  const tenants = names.map((n, i) => box(1450 - i * 360, 150, 300, 'school', n, `TENANT ${i + 1}`, tones[i]));
  const app = box(760, 400, 400, 'server', 'تطبيق واحد للجميع', 'ONE APPLICATION');
  const db = h('div', { class: 'abs', style: { left: '460px', top: '640px', width: '1000px', padding: '24px 30px', borderRadius: '24px', background: 'rgba(11,18,32,0.8)', border: '1.5px solid rgba(237,242,250,0.25)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', direction: 'rtl' } },
    h('div', { style: { gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'center', color: 'var(--on-night)', fontSize: '28px', marginBottom: '6px' } }, icon('db', 38, 1.5), 'قاعدة البيانات', h('span', { class: 'mono', style: { fontSize: '15px', color: 'var(--on-night-muted)' } }, 'FORCED ROW-LEVEL SECURITY')),
    ...names.map((n, i) => h('div', { style: { height: '90px', borderRadius: '12px', background: `${tones[i]}24`, border: `1px solid ${tones[i]}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', color: 'var(--on-night)', fontSize: '24px' } }, icon('lock', 26, 1.8), n)));
  const wires = [...names.map((_, i) => wire(1600 - i * 360, 245, 1600 - i * 360, 330)), wire(560, 330, 1600, 330), wire(960, 330, 960, 400), wire(960, 500, 960, 640)];
  const bug = h('div', { class: 'abs', style: { left: '1170px', top: '410px', display: 'flex', gap: '12px', alignItems: 'center', color: 'var(--coral)', fontSize: '26px' } }, icon('bug', 44, 1.6), 'خطأ في الكود؟');
  const refuse = h('div', { class: 'abs', style: { left: '700px', top: '575px', display: 'flex', gap: '12px', alignItems: 'center', color: '#fff', background: 'var(--margin)', borderRadius: '12px', padding: '10px 18px', fontSize: '25px', boxShadow: '0 0 40px rgba(192,71,59,0.55)' } }, icon('shield', 32, 1.8), 'قاعدة البيانات ترفض');
  const extras = h('div', { class: 'abs', style: { right: '120px', top: '420px', display: 'grid', gap: '16px', width: '330px' } },
    ...[['key', 'تشفير الأسرار المحفوظة'], ['worker', 'تدوير مفاتيح التشفير'], ['gauge', 'حدود للطلبات']].map(([ic, t]) => h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', color: 'var(--on-night)', fontSize: '26px', padding: '14px 18px', borderRadius: '14px', border: '1px solid rgba(111,208,160,0.5)', background: 'rgba(111,208,160,0.08)', direction: 'rtl' } }, h('span', { style: { color: 'var(--mint)' } }, icon(ic, 32, 1.7)), t)));
  return { parts: { tenants, app, db, wires, bug, refuse, extras }, all: [...wires, ...tenants, app, db, bug, refuse, extras] };
}

function deploy(scene) {
  const users = box(1500, 420, 300, 'globe', 'المستخدمون', 'BROWSERS & PHONES');
  const lb = box(1090, 420, 380, 'shield', 'موازن الأحمال وTLS', 'CADDY');
  const app1 = box(720, 300, 320, 'server', 'التطبيق — نسخة 1', 'APP 1');
  const app2 = box(720, 540, 320, 'server', 'التطبيق — نسخة 2', 'APP 2');
  const db = box(300, 420, 340, 'db', 'قاعدة البيانات', 'POSTGRESQL');
  const worker = box(700, 790, 420, 'worker', 'العامل الخلفي', 'EMAIL · REMINDERS · FILE SCANS');
  const backup = box(160, 700, 380, 'archive', 'نسخ احتياطية مشفّرة', 'ENCRYPTED BACKUPS');
  const offsite = box(160, 860, 380, 'cloud', 'نسخة خارجية', 'OFF-SITE COPY', 'var(--mint)');
  const wires = [wire(1470, 470, 1500, 470), wire(1040, 380, 1080, 380), wire(1040, 620, 1080, 620), wire(1080, 380, 1080, 620), wire(1080, 470, 1090, 470), wire(640, 470, 680, 470), wire(680, 380, 720, 380), wire(680, 620, 720, 620), wire(680, 380, 680, 620), wire(470, 520, 470, 700), wire(350, 795, 350, 860), wire(540, 840, 700, 840)];
  const stat = h('div', { class: 'abs', style: { left: '1160px', top: '690px', width: '640px', padding: '26px 32px', borderRadius: '24px', background: 'rgba(237,242,250,0.07)', border: '1.5px solid rgba(111,208,160,0.6)', color: 'var(--on-night)', direction: 'rtl' } },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '18px' } }, h('div', { class: 'ltr', style: { fontSize: '96px', fontWeight: '700', color: 'var(--mint)', lineHeight: '1' } }, scene.p.stat.big), h('div', { style: { fontSize: '27px', lineHeight: '1.35' } }, scene.p.stat.ar)),
    h('div', { style: { fontSize: '20px', color: 'var(--amber)', marginTop: '12px' } }, scene.p.stat.note));
  return { parts: { users, lb, app1, app2, db, worker, backup, offsite, wires, stat }, all: [...wires, users, lb, app1, app2, db, worker, backup, offsite, stat] };
}

export default function arch(scene, ctx) {
  const bg = ctx.bgInk(11.3);
  const progress = ctx.progress(scene);
  const isTenancy = scene.p.mode === 'tenancy';
  const head = h('div', { class: 'abs margin-bar', style: { right: '230px', top: isTenancy ? '40px' : '120px' } },
    h('div', { class: 'eyebrow' }, isTenancy ? 'MULTI-TENANT SAAS · ISOLATION' : 'DEPLOYMENT · SCALE · RECOVERY'),
    h('div', { class: 'title-ar', style: { fontSize: '50px' } }, isTenancy ? 'نظام واحد، وبيانات معزولة' : 'جاهزية تقنية للتوسّع'));
  const built = isTenancy ? tenancy() : deploy(scene, ctx);
  const el = h('div', { class: 'scene dark' }, bg.el, head, ...built.all, progress.el);
  // A beat whose line the cut does not have never shows.
  const lineT = (k) => scene.lines[k]?.t ?? Infinity;
  return {
    el,
    update(t) {
      bg.update(t);
      progress.update(t);
      enter(head, t, 0.1, { dy: 18, d: 0.7 });
      const P = built.parts;
      if (isTenancy) {
        P.tenants.forEach((x, i) => enter(x, t, 0.3 + i * 0.2, { dy: -20, d: 0.6 }));
        P.wires.forEach((w, i) => { w.style.opacity = String(clamp(prog(t, 0.9 + i * 0.08, 1.4 + i * 0.08))); });
        enter(P.app, t, 1.2, { dy: 20, d: 0.6 });
        enter(P.db, t, 1.6, { dy: 30, d: 0.7 });
        [...P.db.children].slice(1).forEach((c, i) => enter(c, t, 2.0 + i * 0.25, { dy: 10, d: 0.5 }));
        enter(P.bug, t, lineT(1) + 0.2, { dx: -20, dy: 0, d: 0.5 });
        enter(P.refuse, t, lineT(1) + 1.2, { scale: 0.3, dy: 0, d: 0.5 });
        P.refuse.style.boxShadow = `0 0 ${(30 + 20 * Math.sin(t * 5)).toFixed(1)}px rgba(192,71,59,0.55)`;
        enter(P.extras, t, lineT(2) + 0.2, { dx: -30, dy: 0, d: 0.6 });
        [...P.extras.children].forEach((c, i) => enter(c, t, lineT(2) + 0.3 + i * 0.6, { dx: -20, dy: 0, d: 0.5 }));
      } else {
        const order = [P.users, P.lb, P.app1, P.app2, P.db];
        order.forEach((x, i) => enter(x, t, 0.3 + i * 0.35, { dy: 20, d: 0.6 }));
        P.wires.forEach((w, i) => { w.style.opacity = String(clamp(prog(t, 0.8 + i * 0.12, 1.3 + i * 0.12))); });
        enter(P.worker, t, 2.2, { dy: 20, d: 0.6 });
        enter(P.stat, t, lineT(1) + 0.3, { dy: 30, d: 0.8 });
        enter(P.backup, t, lineT(2) + 0.2, { dx: 30, dy: 0, d: 0.6 });
        enter(P.offsite, t, lineT(2) + 0.8, { dx: 30, dy: 0, d: 0.6 });
        // Requests flowing from the users to both instances.
        const pulse = (t * 0.8) % 1;
        P.app1.style.boxShadow = `0 0 ${(pulse < 0.5 ? 30 : 0)}px rgba(141,182,239,0.4)`;
        P.app2.style.boxShadow = `0 0 ${(pulse >= 0.5 ? 30 : 0)}px rgba(141,182,239,0.4)`;
      }
    },
  };
}
