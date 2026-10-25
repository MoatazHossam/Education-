// Notes and assignees on a scope's selected books: a work list for the team.
// Editors write a short note on any selected book, name the member responsible
// for it, and track a status and due date, one book at a time or several at once.
import { get, patch, post } from '../api.js';
import { dialog, errorMessage, fmtDate, form, h, link, tableCard, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { can, invalidateOrg, session } from '../state.js';
import { pageHead } from './shell.js';

const SHOW = ['all', 'mine', 'notes', 'assigned', 'unassigned', 'open', 'overdue', 'done'];
export const STATUSES = ['todo', 'in_progress', 'done'];

/** Today in the browser's time zone, as YYYY-MM-DD (due dates are calendar days). */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const isOverdue = (a) => Boolean(a?.dueOn && a.status !== 'done' && a.dueOn < today());
/** A calendar day shown in the user's language (built at local midnight, so the day never shifts). */
export const fmtDay = (day) => fmtDate(new Date(`${day}T00:00:00`));

/** Status pill and due date of a book; "overdue" is said in words, not only by colour. */
export function progress(a) {
  const parts = [];
  if (a?.status) parts.push(h('span', { class: `pill ${a.status === 'done' ? 'ok' : a.status === 'in_progress' ? 'warn' : ''}` }, t(`items.status.${a.status}`)));
  if (a?.dueOn) {
    parts.push(h('div', { class: 'small' }, t('items.due', { date: fmtDay(a.dueOn) }),
      isOverdue(a) ? [' ', h('span', { class: 'pill bad' }, t('items.overdue'))] : null));
  }
  return parts.length ? parts : h('span', { class: 'muted' }, '—');
}
const auto = (...c) => h('span', { dir: 'auto' }, ...c);
const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)));

export async function itemsView(ctx) {
  const { orgId, scopeId } = ctx.params;
  const info = ctx.info;
  const me = session.me.user.id;
  const [{ scopes }, data, { members }] = await Promise.all([
    get(`/api/orgs/${orgId}/scopes`),
    get(`/api/orgs/${orgId}/scopes/${scopeId}`),
    get(`/api/orgs/${orgId}/members`),
  ]);
  const scope = scopes.find((s) => s.id === scopeId);
  const tree = await get(`/api/catalog/versions/${data.scope.catalogVersionId}`);
  const canEdit = can(info.role, 'editor') && !scope?.readOnly;
  const ar = locale() === 'ar';
  const notes = new Map(data.annotations.map((a) => [a.materialId, a]));
  const selected = new Set(data.materialIds);

  // Selected books in catalogue order, with their subject and grade.
  const rows = [];
  for (const s of tree.subjects) for (const m of s.materials) if (selected.has(m.id)) rows.push({ subject: s, m });
  const gradeName = (g) => { const n = tree.grades.find((x) => x.grade === g); return n ? (ar ? n.nameAr : n.nameEn) : `${t('picker.grade')} ${g}`; };

  const wanted = ctx.query.get('show');
  const st = { show: SHOW.includes(wanted) ? wanted : 'all', grade: '', q: '' };
  const chosen = new Set();

  const matches = (r) => {
    const a = notes.get(r.m.id);
    if (st.show === 'mine' && a?.assigneeId !== me) return false;
    if (st.show === 'notes' && !a?.note) return false;
    if (st.show === 'assigned' && !a?.assigneeId) return false;
    if (st.show === 'unassigned' && a?.assigneeId) return false;
    if (st.show === 'open' && a?.status === 'done') return false;
    if (st.show === 'done' && a?.status !== 'done') return false;
    if (st.show === 'overdue' && !isOverdue(a)) return false;
    if (st.grade && String(r.subject.grade) !== st.grade) return false;
    if (st.q) {
      const hay = `${r.m.title} ${r.subject.nameEn} ${r.subject.nameAr} ${a?.note ?? ''} ${a?.assigneeName ?? ''}`.toLowerCase();
      if (!hay.includes(st.q.toLowerCase())) return false;
    }
    return true;
  };

  async function edit(r) {
    const a = notes.get(r.m.id);
    const f = form({
      fields: [
        { name: 'note', label: t('items.note'), type: 'textarea', value: a?.note ?? '', maxlength: 500, hint: t('items.noteHint') },
        { name: 'assigneeId', label: t('items.assignee'), type: 'select', value: a?.assigneeId ?? '', options: [{ value: '', label: t('items.nobody') }, ...members.map((m) => ({ value: m.userId, label: m.name }))] },
        { name: 'status', label: t('items.statusLabel'), type: 'select', value: a?.status ?? '', options: [{ value: '', label: t('items.status.none') }, ...STATUSES.map((k) => ({ value: k, label: t(`items.status.${k}`) }))] },
        { name: 'dueOn', label: t('items.dueLabel'), type: 'date', value: a?.dueOn ?? '', hint: t('items.dueHint') },
      ],
      submitLabel: t('common.save'),
      onSubmit: async (v) => {
        const res = await patch(`/api/orgs/${orgId}/scopes/${scopeId}/items/${r.m.id}`, { note: v.note, assigneeId: v.assigneeId || null, status: v.status || null, dueOn: v.dueOn || null });
        const x = res.annotation;
        if (x.note || x.assigneeId || x.status || x.dueOn) notes.set(r.m.id, x); else notes.delete(r.m.id);
        f.el.closest('dialog')?.close();
        toast(t('common.saved'));
        invalidateOrg(orgId);
        draw();
        results.querySelector(`[data-edit="${r.m.id}"]`)?.focus();
      },
    });
    await dialog({ title: t('items.editTitle'), body: h('div', { class: 'stack' }, h('p', { class: 'muted', dir: 'auto' }, r.m.title), f.el), actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }] });
  }

  // ------------------------------------------------------------ several books at once (editors)
  // Each control starts at "keep", so only what the editor changes is sent.
  const chosenCount = h('span', {});
  const KEEP = '__keep';
  const bulkAssignee = h('select', { id: 'bulk-assignee' },
    h('option', { value: KEEP }, t('items.keep')), h('option', { value: '' }, t('items.nobody')), members.map((m) => h('option', { value: m.userId }, m.name)));
  const bulkStatus = h('select', { id: 'bulk-status' },
    h('option', { value: KEEP }, t('items.keep')), h('option', { value: '' }, t('items.status.none')), STATUSES.map((k) => h('option', { value: k }, t(`items.status.${k}`))));
  const bulkDue = h('input', { id: 'bulk-due', type: 'date' });
  const bulkBtn = h('button', {
    type: 'button', class: 'btn small', onclick: async () => {
      if (!chosen.size) return toast(t('items.chooseFirst'));
      const body = { materialIds: [...chosen] };
      if (bulkAssignee.value !== KEEP) body.assigneeId = bulkAssignee.value || null;
      if (bulkStatus.value !== KEEP) body.status = bulkStatus.value || null;
      if (bulkDue.value) body.dueOn = bulkDue.value;
      if (Object.keys(body).length === 1) return toast(t('items.chooseChange'));
      try {
        const res = await post(`/api/orgs/${orgId}/scopes/${scopeId}/items/assign`, body);
        const name = members.find((m) => m.userId === body.assigneeId)?.name ?? null;
        for (const id of chosen) {
          const a = notes.get(id) ?? { materialId: id, note: null, assigneeId: null, assigneeName: null, status: null, dueOn: null };
          const next = { ...a,
            ...('assigneeId' in body ? { assigneeId: body.assigneeId, assigneeName: name } : {}),
            ...('status' in body ? { status: body.status } : {}),
            ...('dueOn' in body ? { dueOn: body.dueOn } : {}) };
          if (next.note || next.assigneeId || next.status || next.dueOn) notes.set(id, next); else notes.delete(id);
        }
        chosen.clear();
        // Back to "keep", so a second click cannot repeat the change by accident.
        bulkAssignee.value = KEEP;
        bulkStatus.value = KEEP;
        bulkDue.value = '';
        toast(t('items.applied', { n: res.updated }));
        invalidateOrg(orgId);
        draw();
      } catch (err) { toast(errorMessage(err), 'error'); }
    },
  }, t('items.apply'));
  const bulk = canEdit ? h('div', { class: 'card items-bulk', role: 'region', 'aria-labelledby': 'bulk-h' },
    h('div', { class: 'row' }, h('h2', { id: 'bulk-h' }, t('items.bulkTitle')), chosenCount),
    h('div', { class: 'compare-controls' },
      h('div', { class: 'field' }, h('label', { for: 'bulk-assignee' }, t('items.assignee')), bulkAssignee),
      h('div', { class: 'field' }, h('label', { for: 'bulk-status' }, t('items.statusLabel')), bulkStatus),
      h('div', { class: 'field' }, h('label', { for: 'bulk-due' }, t('items.dueLabel')), bulkDue),
      bulkBtn)) : null;

  // ------------------------------------------------------------ filters
  const showSel = h('select', { id: 'items-show', onchange: (e) => { st.show = e.target.value; chosen.clear(); draw(); } },
    SHOW.map((k) => h('option', { value: k, selected: k === st.show ? 'selected' : null }, t(`items.show.${k}`))));
  const grades = [...new Set(rows.map((r) => r.subject.grade))];
  const gradeSel = h('select', { id: 'items-grade', onchange: (e) => { st.grade = e.target.value; chosen.clear(); draw(); } },
    h('option', { value: '' }, t('items.allGrades')), grades.map((g) => h('option', { value: String(g) }, gradeName(g))));
  const search = h('input', { id: 'items-q', type: 'search', placeholder: t('items.search'), oninput: (e) => { st.q = e.target.value; draw(); } });
  const filters = h('div', { class: 'card compare-controls' },
    // Labels point at their controls (not wrapped), so a select's name is not followed by its chosen option.
    h('div', { class: 'field' }, h('label', { for: 'items-show' }, t('picker.show')), showSel),
    h('div', { class: 'field' }, h('label', { for: 'items-grade' }, t('picker.grade')), gradeSel),
    h('div', { class: 'field' }, h('label', { for: 'items-q' }, t('picker.search')), search));

  const stats = h('div', { class: 'stats items-stats' });
  const results = h('div', {});
  const gradeBoxes = [];

  // Ticking boxes only updates the counts, so keyboard focus stays where it is.
  function updateChosen() {
    chosenCount.textContent = t('items.chosen', { n: chosen.size });
    for (const { box, ids } of gradeBoxes) box.checked = ids.every((id) => chosen.has(id));
  }

  function draw() {
    const all = [...notes.values()];
    stats.replaceChildren(
      stat(t('items.stat.selected'), rows.length),
      stat(t('items.stat.notes'), all.filter((a) => a.note).length),
      stat(t('items.stat.assigned'), all.filter((a) => a.assigneeId).length),
      stat(t('items.stat.mine'), all.filter((a) => a.assigneeId === me).length),
      stat(t('items.stat.overdue'), all.filter(isOverdue).length));
    gradeBoxes.length = 0;
    const shown = rows.filter(matches);
    if (!rows.length) return results.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'empty' }, t('items.noneSelected')), link(`/org/${orgId}?scope=${scopeId}`, t('items.openPicker'), { class: 'btn' })));
    if (!shown.length) return results.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'empty' }, t('items.noMatch'))));
    const byGrade = new Map();
    for (const r of shown) {
      if (!byGrade.has(r.subject.grade)) byGrade.set(r.subject.grade, []);
      byGrade.get(r.subject.grade).push(r);
    }
    results.replaceChildren(...[...byGrade].map(([g, list]) => {
      const title = gradeName(g);
      const ids = list.map((r) => r.m.id);
      const allBox = canEdit ? h('input', {
        type: 'checkbox', 'aria-label': t('items.chooseAll', { grade: title }), checked: ids.every((id) => chosen.has(id)),
        onchange: (e) => {
          for (const id of ids) { if (e.target.checked) chosen.add(id); else chosen.delete(id); }
          for (const b of results.querySelectorAll('input[data-pick]')) if (ids.includes(b.dataset.pick)) b.checked = e.target.checked;
          updateChosen();
        },
      }) : null;
      if (allBox) gradeBoxes.push({ box: allBox, ids });
      const subjects = [...new Set(list.map((r) => r.subject))];
      const cols = canEdit ? 6 : 4;
      return tableCard(title, h('h2', {}, title), h('table', { class: 'data compare items' },
        h('thead', {}, h('tr', {},
          canEdit ? h('th', { scope: 'col', class: 'pick' }, allBox) : null,
          h('th', { scope: 'col' }, t('compare.material')), h('th', { scope: 'col' }, t('items.note')), h('th', { scope: 'col' }, t('items.assignee')), h('th', { scope: 'col' }, t('items.progress')),
          canEdit ? h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, t('common.edit'))) : null)),
        subjects.map((s) => h('tbody', {},
          h('tr', { class: 'group' }, h('th', { scope: 'colgroup', colspan: String(cols) }, auto(ar ? s.nameAr : s.nameEn))),
          list.filter((r) => r.subject === s).map((r) => {
            const a = notes.get(r.m.id);
            return h('tr', {},
              canEdit ? h('td', { class: 'pick' }, h('input', {
                type: 'checkbox', 'aria-label': t('items.choose', { title: r.m.title }), checked: chosen.has(r.m.id), dataset: { pick: r.m.id },
                onchange: (e) => { if (e.target.checked) chosen.add(r.m.id); else chosen.delete(r.m.id); updateChosen(); },
              })) : null,
              h('th', { scope: 'row' }, auto(r.m.title), h('div', { class: 'muted small' }, t(`kind.${r.m.kind}`))),
              h('td', { class: 'note' }, a?.note ? auto(a.note) : h('span', { class: 'muted' }, '—'),
                a?.annotatedAt ? h('div', { class: 'muted small' }, t('items.by', { name: a.annotatedBy ?? '—', date: fmtDate(a.annotatedAt) })) : null),
              h('td', {}, a?.assigneeName ? h('span', { class: a.assigneeId === me ? 'pill ok' : '' }, auto(a.assigneeName)) : h('span', { class: 'muted' }, '—')),
              h('td', {}, progress(a)),
              canEdit ? h('td', {}, h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('items.editFor', { title: r.m.title }), dataset: { edit: r.m.id }, onclick: () => edit(r).catch((e) => toast(errorMessage(e), 'error')) }, t('common.edit'))) : null);
          }))),
      ));
    }));
    updateChosen();
  }
  draw();

  const back = h('div', { class: 'row' },
    link(`/org/${orgId}/scopes`, t('carry.back')),
    link(`/org/${orgId}?scope=${scopeId}`, t('items.openPicker'), { class: 'btn ghost' }));
  return h('div', {},
    pageHead(t('items.title'), t('items.sub', { name: data.scope.name, year: tree.version.academicYear }), back),
    can(info.role, 'editor') && scope?.readOnly ? h('p', { class: 'notice' }, t('picker.scopeReadOnly')) : null,
    !can(info.role, 'editor') ? h('p', { class: 'muted' }, t('items.viewerNote')) : null,
    stats, filters, bulk, results);
}

/** Used by the scopes list: how many notes and assignments a scope has. */
export function itemsSummary(s) {
  return [t('items.summary', { notes: s.notes ?? 0, assigned: s.assigned ?? 0 }), s.assignedToMe ? [' ', h('span', { class: 'pill ok' }, t('items.mineCount', { n: s.assignedToMe }))] : null];
}
