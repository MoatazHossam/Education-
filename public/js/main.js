import { setUnauthorizedHandler } from './api.js';
import { clear, h, link } from './dom.js';
import { initLocale, t } from './i18n.js';
import { match, navigate, route, startRouter } from './router.js';
import { loadSession, session } from './state.js';
import * as auth from './views/auth.js';
import * as account from './views/account.js';
import * as admin from './views/admin.js';
import * as billing from './views/billing.js';
import * as carry from './views/carry.js';
import * as compare from './views/compare.js';
import * as items from './views/items.js';
import * as assignments from './views/assignments.js';
import * as members from './views/members.js';
import * as picker from './views/picker.js';
import * as scopes from './views/scopes.js';
import * as settings from './views/settings.js';
import * as student from './views/student.js';
import * as students from './views/students.js';
import { renderShell } from './views/shell.js';

// access: guest (signed-out only), public, user (signed-in staff), admin (platform admin), student (student account)
route('/', { access: 'user', view: async () => {
  const first = session.me.organizations[0];
  navigate(first ? `/org/${first.id}` : '/account?new-org=1', { replace: true });
  return null;
} });
route('/login', { access: 'guest', bare: true, view: auth.loginView });
route('/student-login', { access: 'guest', bare: true, view: auth.studentLoginView });
route('/student', { access: 'student', bare: true, view: student.portalView });
route('/register', { access: 'guest', bare: true, view: auth.registerView });
route('/verify-email', { access: 'public', bare: true, view: auth.verifyEmailView });
route('/forgot-password', { access: 'public', bare: true, view: auth.forgotView });
route('/reset-password', { access: 'public', bare: true, view: auth.resetView });
route('/invite', { access: 'public', bare: true, view: auth.inviteView });
route('/mfa', { access: 'public', bare: true, view: auth.mfaView });
route('/pricing', { access: 'public', bare: true, view: billing.pricingView });
route('/billing/sandbox-checkout', { access: 'public', bare: true, view: billing.sandboxCheckoutView });
route('/account', { access: 'user', view: account.accountView });
route('/assignments', { access: 'user', view: assignments.allAssignmentsView });
route('/org/:orgId', { access: 'user', org: true, view: picker.pickerView });
route('/org/:orgId/scopes', { access: 'user', org: true, view: scopes.scopesView });
route('/org/:orgId/scopes/:scopeId/carry', { access: 'user', org: true, view: carry.carryView });
route('/org/:orgId/scopes/compare', { access: 'user', org: true, view: compare.compareView });
route('/org/:orgId/scopes/:scopeId/items', { access: 'user', org: true, view: items.itemsView });
route('/org/:orgId/assignments', { access: 'user', org: true, view: assignments.assignmentsView });
route('/org/:orgId/members', { access: 'user', org: true, view: members.membersView });
route('/org/:orgId/students', { access: 'user', org: true, view: students.studentsView });
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
    announcePage();
    return;
  }
  const { handler, params } = m;
  if (handler.access === 'guest' && session.me) {
    const next = query.get('next');
    return navigate(next && /^\/(?![/\\])/.test(next) ? next : '/', { replace: true });
  }
  if (handler.access === 'student' && !session.me) return navigate('/student-login', { replace: true });
  if ((handler.access === 'user' || handler.access === 'admin') && !session.me) {
    return navigate(session.mfaPending ? '/mfa' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }
  // A student account only has the student portal; staff accounts never see it.
  const isStudent = session.me?.user?.kind === 'student';
  if (isStudent && (handler.access === 'user' || handler.access === 'admin')) return navigate('/student', { replace: true });
  if (handler.access === 'student' && !isStudent) return navigate('/', { replace: true });
  if (handler.access === 'admin' && !session.me.user.isPlatformAdmin) return navigate('/', { replace: true });

  const ctx = { params, query, render };
  if (handler.bare) {
    const node = await handler.view(ctx);
    if (seq !== renderSeq || !node) return;
    clear(root).append(node);
  } else {
    await renderShell(root, ctx, handler, () => seq === renderSeq);
  }
  if (seq === renderSeq) announcePage();
}

/** Moves focus to the page heading and titles the page after it; screen readers announce both. */
function announcePage() {
  const heading = document.getElementById('main')?.querySelector('h1');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
  const name = heading?.textContent.trim();
  document.title = name ? `${name} · ${t('app.name')}` : t('app.name');
}

setUnauthorizedHandler(() => {
  if (session.me) {
    const wasStudent = session.me.user?.kind === 'student';
    session.me = null;
    navigate(wasStudent ? '/student-login' : `/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
  }
});

// The skip link moves focus to the page heading. Following "#main" as a link would
// fire popstate, which re-renders the page.
document.getElementById('skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  const main = document.getElementById('main');
  const target = main?.querySelector('h1') ?? main;
  target?.setAttribute('tabindex', '-1');
  target?.focus();
});

initLocale();
await loadSession();
initLocale(session.me?.user?.locale);
startRouter(render);
