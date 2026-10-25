// The student portal: what a school-created student account sees. It has its
// own header (no organizations, notifications or staff navigation) and shows
// the books of the student's grade in the scope the school assigned.
import { get, patch, post } from '../api.js';
import { append, clear, dialog, errorMessage, form, h, toast } from '../dom.js';
import { locale, setLocale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { loadSession, session } from '../state.js';
import { pageHead } from './shell.js';

const KINDS = ['moe', 'lang', 'ext', 'prog', 'exam'];

async function changePassword() {
  const f = form({
    fields: [
      { name: 'currentPassword', label: t('account.currentPassword'), type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'newPassword', label: t('auth.newPassword'), type: 'password', required: true, autocomplete: 'new-password', minlength: 10, hint: t('auth.passwordHint') },
    ],
    submitLabel: t('student.changePassword'),
    onSubmit: async (v) => {
      await post('/api/student/password', v);
      f.el.closest('dialog')?.close();
      toast(t('student.passwordChanged'));
    },
  });
  await dialog({ title: t('student.changePassword'), body: f.el, actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }] });
}

function book(m) {
  return h('span', { class: `mat book ${m.kind}`, dir: 'auto' }, m.title, h('span', { class: 'sr-only' }, ` (${t(`legend.${m.kind}`)})`));
}

function curriculum(data) {
  const ar = locale() === 'ar';
  if (!data.scope) return h('div', { class: 'notice', role: 'status' }, t('student.noScope'));
  if (!data.subjects.length) return h('div', { class: 'notice', role: 'status' }, t('student.noBooks'));
  const blocks = new Map();
  for (const s of data.subjects) {
    if (!blocks.has(s.block)) blocks.set(s.block, []);
    blocks.get(s.block).push(s);
  }
  const kinds = KINDS.filter((k) => data.subjects.some((s) => s.materials.some((m) => m.kind === k)));
  return h('section', { class: 'grade', 'aria-labelledby': 'cur-h' },
    h('div', { class: 'ghead' },
      h('h2', { id: 'cur-h' }, data.grade ? (ar ? data.grade.nameAr : data.grade.nameEn) : t('student.myBooks')),
      data.grade ? h('span', { class: 'ar', lang: ar ? 'en' : 'ar', dir: ar ? 'ltr' : 'rtl' }, ar ? data.grade.nameEn : data.grade.nameAr) : null,
      h('span', { class: 'meta' }, t('student.scopeLine', { scope: data.scope.name, year: data.scope.academicYear }))),
    h('ul', { class: 'legend', 'aria-label': t('student.legend') }, kinds.map((k) => h('li', {}, h('span', { class: `mat book ${k}` }, t(`kind.${k}`))))),
    [...blocks].map(([name, list]) => h('div', { class: 'block' },
      h('div', { class: 'bhead' }, h('span', { dir: 'auto', class: 'bname' }, name), h('span', {}, t(list.length > 1 ? 'picker.subjects' : 'picker.subject', { n: list.length }))),
      list.map((s) => h('div', { class: 'subj' },
        h('div', { class: 'sname' },
          h('b', {}, ar ? s.nameAr : s.nameEn),
          h('span', { class: 'ar', lang: ar ? 'en' : 'ar', dir: ar ? 'ltr' : 'rtl' }, ar ? s.nameEn : s.nameAr),
          h('span', { class: `status st-${s.status}` }, t(`status.${s.status}`))),
        h('div', { class: 'mats' }, s.materials.map(book)))))));
}

export async function portalView(ctx) {
  const me = session.me;
  const school = me.student.school;
  let data = null;
  let error = null;
  try { data = await get('/api/student/curriculum'); } catch (err) { error = err; }

  const top = h('header', { class: 'topbar student-top' }, h('div', { class: 'in' },
    h('span', { class: 'brand' }, t('app.name'), h('small', { dir: 'auto' }, school.name)),
    h('div', { class: 'tools' },
      h('button', {
        type: 'button', class: 'iconbtn', lang: locale() === 'ar' ? 'en' : 'ar', onclick: async () => {
          const next = locale() === 'ar' ? 'en' : 'ar';
          setLocale(next);
          try { await patch('/api/student/profile', { locale: next }); me.user.locale = next; } catch { /* preference stays local */ }
          ctx.render();
        },
      }, locale() === 'ar' ? 'English' : 'العربية'),
      h('button', { type: 'button', class: 'iconbtn', onclick: () => changePassword().catch((e) => toast(errorMessage(e), 'error')) }, t('student.changePassword')),
      h('button', {
        type: 'button', class: 'iconbtn', onclick: async () => {
          await post('/api/auth/logout').catch(() => {});
          await loadSession();
          navigate(`/student-login?school=${encodeURIComponent(school.code)}`);
        },
      }, t('shell.logout')))));

  const main = h('main', { id: 'main', class: 'wrap' },
    pageHead(t('student.title'), t('student.sub', { name: me.user.name, school: school.name })),
    h('p', { class: 'muted' }, t('student.account', { username: me.student.username })),
    error ? h('div', { class: 'alert error', role: 'alert' }, errorMessage(error)) : curriculum(data),
    h('p', { class: 'muted student-foot' }, t('student.chosenBySchool')));

  const root = h('div', {});
  append(clear(root), [top, main]);
  return root;
}
