import { del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, form, h, tableCard, toast } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg, loadSession } from '../state.js';
import { pageHead, planLimitHint } from './shell.js';

export async function settingsView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const isOwner = can(info.role, 'owner');
  const org = info.organization;
  const refresh = () => { invalidateOrg(orgId); ctx.render(); };

  const profile = form({
    fields: [
      { name: 'name', label: t('settings.orgName'), value: org.name, required: true, maxlength: 120 },
      { name: 'locale', label: t('settings.orgLocale'), type: 'select', value: org.locale, options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }], hint: t('settings.orgLocaleHint') },
      ...(isOwner ? [{ name: 'requireMfaForAdmins', label: t('settings.requireMfa'), type: 'checkbox', value: org.requireMfaForAdmins }] : []),
    ],
    submitLabel: t('common.save'),
    onSubmit: async (v) => {
      await patch(`/api/orgs/${orgId}`, v);
      await loadSession();
      toast(t('common.saved'));
      refresh();
    },
  });

  // API keys
  const keysCard = h('div', { class: 'card' }, h('h2', {}, t('apikeys.title')), h('p', { class: 'muted' }, t('apikeys.sub')));
  if (!info.plan.features.api_access) {
    keysCard.append(h('p', {}, t('apikeys.notInPlan'), ' ', planLimitHint({ code: 'FEATURE_NOT_IN_PLAN' }, orgId, info.role)));
  } else {
    const { apiKeys } = await get(`/api/orgs/${orgId}/api-keys`);
    const f = form({
      fields: [{ name: 'name', label: t('apikeys.name'), required: true, maxlength: 80, placeholder: 'Content pipeline' }],
      submitLabel: t('apikeys.create'),
      onSubmit: async (v) => {
        const r = await post(`/api/orgs/${orgId}/api-keys`, v);
        await dialog({
          title: t('apikeys.created'),
          body: h('div', { class: 'stack' }, h('p', {}, t('apikeys.copyNow')), h('pre', { class: 'codes', tabindex: '0' }, r.key), h('p', { class: 'muted mono' }, `curl -H "Authorization: Bearer ${r.key.slice(0, 14)}…" ${location.origin}/api/v1/scopes`)),
          actions: [{ label: t('common.done'), value: true }],
        });
        refresh();
      },
    });
    keysCard.append(apiKeys.length ? h('table', { class: 'data' }, h('tbody', {}, apiKeys.map((k) => h('tr', {},
      h('td', {}, h('b', {}, k.name), h('div', { class: 'mono muted' }, `${k.prefix}…`)),
      h('td', {}, t('apikeys.lastUsed'), ' ', fmtDate(k.lastUsedAt, true)),
      h('td', {}, k.revokedAt ? h('span', { class: 'pill' }, t('apikeys.revoked')) : h('button', {
        type: 'button', class: 'btn small danger ghost', onclick: async () => {
          if (await confirmDialog(t('apikeys.revokeTitle'), t('apikeys.revokeText', { name: k.name }), { danger: true, confirmLabel: t('members.revoke') })) {
            try { await del(`/api/orgs/${orgId}/api-keys/${k.id}`); refresh(); } catch (e) { toast(errorMessage(e), 'error'); }
          }
        },
      }, t('members.revoke'))))))) : h('p', { class: 'muted' }, t('apikeys.none')), f.el);
  }

  // Support access (owner)
  let supportCard = null;
  if (isOwner) {
    const { grants } = await get(`/api/orgs/${orgId}/support-access`);
    const f = form({
      fields: [
        { name: 'reason', label: t('support.reason'), required: true, maxlength: 500, placeholder: t('support.reasonPlaceholder') },
        { name: 'hours', label: t('support.hours'), type: 'select', value: '24', options: [1, 4, 24, 72].map((n) => ({ value: String(n), label: t('support.hoursN', { n }) })) },
      ],
      submitLabel: t('support.grant'),
      onSubmit: async (v) => { await post(`/api/orgs/${orgId}/support-access`, { reason: v.reason, hours: Number(v.hours) }); toast(t('support.granted')); refresh(); },
    });
    supportCard = h('div', { class: 'card' }, h('h2', {}, t('support.title')), h('p', { class: 'muted' }, t('support.sub')),
      grants.length ? h('table', { class: 'data' }, h('tbody', {}, grants.map((g) => h('tr', {},
        h('td', {}, g.reason, h('div', { class: 'muted' }, `${g.grantedBy || ''} · ${fmtDate(g.createdAt, true)}`)),
        h('td', {}, g.active ? h('span', { class: 'pill ok' }, `${t('support.until')} ${fmtDate(g.expiresAt, true)}`) : h('span', { class: 'pill' }, t('support.inactive'))),
        h('td', {}, g.active ? h('button', { type: 'button', class: 'btn small danger ghost', onclick: async () => { await del(`/api/orgs/${orgId}/support-access/${g.id}`); refresh(); } }, t('members.revoke')) : null))))) : null,
      f.el);
  }

  const dangerCard = isOwner ? h('div', { class: 'card' }, h('h2', {}, t('settings.dangerZone')), h('p', { class: 'muted' }, t('settings.deleteOrgText')),
    h('button', {
      type: 'button', class: 'btn danger ghost', onclick: async () => {
        const name = h('input', { type: 'text', autocomplete: 'off' });
        const password = h('input', { type: 'password', autocomplete: 'current-password' });
        const err = h('div', { class: 'alert error', hidden: true });
        const ok = await dialog({
          title: t('settings.deleteOrg'),
          body: h('div', { class: 'stack' }, err, h('p', {}, t('settings.deleteOrgConfirm', { name: org.name })),
            h('label', { class: 'field' }, t('settings.typeName'), name), h('label', { class: 'field' }, t('auth.password'), password)),
          actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, {
            label: t('settings.deleteOrg'), value: true, kind: 'danger', validate: async () => {
              try { await del(`/api/orgs/${orgId}`, { password: password.value, confirmName: name.value }); return true; } catch (e) { err.textContent = errorMessage(e); err.hidden = false; return false; }
            },
          }],
        });
        if (ok) { await loadSession(); navigate('/'); }
      },
    }, t('settings.deleteOrg'))) : null;

  return h('div', {},
    pageHead(t('settings.title'), null),
    h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h2', {}, t('settings.profile')), profile.el), keysCard),
    supportCard, dangerCard);
}

export async function auditView(ctx) {
  const { orgId } = ctx.params;
  const filter = ctx.query.get('action') || '';
  const before = ctx.query.get('before');
  const data = await get(`/api/orgs/${orgId}/audit-logs?limit=50${filter ? `&action=${encodeURIComponent(filter)}` : ''}${before ? `&before=${before}` : ''}`);
  const input = h('input', { type: 'search', value: filter, placeholder: 'scope., member., billing.', 'aria-label': t('audit.filter') });
  const go = (b) => {
    const q = new URLSearchParams();
    if (input.value) q.set('action', input.value);
    if (b) q.set('before', b);
    history.pushState(null, '', `/org/${orgId}/audit?${q}`);
    ctx.render();
  };
  return h('div', {},
    pageHead(t('audit.title'), t('audit.sub', { days: data.retentionDays })),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); go(null); } }, input, h('button', { class: 'btn small', type: 'submit' }, t('audit.apply'))),
    auditTable(data.entries),
    data.nextBefore ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(data.nextBefore) }, t('audit.older')) : null);
}

export function auditTable(entries, { showOrg = false } = {}) {
  if (!entries.length) return h('div', { class: 'card' }, h('p', { class: 'empty' }, t('audit.empty')));
  return tableCard(t('nav.audit'), h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, [t('audit.when'), t('audit.actor'), t('audit.action'), t('audit.target'), showOrg ? 'Org' : null, t('audit.details')].filter(Boolean).map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, entries.map((e) => h('tr', {},
      h('td', {}, fmtDate(e.createdAt, true)),
      h('td', {}, e.actor || e.actorType, h('div', { class: 'muted mono' }, e.actorType)),
      h('td', { class: 'mono' }, e.action),
      h('td', { class: 'mono' }, e.targetType ? `${e.targetType}:${String(e.targetId || '').slice(0, 8)}` : '—'),
      showOrg ? h('td', { class: 'mono' }, e.orgId ? String(e.orgId).slice(0, 8) : '—') : null,
      h('td', { class: 'mono' }, Object.keys(e.metadata || {}).length ? JSON.stringify(e.metadata) : '', e.ip ? h('div', { class: 'muted' }, e.ip) : null))))));
}
