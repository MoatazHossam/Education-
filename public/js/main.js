import { setUnauthorizedHandler } from './api.js';
import { clear, h, link } from './dom.js';
import { initLocale, t } from './i18n.js';
import { match, navigate, route, startRouter } from './router.js';
import { loadSession, session } from './state.js';
import * as auth from './views/auth.js';
import * as account from './views/account.js';
import * as admin from './views/admin.js';
import * as billing from './views/billing.js';
import * as members from './views/members.js';
import * as picker from './views/picker.js';
import * as scopes from './views/scopes.js';
import * as settings from './views/settings.js';
import { renderShell } from './views/shell.js';

// access: guest (signed-out only), public, user (signed in), admin (platform admin)
route('/', { access: 'user', view: async () => {
  const first = session.me.organizations[0];
  navigate(first ? `/org/${first.id}` : '/account?new-org=1', { replace: true });
  return null;
} });
route('/login', { access: 'guest', bare: true, view: auth.loginView });
route('/register', { access: 'guest', bare: true, view: auth.registerView });
route('/verify-email', { access: 'public', bare: true, view: auth.verifyEmailView });
route('/forgot-password', { access: 'public', bare: true, view: auth.forgotView });
route('/reset-password', { access: 'public', bare: true, view: auth.resetView });
route('/invite', { access: 'public', bare: true, view: auth.inviteView });
route('/mfa', { access: 'public', bare: true, view: auth.mfaView });
route('/pricing', { access: 'public', bare: true, view: billing.pricingView });
route('/billing/sandbox-checkout', { access: 'public', bare: true, view: billing.sandboxCheckoutView });
route('/account', { access: 'user', view: account.accountView });
route('/org/:orgId', { access: 'user', org: true, view: picker.pickerView });
route('/org/:orgId/scopes', { access: 'user', org: true, view: scopes.scopesView });
route('/org/:orgId/members', { access: 'user', org: true, view: members.membersView });
route('/org/:orgId/billing', { access: 'user', org: true, view: billing.billingView });
route('/org/:orgId/settings', { access: 'user', org: true, view: settings.settingsView });
route('/org/:orgId/audit', { access: 'user', org: true, view: settings.auditView });
route('/admin', { access: 'admin', view: admin.overviewView });
route('/admin/orgs', { access: 'admin', view: admin.orgsView });
route('/admin/orgs/:orgId', { access: 'admin', view: admin.orgDetailView });
route('/admin/users', { access: 'admin', view: admin.usersView });
route('/admin/catalog', { access: 'admin', view: admin.catalogView });
route('/admin/catalog/:versionId', { access: 'admin', view: admin.catalogVersionView });
route('/admin/plans', { access: 'admin', view: admin.plansView });
route('/admin/audit', { access: 'admin', view: admin.auditView });
route('/admin/events', { access: 'admin', view: admin.eventsView });

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById('app');
  const m = match(location.pathname);
  const query = new URLSearchParams(location.search);
  if (!m) {
    clear(root).append(h('main', { id: 'main', class: 'wrap' }, h('div', { class: 'page-head' }, h('h1', {}, t('notfound.title')), h('p', {}, link('/', t('notfound.home'))))));
    return;
  }
  const { handler, params } = m;
  if (handler.access === 'guest' && session.me) {
    const next = query.get('next');
    return navigate(next && /^\/(?![/\\])/.test(next) ? next : '/', { replace: true });
  }
  if ((handler.access === 'user' || handler.access === 'admin') && !session.me) {
    return navigate(session.mfaPending ? '/mfa' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }
  if (handler.access === 'admin' && !session.me.user.isPlatformAdmin) return navigate('/', { replace: true });

  const ctx = { params, query, render };
  if (handler.bare) {
    const node = await handler.view(ctx);
    if (seq !== renderSeq || !node) return;
    clear(root).append(node);
  } else {
    await renderShell(root, ctx, handler, () => seq === renderSeq);
  }
  document.getElementById('main')?.querySelector('h1')?.setAttribute('tabindex', '-1');
  if (seq === renderSeq) document.getElementById('main')?.querySelector('h1')?.focus({ preventScroll: true });
}

setUnauthorizedHandler(() => {
  if (session.me) {
    session.me = null;
    navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
  }
});

initLocale();
await loadSession();
initLocale(session.me?.user?.locale);
startRouter(render);
