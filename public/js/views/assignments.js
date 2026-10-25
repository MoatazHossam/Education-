// My assignments: every selected book assigned to the signed-in member,
// across the organization's scopes, overdue first and then by due date. The
// assignee can update each book's status here, whatever their role.
import { get, patch } from '../api.js';
import { errorMessage, h, link, tableCard, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { invalidateOrg } from '../state.js';
import { progress, STATUSES } from './items.js';
import { pageHead } from './shell.js';

const SHOW = ['open', 'done', 'all'];
const auto = (...c) => h('span', { dir: 'auto' }, ...c);

export async function assignmentsView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const wanted = ctx.query.get('show');
  const show = SHOW.includes(wanted) ? wanted : 'open';
  const { items } = await get(`/api/orgs/${orgId}/assignments?show=${show}`);
  const ar = locale() === 'ar';

  const showSel = h('select', { id: 'assign-show', onchange: (e) => navigate(`/org/${orgId}/assignments?show=${e.target.value}`, { replace: true }) },
    SHOW.map((k) => h('option', { value: k, selected: k === show ? 'selected' : null }, t(`assignments.show.${k}`))));
  const filters = h('div', { class: 'card compare-controls' },
    h('div', { class: 'field' }, h('label', { for: 'assign-show' }, t('picker.show')), showSel));

  const body = h('div', {});
  function draw() {
    if (!items.length) {
      body.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'empty' }, t(show === 'done' ? 'assignments.noneDone' : 'assignments.none'))));
      return;
    }
    body.replaceChildren(tableCard(t('assignments.title'), h('table', { class: 'data compare items' },
      h('thead', {}, h('tr', {}, [t('compare.material'), t('assignments.scope'), t('items.progress'), t('items.statusLabel'), t('items.note')].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, items.map((it) => {
        const statusSel = h('select', {
          'aria-label': t('assignments.statusFor', { title: it.title }), disabled: it.readOnly,
          onchange: async (e) => {
            const status = e.target.value || null;
            try {
              await patch(`/api/orgs/${orgId}/scopes/${it.scopeId}/items/${it.materialId}`, { status });
              it.status = status;
              toast(t('common.saved'));
              invalidateOrg(orgId);
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
          h('td', {}, link(`/org/${orgId}/scopes/${it.scopeId}/items?show=mine`, auto(it.scopeName)), h('div', { class: 'muted small mono' }, it.academicYear)),
          h('td', { class: 'prog' }, progress(it)),
          h('td', {}, statusSel),
          h('td', { class: 'note' }, it.note ? auto(it.note) : h('span', { class: 'muted' }, '—')));
      })))));
  }
  draw();

  const counts = info.myAssignments ?? { open: 0, overdue: 0, dueSoon: 0 };
  return h('div', {},
    pageHead(t('assignments.title'), t('assignments.sub', { org: info.organization.name })),
    h('div', { class: 'stats items-stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, t('assignments.open')), h('div', { class: 'v' }, String(counts.open))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, t('items.stat.overdue')), h('div', { class: 'v' }, String(counts.overdue))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, t('items.stat.dueSoon')), h('div', { class: 'v' }, String(counts.dueSoon)))),
    filters, body);
}
