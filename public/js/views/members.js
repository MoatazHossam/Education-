import { del, get, patch, post } from '../api.js';
import { confirmDialog, errorMessage, fmtDate, form, h, promptDialog, tableCard, th, toast } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg, loadSession, session } from '../state.js';
import { pageHead, planLimitHint } from './shell.js';

export async function membersView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const myRole = info.role;
  const meId = session.me.user.id;
  const isAdmin = can(myRole, 'admin');
  const [{ members }, invites] = await Promise.all([
    get(`/api/orgs/${orgId}/members`),
    isAdmin ? get(`/api/orgs/${orgId}/invitations`) : Promise.resolve({ invitations: [] }),
  ]);
  const refresh = () => { invalidateOrg(orgId); ctx.render(); };
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); refresh(); } catch (err) { toast(errorMessage(err), 'error'); } };

  const canManage = (m) => m.role !== 'owner' && m.userId !== meId && (myRole === 'owner' || (myRole === 'admin' && m.role !== 'admin'));
  const roleOptions = myRole === 'owner' ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];

  const rows = members.map((m) => h('tr', {},
    h('td', {}, h('b', {}, m.name), m.userId === meId ? h('span', { class: 'muted' }, ` (${t('members.you')})`) : null, h('div', { class: 'muted' }, m.email)),
    h('td', {}, canManage(m)
      ? h('select', { 'aria-label': t('members.roleFor', { name: m.name }), onchange: (e) => act(() => patch(`/api/orgs/${orgId}/members/${m.userId}`, { role: e.target.value }), t('members.roleChanged')) },
        roleOptions.map((r) => h('option', { value: r, selected: r === m.role ? 'selected' : null }, t(`role.${r}`))))
      : h('span', { class: 'pill' }, t(`role.${m.role}`))),
    h('td', {}, m.mfaEnabled ? h('span', { class: 'pill ok' }, t('members.mfaOn')) : h('span', { class: 'pill' }, t('members.mfaOff'))),
    h('td', {}, fmtDate(m.joinedAt)),
    h('td', {}, h('div', { class: 'row' },
      canManage(m) ? h('button', {
        type: 'button', class: 'btn small danger ghost', onclick: async () => {
          if (await confirmDialog(t('members.removeTitle'), t('members.removeText', { name: m.name }), { danger: true, confirmLabel: t('members.remove') })) {
            await act(() => del(`/api/orgs/${orgId}/members/${m.userId}`));
          }
        },
      }, t('members.remove')) : null,
      m.userId === meId && m.role !== 'owner' ? h('button', {
        type: 'button', class: 'btn small danger ghost', onclick: async () => {
          if (await confirmDialog(t('members.leaveTitle'), t('members.leaveText', { org: info.organization.name }), { danger: true, confirmLabel: t('members.leave') })) {
            try { await del(`/api/orgs/${orgId}/members/${meId}`); await loadSession(); navigate('/'); } catch (err) { toast(errorMessage(err), 'error'); }
          }
        },
      }, t('members.leave')) : null,
      myRole === 'owner' && m.role !== 'owner' ? h('button', {
        type: 'button', class: 'btn small ghost', onclick: async () => {
          const pw = await promptDialog(t('members.transferTitle'), t('members.transferText', { name: m.name }), { type: 'password', danger: true, confirmLabel: t('members.transfer') });
          if (pw) await act(() => post(`/api/orgs/${orgId}/transfer-ownership`, { userId: m.userId, password: pw }), t('members.transferred'));
        },
      }, t('members.makeOwner')) : null))));

  const inviteCard = isAdmin ? (() => {
    const err = h('div', {});
    const f = form({
      fields: [
        { name: 'email', label: t('auth.email'), type: 'email', required: true },
        { name: 'role', label: t('members.role'), type: 'select', value: 'editor', options: roleOptions.map((r) => ({ value: r, label: t(`role.${r}`) })) },
      ],
      submitLabel: t('members.invite'),
      onSubmit: async (v) => {
        try {
          await post(`/api/orgs/${orgId}/invitations`, v);
          toast(t('members.invited', { email: v.email }));
          refresh();
        } catch (e) {
          err.replaceChildren(planLimitHint(e, orgId, myRole) || '');
          throw e;
        }
      },
    });
    return h('div', { class: 'card' }, h('h2', {}, t('members.inviteTitle')),
      h('p', { class: 'muted' }, t('members.seats', { used: info.usage.members + info.usage.pendingInvites, max: info.plan.limits.max_members ?? '∞' })),
      f.el, err);
  })() : null;

  const pending = invites.invitations.length ? tableCard(t('members.pending'), h('h2', {}, t('members.pending')),
    h('table', { class: 'data' }, h('tbody', {}, invites.invitations.map((i) => h('tr', {},
      h('td', {}, i.email), h('td', {}, t(`role.${i.role}`)),
      h('td', {}, i.expired ? h('span', { class: 'pill bad' }, t('members.expired')) : `${t('members.expires')} ${fmtDate(i.expiresAt)}`),
      h('td', {}, h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => act(() => post(`/api/orgs/${orgId}/invitations/${i.id}/resend`), t('members.resent')) }, t('members.resend')),
        h('button', { type: 'button', class: 'btn small danger ghost', onclick: () => act(() => del(`/api/orgs/${orgId}/invitations/${i.id}`)) }, t('members.revoke')))))))))
    : null;

  return h('div', {},
    pageHead(t('members.title'), t('members.sub')),
    tableCard(t('nav.members'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('members.member'), t('members.role'), t('members.mfa'), t('members.joined'), ''].map(th))),
      h('tbody', {}, rows))),
    inviteCard, pending,
    h('div', { class: 'card' }, h('h2', {}, t('members.rolesTitle')), h('ul', {}, ['owner', 'admin', 'editor', 'viewer'].map((r) => h('li', {}, h('b', {}, t(`role.${r}`)), ' — ', t(`role.${r}.desc`))))));
}
