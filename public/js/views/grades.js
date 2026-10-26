// The gradebook for teachers and "My grades" for students (docs/CLASSROOM.md §10).
// Read only: marks are given on the homework and test pages.
import { ApiError, get } from '../api.js';
import { downloadText, errorMessage, fmtDate, fmtNum, h, link, none, tableCard, th, toast } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { subjectName } from './classroom-common.js';
import { pageHead } from './shell.js';
import { frame } from './student.js';

const percent = (n) => t('grades.percent', { n: fmtNum(n) });

/** A mark, or what stands in for one. `mine` words it for the student. */
function cellContent(c, maxPoints, mine) {
  if (c.status === 'marked') return mine ? t('hw.markOf', { points: fmtNum(c.points), max: fmtNum(maxPoints) }) : fmtNum(c.points);
  if (c.status === 'pending') return none();
  const kind = { missing: 'bad', to_mark: 'warn' }[c.status] ?? '';
  return h('span', { class: `pill ${kind}` }, t(mine && c.status === 'to_mark' ? 'grades.waiting' : `grades.status.${c.status}`));
}

// ------------------------------------------------------------ teachers

export async function gradebookView(ctx) {
  const { orgId, classId } = ctx.params;
  const wanted = ctx.query.get('subject') || '';
  const data = await get(`/api/orgs/${orgId}/classes/${classId}/gradebook${wanted ? `?subject=${encodeURIComponent(wanted)}` : ''}`);
  const cls = data.class;
  const crumbs = h('p', { class: 'crumbs' }, link(`/org/${orgId}/classes`, t('classes.title')), ' › ', link(`/org/${orgId}/classes/${classId}`, cls.name, { dir: 'auto' }));

  if (!data.subjects.length) {
    return h('div', {}, crumbs, pageHead(t('grades.title'), t('grades.sub', { name: cls.name })), h('p', { class: 'empty' }, t('grades.none')));
  }

  const subject = data.subject ?? data.subjects[0];
  const select = h('select', { id: 'gb-subject', onchange: () => navigate(`/org/${orgId}/classes/${classId}/gradebook?subject=${encodeURIComponent(select.value)}`) },
    data.subjects.map((s) => h('option', { value: s.subjectEn, selected: s.subjectEn === subject.subjectEn ? 'selected' : null }, subjectName(s))));

  async function download() {
    try {
      const res = await fetch(`/api/orgs/${orgId}/classes/${classId}/gradebook?subject=${encodeURIComponent(subject.subjectEn)}&format=csv`, { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'gradebook.csv';
      downloadText(name, await res.text(), 'text/csv');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const itemHead = (it) => h('th', { scope: 'col', class: 'num' },
    link(it.kind === 'homework' ? `/org/${orgId}/homework/${it.id}` : `/org/${orgId}/tests/${it.id}/results`, it.title, { dir: 'auto' }),
    h('span', { class: 'cell-sub' }, t(`grades.kind.${it.kind}`), ' · ', fmtDate(it.date), ' · ', t('grades.outOf', { max: fmtNum(it.maxPoints) })));

  const table = data.items.length
    ? tableCard(t('grades.tableLabel', { subject: subjectName(subject) }), h('table', { class: 'data gradebook' },
      h('thead', {}, h('tr', {}, th(t('students.student')), data.items.map(itemHead),
        h('th', { scope: 'col', class: 'num' }, t('grades.average')), h('th', { scope: 'col', class: 'num' }, t('grades.missingCol')))),
      h('tbody', {}, data.students.map((r) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { dir: 'auto' }, r.name)),
        r.cells.map((c, i) => h('td', { class: 'num' }, cellContent(c, data.items[i].maxPoints, false))),
        h('td', { class: 'num' }, r.average === null ? none() : h('b', {}, percent(r.average))),
        h('td', { class: 'num' }, r.missing ? fmtNum(r.missing) : none()))))))
    : h('p', { class: 'empty' }, t('grades.noneSubject'));

  return h('div', {},
    crumbs,
    pageHead(t('grades.title'), t('grades.sub', { name: cls.name })),
    h('div', { class: 'row' },
      h('div', { class: 'subject-pick' }, h('label', { for: 'gb-subject' }, t('grades.subject')), select),
      data.items.length ? h('button', { type: 'button', class: 'btn ghost', onclick: download }, t('grades.download')) : null),
    h('p', { class: 'muted' }, t('grades.help')),
    table);
}

// ------------------------------------------------------------ students

export async function myGradesView(ctx) {
  const { subjects } = await get('/api/student/grades');
  const head = pageHead(t('grades.mine'), t('grades.mineSub'));
  if (!subjects.length) return frame(ctx, head, h('p', { class: 'empty' }, t('grades.mineNone')));
  return frame(ctx, head, subjects.map((s, n) => h('section', { class: 'card', 'aria-labelledby': `gs-${n}` },
    h('div', { class: 'row spread' },
      h('h2', { id: `gs-${n}` }, t('grades.subjectInClass', { subject: subjectName(s), class: s.className })),
      h('p', {}, s.average === null ? h('span', { class: 'muted' }, t('grades.noAverage')) : h('b', {}, t('grades.averageIs', { n: fmtNum(s.average) })),
        s.missing ? [' · ', h('span', { class: 'pill bad' }, t('grades.missingN', { n: fmtNum(s.missing) }))] : null)),
    tableCard(t('grades.subjectInClass', { subject: subjectName(s), class: s.className }), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('grades.item'), t('grades.date'), t('grades.mark')].map(th))),
      h('tbody', {}, s.items.map((it) => h('tr', {},
        h('td', {}, link(it.kind === 'homework' ? `/student/homework/${it.id}` : `/student/tests/${it.id}`, it.title, { dir: 'auto' }),
          h('span', { class: 'cell-sub' }, t(`grades.kind.${it.kind}`))),
        h('td', { class: 'nowrap' }, fmtDate(it.date)),
        h('td', {}, cellContent(it, it.maxPoints, true))))))))));
}
