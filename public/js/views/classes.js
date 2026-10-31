// Classes and homework for school staff (docs/CLASSROOM.md). Owners and admins
// create classes, choose their students and assign teachers per subject.
// Teachers (members assigned to a class) set homework, look at what students
// hand in, mark it and return it.
import { del, get, patch, post, put, upload } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, fmtNum, form, h, link, none, tableCard, th, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { invalidateOrg } from '../state.js';
import { act, localInput, settableSubjects, subjectName } from './classroom-common.js';
import { retentionNotes } from './retention.js';
import { pageHead } from './shell.js';
import { testsCard } from './tests.js';

let gradeNames = [];
const gradeLabel = (g) => {
  const n = gradeNames.find((x) => x.grade === g);
  return n ? (locale() === 'ar' ? n.nameAr : n.nameEn) : `${t('picker.grade')} ${g}`;
};
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function fmtSize(bytes) {
  return bytes >= 1048576 ? t('hw.sizeMB', { n: fmtNum(Number((bytes / 1048576).toFixed(1))) }) : t('hw.sizeKB', { n: fmtNum(Math.max(1, Math.round(bytes / 1024))) });
}

/**
 * A file: images show a small preview; PDFs download. A file opens only once the
 * server has checked it (virus scan, photo resizing); until then, or when it was
 * deleted for a virus or as unreadable, it is listed without a link.
 */
export function fileItem(href, f, onRemove) {
  const remove = onRemove ? h('button', { type: 'button', class: 'btn small danger ghost', 'aria-label': t('hw.removeFile', { name: f.name }), onclick: onRemove }, t('common.delete')) : null;
  if (f.status && f.status !== 'ready') {
    const state = f.status === 'pending'
      ? h('span', { class: 'muted' }, ` · ${t('hw.fileChecking')}`)
      : [' ', h('span', { class: 'pill bad' }, t(f.status === 'infected' ? 'hw.fileInfected' : 'hw.fileUnreadable'))];
    return h('li', { class: 'file' }, h('span', { dir: 'auto' }, f.name), state, remove);
  }
  const image = f.contentType.startsWith('image/');
  return h('li', { class: 'file' },
    image ? h('a', { href, target: '_blank', rel: 'noopener' }, h('img', { src: href, alt: f.name, loading: 'lazy' })) : null,
    h('a', { href, ...(image ? { target: '_blank', rel: 'noopener' } : { download: f.name }) }, h('span', { dir: 'auto' }, f.name)),
    h('span', { class: 'muted' }, ` · ${fmtSize(f.size)}`),
    remove);
}

const CHECK_POLL_MS = 3000;
const CHECK_POLL_MAX = 200;

/**
 * A list of files. While one is being checked, asks `reload` (the files as the server now
 * lists them) every few seconds and redraws the list in place, so the page keeps its focus
 * and what the student is typing. A file deleted for a virus or as unreadable is also told.
 */
export function fileList(files, makeItem, reload) {
  const ul = h('ul', { class: 'files' }, files.map(makeItem));
  const watch = (current, round) => {
    if (!reload || round >= CHECK_POLL_MAX || !current.some((f) => f.status === 'pending')) return;
    setTimeout(async () => {
      if (!ul.isConnected) return;
      let fresh;
      try { fresh = await reload(); } catch { return watch(current, round + 1); }
      if (!ul.isConnected) return;
      const changed = fresh.length !== current.length || fresh.some((f) => current.find((c) => c.id === f.id)?.status !== f.status);
      if (changed) {
        for (const f of fresh) {
          if (current.find((c) => c.id === f.id)?.status === 'pending' && (f.status === 'infected' || f.status === 'unreadable')) {
            toast(t(f.status === 'infected' ? 'hw.fileInfectedToast' : 'hw.fileUnreadableToast', { name: f.name }), 'error');
          }
        }
        ul.replaceChildren(...fresh.map(makeItem));
      }
      watch(fresh, round + 1);
    }, CHECK_POLL_MS);
  };
  watch(files, 0);
  return ul;
}

/** A file input that uploads each chosen file at once and reports progress in a live region. */
export function fileUploader({ id, label, path, onDone }) {
  const input = h('input', { type: 'file', id, accept: ACCEPT, multiple: true });
  const status = h('p', { class: 'muted', role: 'status' });
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    for (const f of files) {
      if (f.size > 5 * 1048576) { toast(t('hw.fileTooBig', { name: f.name }), 'error'); continue; }
      status.textContent = t('hw.uploading', { name: f.name });
      try { await upload(path, f); } catch (err) { toast(errorMessage(err), 'error'); }
    }
    status.textContent = '';
    input.value = '';
    await onDone();
  });
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, h('span', { class: 'hint' }, t('hw.fileHint'), ' ', t('hw.filesChecked')), status);
}

// ------------------------------------------------------------ classes list

async function classDialog(orgId, scopes, initial = null) {
  return new Promise((resolve) => {
    const f = form({
      fields: [
        { name: 'name', label: t('classes.name'), required: true, maxlength: 60, value: initial?.name, hint: t('classes.nameHint') },
        { name: 'grade', label: t('picker.grade'), type: 'select', value: String(initial?.grade ?? 1), options: gradeNames.map((g) => ({ value: String(g.grade), label: gradeLabel(g.grade) })) },
        { name: 'scopeId', label: t('classes.curriculum'), type: 'select', value: initial?.scopeId ?? '', hint: t('classes.curriculumHint'), options: [{ value: '', label: t('students.noScope') }, ...scopes.map((s) => ({ value: s.id, label: `${s.name} (${s.academicYear})` }))] },
      ],
      submitLabel: initial ? t('common.save') : t('classes.create'),
      onSubmit: async (v) => {
        const body = { name: v.name, grade: Number(v.grade), scopeId: v.scopeId || null };
        const r = initial ? await patch(`/api/orgs/${orgId}/classes/${initial.id}`, body) : await post(`/api/orgs/${orgId}/classes`, body);
        f.el.closest('dialog')?.close();
        resolve(r);
      },
    });
    dialog({ title: initial ? t('classes.editTitle') : t('classes.newTitle'), body: f.el, actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }] }).then(() => resolve(null));
  });
}

export async function classesView(ctx) {
  const { orgId } = ctx.params;
  const archived = ctx.query.get('archived') === '1';
  const [data, { scopes }] = await Promise.all([get(`/api/orgs/${orgId}/classes${archived ? '?archived=1' : ''}`), get(`/api/orgs/${orgId}/scopes`)]);
  gradeNames = data.grades;
  const head = pageHead(data.admin ? t('classes.title') : t('classes.myTitle'), data.admin ? t('classes.sub') : t('classes.mySub'));
  if (!data.enabled && !data.classes.length) {
    return h('div', {}, head, h('div', { class: 'card' }, h('h2', {}, t('classes.offTitle')), h('p', {}, t('classes.offText'))));
  }
  const newClass = data.admin && data.enabled
    ? h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
      const r = await classDialog(orgId, scopes);
      if (r) { invalidateOrg(orgId); navigate(`/org/${orgId}/classes/${r.class.id}`); }
    }) }, t('classes.new'))
    : null;
  const rows = data.classes.map((c) => h('tr', {},
    h('td', {}, link(`/org/${orgId}/classes/${c.id}`, c.name, { dir: 'auto' }), c.archived ? [' ', h('span', { class: 'pill' }, t('classes.archived'))] : null),
    h('td', {}, gradeLabel(c.grade)),
    h('td', {}, String(c.students)),
    h('td', {}, c.teachers.length ? h('ul', { class: 'plain' }, c.teachers.map((x) => h('li', {}, h('span', { dir: 'auto' }, x.name), ' · ', subjectName(x)))) : none()),
    h('td', {}, c.toMark ? h('span', { class: 'pill warn' }, t('classes.toMark', { n: c.toMark })) : none())));
  return h('div', {}, head,
    h('div', { class: 'row page-actions' }, newClass,
      data.admin ? link(`/org/${orgId}/classes${archived ? '' : '?archived=1'}`, archived ? t('classes.hideArchived') : t('classes.showArchived')) : null,
      data.admin ? link(`/org/${orgId}/classes/retention`, t('ret.link')) : null),
    data.classes.length
      ? tableCard(t('classes.title'), h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [t('classes.class'), t('picker.grade'), t('classes.students'), t('classes.teachers'), t('classes.toMarkCol')].map(th))),
        h('tbody', {}, rows)))
      : h('p', { class: 'empty' }, data.admin ? t('classes.none') : t('classes.noneMine')));
}

// ------------------------------------------------------------ one class

async function studentsDialog(orgId, cls, current) {
  const { students } = await get(`/api/orgs/${orgId}/students`);
  const chosen = new Set(current.map((s) => s.userId));
  const sameGrade = students.filter((s) => s.grade === cls.grade);
  const others = students.filter((s) => s.grade !== cls.grade);
  const box = (s) => {
    const id = `st-${s.userId}`;
    const input = h('input', { type: 'checkbox', id, value: s.userId, checked: chosen.has(s.userId) });
    return h('label', { class: 'check', for: id }, input, h('span', { dir: 'auto' }, s.name), h('span', { class: 'mono muted', dir: 'ltr' }, ` ${s.username}`));
  };
  const list = h('div', { class: 'stack checklist' },
    sameGrade.length ? h('fieldset', {}, h('legend', {}, gradeLabel(cls.grade)), sameGrade.map(box)) : h('p', { class: 'muted' }, t('classes.noStudentsInGrade')),
    others.length ? h('details', {}, h('summary', {}, t('classes.otherGrades', { n: others.length })), h('div', { class: 'stack' }, others.map(box))) : null);
  const ok = await dialog({
    title: t('classes.chooseStudents', { name: cls.name }),
    body: h('div', { class: 'stack' }, h('p', {}, t('classes.chooseStudentsHelp')), list),
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: t('common.save'), value: true }],
  });
  if (!ok) return false;
  const ids = [...list.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
  await put(`/api/orgs/${orgId}/classes/${cls.id}/students`, { studentIds: ids });
  toast(t('common.saved'));
  return true;
}

async function teacherDialog(orgId, cls, subjects) {
  const { members } = await get(`/api/orgs/${orgId}/members`);
  const OTHER = '__other';
  const otherEn = h('input', { id: 'subj-en', type: 'text', maxlength: 120, dir: 'ltr', lang: 'en' });
  const otherAr = h('input', { id: 'subj-ar', type: 'text', maxlength: 120, dir: 'rtl', lang: 'ar' });
  const otherBox = h('div', { class: 'stack', hidden: true },
    h('div', { class: 'field' }, h('label', { for: 'subj-en' }, t('classes.subjectEn')), otherEn),
    h('div', { class: 'field' }, h('label', { for: 'subj-ar' }, t('classes.subjectAr')), otherAr));
  const subject = h('select', { id: 'subj', onchange: () => { otherBox.hidden = subject.value !== OTHER; } },
    subjects.map((s, i) => h('option', { value: String(i) }, locale() === 'ar' ? s.nameAr : s.nameEn)),
    h('option', { value: OTHER }, t('classes.otherSubject')));
  if (!subjects.length) { subject.value = OTHER; otherBox.hidden = false; }
  const member = h('select', { id: 'member' }, members.map((m) => h('option', { value: m.userId }, `${m.name} (${t(`role.${m.role}`)})`)));
  const err = h('div', { class: 'alert error', role: 'alert' });
  const ok = await dialog({
    title: t('classes.addTeacherTitle', { name: cls.name }),
    body: h('div', { class: 'stack' }, err,
      h('div', { class: 'field' }, h('label', { for: 'member' }, t('classes.teacher')), member, h('span', { class: 'hint' }, t('classes.teacherHint'))),
      h('div', { class: 'field' }, h('label', { for: 'subj' }, t('classes.subject')), subject),
      otherBox),
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, {
      label: t('classes.addTeacher'), value: true, validate: async () => {
        const s = subject.value === OTHER ? { nameEn: otherEn.value.trim(), nameAr: otherAr.value.trim() || otherEn.value.trim() } : subjects[Number(subject.value)];
        if (!s?.nameEn) { otherEn.focus(); return false; }
        try {
          await post(`/api/orgs/${orgId}/classes/${cls.id}/teachers`, { userId: member.value, subjectEn: s.nameEn, subjectAr: s.nameAr });
          return true;
        } catch (e) { err.textContent = errorMessage(e); return false; }
      },
    }],
  });
  return Boolean(ok);
}

const HW_KINDS = ['practice', 'reading', 'writing', 'research', 'review'];

/**
 * Homework suggested by AI (docs/CLASSROOM.md §13) for the subject chosen in the form: the teacher
 * gives a topic and, if they like, the lesson text, reads the suggestion, and uses it to fill the
 * form. Nothing is saved until the homework is set. Returns { title, instructions } or null.
 */
async function suggestHomeworkDialog(orgId, cls, subject, ai) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const status = h('p', { class: 'muted', role: 'status' });
  const topic = h('input', { id: 'hs-topic', type: 'text', maxlength: 300, dir: 'auto', required: true, 'aria-describedby': 'hs-topic-hint' });
  const lesson = h('textarea', { id: 'hs-lesson', rows: 5, maxlength: 12000, dir: 'auto', 'aria-describedby': 'hs-lesson-hint' });
  const kind = h('select', { id: 'hs-kind' }, HW_KINDS.map((k) => h('option', { value: k }, t(`hw.kind.${k}`))));
  const minutes = h('input', { id: 'hs-minutes', type: 'number', min: '10', max: '120', step: '5', inputmode: 'numeric', value: '30' });
  const language = h('select', { id: 'hs-language' }, ['ar', 'en'].map((l) => h('option', { value: l, selected: locale() === l ? 'selected' : null }, t(`tests.suggestLang.${l}`))));
  const body = h('div', { class: 'stack' },
    h('p', { class: 'notice' }, t('hw.suggestNote')),
    h('p', { class: 'muted' }, t('hw.suggestFor', { subject: subjectName({ subjectEn: subject.nameEn, subjectAr: subject.nameAr }), name: cls.name })),
    ai.left !== null ? h('p', { class: 'muted' }, t('tests.suggestLeft', { n: fmtNum(ai.left) })) : null,
    err,
    h('div', { class: 'field' }, h('label', { for: 'hs-topic' }, t('tests.suggestTopic')), topic, h('span', { class: 'hint', id: 'hs-topic-hint' }, t('tests.suggestTopicHint'))),
    h('div', { class: 'field' }, h('label', { for: 'hs-lesson' }, t('tests.suggestLesson')), lesson, h('span', { class: 'hint', id: 'hs-lesson-hint' }, t('hw.suggestLessonHint'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'hs-kind' }, t('hw.suggestKind')), kind),
      h('div', { class: 'field' }, h('label', { for: 'hs-minutes' }, t('hw.suggestMinutes')), minutes)),
    h('div', { class: 'field' }, h('label', { for: 'hs-language' }, t('hw.suggestLanguage')), language),
    status);
  let busy = false;
  let reply = null;
  await dialog({
    title: t('hw.suggestTitle'),
    body,
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: t('tests.suggestGo'), value: true, validate: async () => {
        if (busy) return false;
        err.textContent = '';
        if (topic.value.trim().length < 3) { err.textContent = t('tests.suggestNeedTopic'); topic.focus(); return false; }
        busy = true;
        status.textContent = t('hw.suggestWorking');
        try {
          reply = await post(`/api/orgs/${orgId}/classes/${cls.id}/suggest-homework`, {
            subjectEn: subject.nameEn, topic: topic.value.trim(), lessonText: lesson.value.trim(), kind: kind.value,
            minutes: Math.min(120, Math.max(10, Math.round(Number(minutes.value) || 30))), language: language.value,
          });
          return true;
        } catch (e) {
          err.textContent = errorMessage(e);
          return false;
        } finally {
          busy = false;
          status.textContent = '';
        }
      },
    }],
  });
  if (!reply) return null;
  const sg = reply.suggestion;
  const use = await dialog({
    title: t('hw.suggestionTitle'),
    body: h('div', { class: 'stack' },
      h('p', { class: 'notice' }, t('hw.suggestionReplaces')),
      h('h3', { dir: 'auto' }, sg.title),
      h('div', { class: 'answer', dir: 'auto' }, sg.instructions),
      h('p', { class: 'muted' }, t('hw.suggestionMinutes', { n: fmtNum(sg.estimatedMinutes) })),
      sg.teacherNotes ? h('div', { class: 'stack' }, h('h3', {}, t('hw.suggestionNotes')), h('p', { class: 'muted', dir: 'auto' }, sg.teacherNotes)) : null),
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: t('hw.suggestionUse'), value: true }],
  });
  return use ? { title: sg.title, instructions: sg.instructions } : null;
}

/** Set or edit homework. `subjects` are the subjects this member may set work for, with their books. */
async function homeworkDialog(orgId, cls, subjects, initial = null, ai = null) {
  const f = {};
  const err = h('div', { class: 'alert error', role: 'alert' });
  const field = (id, label, input, hint) => h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null);
  f.subject = h('select', { id: 'hw-subject', disabled: Boolean(initial) }, subjects.map((s, i) => h('option', { value: String(i), selected: initial && s.nameEn === initial.subjectEn ? 'selected' : null }, locale() === 'ar' ? s.nameAr : s.nameEn)));
  f.title = h('input', { id: 'hw-title', type: 'text', maxlength: 200, required: true, value: initial?.title ?? null, dir: 'auto' });
  f.instructions = h('textarea', { id: 'hw-instr', maxlength: 5000, rows: 4, dir: 'auto' }, initial?.instructions ?? '');
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(8, 0, 0, 0);
  f.due = h('input', { id: 'hw-due', type: 'datetime-local', required: true, value: localInput(initial?.dueAt ?? tomorrow) });
  const scheduled = initial && new Date(initial.publishAt) > new Date();
  f.later = h('input', { id: 'hw-later', type: 'checkbox', checked: Boolean(scheduled) });
  f.publish = h('input', { id: 'hw-publish', type: 'datetime-local', value: localInput(initial?.publishAt ?? new Date(Date.now() + 3600_000)), 'aria-describedby': 'hw-publish-hint' });
  const publishBox = h('div', { hidden: !scheduled }, field('hw-publish', t('hw.publishAt'), f.publish, t('hw.publishHint')));
  f.later.addEventListener('change', () => { publishBox.hidden = !f.later.checked; });
  f.points = h('input', { id: 'hw-points', type: 'number', min: '0.5', max: '9999', step: '0.5', inputmode: 'decimal', value: initial ? initial.maxPoints ?? '' : '10', 'aria-describedby': 'hw-points-hint' });
  f.late = h('input', { id: 'hw-late', type: 'checkbox', checked: initial ? initial.allowLate : true });
  const picked = new Set((initial?.materials ?? []).map((m) => m.id));
  const books = h('fieldset', { class: 'stack' });
  const drawBooks = () => {
    const s = subjects[Number(f.subject.value)];
    const list = s?.materials ?? [];
    books.replaceChildren(h('legend', {}, t('hw.books')),
      ...(list.length
        ? list.map((m) => {
          const id = `hw-m-${m.id}`;
          return h('label', { class: 'check', for: id }, h('input', { type: 'checkbox', id, value: m.id, checked: picked.has(m.id) }), h('span', { class: `mat book ${m.kind}`, dir: 'auto' }, m.title));
        })
        : [h('p', { class: 'muted' }, cls.scopeId ? t('hw.noBooksForSubject') : t('hw.noCurriculum'))]));
  };
  f.subject.addEventListener('change', () => { picked.clear(); drawBooks(); });
  drawBooks();
  // AI suggestions fill a new homework's title and instructions, for the subject chosen above.
  const suggestBtn = ai && !initial
    ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => {
      const sg = await suggestHomeworkDialog(orgId, cls, subjects[Number(f.subject.value)], ai);
      if (!sg) return;
      f.title.value = sg.title;
      f.instructions.value = sg.instructions;
      f.title.focus();
    }) }, t('hw.suggest'))
    : null;
  const body = h('div', { class: 'stack' }, err,
    field('hw-subject', t('classes.subject'), f.subject),
    suggestBtn ? h('div', { class: 'row' }, suggestBtn) : null,
    field('hw-title', t('hw.titleField'), f.title),
    field('hw-instr', t('hw.instructions'), f.instructions),
    books,
    field('hw-due', t('hw.dueAt'), f.due),
    h('label', { class: 'check', for: 'hw-later' }, f.later, t('hw.later')),
    publishBox,
    field('hw-points', t('hw.maxPoints'), f.points, t('hw.maxPointsHint')),
    h('label', { class: 'check', for: 'hw-late' }, f.late, t('hw.allowLate')));
  let saved = null;
  await dialog({
    title: initial ? t('hw.editTitle') : t('hw.newTitle', { name: cls.name }),
    body,
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: initial ? t('common.save') : t('hw.set'), value: true, validate: async () => {
        err.textContent = '';
        if (!f.title.value.trim()) { f.title.focus(); return false; }
        if (!f.due.value) { f.due.focus(); return false; }
        const s = subjects[Number(f.subject.value)];
        const payload = {
          title: f.title.value.trim(),
          instructions: f.instructions.value,
          materialIds: [...books.querySelectorAll('input:checked')].map((i) => i.value),
          dueAt: new Date(f.due.value).toISOString(),
          ...(f.later.checked ? { publishAt: new Date(f.publish.value).toISOString() } : initial ? { publishAt: scheduled ? new Date().toISOString() : initial.publishAt } : {}),
          maxPoints: f.points.value === '' ? null : Number(f.points.value),
          allowLate: f.late.checked,
        };
        try {
          saved = initial
            ? await patch(`/api/orgs/${orgId}/homework/${initial.id}`, payload)
            : await post(`/api/orgs/${orgId}/classes/${cls.id}/homework`, { subjectEn: s.nameEn, subjectAr: s.nameAr, ...payload });
          return true;
        } catch (e) { err.textContent = errorMessage(e); return false; }
      },
    }],
  });
  return saved;
}

export function dueLabel(hw) {
  return fmtDate(hw.dueAt, true);
}

export async function classView(ctx) {
  const { orgId, classId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/classes/${classId}`);
  gradeNames = data.grade ? [data.grade] : gradeNames;
  const cls = data.class;
  const refresh = () => { invalidateOrg(orgId); ctx.render(); };
  const subjects = settableSubjects(data);
  const now = new Date();

  const adminActions = data.admin
    ? h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => {
        const { scopes } = await get(`/api/orgs/${orgId}/scopes`);
        const all = await get(`/api/orgs/${orgId}/classes`);
        gradeNames = all.grades;
        if (await classDialog(orgId, scopes, cls)) { toast(t('common.saved')); refresh(); }
      }) }, t('classes.edit')),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => {
        await patch(`/api/orgs/${orgId}/classes/${classId}`, { archived: !cls.archived });
        toast(cls.archived ? t('classes.restored') : t('classes.archivedDone'));
        refresh();
      }) }, cls.archived ? t('classes.restore') : t('classes.archive')),
      h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => act(async () => {
        if (!(await confirmDialog(t('classes.deleteTitle'), t('classes.deleteText', { name: cls.name }), { danger: true, confirmLabel: t('common.delete') }))) return;
        await del(`/api/orgs/${orgId}/classes/${classId}`);
        invalidateOrg(orgId);
        navigate(`/org/${orgId}/classes`);
      }) }, t('common.delete')))
    : null;

  const homeworkRows = data.homework.map((hw) => {
    const scheduledHw = new Date(hw.publishAt) > now;
    return h('tr', {},
      h('td', {}, link(`/org/${orgId}/homework/${hw.id}`, hw.title, { dir: 'auto' }), scheduledHw ? [' ', h('span', { class: 'pill' }, t('hw.scheduledFor', { when: fmtDate(hw.publishAt, true) }))] : null),
      h('td', {}, subjectName(hw)),
      h('td', { class: 'nowrap' }, dueLabel(hw)),
      h('td', {}, t('hw.handedInOf', { n: hw.counts.handedIn, total: hw.counts.enrolled })),
      h('td', {}, hw.counts.toMark && hw.mine ? h('span', { class: 'pill warn' }, t('classes.toMark', { n: hw.counts.toMark })) : none()));
  });

  const setBtn = subjects.length && !cls.archived
    ? h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
      const r = await homeworkDialog(orgId, cls, subjects, null, data.ai);
      if (r) { toast(t('hw.setDone')); refresh(); }
    }) }, t('hw.set'))
    : null;

  const homeworkCard = h('section', { class: 'card', 'aria-labelledby': 'hw-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'hw-h' }, t('hw.title')), setBtn),
    !subjects.length ? h('p', { class: 'muted' }, t('hw.noSubjects')) : null,
    data.homework.length
      ? tableCard(t('hw.title'), h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [t('hw.titleField'), t('classes.subject'), t('hw.dueAt'), t('hw.handedIn'), t('classes.toMarkCol')].map(th))),
        h('tbody', {}, homeworkRows)))
      : h('p', { class: 'empty' }, t('hw.none')));

  const studentsCard = h('section', { class: 'card', 'aria-labelledby': 'st-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'st-h' }, t('classes.studentsCount', { n: data.students.length })),
      data.admin ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => { if (await studentsDialog(orgId, cls, data.students)) refresh(); }) }, t('classes.chooseStudentsBtn')) : null),
    data.students.length
      ? h('ul', { class: 'plain cols' }, data.students.map((s) => h('li', {}, h('span', { dir: 'auto' }, s.name), h('span', { class: 'mono muted', dir: 'ltr' }, ` ${s.username}`))))
      : h('p', { class: 'muted' }, t('classes.noStudents')));

  const teachersCard = h('section', { class: 'card', 'aria-labelledby': 'te-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'te-h' }, t('classes.teachers')),
      data.admin ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => { if (await teacherDialog(orgId, cls, data.subjects)) { toast(t('common.saved')); refresh(); } }) }, t('classes.addTeacher')) : null),
    data.teachers.length
      ? h('ul', { class: 'plain' }, data.teachers.map((x) => h('li', { class: 'row' },
        h('span', {}, h('b', { dir: 'auto' }, x.name), ' · ', subjectName(x)),
        data.admin ? h('button', { type: 'button', class: 'btn small danger ghost', 'aria-label': t('classes.removeTeacherFor', { name: x.name, subject: subjectName(x) }), onclick: () => act(async () => {
          if (!(await confirmDialog(t('classes.removeTeacherTitle'), t('classes.removeTeacherText', { name: x.name, subject: subjectName(x) }), { danger: true, confirmLabel: t('classes.removeTeacher') }))) return;
          await del(`/api/orgs/${orgId}/classes/${classId}/teachers/${x.id}`);
          refresh();
        }) }, t('classes.removeTeacher')) : null)))
      : h('p', { class: 'muted' }, data.admin ? t('classes.noTeachersAdmin') : t('classes.noTeachers')));

  const sub = [gradeLabel(cls.grade), cls.scopeName ? t('classes.curriculumIs', { name: cls.scopeName }) : t('classes.noCurriculum')].join(' · ');
  return h('div', {},
    h('p', { class: 'crumbs' }, link(`/org/${orgId}/classes`, data.admin ? t('classes.title') : t('classes.myTitle'))),
    pageHead(cls.name, sub, cls.archived ? h('p', { class: 'notice' }, t('classes.archivedNote')) : null,
      h('div', { class: 'row' }, link(`/org/${orgId}/classes/${classId}/gradebook`, t('classes.gradebook'), { class: 'btn small' }),
        cls.scopeId ? link(`/org/${orgId}/scopes/${cls.scopeId}/plans?grade=${cls.grade}`, t('plans.forClass'), { class: 'btn small ghost' }) : null), adminActions),
    homeworkCard,
    testsCard(orgId, data, subjects),
    h('div', { class: 'grid2' }, studentsCard, teachersCard));
}

// ------------------------------------------------------------ one homework: details, hand-ins and marking

function statusPill(r) {
  if (r.status === 'returned') return h('span', { class: 'pill ok' }, t('hw.status.returned'));
  if (r.status === 'submitted') return [h('span', { class: 'pill warn' }, t('hw.status.submitted')), r.late ? [' ', h('span', { class: 'pill bad' }, t('hw.status.late'))] : null];
  if (r.missing) return h('span', { class: 'pill bad' }, t('hw.status.missing'));
  return h('span', { class: 'muted' }, t('hw.status.assigned'));
}

function markText(r, maxPoints) {
  if (maxPoints === null) return r.graded ? t('hw.commented') : none();
  if (r.points === null) return none();
  const text = t('hw.markOf', { points: r.points, max: maxPoints });
  return r.status === 'returned' ? text : h('span', {}, text, ' ', h('span', { class: 'muted' }, t('hw.notReturned')));
}

async function markDialog(orgId, hw, row, canMark) {
  const data = await get(`/api/orgs/${orgId}/homework/${hw.id}/submissions/${row.studentId}`);
  const sub = data.submission;
  const max = hw.maxPoints;
  const err = h('div', { class: 'alert error', role: 'alert' });
  const points = max === null ? null : h('input', { id: 'mk-points', type: 'number', min: '0', max: String(max), step: '0.25', inputmode: 'decimal', value: sub.points ?? '' });
  const feedback = h('textarea', { id: 'mk-feedback', rows: 3, maxlength: 3000, dir: 'auto' }, sub.feedback ?? '');
  const work = sub.status === 'assigned'
    ? h('p', { class: 'notice' }, t('hw.notHandedInOnline'))
    : h('div', { class: 'stack' },
      h('p', { class: 'muted' }, t('hw.handedInAt', { when: fmtDate(sub.submittedAt, true) }), sub.late ? [' ', h('span', { class: 'pill bad' }, t('hw.status.late'))] : null),
      sub.body ? h('div', { class: 'answer', dir: 'auto' }, sub.body) : h('p', { class: 'muted' }, hw.workRemovedAt ? t('ret.workGone') : t('hw.noText')),
      sub.files.length ? fileList(sub.files, (f) => fileItem(`/api/orgs/${orgId}/files/${f.id}`, f), async () => (await get(`/api/orgs/${orgId}/homework/${hw.id}/submissions/${row.studentId}`)).submission.files) : null);
  const save = async (andReturn) => {
    err.textContent = '';
    const body = { feedback: feedback.value.trim() || null, return: andReturn };
    if (points) body.points = points.value === '' ? null : Number(points.value);
    try { await patch(`/api/orgs/${orgId}/homework/${hw.id}/submissions/${row.studentId}`, body); return true; } catch (e) { err.textContent = errorMessage(e); return false; }
  };
  const result = await dialog({
    title: t('hw.workOf', { name: row.name }),
    body: h('div', { class: 'stack' }, err, work,
      canMark ? [
        points ? h('div', { class: 'field' }, h('label', { for: 'mk-points' }, t('hw.markOutOf', { max })), points) : null,
        h('div', { class: 'field' }, h('label', { for: 'mk-feedback' }, t('hw.feedback')), feedback),
        sub.returnedAt ? h('p', { class: 'muted' }, t('hw.returnedAt', { when: fmtDate(sub.returnedAt, true) })) : null,
      ] : null),
    actions: canMark
      ? [{ label: t('common.cancel'), value: null, kind: 'ghost' }, { label: t('hw.saveMark'), value: 'saved', kind: 'ghost', validate: () => save(false) }, { label: t('hw.return'), value: 'returned', validate: () => save(true) }]
      : [{ label: t('common.close'), value: null, kind: 'ghost' }],
  });
  if (result === 'returned') toast(t('hw.returnedToast', { name: row.name }));
  else if (result === 'saved') toast(t('common.saved'));
  return result;
}

export async function homeworkView(ctx) {
  const { orgId, homeworkId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/homework/${homeworkId}`);
  const hw = data.homework;
  const refresh = () => { invalidateOrg(orgId); ctx.render(); };
  const scheduled = new Date(hw.publishAt) > new Date();

  const facts = h('dl', { class: 'kv' },
    h('dt', {}, t('classes.subject')), h('dd', {}, subjectName(hw)),
    h('dt', {}, t('hw.dueAt')), h('dd', {}, dueLabel(hw), hw.allowLate ? null : [' ', h('span', { class: 'pill' }, t('hw.noLate'))]),
    h('dt', {}, t('hw.setOn')), h('dd', {}, scheduled ? t('hw.scheduledFor', { when: fmtDate(hw.publishAt, true) }) : fmtDate(hw.publishAt, true)),
    h('dt', {}, t('hw.maxPoints')), h('dd', {}, hw.maxPoints === null ? t('hw.noPoints') : String(hw.maxPoints)));

  const files = fileList(data.files, (f) => fileItem(`/api/orgs/${orgId}/files/${f.id}`, f, data.canEdit ? () => act(async () => {
    await del(`/api/orgs/${orgId}/homework/${homeworkId}/files/${f.id}`);
    refresh();
  }) : null), async () => (await get(`/api/orgs/${orgId}/homework/${homeworkId}`)).files);

  const editActions = data.canEdit
    ? h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(async () => {
        const cls = await get(`/api/orgs/${orgId}/classes/${data.class.id}`);
        const subjects = settableSubjects(cls);
        if (await homeworkDialog(orgId, cls.class, subjects, hw)) { toast(t('common.saved')); refresh(); }
      }) }, t('common.edit')),
      h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => act(async () => {
        if (!(await confirmDialog(t('hw.deleteTitle'), t('hw.deleteText', { title: hw.title }), { danger: true, confirmLabel: t('common.delete') }))) return;
        await del(`/api/orgs/${orgId}/homework/${homeworkId}`);
        invalidateOrg(orgId);
        navigate(`/org/${orgId}/classes/${data.class.id}`);
      }) }, t('common.delete')))
    : null;

  const details = h('section', { class: 'card', 'aria-labelledby': 'd-h' },
    h('h2', { id: 'd-h' }, t('hw.details')),
    facts,
    hw.instructions ? h('div', { class: 'answer', dir: 'auto' }, hw.instructions) : null,
    hw.materials.length ? [h('h3', {}, t('hw.books')), h('div', { class: 'mats' }, hw.materials.map((m) => h('span', { class: `mat book ${m.kind}`, dir: 'auto' }, m.title, h('span', { class: 'sr-only' }, ` (${t(`legend.${m.kind}`)})`))))] : null,
    data.files.length || data.canEdit ? h('h3', {}, t('hw.files')) : null,
    data.files.length ? files : null,
    data.canEdit ? fileUploader({ id: 'hw-files', label: t('hw.attach'), path: `/api/orgs/${orgId}/homework/${homeworkId}/files`, onDone: async () => refresh() }) : null);

  const counts = {
    handedIn: data.roster.filter((r) => r.status !== 'assigned').length,
    returned: data.roster.filter((r) => r.status === 'returned').length,
    enrolled: data.roster.filter((r) => r.enrolled).length,
  };
  const markedWaiting = data.roster.filter((r) => r.status !== 'returned' && r.graded);
  const returnAll = data.canEdit && markedWaiting.length
    ? h('button', { type: 'button', class: 'btn small', onclick: () => act(async () => {
      if (!(await confirmDialog(t('hw.returnAllTitle'), t('hw.returnAllText', { n: markedWaiting.length }), { confirmLabel: t('hw.return') }))) return;
      const r = await post(`/api/orgs/${orgId}/homework/${homeworkId}/return`, { studentIds: markedWaiting.map((x) => x.studentId) });
      toast(t('hw.returnedMany', { n: r.returned }));
      refresh();
    }) }, t('hw.returnAll', { n: markedWaiting.length }))
    : null;

  const rows = data.roster.map((r) => h('tr', {},
    h('td', {}, h('b', { dir: 'auto' }, r.name), r.enrolled ? null : [' ', h('span', { class: 'pill' }, t('hw.leftClass'))]),
    h('td', {}, statusPill(r)),
    h('td', { class: 'nowrap' }, r.submittedAt ? fmtDate(r.submittedAt, true) : none()),
    h('td', {}, r.files ? String(r.files) : none()),
    h('td', {}, markText(r, hw.maxPoints)),
    h('td', {}, h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('hw.openFor', { name: r.name }), onclick: () => act(async () => {
      if (await markDialog(orgId, hw, r, data.canEdit)) refresh();
    }) }, data.canEdit ? (r.status === 'submitted' ? t('hw.mark') : t('hw.open')) : t('hw.open')))));

  const roster = h('section', { class: 'card', 'aria-labelledby': 'r-h' },
    h('div', { class: 'row spread' }, h('h2', { id: 'r-h' }, t('hw.studentWork')), returnAll),
    h('p', { class: 'muted' }, t('hw.summary', { handedIn: counts.handedIn, enrolled: counts.enrolled, returned: counts.returned })),
    tableCard(t('hw.studentWork'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('students.student'), t('hw.statusCol'), t('hw.handedInCol'), t('hw.filesCol'), t('hw.markCol'), ''].map(th))),
      h('tbody', {}, rows))));

  return h('div', {},
    h('p', { class: 'crumbs' }, link(`/org/${orgId}/classes`, t('classes.title')), ' › ', link(`/org/${orgId}/classes/${data.class.id}`, data.class.name, { dir: 'auto' })),
    pageHead(hw.title, t('hw.headLine', { class: data.class.name, subject: subjectName(hw), due: dueLabel(hw) }), editActions),
    retentionNotes('homework', hw, data.retention),
    details,
    roster);
}
