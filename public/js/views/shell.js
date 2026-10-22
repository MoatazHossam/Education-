import { get, patch, post } from '../api.js';
import { append, clear, dialog, errorMessage, fmtDate, h, link, toast } from '../dom.js';
import { locale, setLocale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, loadSession, orgInfo, session } from '../state.js';

function navLink(href, label) {
  const current = location.pathname === href;
  return link(href, label, current ? { 'aria-current': 'page' } : {});
}

async function toggleLocale(rerender) {
  const next = locale() === 'ar' ? 'en' : 'ar';
  setLocale(next);
  if (session.me) {
    try { await patch('/api/auth/profile', { locale: next }); session.me.user.locale = next; } catch { /* preference stays local */ }
  }
  rerender();
}

async function showNotifications(btn) {
  const { notifications } = await get('/api/notifications');
  const list = notifications.length
    ? h('ul', { class: 'notif-list' }, notifications.map((n) => h('li', { class: n.readAt ? '' : 'unread' },
      h('b', {}, n.title), h('div', { class: 'muted' }, n.body), h('div', { class: 'mono muted' }, fmtDate(n.createdAt, true)),
      n.link ? link(n.link, t('notifications.open')) : null)))
    : h('p', { class: 'muted' }, t('notifications.empty'));
  if (notifications.some((n) => !n.readAt)) {
    await post('/api/notifications/read', {});
    session.me.unreadNotifications = 0;
    btn.querySelector('.badge')?.remove();
  }
  await dialog({ title: t('notifications.title'), body: list, actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
}

function banner(info, orgId) {
  const p = info.plan;
  if (p.state === 'trialing' && p.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(p.trialEndsAt) - Date.now()) / 86_400_000));
    return h('div', { class: 'banner', role: 'note' }, h('div', { class: 'in' },
      h('span', {}, h('b', {}, t('banner.trial', { plan: p.name })), ' ', t('banner.trialDays', { days })),
      can(info.role, 'owner') ? link(`/org/${orgId}/billing`, t('banner.choosePlan')) : null));
  }
  if (p.state === 'past_due') {
    return h('div', { class: 'banner danger', role: 'alert' }, h('div', { class: 'in' },
      h('span', {}, h('b', {}, t('banner.pastDue')), ' ', t('banner.pastDueText')),
      can(info.role, 'owner') ? link(`/org/${orgId}/billing`, t('banner.payNow')) : null));
  }
  return null;
}

/** Renders the signed-in layout around an org or account/admin view. */
export async function renderShell(root, ctx, handler, isCurrent) {
  const me = session.me;
  const orgId = handler.org ? ctx.params.orgId : null;
  let info = null;
  let orgError = null;
  if (orgId) {
    try { info = await orgInfo(orgId); } catch (err) { orgError = err; }
  }
  if (!isCurrent()) return;

  const rerender = () => ctx.render();
  const orgSelect = me.organizations.length
    ? h('select', {
      'aria-label': t('shell.switchOrg'),
      onchange: (e) => {
        if (e.target.value === '__new') return navigate('/account?new-org=1');
        navigate(`/org/${e.target.value}`);
      },
    },
    me.organizations.map((o) => h('option', { value: o.id, selected: o.id === orgId ? 'selected' : null }, o.name)),
    !orgId ? h('option', { value: '', selected: 'selected', disabled: true }, t('shell.chooseOrg')) : null,
    h('option', { value: '__new' }, t('shell.newOrg')))
    : null;

  const notifBtn = h('button', { type: 'button', class: 'iconbtn', 'aria-label': t('notifications.title') }, '🔔', me.unreadNotifications ? h('span', { class: 'badge' }, String(me.unreadNotifications)) : null);
  notifBtn.addEventListener('click', () => showNotifications(notifBtn).catch((e) => toast(errorMessage(e), 'error')));

  const role = info?.role;
  const nav = h('nav', { class: 'nav', 'aria-label': t('shell.nav') },
    orgId && info ? [
      navLink(`/org/${orgId}`, t('nav.picker')),
      navLink(`/org/${orgId}/scopes`, t('nav.scopes')),
      navLink(`/org/${orgId}/members`, t('nav.members')),
      can(role, 'admin') ? navLink(`/org/${orgId}/billing`, t('nav.billing')) : null,
      can(role, 'admin') ? navLink(`/org/${orgId}/settings`, t('nav.settings')) : null,
      can(role, 'admin') ? navLink(`/org/${orgId}/audit`, t('nav.audit')) : null,
    ] : null,
    me.user.isPlatformAdmin ? [
      navLink('/admin', t('nav.admin')),
      location.pathname.startsWith('/admin') ? [navLink('/admin/orgs', t('admin.orgs')), navLink('/admin/users', t('admin.users')), navLink('/admin/catalog', t('admin.catalog')), navLink('/admin/plans', t('admin.plans')), navLink('/admin/audit', t('admin.audit')), navLink('/admin/events', t('admin.events'))] : null,
    ] : null,
  );

  const top = h('header', { class: 'topbar' }, h('div', { class: 'in' },
    h('a', { class: 'brand', href: '/', 'data-link': '' }, t('app.name'), h('small', {}, t('app.tagline'))),
    nav,
    h('div', { class: 'tools' },
      orgSelect,
      notifBtn,
      h('button', { type: 'button', class: 'iconbtn', onclick: () => toggleLocale(rerender), lang: locale() === 'ar' ? 'en' : 'ar' }, locale() === 'ar' ? 'English' : 'العربية'),
      link('/account', me.user.name, { class: 'iconbtn' }),
      h('button', {
        type: 'button', class: 'iconbtn', onclick: async () => {
          await post('/api/auth/logout').catch(() => {});
          await loadSession();
          navigate('/login');
        },
      }, t('shell.logout')),
    )));

  const main = h('main', { id: 'main', class: handler.view.wide ? '' : 'wrap' });
  append(clear(root), [top, info ? banner(info, orgId) : null, main]);
  document.documentElement.style.setProperty('--topbar-h', `${top.offsetHeight}px`);

  if (orgError) {
    const suspended = orgError.code === 'ORG_SUSPENDED';
    const mfa = orgError.code === 'MFA_REQUIRED_BY_ORG';
    main.className = 'wrap';
    main.append(h('div', { class: 'page-head' }, h('h1', {}, suspended ? t('org.suspendedTitle') : mfa ? t('org.mfaRequiredTitle') : t('notfound.title')),
      h('p', {}, mfa ? [t('org.mfaRequiredText'), ' ', link('/account', t('account.security'))] : errorMessage(orgError))));
    return;
  }
  try {
    const content = await handler.view({ ...ctx, info, main });
    if (content && isCurrent()) main.append(content);
  } catch (err) {
    if (!isCurrent()) return;
    main.className = 'wrap';
    main.append(h('div', { class: 'alert error', role: 'alert' }, errorMessage(err)));
  }
}

export function pageHead(title, sub, ...extra) {
  return h('div', { class: 'page-head' }, h('h1', {}, title), sub ? h('p', {}, sub) : null, extra);
}

export function planLimitHint(err, orgId, role) {
  if (err?.code !== 'PLAN_LIMIT_REACHED' && err?.code !== 'FEATURE_NOT_IN_PLAN') return null;
  return can(role, 'owner') ? link(`/org/${orgId}/billing`, t('billing.upgrade')) : h('span', { class: 'muted' }, t('billing.askOwner'));
}
