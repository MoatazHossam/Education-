import { get, post } from '../api.js';
import { confirmDialog, errorMessage, fmtDate, fmtMoney, fmtNum, h, link, tableCard, toast } from '../dom.js';
import { locale, setLocale, shipped, t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg, session } from '../state.js';
import { pageHead } from './shell.js';

const price = (p, interval) => (interval === 'year' ? p.priceYearlyCents : p.priceMonthlyCents);

function planFeatures(p) {
  const L = p.limits;
  const items = [
    t('plan.members', { n: fmtNum(L.max_members) }),
    t('plan.scopes', { n: fmtNum(L.max_scopes) }),
    t('plan.exports', { n: fmtNum(L.exports_per_month) }),
    p.features.export_csv ? t('plan.csvJson') : t('plan.textOnly'),
    p.features.api_access ? t('plan.api', { n: fmtNum(L.api_requests_per_month) }) : null,
    t('plan.audit', { n: L.audit_log_days }),
    p.features.require_mfa_policy ? t('plan.mfaPolicy') : null,
    p.features.priority_support ? t('plan.support') : null,
  ];
  return h('ul', {}, items.filter(Boolean).map((i) => h('li', {}, i)));
}

function priceLabel(p, interval) {
  if (!p.selfServe) return t('plan.contactSales');
  const c = price(p, interval);
  if (c === null || c === undefined) return '—';
  if (c === 0) return t('plan.free');
  return `${fmtMoney(c, p.currency)} / ${t(interval === 'year' ? 'plan.year' : 'plan.month')}`;
}

function meter(label, used, max) {
  const pct = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  const bar = h('span', {});
  bar.style.width = `${pct}%`; // CSSOM style is allowed by the CSP (no inline style attributes)
  return h('div', { class: 'stat' },
    h('div', { class: 'k' }, label),
    h('div', { class: 'v' }, `${fmtNum(used)} / ${fmtNum(max)}`),
    max === null ? null : h('div', { class: `meter ${pct >= 100 ? 'full' : ''}`, role: 'meter', 'aria-label': label, 'aria-valuetext': `${fmtNum(used)} / ${fmtNum(max)}`, 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(used) }, bar));
}

async function goCheckout(fn) {
  try {
    const r = await fn();
    if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
    else return r;
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
  return null;
}

export async function billingView(ctx) {
  const { orgId } = ctx.params;
  const isOwner = can(ctx.info.role, 'owner');
  let b = await get(`/api/orgs/${orgId}/billing`);
  const returning = ctx.query.get('invoice');
  const statusBox = h('div', { role: 'status' });

  // Returning from the hosted checkout: the webhook (not the redirect) updates
  // our records, so poll briefly until the invoice shows as paid.
  if (returning) {
    statusBox.className = 'alert';
    statusBox.textContent = t('billing.processing');
    for (let i = 0; i < 10; i++) {
      const inv = b.invoices.find((x) => x.id === returning);
      if (inv && inv.status !== 'open') break;
      if (b.payments.some((p) => p.invoiceId === returning && p.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1500));
      b = await get(`/api/orgs/${orgId}/billing`);
    }
    const inv = b.invoices.find((x) => x.id === returning);
    const failed = b.payments.find((p) => p.invoiceId === returning && p.status === 'failed');
    statusBox.className = `alert ${inv?.status === 'paid' ? 'ok' : failed ? 'error' : ''}`;
    statusBox.textContent = inv?.status === 'paid' ? t('billing.paid') : failed ? t('billing.failed', { reason: failed.failureReason || '' }) : t('billing.pending');
    invalidateOrg(orgId);
  }

  const s = b.subscription;
  const plans = b.plans;
  const current = plans.find((p) => p.id === s.effectivePlanId);
  let interval = s.billingInterval || 'month';
  const paidPeriod = (s.state === 'active' || s.state === 'past_due') && s.currentPeriodEnd && current && current.priceMonthlyCents > 0;

  const stateText = {
    trialing: t('billing.state.trialing', { date: fmtDate(s.trialEndsAt) }),
    active: s.currentPeriodEnd ? (s.cancelAtPeriodEnd ? t('billing.state.canceling', { date: fmtDate(s.currentPeriodEnd) }) : t('billing.state.renews', { date: fmtDate(s.currentPeriodEnd) })) : t('billing.state.activeOpen'),
    past_due: t('billing.state.pastDue', { date: fmtDate(s.graceUntil) }),
    free: t('billing.state.free'),
  }[s.state];

  const reload = () => { invalidateOrg(orgId); navigate(`/org/${orgId}/billing`, { replace: true }); };

  const summary = h('div', { class: 'card' },
    h('h2', {}, t('billing.current')),
    h('div', { class: 'row' }, h('span', { class: 'plan-name' }, h('b', {}, current?.name || s.effectivePlanName)), h('span', { class: `pill ${s.state === 'past_due' ? 'bad' : s.state === 'free' ? '' : 'ok'}` }, t(`billing.stateName.${s.state}`)), s.billingInterval && paidPeriod ? h('span', { class: 'muted' }, t(s.billingInterval === 'year' ? 'billing.yearly' : 'billing.monthly')) : null),
    h('p', {}, stateText),
    s.pendingPlanId ? h('p', { class: 'muted' }, t('billing.pendingChange', { plan: plans.find((p) => p.id === s.pendingPlanId)?.name || s.pendingPlanId, date: fmtDate(s.currentPeriodEnd) })) : null,
    isOwner && paidPeriod && !s.cancelAtPeriodEnd ? h('button', {
      type: 'button', class: 'btn danger ghost', onclick: async () => {
        if (await confirmDialog(t('billing.cancelTitle'), t('billing.cancelText', { date: fmtDate(s.currentPeriodEnd) }), { danger: true, confirmLabel: t('billing.cancel') })) {
          try { await post(`/api/orgs/${orgId}/billing/cancel`); toast(t('billing.canceled')); reload(); } catch (e) { toast(errorMessage(e), 'error'); }
        }
      },
    }, t('billing.cancel')) : null,
    isOwner && s.cancelAtPeriodEnd ? h('button', { type: 'button', class: 'btn', onclick: async () => { try { await post(`/api/orgs/${orgId}/billing/resume`); reload(); } catch (e) { toast(errorMessage(e), 'error'); } } }, t('billing.resume')) : null,
    !isOwner ? h('p', { class: 'muted' }, t('billing.ownerOnly')) : null,
    !b.provider ? h('p', { class: 'muted' }, t('billing.disabled')) : null);

  const usage = h('div', { class: 'card' }, h('h2', {}, t('billing.usage')),
    h('div', { class: 'stats' },
      meter(t('billing.meter.members'), b.usage.members + b.usage.pendingInvites, b.limits.max_members),
      meter(t('billing.meter.scopes'), b.usage.scopes, b.limits.max_scopes),
      meter(t('billing.meter.exports'), b.usage.exports, b.limits.exports_per_month),
      b.features.api_access ? meter(t('billing.meter.api'), b.usage.api_requests, b.limits.api_requests_per_month) : null));

  const plansWrap = h('div', { class: 'plans' });
  function drawPlans() {
    plansWrap.replaceChildren(...plans.map((p) => {
      const isCurrent = p.id === s.effectivePlanId && (p.id === 'free' || !paidPeriod || s.billingInterval === interval);
      // The plan being trialled is current, and can still be subscribed to before the trial ends.
      const trialPlan = isCurrent && s.state === 'trialing' && p.id !== 'free';
      let cta = null;
      if (isOwner && b.provider && (!isCurrent || trialPlan)) {
        if (!p.selfServe) cta = b.salesEmail ? h('a', { class: 'btn ghost', href: `mailto:${b.salesEmail}` }, t('plan.contactSales')) : h('span', { class: 'muted' }, t('plan.contactSales'));
        else if (p.id === 'free') {
          if (paidPeriod && !s.cancelAtPeriodEnd) cta = h('button', { type: 'button', class: 'btn ghost', onclick: () => summary.querySelector('.btn.danger')?.click() }, t('billing.downgradeFree'));
        } else if (!paidPeriod) {
          cta = h('button', { type: 'button', class: 'btn', onclick: () => goCheckout(() => post(`/api/orgs/${orgId}/billing/checkout`, { planId: p.id, interval })) }, t('billing.subscribe'));
        } else if (s.state === 'past_due') {
          cta = null;
        } else if (interval === s.billingInterval && price(p, interval) > price(current, interval)) {
          cta = h('button', { type: 'button', class: 'btn', onclick: () => goCheckout(() => post(`/api/orgs/${orgId}/billing/checkout`, { planId: p.id, interval })).then((r) => r && reload()) }, t('billing.upgradeNow'));
        } else {
          cta = h('button', {
            type: 'button', class: 'btn ghost', onclick: async () => {
              try { await post(`/api/orgs/${orgId}/billing/change`, { planId: p.id, interval }); toast(t('billing.changeScheduled')); reload(); } catch (e) { toast(errorMessage(e), 'error'); }
            },
          }, t('billing.switchAtRenewal'));
        }
      }
      return h('div', { class: `plan ${isCurrent ? 'current' : ''}` },
        h('h3', {}, p.name), h('div', { class: 'price' }, priceLabel(p, interval)), h('p', { class: 'muted' }, shipped(`plan.desc.${p.id}`, p.description)), planFeatures(p),
        isCurrent ? [h('span', { class: 'pill ok' }, t('billing.currentPlan')), trialPlan ? cta : null] : cta);
    }));
  }
  const intervalToggle = h('div', { class: 'seg', role: 'group', 'aria-label': t('billing.interval') },
    ['month', 'year'].map((iv) => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(interval === iv), onclick: (e) => { interval = iv; e.target.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.target))); drawPlans(); } }, t(iv === 'year' ? 'billing.yearly' : 'billing.monthly'))));
  drawPlans();

  const open = b.invoices.filter((i) => i.status === 'open');
  const openCard = open.length ? h('div', { class: 'card' }, h('h2', {}, t('billing.openInvoices')),
    open.map((i) => h('div', { class: 'row' }, h('span', { class: 'mono' }, i.number), h('span', {}, fmtMoney(i.amountCents, i.currency)), h('span', { class: 'muted' }, t(`invoice.kind.${i.kind}`)),
      isOwner && b.provider ? h('button', { type: 'button', class: 'btn small', onclick: () => goCheckout(() => post(`/api/orgs/${orgId}/billing/invoices/${i.id}/checkout`)) }, t('billing.payInvoice')) : null))) : null;

  const history = tableCard(t('billing.history'), h('h2', {}, t('billing.history')),
    b.invoices.length ? h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('billing.invoice'), t('billing.description'), t('billing.amount'), t('billing.status'), t('billing.date')].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, b.invoices.map((i) => h('tr', {},
        h('td', { class: 'mono' }, i.number),
        h('td', {}, `${plans.find((p) => p.id === i.planId)?.name || i.planId} · ${t(`invoice.kind.${i.kind}`)}`, i.periodStart && i.periodEnd ? h('div', { class: 'muted' }, `${fmtDate(i.periodStart)} → ${fmtDate(i.periodEnd)}`) : null),
        h('td', { class: 'mono' }, fmtMoney(i.amountCents, i.currency)),
        h('td', {}, h('span', { class: `pill ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : ''}` }, t(`invoice.status.${i.status}`))),
        h('td', {}, fmtDate(i.paidAt || i.createdAt))))))
      : h('p', { class: 'muted' }, t('billing.noInvoices')),
    b.payments.some((p) => p.status === 'failed') ? h('p', { class: 'muted' }, t('billing.failedAttempts', { n: b.payments.filter((p) => p.status === 'failed').length })) : null);

  return h('div', {},
    pageHead(t('billing.title'), t('billing.sub')),
    returning ? statusBox : null,
    summary, usage, openCard,
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, t('billing.plans')), h('span', { class: 'spacer' }), intervalToggle), plansWrap,
      h('p', { class: 'muted' }, t('billing.taxNote'))),
    history);
}

export async function pricingView(ctx) {
  const { plans } = await get('/api/billing/plans');
  let interval = 'month';
  const wrap = h('div', { class: 'plans' });
  const draw = () => wrap.replaceChildren(...plans.map((p) => h('div', { class: 'plan' }, h('h2', {}, p.name), h('div', { class: 'price' }, priceLabel(p, interval)), h('p', { class: 'muted' }, shipped(`plan.desc.${p.id}`, p.description)), planFeatures(p))));
  draw();
  return h('main', { id: 'main', class: 'wrap' },
    h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'iconbtn', onclick: () => { setLocale(locale() === 'ar' ? 'en' : 'ar'); ctx.render(); } }, locale() === 'ar' ? 'English' : 'العربية')),
    pageHead(t('pricing.title'), t('pricing.sub')),
    h('div', { class: 'seg' }, ['month', 'year'].map((iv) => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(interval === iv), onclick: (e) => { interval = iv; e.target.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.target))); draw(); } }, t(iv === 'year' ? 'billing.yearly' : 'billing.monthly')))),
    h('div', { class: 'card' }, wrap, h('p', { class: 'muted' }, t('pricing.trial')), h('p', { class: 'muted' }, t('billing.taxNote'))),
    h('div', { class: 'row' }, session.me ? link('/', t('pricing.backToApp'), { class: 'btn' }) : [link('/register', t('pricing.startTrial'), { class: 'btn' }), link('/login', t('auth.signIn'), { class: 'btn ghost' })]));
}

/** Development/test only: stands in for the payment provider's hosted page. */
export async function sandboxCheckoutView(ctx) {
  const invoiceId = ctx.query.get('invoice') || '';
  const sig = ctx.query.get('sig') || '';
  const main = h('main', { id: 'main', class: 'auth-page' });
  let inv;
  try {
    inv = (await get(`/api/billing/sandbox/checkout?invoice=${encodeURIComponent(invoiceId)}&sig=${encodeURIComponent(sig)}`)).invoice;
  } catch (err) {
    main.append(h('div', { class: 'auth-card' }, h('h1', {}, t('sandbox.title')), h('div', { class: 'alert error' }, errorMessage(err))));
    return main;
  }
  const err = h('div', { class: 'alert error', hidden: true });
  const complete = async (outcome) => {
    try {
      const r = await post('/api/billing/sandbox/complete', { invoice: invoiceId, sig, outcome });
      navigate(`/org/${r.orgId}/billing?invoice=${invoiceId}`);
    } catch (e) { err.textContent = errorMessage(e); err.hidden = false; }
  };
  main.append(h('div', { class: 'auth-card' },
    h('div', { class: 'eyebrow' }, t('sandbox.eyebrow')),
    h('h1', {}, t('sandbox.title')),
    h('div', { class: 'alert' }, t('sandbox.warning')),
    h('p', {}, h('b', {}, inv.orgName), ' — ', inv.planName, ` (${t(inv.interval === 'year' ? 'billing.yearly' : 'billing.monthly')})`),
    h('p', { class: 'mono' }, `${inv.number} · ${fmtMoney(inv.amountCents, inv.currency)}`),
    err,
    inv.status !== 'open' ? h('div', { class: 'alert' }, t('sandbox.notOpen', { status: inv.status })) : h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => complete('success') }, t('sandbox.pay', { amount: fmtMoney(inv.amountCents, inv.currency) })),
      h('button', { type: 'button', class: 'btn danger ghost', onclick: () => complete('failure') }, t('sandbox.decline')))));
  return main;
}
