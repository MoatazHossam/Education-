import { del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, form, h, promptDialog, tableCard, toast } from '../dom.js';
import { setLocale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { loadSession, session } from '../state.js';
import { pageHead } from './shell.js';

function recoveryCodesDialog(codes) {
  return dialog({
    title: t('mfa.recoveryTitle'),
    body: h('div', {}, h('p', {}, t('mfa.recoveryText')), h('div', { class: 'codes', tabindex: '0' }, codes.map((c) => h('div', {}, c)))),
    actions: [{ label: t('mfa.savedCodes'), value: true }],
  });
}

export async function accountView(ctx) {
  const me = session.me;
  const user = me.user;
  const refresh = async () => { await loadSession(); ctx.render(); };

  const profile = form({
    fields: [
      { name: 'name', label: t('auth.name'), value: user.name, required: true },
      { name: 'locale', label: t('account.language'), type: 'select', value: user.locale, options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }] },
      { name: 'catalogEmails', label: t('account.catalogEmails'), type: 'checkbox', value: user.catalogEmails },
      { name: 'assignmentEmails', label: t('account.assignmentEmails'), type: 'checkbox', value: user.assignmentEmails },
      { name: 'dueReminderEmails', label: t('account.dueReminderEmails'), type: 'checkbox', value: user.dueReminderEmails },
    ],
    submitLabel: t('common.save'),
    onSubmit: async (v) => { await patch('/api/auth/profile', v); setLocale(v.locale); toast(t('common.saved')); await refresh(); },
  });

  const pw = form({
    fields: [
      { name: 'currentPassword', label: t('account.currentPassword'), type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'newPassword', label: t('auth.newPassword'), type: 'password', required: true, autocomplete: 'new-password', minlength: 10, hint: t('auth.passwordHint') },
    ],
    submitLabel: t('account.changePassword'),
    onSubmit: async (v) => { await post('/api/auth/password/change', v); toast(t('account.passwordChanged')); pw.el.reset(); },
  });

  // Two-factor
  const mfaBox = h('div', {});
  const drawMfa = () => {
    if (user.mfaEnabled) {
      const regen = form({
        fields: [{ name: 'code', label: t('mfa.code'), required: true, inputmode: 'numeric', autocomplete: 'one-time-code' }],
        submitLabel: t('mfa.newCodes'),
        onSubmit: async (v) => { const r = await post('/api/auth/mfa/recovery-codes', v); await recoveryCodesDialog(r.recoveryCodes); regen.el.reset(); },
      });
      const disable = user.isPlatformAdmin ? h('p', { class: 'muted' }, t('mfa.adminRequired')) : form({
        fields: [
          { name: 'password', label: t('auth.password'), type: 'password', required: true, autocomplete: 'current-password' },
          { name: 'code', label: t('mfa.code'), required: true, inputmode: 'numeric', autocomplete: 'one-time-code' },
        ],
        submitLabel: t('mfa.disable'),
        onSubmit: async (v) => { await post('/api/auth/mfa/disable', v); toast(t('mfa.disabled')); await refresh(); },
      }).el;
      mfaBox.replaceChildren(h('p', {}, h('span', { class: 'pill ok' }, t('mfa.on'))), h('h3', {}, t('mfa.newCodes')), regen.el, h('h3', {}, t('mfa.disable')), disable);
    } else {
      mfaBox.replaceChildren(h('p', {}, t('mfa.offText')), h('button', {
        type: 'button', class: 'btn', onclick: async () => {
          try {
            const setup = await post('/api/auth/mfa/setup');
            const img = h('img', { alt: t('mfa.qrAlt'), width: '192', height: '192', src: `data:image/svg+xml;base64,${btoa(setup.qrSvg)}` });
            const f = form({
              fields: [{ name: 'code', label: t('mfa.code'), required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 }],
              submitLabel: t('mfa.enable'),
              onSubmit: async (v) => {
                const r = await post('/api/auth/mfa/enable', v);
                await recoveryCodesDialog(r.recoveryCodes);
                await refresh();
              },
            });
            mfaBox.replaceChildren(h('ol', {}, h('li', {}, t('mfa.step1')), h('li', {}, t('mfa.step2')), h('li', {}, t('mfa.step3'))),
              h('div', { class: 'qr' }, img), h('p', { class: 'mono' }, t('mfa.manualKey'), ' ', setup.secret.match(/.{1,4}/g).join(' ')), f.el);
          } catch (e) { toast(errorMessage(e), 'error'); }
        },
      }, t('mfa.setup')));
    }
  };
  drawMfa();

  const { sessions } = await get('/api/auth/sessions');
  const sessionsCard = tableCard(t('account.sessions'), h('h2', {}, t('account.sessions')),
    h('table', { class: 'data' }, h('tbody', {}, sessions.map((s) => h('tr', {},
      h('td', {}, s.userAgent ? s.userAgent.slice(0, 80) : '—', h('div', { class: 'muted mono' }, s.ip || '')),
      h('td', {}, t('account.lastActive'), ' ', fmtDate(s.lastSeenAt, true)),
      h('td', {}, s.current ? h('span', { class: 'pill ok' }, t('account.thisDevice')) : h('button', { type: 'button', class: 'btn small danger ghost', onclick: async () => { await del(`/api/auth/sessions/${s.id}`); ctx.render(); } }, t('account.signOut'))))))),
    sessions.length > 1 ? h('button', {
      type: 'button', class: 'btn ghost', onclick: async () => {
        if (await confirmDialog(t('account.signOutOthers'), t('account.signOutOthersText'))) { await post('/api/auth/logout-others'); ctx.render(); }
      },
    }, t('account.signOutOthers')) : null);

  const newOrg = form({
    fields: [{ name: 'name', label: t('auth.orgName'), required: true, maxlength: 120 }],
    submitLabel: t('account.createOrg'),
    onSubmit: async (v) => {
      const r = await post('/api/orgs', v);
      await loadSession();
      navigate(`/org/${r.organization.id}`);
    },
  });
  const orgCard = h('div', { class: 'card', id: 'new-org' }, h('h2', {}, t('account.organizations')),
    me.organizations.length ? h('ul', {}, me.organizations.map((o) => h('li', {}, h('a', { href: `/org/${o.id}`, 'data-link': '' }, o.name), ' — ', t(`role.${o.role}`)))) : h('p', { class: 'muted' }, t('account.noOrgs')),
    h('h3', {}, t('shell.newOrg')), newOrg.el);
  if (ctx.query.get('new-org')) queueMicrotask(() => orgCard.scrollIntoView({ block: 'start' }));

  const privacyCard = h('div', { class: 'card' }, h('h2', {}, t('account.privacy')),
    h('p', { class: 'muted' }, t('account.exportText')),
    h('a', { class: 'btn ghost', href: '/api/auth/account/export', download: 'my-data.json' }, t('account.export')),
    h('h3', {}, t('account.delete')), h('p', { class: 'muted' }, t('account.deleteText')),
    user.isPlatformAdmin ? null : h('button', {
      type: 'button', class: 'btn danger ghost', onclick: async () => {
        const pwd = await promptDialog(t('account.delete'), t('auth.password'), { type: 'password', danger: true, confirmLabel: t('account.delete') });
        if (!pwd) return;
        try { await del('/api/auth/account', { password: pwd }); await loadSession(); navigate('/login'); } catch (e) { toast(errorMessage(e), 'error'); }
      },
    }, t('account.delete')));

  return h('div', {},
    pageHead(t('account.title'), user.email),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, t('account.profile')), profile.el),
      h('div', { class: 'card' }, h('h2', {}, t('account.password')), pw.el)),
    h('div', { class: 'card', id: 'security' }, h('h2', {}, t('account.security')), mfaBox),
    sessionsCard,
    orgCard,
    privacyCard);
}
