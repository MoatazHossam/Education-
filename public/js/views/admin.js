import { del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, errorMessage, fmtDate, fmtMoney, fmtNum, form, h, link, promptDialog, tableCard, th, toast } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { auditTable } from './settings.js';
import { pageHead } from './shell.js';
import { materialMark, verificationDetails } from '../verify.js';

const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
const safe = async (fn, ok) => { try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(errorMessage(e), 'error'); return false; } };

// Catalogue editor state kept across re-renders: open grade sections per version and the verification filter.
const openGrades = new Map();
let verifFilter = 'all';

export async function overviewView() {
  const [o, health, alerts] = await Promise.all([get('/api/admin/overview'), get('/api/admin/health'), get('/api/admin/alerts')]);
  const worker = health.workers.find((w) => w.name === 'worker');
  return h('div', {},
    pageHead(t('admin.overview'), t('admin.overviewSub')),
    h('div', { class: 'stats' },
      stat(t('admin.mrr'), fmtMoney(o.revenue.mrrCents, o.revenue.currency)),
      stat(t('admin.revenue30'), fmtMoney(o.revenue.last30DaysCents, o.revenue.currency)),
      stat(t('admin.orgsActive'), fmtNum(o.organizations.active ?? 0)),
      stat(t('admin.orgsSuspended'), fmtNum(o.organizations.suspended ?? 0)),
      stat(t('admin.usersTotal'), fmtNum(o.users.total)),
      stat(t('admin.newOrgs30'), fmtNum(o.growth.newOrganizationsLast30Days))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, t('admin.byPlan')), h('ul', {}, Object.entries(o.subscriptions.byPlan).map(([k, v]) => h('li', {}, `${k}: ${v}`))),
        h('h3', {}, t('admin.byState')), h('ul', {}, Object.entries(o.subscriptions.byState).map(([k, v]) => h('li', {}, `${k}: ${v}`)))),
      h('div', { class: 'card' }, h('h2', {}, t('admin.health')),
        h('ul', {},
          h('li', {}, `${t('admin.database')}: `, health.database.ok ? h('span', { class: 'pill ok' }, `ok · ${health.database.latencyMs} ms`) : h('span', { class: 'pill bad' }, 'error')),
          h('li', {}, `${t('admin.migrations')}: `, health.migrations.pending.length ? h('span', { class: 'pill bad' }, health.migrations.pending.join(', ')) : h('span', { class: 'pill ok' }, 'up to date')),
          h('li', {}, `${t('admin.worker')}: `, worker ? h('span', { class: `pill ${worker.ageSeconds < 120 ? 'ok' : 'bad'}` }, t('admin.lastBeat', { s: worker.ageSeconds })) : h('span', { class: 'pill bad' }, t('admin.noWorker'))),
          h('li', {}, `${t('admin.outbox')}: ${o.operations.outbox.pending ?? 0} pending · ${o.operations.outbox.failed ?? 0} failed`),
          h('li', {}, `${t('admin.failedWebhooks')}: ${o.operations.failedWebhooksLast7Days}`),
          h('li', {}, `${t('admin.billingProvider')}: ${health.billingProvider}`),
          h('li', {}, `Node ${health.process.node} · RSS ${health.process.rssMb} MB · up ${Math.round(health.process.uptimeSeconds / 60)} min`)))),
    alertsCard(alerts));
}

/** Operational alerts (src/ops/alerts.ts): what is failing now, what recently cleared, where alerts are sent. */
function alertsCard({ channels, alerts }) {
  const firing = alerts.filter((a) => a.status === 'firing');
  const resolved = alerts.filter((a) => a.status === 'resolved').slice(0, 5);
  const emailOn = channels.emails > 0 && channels.emailTransport !== 'none';
  const result = (r) => ({ sent: t('admin.alertResult.sent'), failed: t('admin.alertResult.failed'), off: t('admin.alertResult.off') })[r];
  const test = h('button', {
    type: 'button', class: 'btn ghost', onclick: async () => {
      test.disabled = true;
      await safe(async () => {
        const r = (await post('/api/admin/alerts/test')).result;
        toast(t('admin.alertTestResult', { email: result(r.email), webhook: result(r.webhook) }), r.email === 'failed' || r.webhook === 'failed' ? 'error' : 'info');
      });
      test.disabled = false;
    },
  }, t('admin.alertTest'));
  return h('div', { class: 'card' },
    h('h2', {}, t('admin.alerts')),
    firing.length
      ? h('ul', {}, firing.map((a) => h('li', {}, h('span', { class: 'pill bad' }, t('admin.alertFiring')), ' ', a.summary, ' · ', t('admin.alertSince', { date: fmtDate(a.firstSeenAt, true) }))))
      : h('p', {}, h('span', { class: 'pill ok' }, t('admin.alertsNone'))),
    resolved.length
      ? [h('h3', {}, t('admin.alertsResolved')), h('ul', {}, resolved.map((a) => h('li', {}, a.summary, ' · ', t('admin.alertResolvedAt', { date: fmtDate(a.resolvedAt, true) }))))]
      : null,
    h('p', { class: 'muted' },
      emailOn ? (channels.emails === 1 ? t('admin.alertEmailOne') : t('admin.alertEmailMany', { n: channels.emails })) : t('admin.alertEmailOff'),
      ' · ', channels.webhook ? t('admin.alertWebhookOn') : t('admin.alertWebhookOff')),
    emailOn || channels.webhook ? null : h('p', { class: 'notice' }, t('admin.alertsNoChannels')),
    h('p', {}, test));
}

export async function orgsView(ctx) {
  const q = ctx.query.get('q') || '';
  const { organizations } = await get(`/api/admin/orgs?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const input = h('input', { type: 'search', value: q, 'aria-label': t('admin.search'), placeholder: t('admin.search') });
  return h('div', {},
    pageHead(t('admin.orgs'), t('admin.orgsSub')),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); navigate(`/admin/orgs?q=${encodeURIComponent(input.value)}`); } }, input, h('button', { class: 'btn small', type: 'submit' }, t('admin.search'))),
    tableCard(t('admin.orgs'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Name', 'Plan', 'Members', 'Scopes', 'Status', 'Created'].map(th))),
      h('tbody', {}, organizations.map((o) => h('tr', {},
        h('td', {}, link(`/admin/orgs/${o.id}`, o.name), h('div', { class: 'mono muted' }, o.slug)),
        h('td', {}, `${o.planId} · `, h('span', { class: 'pill' }, o.billingState)),
        h('td', { class: 'mono' }, String(o.members)),
        h('td', { class: 'mono' }, String(o.scopes)),
        h('td', {}, h('span', { class: `pill ${o.status === 'active' ? 'ok' : 'bad'}` }, o.status)),
        h('td', {}, fmtDate(o.createdAt))))))));
}

export async function orgDetailView(ctx) {
  const { orgId } = ctx.params;
  const d = await get(`/api/admin/orgs/${orgId}`);
  const { plans } = await get('/api/admin/plans');
  const o = d.organization;
  const s = d.subscription;
  const reload = () => ctx.render();

  const suspendBtn = o.status === 'active'
    ? h('button', { type: 'button', class: 'btn danger', onclick: async () => { const reason = await promptDialog(t('admin.suspendOrg'), t('admin.reason'), { danger: true }); if (reason && (await safe(() => post(`/api/admin/orgs/${orgId}/suspend`, { reason })))) reload(); } }, t('admin.suspendOrg'))
    : h('button', { type: 'button', class: 'btn', onclick: async () => { if (await safe(() => post(`/api/admin/orgs/${orgId}/unsuspend`))) reload(); } }, t('admin.unsuspendOrg'));

  const planForm = form({
    fields: [
      { name: 'planId', label: 'Plan', type: 'select', value: s?.planId, options: plans.map((p) => ({ value: p.id, label: p.name })) },
      { name: 'status', label: 'Status', type: 'select', value: s?.status === 'trialing' ? 'trialing' : 'active', options: [{ value: 'active', label: 'active' }, { value: 'trialing', label: 'trialing' }] },
      { name: 'periodEnd', label: t('admin.periodEnd'), type: 'datetime-local', hint: t('admin.periodEndHint') },
      { name: 'maxMembers', label: t('admin.overrideMembers'), type: 'number', value: s?.limitOverrides?.max_members ?? '' },
      { name: 'maxStudents', label: t('admin.overrideStudents'), type: 'number', value: s?.limitOverrides?.max_students ?? '', hint: t('admin.overrideStudentsHint') },
    ],
    submitLabel: t('admin.applyPlan'),
    onSubmit: async (v) => {
      const body = { planId: v.planId, status: v.status, currentPeriodEnd: v.periodEnd ? new Date(v.periodEnd).toISOString() : null };
      if (v.status === 'trialing') body.trialEndsAt = new Date(v.periodEnd || Date.now() + 14 * 86_400_000).toISOString();
      // Overrides replace the stored set: keep the ones this form does not show; an empty field removes one.
      const overrides = { ...(s?.limitOverrides ?? {}) };
      for (const [field, key] of [['maxMembers', 'max_members'], ['maxStudents', 'max_students']]) {
        if (v[field] === '') delete overrides[key];
        else overrides[key] = Number(v[field]);
      }
      body.limitOverrides = overrides;
      await patch(`/api/admin/orgs/${orgId}/subscription`, body);
      toast(t('common.saved'));
      reload();
    },
  });

  const supportCard = h('div', { class: 'card' }, h('h2', {}, t('admin.support')),
    d.activeSupportGrants.length
      ? [h('p', {}, t('admin.grantActive', { date: fmtDate(d.activeSupportGrants[0].expiresAt, true), reason: d.activeSupportGrants[0].reason })),
        h('button', {
          type: 'button', class: 'btn ghost', onclick: async () => {
            const { scopes } = await get(`/api/admin/support/orgs/${orgId}/scopes`);
            await dialog({ title: t('admin.customerScopes'), body: h('ul', {}, scopes.map((x) => h('li', {}, `${x.name} — ${x.itemCount} items (${x.academicYear})`))), actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
          },
        }, t('admin.viewScopes'))]
      : h('p', { class: 'muted' }, t('admin.noGrant')));

  return h('div', {},
    pageHead(o.name, `${o.slug} · ${o.status}${o.suspendedReason ? ` — ${o.suspendedReason}` : ''}`, h('div', { class: 'row' }, suspendBtn)),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, t('admin.subscription')), s ? h('ul', {},
        h('li', {}, `Plan: ${s.planId} (effective ${s.effectivePlanId}, ${s.state})`),
        h('li', {}, `Interval: ${s.interval}`),
        s.trialEndsAt ? h('li', {}, `Trial ends: ${fmtDate(s.trialEndsAt, true)}`) : null,
        s.currentPeriodEnd ? h('li', {}, `Period end: ${fmtDate(s.currentPeriodEnd, true)}${s.cancelAtPeriodEnd ? ' (canceling)' : ''}`) : null,
        s.graceUntil ? h('li', {}, `Grace until: ${fmtDate(s.graceUntil, true)}`) : null,
        s.pendingPlanId ? h('li', {}, `Pending: ${s.pendingPlanId}`) : null) : null,
      h('h3', {}, t('admin.manualPlan')), planForm.el),
      h('div', { class: 'card' }, h('h2', {}, t('nav.members')), h('ul', {}, d.members.map((m) => h('li', {}, `${m.name} <${m.email}> — ${m.role}${m.status !== 'active' ? ' (suspended)' : ''}${m.mfaEnabled ? ' · MFA' : ''}`))),
        h('p', { class: 'muted' }, t('admin.scopeCount', { n: d.scopeCount })),
        h('p', { class: 'muted' }, t('admin.studentCount', { n: d.studentCount })))),
    supportCard,
    tableCard(t('billing.history'), h('h2', {}, t('billing.history')), h('table', { class: 'data' }, h('tbody', {}, d.invoices.map((i) => h('tr', {},
      h('td', { class: 'mono' }, i.number), h('td', {}, `${i.planId} · ${i.kind}`), h('td', { class: 'mono' }, fmtMoney(i.amountCents, i.currency)), h('td', {}, i.status),
      h('td', {}, i.status === 'open' ? h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { if (await confirmDialog(t('admin.markPaid'), t('admin.markPaidText', { n: i.number })) && (await safe(() => post(`/api/admin/invoices/${i.id}/mark-paid`)))) reload(); } }, t('admin.markPaid')) : fmtDate(i.paidAt))))))),
    h('p', {}, link(`/admin/audit?orgId=${orgId}`, t('admin.orgAudit'))));
}

export async function usersView(ctx) {
  const q = ctx.query.get('q') || '';
  const { users } = await get(`/api/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const input = h('input', { type: 'search', value: q, 'aria-label': t('admin.search'), placeholder: t('admin.search') });
  const action = (u, a) => async () => {
    const reason = a === 'suspend' ? await promptDialog(t('admin.suspendUser'), t('admin.reason'), { danger: true }) : '';
    if (reason === null) return;
    if (await safe(() => post(`/api/admin/users/${u.id}/${a}`, reason ? { reason } : {}))) ctx.render();
  };
  return h('div', {},
    pageHead(t('admin.users'), null),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); navigate(`/admin/users?q=${encodeURIComponent(input.value)}`); } }, input, h('button', { class: 'btn small', type: 'submit' }, t('admin.search'))),
    tableCard(t('admin.users'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['User', 'Status', 'MFA', 'Last login', ''].map(th))),
      h('tbody', {}, users.map((u) => h('tr', {},
        h('td', {}, h('b', {}, u.name), u.isPlatformAdmin ? h('span', { class: 'pill warn' }, ' admin') : null, h('div', { class: 'muted' }, u.email)),
        h('td', {}, h('span', { class: `pill ${u.status === 'active' ? 'ok' : 'bad'}` }, u.status), u.emailVerified ? null : h('span', { class: 'pill' }, 'unverified'), u.lockedUntil && new Date(u.lockedUntil) > new Date() ? h('span', { class: 'pill bad' }, 'locked') : null),
        h('td', {}, u.mfaEnabled ? 'yes' : 'no'),
        h('td', {}, fmtDate(u.lastLoginAt, true)),
        h('td', {}, h('div', { class: 'row' },
          u.status === 'active' ? h('button', { type: 'button', class: 'btn small danger ghost', onclick: action(u, 'suspend') }, t('admin.suspend')) : h('button', { type: 'button', class: 'btn small ghost', onclick: action(u, 'unsuspend') }, t('admin.unsuspend')),
          u.lockedUntil ? h('button', { type: 'button', class: 'btn small ghost', onclick: action(u, 'unlock') }, t('admin.unlock')) : null))))))));
}

export async function catalogView(ctx) {
  const { versions } = await get('/api/admin/catalog/versions');
  const f = form({
    fields: [
      { name: 'fromVersionId', label: t('admin.cloneFrom'), type: 'select', options: versions.map((v) => ({ value: v.id, label: `${v.academicYear} — ${v.label} (${v.status})` })) },
      { name: 'academicYear', label: t('admin.academicYear'), required: true, placeholder: '2027/2028' },
      { name: 'label', label: t('admin.label'), required: true, maxlength: 160 },
    ],
    submitLabel: t('admin.createDraft'),
    onSubmit: async (v) => { const r = await post('/api/admin/catalog/versions', v); navigate(`/admin/catalog/${r.id}`); },
  });
  return h('div', {},
    pageHead(t('admin.catalog'), t('admin.catalogSub')),
    tableCard(t('admin.catalog'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Version', 'Status', 'Subjects', 'Materials', t('verify.colVerified'), 'Published', ''].map(th))),
      h('tbody', {}, versions.map((v) => h('tr', {},
        h('td', {}, link(`/admin/catalog/${v.id}`, `${v.academicYear} — ${v.label}`)),
        h('td', {}, h('span', { class: `pill ${v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : ''}` }, v.status)),
        h('td', { class: 'mono' }, String(v.subjects)), h('td', { class: 'mono' }, String(v.materials)),
        h('td', { class: 'mono' }, `${v.subjectsVerified}/${v.subjects}`),
        h('td', {}, fmtDate(v.publishedAt)),
        h('td', {}, h('div', { class: 'row' },
          v.status === 'draft' ? h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await confirmDialog(t('admin.publish'), t('admin.publishText')) && (await safe(() => post(`/api/admin/catalog/versions/${v.id}/publish`)))) ctx.render(); } }, t('admin.publish')) : null,
          v.status === 'published' ? h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { if (await confirmDialog(t('admin.archive'), t('admin.archiveText')) && (await safe(() => post(`/api/admin/catalog/versions/${v.id}/archive`)))) ctx.render(); } }, t('admin.archive')) : null,
          v.status === 'draft' ? h('button', { type: 'button', class: 'btn small danger ghost', onclick: async () => { if (await confirmDialog(t('common.delete'), t('admin.deleteDraft'), { danger: true }) && (await safe(() => del(`/api/admin/catalog/versions/${v.id}`)))) ctx.render(); } }, t('common.delete')) : null))))))),
    h('div', { class: 'card' }, h('h2', {}, t('admin.newVersion')), h('p', { class: 'muted' }, t('admin.newVersionText')), f.el));
}

export async function catalogVersionView(ctx) {
  const { versionId } = ctx.params;
  const tree = await get(`/api/admin/catalog/versions/${versionId}`);
  const draft = tree.version.status === 'draft';
  const editable = tree.version.status !== 'archived';
  const reload = () => ctx.render();

  // Marks may change on drafts and published versions; customers see status, date, source and note.
  const verifyDialog = async ({ title, current, subjectIds = [], materialIds = [], extraMaterialIds = [] }) => {
    const status = h('select', {}, [['unverified', 'verify.statusUnverified'], ['verified', 'verify.statusVerified'], ['needs_review', 'verify.statusNeedsReview']]
      .map(([v, k]) => h('option', { value: v, selected: (current?.status ?? 'unverified') === v ? 'selected' : null }, t(k))));
    const source = h('input', { type: 'text', maxlength: '300', value: current?.source ?? '' });
    const url = h('input', { type: 'url', maxlength: '2000', placeholder: 'https://', value: current?.url ?? '' });
    const note = h('textarea', { maxlength: '1000' }, current?.note ?? '');
    const include = extraMaterialIds.length ? h('input', { type: 'checkbox', checked: true }) : null;
    const err = h('div', { class: 'alert error', hidden: true });
    return dialog({
      title,
      body: h('div', { class: 'stack' }, err,
        h('label', { class: 'field' }, t('verify.status'), status),
        h('label', { class: 'field' }, t('verify.source'), source),
        h('label', { class: 'field' }, t('verify.url'), url),
        h('label', { class: 'field' }, t('verify.note'), note),
        include ? h('label', { class: 'check' }, include, t('verify.includeMaterials', { n: extraMaterialIds.length })) : null,
        h('p', { class: 'muted' }, t('verify.publicHint'))),
      actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, {
        label: t('common.save'), value: true, validate: async () => {
          const opt = (k, el) => (el.value.trim() ? { [k]: el.value.trim() } : {});
          const body = { subjectIds, materialIds: [...materialIds, ...(include?.checked ? extraMaterialIds : [])], status: status.value, ...opt('source', source), ...opt('url', url), ...opt('note', note) };
          try {
            await post(`/api/admin/catalog/versions/${versionId}/verification`, body);
            toast(t('verify.applied'));
            return true;
          } catch (e) { err.textContent = errorMessage(e); err.hidden = false; return false; }
        },
      }],
    });
  };

  const subjectDialog = async (subject) => {
    const fields = {
      grade: h('input', { type: 'number', min: '1', max: '12', value: subject?.grade ?? 1 }),
      track: h('select', {}, ['moe', 'sec', 'bac', 'ta', 'intl'].map((x) => h('option', { value: x, selected: subject?.track === x ? 'selected' : null }, t(`track.${x}`)))),
      block: h('input', { type: 'text', value: subject?.block ?? '' }),
      code: h('input', { type: 'text', value: subject?.code ?? '' }),
      nameEn: h('input', { type: 'text', value: subject?.nameEn ?? '' }),
      nameAr: h('input', { type: 'text', value: subject?.nameAr ?? '', dir: 'rtl' }),
      status: h('select', {}, ['scored', 'pass', 'act'].map((x) => h('option', { value: x, selected: subject?.status === x ? 'selected' : null }, t(`status.${x}`)))),
      note: h('textarea', {}, subject?.note ?? ''),
    };
    const err = h('div', { class: 'alert error', hidden: true });
    return dialog({
      title: subject ? t('admin.editSubject') : t('admin.addSubject'),
      body: h('div', { class: 'stack' }, err, Object.entries(fields).map(([k, el]) => h('label', { class: 'field' }, k, el))),
      actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, {
        label: t('common.save'), value: true, validate: async () => {
          const body = { grade: Number(fields.grade.value), track: fields.track.value, block: fields.block.value, code: fields.code.value, nameEn: fields.nameEn.value, nameAr: fields.nameAr.value, status: fields.status.value, note: fields.note.value || null };
          try {
            if (subject) await patch(`/api/admin/catalog/subjects/${subject.id}`, body);
            else await post(`/api/admin/catalog/versions/${versionId}/subjects`, body);
            return true;
          } catch (e) { err.textContent = errorMessage(e); err.hidden = false; return false; }
        },
      }],
    });
  };

  const meta = form({
    fields: [
      { name: 'label', label: t('admin.label'), value: tree.version.label, required: true },
      { name: 'notice', label: t('admin.notice'), type: 'textarea', value: tree.version.notice || '' },
    ],
    submitLabel: t('common.save'),
    onSubmit: async (v) => { await patch(`/api/admin/catalog/versions/${versionId}`, v); toast(t('common.saved')); reload(); },
  });

  const matches = (s) => {
    if (verifFilter === 'verified') return s.verification?.status === 'verified';
    if (verifFilter === 'needs_review') return s.verification?.status === 'needs_review' || s.materials.some((m) => m.verification?.status === 'needs_review');
    if (verifFilter === 'unverified') return !s.verification;
    return true;
  };
  const opened = openGrades.get(versionId) ?? new Set();
  openGrades.set(versionId, opened);
  const grades = [];
  for (let g = 1; g <= 12; g++) {
    const all = tree.subjects.filter((s) => s.grade === g);
    const subs = all.filter(matches);
    if (!subs.length && verifFilter !== 'all') continue;
    const gradeName = tree.grades[g - 1].nameEn;
    grades.push(h('details', { class: 'card', open: opened.has(g) || null, ontoggle: (e) => { if (e.target.open) opened.add(g); else opened.delete(g); } },
      h('summary', {}, `${gradeName} — ${subs.length} subjects`),
      editable && all.length ? h('div', { class: 'row' }, h('button', {
        type: 'button', class: 'btn small ghost', onclick: async () => {
          if (await verifyDialog({ title: t('verify.gradeTarget', { grade: gradeName, s: all.length }), subjectIds: all.map((s) => s.id), extraMaterialIds: all.flatMap((s) => s.materials.map((m) => m.id)) })) reload();
        },
      }, t('verify.gradeAll'))) : null,
      subs.map((s) => h('div', { class: 'subj' },
        h('div', { class: 'sname' }, h('b', {}, s.nameEn), h('span', { class: 'ar', lang: 'ar', dir: 'rtl' }, s.nameAr), h('span', { class: 'mono muted' }, `${s.track} · ${s.code} · ${s.status}`), h('div', { class: 'muted' }, s.block),
          verificationDetails(s),
          h('div', { class: 'row' },
            editable ? h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { if (await verifyDialog({ title: `${t('verify.dialogTitle')}: ${s.nameEn}`, current: s.verification, subjectIds: [s.id], extraMaterialIds: s.materials.map((m) => m.id) })) reload(); } }, t('verify.set')) : null,
            draft ? [
              h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { if (await subjectDialog(s)) reload(); } }, t('common.edit')),
              h('button', { type: 'button', class: 'btn small danger ghost', onclick: async () => { if (await confirmDialog(t('common.delete'), s.nameEn, { danger: true }) && (await safe(() => del(`/api/admin/catalog/subjects/${s.id}`)))) reload(); } }, t('common.delete')),
            ] : null)),
        h('div', { class: 'mats' },
          s.materials.map((m) => h('span', { class: `mat ${m.kind}` }, m.title, materialMark(m),
            editable ? h('button', { type: 'button', class: 'linkbtn', 'aria-label': `${t('verify.set')} ${m.title}`, onclick: async () => { if (await verifyDialog({ title: `${t('verify.dialogTitle')}: ${m.title}`, current: m.verification, materialIds: [m.id] })) reload(); } }, t('verify.short')) : null,
            draft ? h('button', { type: 'button', class: 'linkbtn', 'aria-label': `${t('common.delete')} ${m.title}`, onclick: async () => { if (await safe(() => del(`/api/admin/catalog/materials/${m.id}`))) reload(); } }, '×') : null)),
          draft ? h('button', {
            type: 'button', class: 'btn small ghost', onclick: async () => {
              const title = await promptDialog(t('admin.addMaterial'), t('admin.materialTitle'));
              if (!title) return;
              const kind = await promptDialog(t('admin.addMaterial'), t('admin.materialKind'), { hint: 'moe | lang | ext | prog | exam' });
              if (kind && (await safe(() => post(`/api/admin/catalog/subjects/${s.id}/materials`, { title, kind: kind.trim() })))) reload();
            },
          }, `+ ${t('admin.addMaterial')}`) : null)))));
  }

  const vc = tree.counts.verification;
  const filterSel = h('select', { 'aria-label': t('verify.filter'), onchange: (e) => { verifFilter = e.target.value; reload(); } },
    [['all', 'verify.filterAll'], ['unverified', 'verify.filterUnverified'], ['verified', 'verify.filterVerified'], ['needs_review', 'verify.filterReview']]
      .map(([v, k]) => h('option', { value: v, selected: verifFilter === v ? 'selected' : null }, t(k))));
  const verificationBar = h('div', { class: 'card stack' },
    h('div', { class: 'row' },
      h('span', {}, t('verify.adminCoverage', { sv: vc.subjectsVerified, s: tree.counts.subjects, mv: vc.materialsVerified, m: tree.counts.materials, r: vc.subjectsNeedReview + vc.materialsNeedReview })),
      h('label', { class: 'row' }, t('verify.filter'), filterSel)),
    sheetActions(versionId, tree.version.status, reload));

  return h('div', {},
    pageHead(`${tree.version.academicYear} — ${tree.version.label}`, `${tree.version.status} · ${tree.counts.subjects} subjects · ${tree.counts.materials} materials`,
      h('div', { class: 'row' }, link('/admin/catalog', t('admin.backToVersions')), draft ? h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await subjectDialog(null)) reload(); } }, `+ ${t('admin.addSubject')}`) : h('span', { class: 'muted' }, t(editable ? 'admin.readOnlyContent' : 'admin.readOnlyVersion')))),
    draft ? h('div', { class: 'card' }, h('h2', {}, t('admin.versionDetails')), meta.el) : null,
    verificationBar,
    grades.length ? grades : h('p', { class: 'empty' }, t('picker.noMatch')));
}

// ------------------------------------------------------------ spreadsheet round trip
const MARK_LABEL = { unverified: 'verify.statusUnverified', verified: 'verify.statusVerified', needs_review: 'verify.statusNeedsReview' };
const LIST_LIMIT = 100;

function sheetActions(versionId, status, reload) {
  const url = `/api/admin/catalog/versions/${versionId}/sheet`;
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const csv = await f.text();
      const { plan } = await post(url, { csv, apply: false });
      if (await sheetPreview(plan) && (await safe(() => post(url, { csv, apply: true }), t('sheet.applied', { n: plan.changes.length })))) reload();
    } catch (e) { toast(errorMessage(e), 'error'); }
  } });
  return h('div', { class: 'row' },
    h('a', { href: url, download: '', class: 'btn small ghost' }, t('sheet.download')),
    status === 'archived' ? null : [h('button', { type: 'button', class: 'btn small ghost', onclick: () => file.click() }, t('sheet.upload')), file],
    h('span', { class: 'muted' }, t(status === 'draft' ? 'sheet.hintDraft' : 'sheet.hintPublished')));
}

/** Shows what an uploaded sheet would change; resolves true when the admin applies it. */
function sheetPreview(plan) {
  const s = plan.summary;
  const more = (n) => (n > LIST_LIMIT ? h('p', { class: 'muted' }, t('sheet.more', { n: n - LIST_LIMIT })) : null);
  const markText = (m) => [t(MARK_LABEL[m.status]), m.source ? ` (${m.source})` : '', m.note ? ` — ${m.note}` : ''].join('');
  const changeItem = (c) => h('li', {},
    h('b', {}, t('sheet.row', { n: c.row })), ' ', h('span', { dir: 'auto' }, c.label),
    h('ul', {},
      c.content.map((f) => h('li', {}, h('span', { class: 'mono' }, f.field), ': ', h('span', { dir: 'auto' }, f.from ?? '—'), ' → ', h('span', { dir: 'auto' }, f.to ?? '—'))),
      c.mark ? h('li', {}, t('sheet.mark'), ': ', h('span', { dir: 'auto' }, markText(c.mark.from)), ' → ', h('span', { dir: 'auto' }, markText(c.mark.to))) : null,
      c.markCleared ? h('li', { class: 'muted' }, t('sheet.markCleared')) : null));
  const body = h('div', { class: 'stack sheet-preview' },
    h('p', {}, t('sheet.summary', { rows: s.rows, changes: plan.changes.length, unchanged: s.unchanged })),
    plan.changes.length ? h('p', { class: 'muted' }, t('sheet.counts', { marks: s.marksChanged, content: s.subjectsChanged + s.materialsChanged, added: s.materialsAdded, cleared: s.marksCleared })) : null,
    plan.errors.length ? h('div', { class: 'alert error', role: 'alert' },
      h('b', {}, plan.errors.length === 1 ? t('sheet.errorsTitleOne') : t('sheet.errorsTitle', { n: plan.errors.length })),
      h('ul', {}, plan.errors.slice(0, LIST_LIMIT).map((e) => h('li', {}, e.row ? `${t('sheet.row', { n: e.row })}: ` : '', e.message))), more(plan.errors.length)) : null,
    plan.warnings.length ? h('div', { class: 'alert' }, h('ul', {}, plan.warnings.map((w) => h('li', {}, w.message)))) : null,
    plan.changes.length ? [h('h3', {}, t('sheet.changesTitle')), h('ul', {}, plan.changes.slice(0, LIST_LIMIT).map(changeItem)), more(plan.changes.length)] : null,
    !plan.changes.length && !plan.errors.length ? h('p', {}, t('sheet.noChanges')) : null);
  const canApply = !plan.errors.length && plan.changes.length > 0;
  return dialog({
    title: t('sheet.previewTitle'),
    body,
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, ...(canApply ? [{ label: plan.changes.length === 1 ? t('sheet.applyOne') : t('sheet.apply', { n: plan.changes.length }), value: true }] : [])],
  });
}

export async function plansView(ctx) {
  const { plans } = await get('/api/admin/plans');
  return h('div', {},
    pageHead(t('admin.plans'), t('admin.plansSub')),
    plans.map((p) => {
      const f = form({
        fields: [
          { name: 'name', label: 'Name', value: p.name },
          { name: 'priceMonthlyCents', label: t('admin.priceMonthly'), type: 'number', value: p.priceMonthlyCents },
          { name: 'priceYearlyCents', label: t('admin.priceYearly'), type: 'number', value: p.priceYearlyCents ?? '' },
          { name: 'limits', label: t('admin.limitsJson'), type: 'textarea', value: JSON.stringify(p.limits) },
          { name: 'features', label: t('admin.featuresJson'), type: 'textarea', value: JSON.stringify(p.features) },
          { name: 'active', label: t('admin.active'), type: 'checkbox', value: p.active },
        ],
        submitLabel: t('common.save'),
        onSubmit: async (v) => {
          await patch(`/api/admin/plans/${p.id}`, {
            name: v.name, priceMonthlyCents: Number(v.priceMonthlyCents), priceYearlyCents: v.priceYearlyCents === '' ? null : Number(v.priceYearlyCents),
            limits: JSON.parse(v.limits), features: JSON.parse(v.features), active: v.active,
          });
          toast(t('common.saved'));
          ctx.render();
        },
      });
      return h('div', { class: 'card' }, h('h2', {}, `${p.name} (${p.id}) · ${p.currency}`), f.el);
    }));
}

export async function auditView(ctx) {
  const qs = new URLSearchParams(ctx.query);
  qs.set('limit', '100');
  const data = await get(`/api/admin/audit-logs?${qs}`);
  const action = h('input', { type: 'search', value: ctx.query.get('action') || '', placeholder: 'action prefix', 'aria-label': 'action' });
  const actor = h('input', { type: 'search', value: ctx.query.get('actor') || '', placeholder: 'actor email', 'aria-label': 'actor' });
  const orgId = h('input', { type: 'search', value: ctx.query.get('orgId') || '', placeholder: 'org id', 'aria-label': 'org id' });
  const go = (before) => {
    const q = new URLSearchParams();
    if (action.value) q.set('action', action.value);
    if (actor.value) q.set('actor', actor.value);
    if (orgId.value) q.set('orgId', orgId.value);
    if (before) q.set('before', before);
    navigate(`/admin/audit?${q}`);
  };
  return h('div', {},
    pageHead(t('admin.audit'), null),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); go(null); } }, action, actor, orgId, h('button', { class: 'btn small', type: 'submit' }, t('audit.apply'))),
    auditTable(data.entries, { showOrg: true }),
    data.nextBefore ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(data.nextBefore) }, t('audit.older')) : null);
}

export async function eventsView(ctx) {
  const status = ctx.query.get('status') || '';
  const { events } = await get(`/api/admin/billing-events?limit=100${status ? `&status=${status}` : ''}`);
  return h('div', {},
    pageHead(t('admin.events'), t('admin.eventsSub')),
    h('div', { class: 'seg' }, ['', 'processed', 'ignored', 'failed'].map((s) => link(`/admin/events${s ? `?status=${s}` : ''}`, s || 'all', { class: 'chipbtn', 'aria-current': s === status ? 'page' : null }))),
    tableCard(t('admin.events'), h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Received', 'Provider', 'Event', 'Type', 'Status', 'Note'].map(th))),
      h('tbody', {}, events.map((e) => h('tr', {},
        h('td', {}, fmtDate(e.receivedAt, true)), h('td', {}, e.provider), h('td', { class: 'mono' }, e.eventId), h('td', { class: 'mono' }, e.type),
        h('td', {}, h('span', { class: `pill ${e.status === 'processed' ? 'ok' : e.status === 'failed' ? 'bad' : ''}` }, e.status)),
        h('td', { class: 'muted' }, e.error || '')))))));
}
