import { get, post, setCsrf } from '../api.js';
import { errorMessage, form, h, link } from '../dom.js';
import { locale, setLocale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { loadSession, session } from '../state.js';

function langToggle(ctx) {
  return h('button', { type: 'button', class: 'iconbtn auth-lang', onclick: () => { setLocale(locale() === 'ar' ? 'en' : 'ar'); ctx.render(); } }, locale() === 'ar' ? 'English' : 'العربية');
}

function page(ctx, title, sub, ...content) {
  return h('main', { id: 'main', class: 'auth-page' }, langToggle(ctx),
    h('div', { class: 'auth-card' },
      h('div', { class: 'eyebrow' }, t('app.name')),
      h('h1', {}, title),
      sub ? h('p', { class: 'sub' }, sub) : null,
      content));
}

async function afterLogin(ctx, next) {
  await loadSession();
  if (session.mfaPending) return navigate(`/mfa${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (session.me?.user?.locale) setLocale(session.me.user.locale);
  // Only same-origin paths: '//host' and '/\\host' are protocol-relative URLs in browsers.
  navigate(next && /^\/(?![/\\])/.test(next) ? next : '/');
}

export function loginView(ctx) {
  const next = ctx.query.get('next');
  const notVerified = h('div', { class: 'alert', hidden: true });
  const f = form({
    fields: [
      { name: 'email', label: t('auth.email'), type: 'email', required: true, autocomplete: 'username' },
      { name: 'password', label: t('auth.password'), type: 'password', required: true, autocomplete: 'current-password' },
    ],
    submitLabel: t('auth.signIn'),
    onSubmit: async (v) => {
      notVerified.hidden = true;
      try {
        await post('/api/auth/login', { email: v.email, password: v.password });
      } catch (err) {
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          notVerified.replaceChildren(t('auth.notVerified'), ' ', h('button', {
            type: 'button', class: 'linkbtn', onclick: async () => {
              await post('/api/auth/resend-verification', { email: v.email }).catch(() => {});
              notVerified.replaceChildren(t('auth.verificationResent'));
            },
          }, t('auth.resend')));
          notVerified.hidden = false;
          return;
        }
        throw err;
      }
      await afterLogin(ctx, next);
    },
  });
  return page(ctx, t('auth.signInTitle'), t('auth.signInSub'), notVerified, f.el,
    h('div', { class: 'auth-foot' }, link('/forgot-password', t('auth.forgot')), link('/register', t('auth.noAccount')), link('/pricing', t('pricing.title'))));
}

export function registerView(ctx) {
  const done = h('div', { class: 'alert ok', role: 'status', hidden: true });
  const f = form({
    fields: [
      { name: 'name', label: t('auth.name'), required: true, autocomplete: 'name', maxlength: 120 },
      { name: 'email', label: t('auth.email'), type: 'email', required: true, autocomplete: 'email' },
      { name: 'password', label: t('auth.password'), type: 'password', required: true, autocomplete: 'new-password', minlength: 10, hint: t('auth.passwordHint') },
      { name: 'organizationName', label: t('auth.orgName'), required: true, maxlength: 120, hint: t('auth.orgNameHint') },
    ],
    submitLabel: t('auth.createAccount'),
    onSubmit: async (v) => {
      await post('/api/auth/register', { ...v, locale: locale() });
      f.el.hidden = true;
      done.textContent = t('auth.checkEmail', { email: v.email });
      done.hidden = false;
    },
  });
  return page(ctx, t('auth.registerTitle'), t('auth.registerSub'), done, f.el,
    h('div', { class: 'auth-foot' }, link('/login', t('auth.haveAccount')), link('/pricing', t('pricing.title'))));
}

export async function verifyEmailView(ctx) {
  const token = ctx.query.get('token') || '';
  const box = h('div', { class: 'alert', role: 'status' }, t('common.loading'));
  const body = page(ctx, t('auth.verifyTitle'), null, box, h('div', { class: 'auth-foot' }, link('/login', t('auth.signIn'))));
  try {
    await post('/api/auth/verify-email', { token });
    box.className = 'alert ok';
    box.textContent = t('auth.verified');
  } catch (err) {
    box.className = 'alert error';
    box.textContent = errorMessage(err);
  }
  return body;
}

export function forgotView(ctx) {
  const done = h('div', { class: 'alert ok', role: 'status', hidden: true });
  const f = form({
    fields: [{ name: 'email', label: t('auth.email'), type: 'email', required: true, autocomplete: 'email' }],
    submitLabel: t('auth.sendReset'),
    onSubmit: async (v) => {
      await post('/api/auth/password/forgot', v);
      f.el.hidden = true;
      done.textContent = t('auth.resetSent');
      done.hidden = false;
    },
  });
  return page(ctx, t('auth.forgotTitle'), t('auth.forgotSub'), done, f.el, h('div', { class: 'auth-foot' }, link('/login', t('auth.backToSignIn'))));
}

export function resetView(ctx) {
  const token = ctx.query.get('token') || '';
  const done = h('div', { class: 'alert ok', role: 'status', hidden: true });
  const f = form({
    fields: [{ name: 'password', label: t('auth.newPassword'), type: 'password', required: true, autocomplete: 'new-password', minlength: 10, hint: t('auth.passwordHint') }],
    submitLabel: t('auth.setPassword'),
    onSubmit: async (v) => {
      await post('/api/auth/password/reset', { token, password: v.password });
      f.el.hidden = true;
      done.replaceChildren(t('auth.passwordReset'), ' ', link('/login', t('auth.signIn')));
      done.hidden = false;
    },
  });
  return page(ctx, t('auth.resetTitle'), null, done, f.el);
}

export async function inviteView(ctx) {
  const token = ctx.query.get('token') || '';
  let invite;
  try {
    invite = await get(`/api/invitations/${encodeURIComponent(token)}`);
  } catch (err) {
    return page(ctx, t('invite.title'), null, h('div', { class: 'alert error' }, errorMessage(err)), h('div', { class: 'auth-foot' }, link('/login', t('auth.signIn'))));
  }
  const summary = h('p', {}, t('invite.summary', { inviter: invite.inviterName || '—', org: invite.orgName, role: t(`role.${invite.role}`) }));
  if (session.me) {
    const err = h('div', { class: 'alert error', role: 'alert', hidden: true });
    const accept = h('button', {
      type: 'button', class: 'btn', onclick: async () => {
        try {
          const r = await post('/api/invitations/accept', { token });
          await loadSession();
          navigate(`/org/${r.orgId}`);
        } catch (e) { err.textContent = errorMessage(e); err.hidden = false; }
      },
    }, t('invite.accept'));
    const mismatch = session.me.user.email !== invite.email ? h('div', { class: 'alert' }, t('invite.otherAccount', { email: invite.email })) : null;
    return page(ctx, t('invite.title'), null, summary, mismatch, err, accept);
  }
  if (invite.hasAccount) {
    return page(ctx, t('invite.title'), null, summary, h('p', {}, t('invite.signInFirst', { email: invite.email })),
      link(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`, t('auth.signIn'), { class: 'btn' }));
  }
  const f = form({
    fields: [
      { name: 'name', label: t('auth.name'), required: true, autocomplete: 'name' },
      { name: 'email', label: t('auth.email'), type: 'email', value: invite.email, required: true, autocomplete: 'email' },
      { name: 'password', label: t('auth.password'), type: 'password', required: true, autocomplete: 'new-password', minlength: 10, hint: t('auth.passwordHint') },
    ],
    submitLabel: t('invite.createAndJoin'),
    onSubmit: async (v) => {
      const r = await post('/api/auth/register', { ...v, inviteToken: token, locale: locale() });
      await loadSession();
      navigate(`/org/${r.orgId}`);
    },
  });
  f.inputs.email.readOnly = true;
  return page(ctx, t('invite.title'), null, summary, f.el);
}

export function mfaView(ctx) {
  const next = ctx.query.get('next');
  if (!session.mfaPending) { queueMicrotask(() => navigate(session.me ? '/' : '/login', { replace: true })); return null; }
  let useRecovery = false;
  const container = h('div');
  const draw = () => {
    const f = form({
      fields: useRecovery
        ? [{ name: 'recoveryCode', label: t('mfa.recoveryCode'), required: true, autocomplete: 'off' }]
        : [{ name: 'code', label: t('mfa.code'), required: true, autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 6 }],
      submitLabel: t('mfa.verify'),
      onSubmit: async (v) => {
        const res = await post('/api/auth/mfa/verify', v);
        void res;
        await afterLogin(ctx, next);
      },
    });
    container.replaceChildren(f.el, h('button', { type: 'button', class: 'linkbtn', onclick: () => { useRecovery = !useRecovery; draw(); } }, useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')));
  };
  draw();
  return page(ctx, t('mfa.title'), t('mfa.sub'), container,
    h('div', { class: 'auth-foot' }, h('button', { type: 'button', class: 'linkbtn', onclick: async () => { await post('/api/auth/logout').catch(() => {}); setCsrf(null); await loadSession(); navigate('/login'); } }, t('shell.logout'))));
}
