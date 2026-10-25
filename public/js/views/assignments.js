// My assignments: every selected book assigned to the signed-in member,
// across the organization's scopes (or across all their schools), overdue
// first and then by due date. The assignee can update each book's status here,
// whatever their role.
import { get, patch } from '../api.js';
import { errorMessage, h, link, tableCard, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { invalidateOrg, session } from '../state.js';
import { progress, STATUSES } from './items.js';
import { pageHead } from './shell.js';

const SHOW = ['open', 'done', 'all'];
const auto = (...c) => h('span', { dir: 'auto' }, ...c);
const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)));

function showFilter(show, path) {
  const sel = h('select', { id: 'assign-show', onchange: (e) => navigate(`${path}?show=${e.target.value}`, { replace: true }) },
    SHOW.map((k) => h('option', { value: k, selected: k === show ? 'selected' : null }, t(`assignments.show.${k}`))));
  return h('div', { class: 'card compare-controls' }, h('div', { class: 'field' }, h('label', { for: 'assign-show' }, t('picker.show')), sel));
}

/** The table, or a note when there is nothing. Items from several schools carry orgId and orgName. */
function assignmentsTable(items, show, allSchools) {
  if (!items.length) return h('div', { class: 'card' }, h('p', { class: 'empty' }, t(show === 'done' ? 'assignments.noneDone' : 'assignments.none')));
  const ar = locale() === 'ar';
  const heads = [t('compare.material'), allSchools ? t('assignments.schoolScope') : t('assignments.scope'), t('items.progress'), t('items.statusLabel'), t('items.note')];
  return tableCard(t('assignments.title'), h('table', { class: 'data compare items' },
    h('thead', {}, h('tr', {}, heads.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, items.map((it) => {
      const statusSel = h('select', {
        'aria-label': t('assignments.statusFor', { title: it.title }), disabled: it.readOnly,
        onchange: async (e) => {
          const status = e.target.value || null;
          try {
            await patch(`/api/orgs/${it.orgId}/scopes/${it.scopeId}/items/${it.materialId}`, { status });
            it.status = status;
            toast(t('common.saved'));
            invalidateOrg(it.orgId);
            // Redraw this row's progress only, so focus stays on the select.
            e.target.closest('tr').querySelector('td.prog').replaceChildren(...[progress(it)].flat());
          } catch (err) {
            e.target.value = it.status ?? '';
            toast(errorMessage(err), 'error');
          }
        },
      }, h('option', { value: '' }, t('items.status.none')), STATUSES.map((k) => h('option', { value: k, selected: it.status === k ? 'selected' : null }, t(`items.status.${k}`))));
      return h('tr', {},
        h('th', { scope: 'row' }, auto(it.title), h('div', { class: 'muted small' }, auto(ar ? it.subjectAr : it.subjectEn), ` · ${t('picker.grade')} ${it.grade}`)),
        h('td', {},
          allSchools ? h('div', {}, link(`/org/${it.orgId}/assignments`, auto(it.orgName))) : null,
          link(`/org/${it.orgId}/scopes/${it.scopeId}/items?show=mine`, auto(it.scopeName)), h('div', { class: 'muted small mono' }, it.academicYear)),
        h('td', { class: 'prog' }, progress(it)),
        h('td', {}, statusSel),
        h('td', { class: 'note' }, it.note ? auto(it.note) : h('span', { class: 'muted' }, '—')));
    }))));
}

export async function assignmentsView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const wanted = ctx.query.get('show');
  const show = SHOW.includes(wanted) ? wanted : 'open';
  const { items } = await get(`/api/orgs/${orgId}/assignments?show=${show}`);
  for (const it of items) it.orgId = orgId;

  const counts = info.myAssignments ?? { open: 0, overdue: 0, dueSoon: 0 };
  const schools = session.me?.organizations?.length ?? 0;
  return h('div', {},
    pageHead(t('assignments.title'), t('assignments.sub', { org: info.organization.name })),
    schools > 1 ? h('p', {}, link('/assignments', t('assignments.allLink', { n: schools }))) : null,
    h('div', { class: 'stats items-stats' },
      stat(t('assignments.open'), counts.open), stat(t('items.stat.overdue'), counts.overdue), stat(t('items.stat.dueSoon'), counts.dueSoon)),
    showFilter(show, `/org/${orgId}/assignments`), assignmentsTable(items, show, false));
}

/** My assignments in every school the member belongs to. */
export async function allAssignmentsView(ctx) {
  const wanted = ctx.query.get('show');
  const show = SHOW.includes(wanted) ? wanted : 'open';
  const { items, counts, organizations, unavailable } = await get(`/api/assignments?show=${show}`);
  return h('div', {},
    pageHead(t('assignments.allTitle'), t('assignments.allSub', { n: organizations.length + unavailable.length })),
    unavailable.length
      ? h('div', { class: 'card', role: 'note' }, h('p', {}, t('assignments.unavailable', { names: unavailable.map((o) => o.name).join(locale() === 'ar' ? '، ' : ', ') })))
      : null,
    h('div', { class: 'stats items-stats' },
      stat(t('assignments.open'), counts.open), stat(t('items.stat.overdue'), counts.overdue), stat(t('items.stat.dueSoon'), counts.dueSoon)),
    organizations.length > 1
      ? h('p', { class: 'muted' }, t('assignments.bySchool'), ' ', organizations.map((o, i) => [i ? ' · ' : null, link(`/org/${o.id}/assignments`, auto(o.name)), ` (${o.open})`]))
      : null,
    showFilter(show, '/assignments'), assignmentsTable(items, show, true));
}
