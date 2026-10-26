// The student portal: what a school-created student account sees. It has its
// own header (no organizations or staff navigation): Today (what is due and
// what came back), Homework (all of it, and handing work in), and My books
// (the books of the student's grade in the scope the school assigned).
import { del, get, patch, post, put } from '../api.js';
import { append, clear, dialog, errorMessage, fmtDate, form, h, link, toast } from '../dom.js';
import { locale, setLocale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { loadSession, session } from '../state.js';
import { fileItem, fileUploader } from './classes.js';
import { pageHead } from './shell.js';

const KINDS = ['moe', 'lang', 'ext', 'prog', 'exam'];
const subjectName = (x) => (locale() === 'ar' ? x.subjectAr : x.subjectEn);
const act = async (fn) => { try { await fn(); } catch (err) { toast(errorMessage(err), 'error'); } };

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

async function showNotifications(btn) {
  const { notifications } = await get('/api/student/notifications');
  const list = notifications.length
    ? h('ul', { class: 'notif-list' }, notifications.map((n) => h('li', { class: n.readAt ? '' : 'unread' },
      h('b', {}, n.title), h('div', { class: 'muted' }, n.body), h('div', { class: 'mono muted' }, fmtDate(n.createdAt, true)),
      n.link ? link(n.link, t('notifications.open'), { onclick: (e) => e.target.closest('dialog')?.close() }) : null)))
    : h('p', { class: 'muted' }, t('notifications.empty'));
  if (notifications.some((n) => !n.readAt)) {
    await post('/api/student/notifications/read', {});
    session.me.unreadNotifications = 0;
    btn.querySelector('.badge')?.remove();
    btn.setAttribute('aria-label', t('notifications.title'));
  }
  await dialog({ title: t('notifications.title'), body: list, actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
}

function navLink(href, label) {
  return link(href, label, location.pathname === href ? { 'aria-current': 'page' } : {});
}

/** The portal's header and page frame around a student page. */
function frame(ctx, ...content) {
  const me = session.me;
  const school = me.student.school;
  const unread = me.unreadNotifications || 0;
  const bell = h('button', { type: 'button', class: 'iconbtn', 'aria-label': unread ? t('notifications.titleUnread', { n: unread }) : t('notifications.title') },
    h('span', { 'aria-hidden': 'true' }, '🔔'), unread ? h('span', { class: 'badge' }, String(unread)) : null);
  bell.addEventListener('click', () => showNotifications(bell).catch((e) => toast(errorMessage(e), 'error')));
  const top = h('header', { class: 'topbar student-top' }, h('div', { class: 'in' },
    h('span', { class: 'brand' }, t('app.name'), h('small', { dir: 'auto' }, school.name)),
    h('nav', { class: 'nav', 'aria-label': t('shell.nav') },
      navLink('/student', t('portal.today')),
      navLink('/student/homework', t('portal.homework')),
      navLink('/student/books', t('portal.books'))),
    h('div', { class: 'tools' },
      bell,
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
  const main = h('main', { id: 'main', class: 'wrap' }, content);
  const root = h('div', {});
  append(clear(root), [top, main]);
  return root;
}

async function load(path) {
  try { return { data: await get(path) }; } catch (error) { return { error }; }
}

// ------------------------------------------------------------ Today

function dueText(hw) {
  return hw.overdue ? t('hw.wasDue', { when: fmtDate(hw.dueAt, true) }) : t('hw.dueOn', { when: fmtDate(hw.dueAt, true) });
}

/** One homework in a list: title, subject and class, due time, and the student's state. */
function homeworkItem(hw) {
  const state = hw.status === 'returned'
    ? h('span', { class: 'pill ok' }, hw.points !== null ? t('hw.markOf', { points: hw.points, max: hw.maxPoints }) : t('hw.status.returned'))
    : hw.status === 'submitted'
      ? [h('span', { class: 'pill warn' }, t('hw.status.submitted')), hw.late ? [' ', h('span', { class: 'pill bad' }, t('hw.status.late'))] : null]
      : hw.closed
        ? h('span', { class: 'pill bad' }, t('hw.status.missing'))
        : hw.status === 'draft'
          ? h('span', { class: 'pill' }, t('hw.status.draft'))
          : hw.overdue ? h('span', { class: 'pill bad' }, t('hw.overdue')) : null;
  return h('li', { class: 'hw-item' },
    h('div', {}, link(`/student/homework/${hw.id}`, hw.title, { dir: 'auto', class: 'hw-title' }),
      h('div', { class: 'muted' }, subjectName(hw), ' · ', h('span', { dir: 'auto' }, hw.className))),
    h('div', { class: 'hw-side' }, h('span', { class: hw.overdue && hw.status !== 'submitted' && hw.status !== 'returned' ? 'due overdue' : 'due' }, hw.status === 'returned' || hw.status === 'submitted' ? fmtDate(hw.dueAt, true) : dueText(hw)), state));
}

export async function portalView(ctx) {
  const me = session.me;
  const { data, error } = await load('/api/student/home');
  const body = error
    ? h('div', { class: 'alert error', role: 'alert' }, errorMessage(error))
    : [
      h('section', { class: 'card', 'aria-labelledby': 'todo-h' },
        h('h2', { id: 'todo-h' }, t('portal.toDo', { n: data.todo.length })),
        data.todo.length ? h('ul', { class: 'hw-list' }, data.todo.map(homeworkItem)) : h('p', { class: 'empty' }, data.classes.length ? t('portal.nothingDue') : t('portal.noClasses'))),
      data.returned.length ? h('section', { class: 'card', 'aria-labelledby': 'ret-h' },
        h('h2', { id: 'ret-h' }, t('portal.returned')),
        h('ul', { class: 'hw-list' }, data.returned.map(homeworkItem))) : null,
      data.missed.length ? h('section', { class: 'card', 'aria-labelledby': 'miss-h' },
        h('h2', { id: 'miss-h' }, t('portal.missed')),
        h('p', { class: 'muted' }, t('portal.missedHelp')),
        h('ul', { class: 'hw-list' }, data.missed.map(homeworkItem))) : null,
      h('p', {}, link('/student/homework?show=all', t('portal.allHomework')), ' · ', link('/student/books', t('portal.books'))),
    ];
  return frame(ctx,
    pageHead(t('portal.todayTitle'), t('portal.hello', { name: me.user.name, school: me.student.school.name })),
    h('p', { class: 'muted' }, t('student.account', { username: me.student.username })),
    body);
}

// ------------------------------------------------------------ Homework list

export async function homeworkListView(ctx) {
  const show = ['todo', 'done', 'all'].includes(ctx.query.get('show')) ? ctx.query.get('show') : 'todo';
  const { data, error } = await load(`/api/student/homework?show=${show}`);
  const tabs = h('div', { class: 'row filters', role: 'group', 'aria-label': t('portal.showLabel') },
    ['todo', 'done', 'all'].map((k) => link(`/student/homework?show=${k}`, t(`portal.show.${k}`), { class: `btn small ${k === show ? '' : 'ghost'}`, 'aria-current': k === show ? 'page' : null })));
  return frame(ctx,
    pageHead(t('portal.homework'), t('portal.homeworkSub')),
    tabs,
    error
      ? h('div', { class: 'alert error', role: 'alert' }, errorMessage(error))
      : data.homework.length
        ? h('ul', { class: 'hw-list card' }, data.homework.map(homeworkItem))
        : h('p', { class: 'empty' }, t(`portal.empty.${show}`)));
}

// ------------------------------------------------------------ One homework: read it, write, attach, hand in

export async function homeworkDetailView(ctx) {
  const { homeworkId } = ctx.params;
  const { data, error } = await load(`/api/student/homework/${homeworkId}`);
  if (error) return frame(ctx, pageHead(t('portal.homework'), null), h('div', { class: 'alert error', role: 'alert' }, errorMessage(error)));
  const hw = data.homework;
  const sub = data.submission;
  const editable = (sub.status === 'assigned' || sub.status === 'draft') && !data.closed;
  const refresh = () => ctx.render();

  const facts = h('dl', { class: 'kv' },
    h('dt', {}, t('classes.subject')), h('dd', {}, subjectName(hw), ' · ', h('span', { dir: 'auto' }, data.class.name)),
    h('dt', {}, t('hw.dueAt')), h('dd', {}, fmtDate(hw.dueAt, true), hw.allowLate ? null : [' ', h('span', { class: 'pill' }, t('hw.noLate'))]),
    h('dt', {}, t('hw.maxPoints')), h('dd', {}, hw.maxPoints === null ? t('hw.noPoints') : String(hw.maxPoints)));

  const task = h('section', { class: 'card', 'aria-labelledby': 'task-h' },
    h('h2', { id: 'task-h' }, t('portal.task')),
    facts,
    hw.instructions ? h('div', { class: 'answer', dir: 'auto' }, hw.instructions) : null,
    hw.materials.length ? [h('h3', {}, t('hw.books')), h('div', { class: 'mats' }, hw.materials.map((m) => h('span', { class: `mat book ${m.kind}`, dir: 'auto' }, m.title, h('span', { class: 'sr-only' }, ` (${t(`legend.${m.kind}`)})`))))] : null,
    data.files.length ? [h('h3', {}, t('hw.files')), h('ul', { class: 'files' }, data.files.map((f) => fileItem(`/api/student/files/${f.id}`, f)))] : null);

  let work;
  if (sub.status === 'returned') {
    work = h('section', { class: 'card', 'aria-labelledby': 'work-h' },
      h('h2', { id: 'work-h' }, t('portal.yourMark')),
      sub.points !== null ? h('p', { class: 'mark-big' }, t('hw.markOf', { points: sub.points, max: hw.maxPoints })) : null,
      sub.feedback ? [h('h3', {}, t('hw.feedback')), h('div', { class: 'answer', dir: 'auto' }, sub.feedback)] : h('p', { class: 'muted' }, t('portal.noFeedback')),
      h('p', { class: 'muted' }, t('hw.returnedAt', { when: fmtDate(sub.returnedAt, true) })),
      sub.body || sub.files.length ? [h('h3', {}, t('portal.yourWork')), sub.body ? h('div', { class: 'answer', dir: 'auto' }, sub.body) : null,
        sub.files.length ? h('ul', { class: 'files' }, sub.files.map((f) => fileItem(`/api/student/files/${f.id}`, f))) : null] : null);
  } else if (sub.status === 'submitted') {
    work = h('section', { class: 'card', 'aria-labelledby': 'work-h' },
      h('h2', { id: 'work-h' }, t('portal.yourWork')),
      h('p', { class: 'notice', role: 'status' }, t('portal.handedInAt', { when: fmtDate(sub.submittedAt, true) }), sub.late ? [' ', h('span', { class: 'pill bad' }, t('hw.status.late'))] : null),
      sub.body ? h('div', { class: 'answer', dir: 'auto' }, sub.body) : null,
      sub.files.length ? h('ul', { class: 'files' }, sub.files.map((f) => fileItem(`/api/student/files/${f.id}`, f))) : null,
      data.closed ? null : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => act(async () => {
        await post(`/api/student/homework/${hw.id}/take-back`);
        toast(t('portal.takenBack'));
        refresh();
      }) }, t('portal.takeBack')), h('span', { class: 'muted' }, t('portal.takeBackHelp'))));
  } else if (!editable) {
    work = h('section', { class: 'card' }, h('h2', {}, t('portal.yourWork')), h('p', { class: 'alert' }, t('portal.closed')));
  } else {
    const text = h('textarea', { id: 'answer', rows: 6, maxlength: 10000, dir: 'auto' }, sub.body);
    const saveDraft = async () => { await put(`/api/student/homework/${hw.id}/submission`, { body: text.value }); };
    work = h('section', { class: 'card', 'aria-labelledby': 'work-h' },
      h('h2', { id: 'work-h' }, t('portal.yourWork')),
      h('div', { class: 'field' }, h('label', { for: 'answer' }, t('portal.answer')), text, h('span', { class: 'hint' }, t('portal.answerHint'))),
      sub.files.length ? h('ul', { class: 'files' }, sub.files.map((f) => fileItem(`/api/student/files/${f.id}`, f, () => act(async () => {
        await saveDraft();
        await del(`/api/student/homework/${hw.id}/files/${f.id}`);
        refresh();
      })))) : null,
      fileUploader({ id: 'work-files', label: t('portal.attach'), path: `/api/student/homework/${hw.id}/files`, onDone: async () => { await saveDraft().catch(() => {}); refresh(); } }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
          const r = await post(`/api/student/homework/${hw.id}/hand-in`, { body: text.value });
          toast(r.late ? t('portal.handedInLate') : t('portal.handedIn'));
          refresh();
        }) }, t('portal.handIn')),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => act(async () => { await saveDraft(); toast(t('portal.draftSaved')); }) }, t('portal.saveDraft'))),
      new Date(hw.dueAt) < new Date() ? h('p', { class: 'notice' }, t('portal.lateWarning')) : null);
  }

  return frame(ctx,
    h('p', { class: 'crumbs' }, link('/student/homework', t('portal.homework'))),
    pageHead(hw.title, t('hw.headLine', { class: data.class.name, subject: subjectName(hw), due: fmtDate(hw.dueAt, true) })),
    task,
    work);
}

// ------------------------------------------------------------ My books (the curriculum)

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

export async function booksView(ctx) {
  const me = session.me;
  const school = me.student.school;
  const { data, error } = await load('/api/student/curriculum');
  return frame(ctx,
    pageHead(t('student.title'), t('student.sub', { name: me.user.name, school: school.name })),
    error ? h('div', { class: 'alert error', role: 'alert' }, errorMessage(error)) : curriculum(data),
    h('p', { class: 'muted student-foot' }, t('student.chosenBySchool')));
}

