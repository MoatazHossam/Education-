import { del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, h, link, promptDialog, tableCard, toast } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg } from '../state.js';
import { newerVersionFor } from './carry.js';
import { itemsSummary } from './items.js';
import { pageHead, planLimitHint } from './shell.js';

export async function scopesView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const canEdit = can(info.role, 'editor');
  const [{ scopes, limit }, { versions }] = await Promise.all([get(`/api/orgs/${orgId}/scopes`), get('/api/catalog/versions')]);

  const refresh = () => { invalidateOrg(orgId); ctx.render(); };
  const act = async (fn) => { try { await fn(); refresh(); } catch (err) { toast(errorMessage(err), 'error'); } };

  async function rename(s) {
    const name = h('input', { type: 'text', value: s.name, maxlength: 120 });
    const desc = h('textarea', { maxlength: 2000 }, s.description || '');
    const ok = await dialog({
      title: t('scopes.edit'),
      body: h('div', { class: 'stack' }, h('label', { class: 'field' }, t('scopes.name'), name), h('label', { class: 'field' }, t('scopes.description'), desc)),
      actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: t('common.save'), value: true }],
    });
    if (ok) await act(() => patch(`/api/orgs/${orgId}/scopes/${s.id}`, { name: name.value, description: desc.value || null }));
  }

  async function duplicate(s) {
    const name = await promptDialog(t('scopes.duplicate'), t('scopes.name'));
    if (!name) return;
    try {
      const r = await post(`/api/orgs/${orgId}/scopes/${s.id}/duplicate`, { name });
      invalidateOrg(orgId);
      navigate(`/org/${orgId}?scope=${r.scope.id}`);
    } catch (err) {
      await dialog({ title: t('scopes.duplicate'), body: h('p', {}, errorMessage(err), ' ', planLimitHint(err, orgId, info.role)), actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
    }
  }

  async function remove(s) {
    if (await confirmDialog(t('scopes.deleteTitle'), t('scopes.deleteText', { name: s.name, n: s.itemCount }), { danger: true, confirmLabel: t('common.delete') })) {
      await act(() => del(`/api/orgs/${orgId}/scopes/${s.id}`));
    }
  }

  const carryLink = (s) => {
    const next = newerVersionFor(s, versions);
    return next ? link(`/org/${orgId}/scopes/${s.id}/carry?to=${next.id}`, t('carry.action', { year: next.academicYear }), { class: 'btn small' }) : null;
  };

  const body = scopes.length
    ? tableCard(t('scopes.title'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('scopes.name'), t('scopes.year'), t('scopes.items'), t('items.title'), t('scopes.updated'), ''].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, scopes.map((s) => h('tr', {},
        h('td', { dir: 'auto' }, link(`/org/${orgId}?scope=${s.id}`, s.name), s.description ? h('div', { class: 'muted' }, s.description) : null, s.readOnly ? h('span', { class: 'pill warn' }, t('scopes.readOnly')) : null),
        h('td', { class: 'mono' }, s.academicYear),
        h('td', { class: 'mono' }, String(s.itemCount)),
        h('td', {}, link(`/org/${orgId}/scopes/${s.id}/items${s.assignedToMe ? '?show=mine' : ''}`, itemsSummary(s))),
        h('td', {}, fmtDate(s.updatedAt)),
        h('td', {}, canEdit ? h('div', { class: 'row' },
          carryLink(s),
          s.readOnly ? null : h('button', { type: 'button', class: 'btn small ghost', onclick: () => rename(s) }, t('common.edit')),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => duplicate(s) }, t('scopes.duplicate')),
          h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => remove(s) }, t('common.delete'))) : null))))))
    : h('div', { class: 'card' }, h('p', { class: 'empty' }, t('scopes.empty')), canEdit ? link(`/org/${orgId}`, t('scopes.createFirst'), { class: 'btn' }) : null);

  return h('div', {},
    pageHead(t('scopes.title'), t('scopes.sub', { used: scopes.length, limit: limit === null ? '∞' : limit }),
      scopes.length >= 2 ? link(`/org/${orgId}/scopes/compare`, t('compare.action'), { class: 'btn ghost' }) : null),
    body);
}
