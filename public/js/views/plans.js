// Teaching plans of a curriculum scope (docs/TEACHING_PLANS.md): lesson plans and
// pacing plans per grade and subject. Any member writes their own, by hand or from
// a draft written by AI that they review; everyone in the school reads them and can
// print them. The author and the school's admins change or remove a plan.
import { del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, fmtNum, h, link, none, tableCard, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { today } from './items.js';
import { pageHead } from './shell.js';

export const KINDS = ['lesson', 'pacing'];
const auto = (...c) => h('span', { dir: 'auto' }, ...c);
const subjectLabel = (s) => (locale() === 'ar' ? s.nameAr : s.nameEn);
const planSubject = (p) => (locale() === 'ar' ? p.subjectAr : p.subjectEn);
const gradeLabel = (g) => t('plans.grade', { n: g });
const plansPath = (orgId, scopeId) => `/org/${orgId}/scopes/${scopeId}/plans`;

/** A calendar day (YYYY-MM-DD) shown in the user's language, never shifted by time zones. */
const fmtDay = (day) => new Intl.DateTimeFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
/** The day `n` weeks (and `days` days) after a calendar day. */
function addDays(day, days) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** "27 Sep 2026 – 1 Oct 2026": a school week of five days from its first day. */
export const weekDates = (startDate, i) => `${fmtDay(addDays(startDate, i * 7))} – ${fmtDay(addDays(startDate, i * 7 + 4))}`;

/** A draft from the AI service, waiting for the editor it opens (kept in memory only). */
let pendingDraft = null;

// ------------------------------------------------------------ list

export async function plansView(ctx) {
  const { orgId, scopeId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/scopes/${scopeId}/plans`);
  const wanted = Number(ctx.query.get('grade'));
  const st = { grade: data.grades.some((g) => g.grade === wanted) ? String(wanted) : '', kind: '' };

  const gradeSel = h('select', { id: 'plans-grade', onchange: (e) => { st.grade = e.target.value; draw(); } },
    h('option', { value: '' }, t('plans.allGrades')), data.grades.map((g) => h('option', { value: String(g.grade), selected: String(g.grade) === st.grade ? 'selected' : null }, gradeLabel(g.grade))));
  const kindSel = h('select', { id: 'plans-kind', onchange: (e) => { st.kind = e.target.value; draw(); } },
    h('option', { value: '' }, t('plans.allKinds')), KINDS.map((k) => h('option', { value: k }, t(`plans.kind.${k}`))));
  const filters = h('div', { class: 'card compare-controls' },
    h('div', { class: 'field' }, h('label', { for: 'plans-grade' }, t('picker.grade')), gradeSel),
    h('div', { class: 'field' }, h('label', { for: 'plans-kind' }, t('plans.kindLabel')), kindSel));
  const results = h('div', {});

  function draw() {
    const shown = data.plans.filter((p) => (!st.grade || String(p.grade) === st.grade) && (!st.kind || p.kind === st.kind));
    if (!data.plans.length) return results.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'empty' }, t('plans.empty'))));
    if (!shown.length) return results.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'empty' }, t('plans.noMatch'))));
    const grades = [...new Set(shown.map((p) => p.grade))];
    results.replaceChildren(...grades.map((g) => {
      const list = shown.filter((p) => p.grade === g);
      const subjects = [...new Set(list.map((p) => p.subjectEn))];
      return tableCard(gradeLabel(g), h('h2', {}, gradeLabel(g)), h('table', { class: 'data compare' },
        h('thead', {}, h('tr', {}, [t('plans.titleCol'), t('plans.kindLabel'), t('plans.about'), t('plans.updated')].map((c) => h('th', { scope: 'col' }, c)))),
        subjects.map((sub) => {
          const rows = list.filter((p) => p.subjectEn === sub);
          return h('tbody', {},
            h('tr', { class: 'group' }, h('th', { scope: 'colgroup', colspan: '4' }, auto(planSubject(rows[0])))),
            rows.map((p) => h('tr', {},
              h('th', { scope: 'row' }, link(`${plansPath(orgId, scopeId)}/${p.id}`, auto(p.title)), p.aiAssisted ? [' ', h('span', { class: 'pill' }, t('plans.aiPill'))] : null),
              h('td', {}, t(`plans.kind.${p.kind}`)),
              h('td', {}, p.kind === 'lesson'
                ? [auto(p.summary.topic), h('div', { class: 'muted small' }, t('plans.minutes', { n: fmtNum(p.summary.durationMinutes) }))]
                : [t('plans.weeksFrom', { n: fmtNum(p.summary.weeks), date: fmtDay(p.summary.startDate) })]),
              h('td', {}, fmtDate(p.updatedAt), h('div', { class: 'muted small' }, auto(p.updatedBy ?? p.createdBy ?? '—'))))));
        })));
    }));
  }
  draw();

  const canWrite = data.grades.length > 0 && data.plans.length < data.limit;
  const newBtn = canWrite ? h('button', { type: 'button', class: 'btn', onclick: () => newPlanDialog(orgId, scopeId, data, st).catch((e) => toast(errorMessage(e), 'error')) }, t('plans.new')) : null;
  return h('div', {},
    pageHead(t('plans.title'), t('plans.sub', { name: data.scope.name, year: data.scope.academicYear }),
      h('div', { class: 'row' }, link(`/org/${orgId}/scopes`, t('carry.back')), newBtn)),
    h('p', { class: 'muted' }, t('plans.intro')),
    !data.grades.length ? h('p', { class: 'notice' }, t('plans.noBooks'), ' ', link(`/org/${orgId}?scope=${scopeId}`, t('items.openPicker'))) : null,
    data.plans.length >= data.limit ? h('p', { class: 'notice' }, t('plans.full', { n: fmtNum(data.limit) })) : null,
    filters, results);
}

/** Chooses the kind, grade and subject, then a blank plan or a draft by AI. */
async function newPlanDialog(orgId, scopeId, data, st) {
  const kind = h('select', { id: 'np-kind' }, KINDS.map((k) => h('option', { value: k, selected: k === st.kind ? 'selected' : null }, t(`plans.kind.${k}`))));
  const grade = h('select', { id: 'np-grade' }, data.grades.map((g) => h('option', { value: String(g.grade), selected: String(g.grade) === st.grade ? 'selected' : null }, gradeLabel(g.grade))));
  const subject = h('select', { id: 'np-subject' });
  const fillSubjects = () => {
    const g = data.grades.find((x) => String(x.grade) === grade.value);
    subject.replaceChildren(...(g?.subjects ?? []).map((s) => h('option', { value: s.nameEn }, subjectLabel(s))));
  };
  grade.addEventListener('change', fillSubjects);
  fillSubjects();
  const choice = await dialog({
    title: t('plans.new'),
    body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { for: 'np-kind' }, t('plans.kindLabel')), kind, h('span', { class: 'hint' }, t('plans.kindHint'))),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'np-grade' }, t('picker.grade')), grade),
        h('div', { class: 'field' }, h('label', { for: 'np-subject' }, t('plans.subject')), subject)),
      data.ai ? h('p', { class: 'muted' }, t('plans.aiOffer')) : null),
    actions: [
      { label: t('common.cancel'), value: null, kind: 'ghost' },
      data.ai ? { label: t('plans.draftWithAi'), value: 'ai', kind: 'ghost' } : null,
      { label: t('plans.startBlank'), value: 'blank' },
    ].filter(Boolean),
  });
  if (!choice) return;
  const g = data.grades.find((x) => String(x.grade) === grade.value);
  const sub = g?.subjects.find((s) => s.nameEn === subject.value);
  if (!g || !sub) return;
  const query = `kind=${kind.value}&grade=${g.grade}&subject=${encodeURIComponent(sub.nameEn)}`;
  if (choice === 'blank') return navigate(`${plansPath(orgId, scopeId)}/new?${query}`);
  const draft = await draftDialog(orgId, scopeId, kind.value, g.grade, sub, data.ai);
  if (!draft) return;
  pendingDraft = draft;
  navigate(`${plansPath(orgId, scopeId)}/new?${query}&draft=1`);
}

/** Asks the AI service for a draft of a lesson or pacing plan; resolves with the draft or null. */
async function draftDialog(orgId, scopeId, kind, grade, subject, ai) {
  const err = h('div', { class: 'alert error', role: 'alert' });
  const status = h('p', { class: 'muted', role: 'status' });
  const field = (id, label, input, hint) => h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null);
  const language = h('select', { id: 'pd-language' }, ['ar', 'en'].map((l) => h('option', { value: l, selected: locale() === l ? 'selected' : null }, t(`tests.suggestLang.${l}`))));
  const f = {};
  let fields;
  if (kind === 'lesson') {
    f.topic = h('input', { id: 'pd-topic', type: 'text', maxlength: 300, dir: 'auto', required: true, 'aria-describedby': 'pd-topic-hint' });
    f.lesson = h('textarea', { id: 'pd-lesson', rows: 5, maxlength: 12000, dir: 'auto', 'aria-describedby': 'pd-lesson-hint' });
    f.minutes = h('input', { id: 'pd-minutes', type: 'number', min: '20', max: '180', step: '5', inputmode: 'numeric', value: '45' });
    fields = [
      field('pd-topic', t('tests.suggestTopic'), f.topic, t('tests.suggestTopicHint')),
      field('pd-lesson', t('tests.suggestLesson'), f.lesson, t('plans.lessonTextHint')),
      h('div', { class: 'grid2' }, field('pd-minutes', t('plans.durationAsk'), f.minutes), field('pd-language', t('plans.language'), language)),
    ];
  } else {
    f.start = h('input', { id: 'pd-start', type: 'date', required: true, value: today() });
    f.weeks = h('input', { id: 'pd-weeks', type: 'number', min: '1', max: '40', inputmode: 'numeric', value: '12' });
    f.periods = h('input', { id: 'pd-periods', type: 'number', min: '1', max: '15', inputmode: 'numeric', value: '4' });
    f.contents = h('textarea', { id: 'pd-contents', rows: 6, maxlength: 8000, dir: 'auto', 'aria-describedby': 'pd-contents-hint' });
    fields = [
      h('div', { class: 'grid2' }, field('pd-start', t('plans.startDate'), f.start), field('pd-weeks', t('plans.weeksAsk'), f.weeks)),
      h('div', { class: 'grid2' }, field('pd-periods', t('plans.periodsAsk'), f.periods), field('pd-language', t('plans.language'), language)),
      field('pd-contents', t('plans.contents'), f.contents, t('plans.contentsHint')),
    ];
  }
  const num = (input, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(input.value) || fallback)));
  let busy = false;
  let reply = null;
  await dialog({
    title: t(`plans.draftTitle.${kind}`),
    body: h('div', { class: 'stack' },
      h('p', { class: 'notice' }, t('plans.draftNote')),
      h('p', { class: 'muted' }, `${subjectLabel(subject)} · ${gradeLabel(grade)}`),
      ai.left !== null ? h('p', { class: 'muted' }, t('tests.suggestLeft', { n: fmtNum(ai.left) })) : null,
      err, fields, status),
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, {
      label: t('plans.draftGo'), value: true, validate: async () => {
        if (busy) return false;
        err.textContent = '';
        if (kind === 'lesson' && f.topic.value.trim().length < 3) { err.textContent = t('tests.suggestNeedTopic'); f.topic.focus(); return false; }
        if (kind === 'pacing' && !/^\d{4}-\d{2}-\d{2}$/.test(f.start.value)) { err.textContent = t('plans.needStart'); f.start.focus(); return false; }
        busy = true;
        status.textContent = t('plans.draftWorking');
        try {
          const base = { grade, subjectEn: subject.nameEn, language: language.value };
          reply = kind === 'lesson'
            ? await post(`/api/orgs/${orgId}/scopes/${scopeId}/plans/suggest-lesson`, { ...base, topic: f.topic.value.trim(), lessonText: f.lesson.value.trim(), durationMinutes: num(f.minutes, 20, 180, 45) })
            : await post(`/api/orgs/${orgId}/scopes/${scopeId}/plans/suggest-pacing`, { ...base, startDate: f.start.value, weeks: num(f.weeks, 1, 40, 12), periodsPerWeek: num(f.periods, 1, 15, 4), contents: f.contents.value.trim() });
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
  return reply ? reply.draft : null;
}

// ------------------------------------------------------------ one plan, to read and print

function section(title, ...body) {
  const content = body.flat().filter(Boolean);
  return content.length ? h('section', { class: 'plan-section' }, h('h2', {}, title), ...content) : null;
}
const para = (text) => (text ? h('p', { class: 'prose', dir: 'auto' }, text) : null);
const list = (items, ordered = false) => (items?.length ? h(ordered ? 'ol' : 'ul', {}, items.map((x) => h('li', { dir: 'auto' }, x))) : null);

function lessonBody(c) {
  const total = c.activities.reduce((n, a) => n + a.minutes, 0);
  return [
    section(t('plans.books'), list(c.books)),
    section(t('plans.objectives'), list(c.objectives, true)),
    section(t('plans.materials'), list(c.materials)),
    section(t('plans.warmUp'), para(c.warmUp)),
    c.activities.length ? section(t('plans.activities'), h('table', { class: 'data compare plan-table' },
      h('thead', {}, h('tr', {}, [t('plans.activity'), t('plans.minutesCol'), t('plans.description')].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, c.activities.map((a) => h('tr', {}, h('th', { scope: 'row', dir: 'auto' }, a.title), h('td', { class: 'mono' }, fmtNum(a.minutes)), h('td', { class: 'prose', dir: 'auto' }, a.description || none())))),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, t('plans.total')), h('td', { class: 'mono' }, fmtNum(total)), h('td', {}, total !== c.durationMinutes ? t('plans.totalDiffers', { n: fmtNum(c.durationMinutes) }) : ''))))) : null,
    section(t('plans.questions'), list(c.questions, true)),
    section(t('plans.assessment'), para(c.assessment)),
    section(t('plans.homework'), para(c.homework)),
    section(t('plans.differentiation'), para(c.differentiation)),
    section(t('plans.notes'), para(c.notes)),
  ];
}

function pacingBody(c) {
  return [
    section(t('plans.books'), list(c.books)),
    section(t('plans.weeks'), h('table', { class: 'data compare plan-table' },
      h('thead', {}, h('tr', {}, [t('plans.week'), t('plans.topics'), t('plans.weekObjectives'), t('plans.weekNotes')].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, c.weeks.map((w, i) => h('tr', {},
        h('th', { scope: 'row' }, t('plans.weekN', { n: i + 1 }), h('div', { class: 'muted small' }, weekDates(c.startDate, i))),
        h('td', { class: 'prose', dir: 'auto' }, w.topics || none()),
        h('td', { class: 'prose', dir: 'auto' }, w.objectives || none()),
        h('td', { class: 'prose', dir: 'auto' }, w.notes || none())))))),
  ];
}

export async function planView(ctx) {
  const { orgId, scopeId, planId } = ctx.params;
  const { plan: p, scope } = await get(`/api/orgs/${orgId}/scopes/${scopeId}/plans/${planId}`);
  const c = p.content;
  const facts = p.kind === 'lesson'
    ? [[t('plans.topic'), auto(c.topic)], [t('plans.duration'), t('plans.minutes', { n: fmtNum(c.durationMinutes) })]]
    : [[t('plans.startDate'), fmtDay(c.startDate)], [t('plans.periods'), fmtNum(c.periodsPerWeek)], [t('plans.weekCount'), fmtNum(c.weeks.length)],
      [t('plans.endDate'), fmtDay(addDays(c.startDate, (c.weeks.length - 1) * 7 + 4))]];

  async function remove() {
    if (!(await confirmDialog(t('plans.deleteTitle'), t('plans.deleteText', { title: p.title }), { danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await del(`/api/orgs/${orgId}/scopes/${scopeId}/plans/${planId}`);
      toast(t('plans.deleted'));
      navigate(plansPath(orgId, scopeId));
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  const actions = h('div', { class: 'row no-print' },
    link(plansPath(orgId, scopeId), t('plans.back')),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => window.print() }, t('plans.print')),
    p.canEdit ? link(`${plansPath(orgId, scopeId)}/${planId}/edit`, t('common.edit'), { class: 'btn' }) : null,
    p.canEdit ? h('button', { type: 'button', class: 'btn danger ghost', onclick: remove }, t('common.delete')) : null);
  // Headings follow the interface; the plan's own text keeps its direction (dir=auto) and is marked
  // with its language where it differs from the interface's (dom.js).
  return h('div', {},
    pageHead(t(`plans.kind.${p.kind}`), `${planSubject(p)} · ${gradeLabel(p.grade)} · ${scope.name}`, actions),
    h('article', { class: 'card plan-doc stack' },
      h('h2', { class: 'plan-title', dir: 'auto' }, p.title),
      h('dl', { class: 'plan-facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      p.kind === 'lesson' ? lessonBody(c) : pacingBody(c)),
    h('p', { class: 'muted small' },
      t('plans.byline', { name: p.createdBy ?? '—', date: fmtDate(p.createdAt) }),
      p.updatedBy && p.updatedAt !== p.createdAt ? [' ', t('plans.updatedBy', { name: p.updatedBy, date: fmtDate(p.updatedAt) })] : null,
      p.aiAssisted ? [' ', t('plans.aiNote')] : null));
}

// ------------------------------------------------------------ editor (new or existing)

const BLANK_LESSON = { topic: '', durationMinutes: 45, books: [], objectives: [], materials: [], warmUp: '', activities: [], questions: [], assessment: '', homework: '', differentiation: '', notes: '' };
const BLANK_WEEK = { topics: '', objectives: '', notes: '' };

export async function planEditView(ctx) {
  const { orgId, scopeId, planId } = ctx.params;
  let plan;
  let draftNote = null;
  if (planId) {
    plan = (await get(`/api/orgs/${orgId}/scopes/${scopeId}/plans/${planId}`)).plan;
    if (!plan.canEdit) return h('div', {}, pageHead(t('plans.editTitle'), null), h('p', { class: 'notice' }, t('plans.notYours')), link(`${plansPath(orgId, scopeId)}/${planId}`, t('plans.backToPlan')));
  } else {
    const data = await get(`/api/orgs/${orgId}/scopes/${scopeId}/plans`);
    const kind = KINDS.includes(ctx.query.get('kind')) ? ctx.query.get('kind') : 'lesson';
    const g = data.grades.find((x) => String(x.grade) === ctx.query.get('grade'));
    const sub = g?.subjects.find((s) => s.nameEn === ctx.query.get('subject'));
    if (!g || !sub) return h('div', {}, pageHead(t('plans.new'), null), h('p', { class: 'notice' }, t('plans.chooseAgain')), link(plansPath(orgId, scopeId), t('plans.back')));
    const draft = ctx.query.get('draft') && pendingDraft?.kind === kind && pendingDraft.grade === g.grade && pendingDraft.subjectEn === sub.nameEn ? pendingDraft : null;
    pendingDraft = null;
    plan = draft
      ? { ...draft, subjectAr: sub.nameAr, aiAssisted: true }
      : {
        kind, grade: g.grade, subjectEn: sub.nameEn, subjectAr: sub.nameAr, title: '', language: locale(), aiAssisted: false,
        content: kind === 'lesson' ? { ...BLANK_LESSON, books: sub.books.slice(0, 20) } : { startDate: today(), periodsPerWeek: 4, books: sub.books.slice(0, 20), weeks: [{ ...BLANK_WEEK }] },
      };
    if (draft) draftNote = h('p', { class: 'notice' }, t('plans.draftReview'));
  }
  const c = JSON.parse(JSON.stringify(plan.content));
  const back = planId ? `${plansPath(orgId, scopeId)}/${planId}` : plansPath(orgId, scopeId);

  // Every input is registered under the path the server names in its errors (content.activities.0.title…).
  const inputs = new Map();
  let seq = 0;
  const field = (path, label, input, hint) => {
    const id = `pe-${++seq}`;
    input.id = id;
    input.setAttribute('aria-describedby', hint ? `${id}-hint ${id}-err` : `${id}-err`);
    inputs.set(path, input);
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null, h('span', { class: 'err', id: `${id}-err`, hidden: true }));
  };
  // Each text field is marked with the language of what it holds, for screen readers (WCAG 3.1.2): Arabic when it
  // has Arabic, English when it has only Latin letters, else the plan's language. Updated as the member types.
  let planLang = plan.language;
  const markLang = (el) => { el.lang = /[\u0600-\u06FF]/.test(el.value) ? 'ar' : /[A-Za-z]/.test(el.value) ? 'en' : planLang; };
  const marked = (el) => { markLang(el); el.addEventListener('input', () => markLang(el)); return el; };
  const text = (value, max) => marked(h('input', { type: 'text', value, maxlength: max, dir: 'auto' }));
  const area = (value, max, rows = 3) => marked(h('textarea', { maxlength: max, rows, dir: 'auto' }, value ?? ''));
  const number = (value, min, max) => h('input', { type: 'number', value: String(value), min: String(min), max: String(max), inputmode: 'numeric' });
  const lines = (items) => area(items.join('\n'), 20000, Math.max(3, items.length + 1));
  const readLines = (el) => el.value.split('\n').map((s) => s.trim()).filter(Boolean);

  const title = text(plan.title, 200);
  title.required = true;
  const language = h('select', {
    onchange: () => {
      planLang = language.value;
      for (const el of inputs.values()) if (el.tagName === 'TEXTAREA' || el.type === 'text') markLang(el);
    },
  }, ['ar', 'en'].map((l) => h('option', { value: l, selected: plan.language === l ? 'selected' : null }, t(`tests.suggestLang.${l}`))));
  const head = h('div', { class: 'card stack' },
    field('title', t('plans.planTitle'), title),
    field('language', t('plans.language'), language, t('plans.languageHint')));

  // Rows that can be added and removed: lesson activities or pacing weeks.
  const rowsBox = h('div', { class: 'stack' });
  let body;
  let collect;
  if (plan.kind === 'lesson') {
    const f = {
      topic: text(c.topic, 300), duration: number(c.durationMinutes, 10, 240), books: lines(c.books), objectives: lines(c.objectives), materials: lines(c.materials),
      warmUp: area(c.warmUp, 2000), questions: lines(c.questions), assessment: area(c.assessment, 2000), homework: area(c.homework, 2000), differentiation: area(c.differentiation, 2000), notes: area(c.notes, 3000),
    };
    f.topic.required = true;
    const acts = c.activities.map((a) => ({ ...a }));
    const drawActs = () => {
      for (const k of [...inputs.keys()]) if (k.startsWith('content.activities.')) inputs.delete(k);
      rowsBox.replaceChildren(...acts.map((a, i) => {
        const at = text(a.title, 200);
        const am = number(a.minutes, 1, 240);
        const ad = area(a.description, 3000, 2);
        at.addEventListener('input', () => { a.title = at.value; });
        am.addEventListener('input', () => { a.minutes = Number(am.value); });
        ad.addEventListener('input', () => { a.description = ad.value; });
        return h('fieldset', { class: 'plan-row' }, h('legend', {}, t('plans.activityN', { n: i + 1 })),
          h('div', { class: 'grid2' }, field(`content.activities.${i}.title`, t('plans.activity'), at), field(`content.activities.${i}.minutes`, t('plans.minutesCol'), am)),
          field(`content.activities.${i}.description`, t('plans.description'), ad),
          h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => { acts.splice(i, 1); drawActs(); addAct.focus(); } }, t('plans.removeActivity', { n: i + 1 })));
      }));
    };
    const addAct = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { acts.push({ title: '', minutes: 10, description: '' }); drawActs(); rowsBox.lastElementChild?.querySelector('input')?.focus(); } }, t('plans.addActivity'));
    drawActs();
    body = [
      h('div', { class: 'card stack' }, h('div', { class: 'grid2' }, field('content.topic', t('plans.topic'), f.topic), field('content.durationMinutes', t('plans.durationLabel'), f.duration)),
        field('content.books', t('plans.books'), f.books, t('plans.linesHint')),
        field('content.objectives', t('plans.objectives'), f.objectives, t('plans.linesHint')),
        field('content.materials', t('plans.materials'), f.materials, t('plans.linesHint')),
        field('content.warmUp', t('plans.warmUp'), f.warmUp)),
      h('div', { class: 'card stack' }, h('h2', {}, t('plans.activities')), rowsBox, h('div', {}, addAct)),
      h('div', { class: 'card stack' },
        field('content.questions', t('plans.questions'), f.questions, t('plans.linesHint')),
        field('content.assessment', t('plans.assessment'), f.assessment),
        field('content.homework', t('plans.homework'), f.homework),
        field('content.differentiation', t('plans.differentiation'), f.differentiation, t('plans.differentiationHint')),
        field('content.notes', t('plans.notes'), f.notes)),
    ];
    collect = () => ({
      topic: f.topic.value, durationMinutes: Number(f.duration.value), books: readLines(f.books), objectives: readLines(f.objectives), materials: readLines(f.materials),
      warmUp: f.warmUp.value, activities: acts, questions: readLines(f.questions), assessment: f.assessment.value, homework: f.homework.value,
      differentiation: f.differentiation.value, notes: f.notes.value,
    });
  } else {
    const f = { start: h('input', { type: 'date', value: c.startDate, required: true }), periods: number(c.periodsPerWeek, 1, 15), books: lines(c.books) };
    const weeks = c.weeks.map((w) => ({ ...w }));
    const drawWeeks = () => {
      for (const k of [...inputs.keys()]) if (k.startsWith('content.weeks.')) inputs.delete(k);
      rowsBox.replaceChildren(...weeks.map((w, i) => {
        const wt = area(w.topics, 1000, 2);
        const wo = area(w.objectives, 1000, 2);
        const wn = area(w.notes, 1000, 2);
        wt.addEventListener('input', () => { w.topics = wt.value; });
        wo.addEventListener('input', () => { w.objectives = wo.value; });
        wn.addEventListener('input', () => { w.notes = wn.value; });
        const dates = /^\d{4}-\d{2}-\d{2}$/.test(f.start.value) ? weekDates(f.start.value, i) : '';
        return h('fieldset', { class: 'plan-row' }, h('legend', {}, t('plans.weekN', { n: i + 1 }), dates ? h('span', { class: 'muted small' }, ` · ${dates}`) : null),
          field(`content.weeks.${i}.topics`, t('plans.topics'), wt),
          h('div', { class: 'grid2' }, field(`content.weeks.${i}.objectives`, t('plans.weekObjectives'), wo), field(`content.weeks.${i}.notes`, t('plans.weekNotes'), wn)),
          weeks.length > 1 ? h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => { weeks.splice(i, 1); drawWeeks(); addWeek.focus(); } }, t('plans.removeWeek', { n: i + 1 })) : null);
      }));
    };
    const addWeek = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { if (weeks.length >= 52) return toast(t('plans.maxWeeks')); weeks.push({ ...BLANK_WEEK }); drawWeeks(); rowsBox.lastElementChild?.querySelector('textarea')?.focus(); } }, t('plans.addWeek'));
    f.start.addEventListener('change', drawWeeks);
    drawWeeks();
    body = [
      h('div', { class: 'card stack' }, h('div', { class: 'grid2' }, field('content.startDate', t('plans.startDate'), f.start, t('plans.startHint')), field('content.periodsPerWeek', t('plans.periods'), f.periods)),
        field('content.books', t('plans.books'), f.books, t('plans.linesHint'))),
      h('div', { class: 'card stack' }, h('h2', {}, t('plans.weeks')), rowsBox, h('div', {}, addWeek)),
    ];
    collect = () => ({ startDate: f.start.value, periodsPerWeek: Number(f.periods.value), books: readLines(f.books), weeks });
  }

  const errBox = h('div', { class: 'alert error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn' }, t('common.save'));
  const el = h('form', { class: 'stack', novalidate: true }, errBox, head, body, h('div', { class: 'row' }, save, link(back, t('common.cancel'), { class: 'btn ghost' })));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    for (const inp of inputs.values()) {
      inp.removeAttribute('aria-invalid');
      const errEl = document.getElementById(`${inp.id}-err`);
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    }
    const content = collect();
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
    try {
      const res = planId
        ? await patch(`/api/orgs/${orgId}/scopes/${scopeId}/plans/${planId}`, { title: title.value, language: language.value, content })
        : await post(`/api/orgs/${orgId}/scopes/${scopeId}/plans`, { kind: plan.kind, grade: plan.grade, subjectEn: plan.subjectEn, title: title.value, language: language.value, aiAssisted: plan.aiAssisted, content });
      toast(t('common.saved'));
      navigate(`${plansPath(orgId, scopeId)}/${res.plan.id}`, { replace: !planId });
    } catch (err) {
      let first = null;
      for (const d of Array.isArray(err?.details) ? err.details : []) {
        // A line of a list (content.objectives.2) is shown on the list's field.
        const inp = inputs.get(d.path) ?? inputs.get(String(d.path).replace(/\.\d+$/, ''));
        const errEl = inp && document.getElementById(`${inp.id}-err`);
        if (errEl && !errEl.textContent) { errEl.textContent = d.message; errEl.hidden = false; inp.setAttribute('aria-invalid', 'true'); first ??= inp; }
      }
      if (first && err.code === 'VALIDATION_ERROR') first.focus();
      else errBox.textContent = errorMessage(err);
    } finally {
      save.disabled = false;
      save.removeAttribute('aria-busy');
    }
  });

  return h('div', {},
    pageHead(planId ? t('plans.editTitle') : t(`plans.newTitle.${plan.kind}`), `${planSubject(plan)} · ${gradeLabel(plan.grade)}`),
    draftNote, el);
}
