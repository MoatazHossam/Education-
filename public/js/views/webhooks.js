// Webhooks card on the organization's settings page (owners and admins): the
// endpoints told about scope changes, their deliveries, tests and secrets.
import { ApiError, del, get, patch, post } from '../api.js';
import { confirmDialog, dialog, downloadText, errorMessage, fmtDate, fmtNum, form, h, th, toast } from '../dom.js';
import { t } from '../i18n.js';
import { planLimitHint } from './shell.js';

const eventLabel = (e) => t(`webhooks.event.${e}`);
const ltr = (text) => h('span', { dir: 'ltr', class: 'mono' }, text);

function statusPill(w) {
  if (w.enabled) return h('span', { class: 'pill ok' }, t('webhooks.status.active'));
  return h('span', { class: `pill ${w.disabledReason === 'failing' ? 'bad' : ''}` }, t(w.disabledReason === 'failing' ? 'webhooks.status.failing' : 'webhooks.status.off'));
}

function resultText(d) {
  const code = d.statusCode ? ` (${d.statusCode})` : '';
  return `${t(`webhooks.result.${d.status}`)}${code}`;
}

/** The secret, shown once, with how receivers check it. */
function showSecret(title, secret) {
  return dialog({
    title,
    body: h('div', { class: 'stack' },
      h('p', {}, t('webhooks.secretOnce')),
      h('pre', { class: 'codes', tabindex: '0', dir: 'ltr' }, secret),
      h('p', { class: 'muted' }, t('webhooks.signatureHelp'))),
    actions: [{ label: t('common.done'), value: true }],
  });
}

function eventFields(events, chosen) {
  return events.map((e, i) => ({ name: `ev${i}`, label: eventLabel(e), type: 'checkbox', value: chosen.includes(e) }));
}
const chosenEvents = (events, v) => events.filter((_, i) => v[`ev${i}`]);

/** Every kept delivery as CSV (the server names the file). */
async function downloadHistory(orgId, w) {
  try {
    const res = await fetch(`/api/orgs/${orgId}/webhooks/${w.id}/deliveries/export`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'webhook-deliveries.csv';
    downloadText(name, await res.text(), 'text/csv');
  } catch (err) { toast(errorMessage(err), 'error'); }
}

async function showDeliveries(orgId, w) {
  const { deliveries, total, keptDays, exportMax } = await get(`/api/orgs/${orgId}/webhooks/${w.id}/deliveries`);
  const rows = deliveries.map((d) => h('tr', {},
    h('td', {}, fmtDate(d.createdAt, true)),
    h('td', {}, eventLabel(d.eventType), h('div', { class: 'muted small mono' }, d.eventType)),
    h('td', {}, h('span', { class: `pill ${d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}` }, resultText(d)),
      d.error ? h('div', { class: 'muted small', dir: 'auto' }, d.error) : null,
      d.nextAttemptAt ? h('div', { class: 'muted small' }, t('webhooks.nextAttempt', { date: fmtDate(d.nextAttemptAt, true) })) : null),
    h('td', {}, String(d.attempts)),
    h('td', {},
      h('details', { class: 'payload' }, h('summary', {}, t('webhooks.payload')), h('pre', { class: 'codes', tabindex: '0', dir: 'ltr' }, JSON.stringify(d.payload, null, 2))),
      d.status !== 'pending' ? h('button', {
        type: 'button', class: 'btn small ghost', 'aria-label': t('webhooks.redeliverFor', { event: eventLabel(d.eventType), date: fmtDate(d.createdAt, true) }),
        onclick: async (e) => {
          try {
            await post(`/api/orgs/${orgId}/webhooks/${w.id}/deliveries/${d.id}/redeliver`);
            toast(t('webhooks.redelivered'));
            e.target.disabled = true;
          } catch (err) { toast(errorMessage(err), 'error'); }
        },
      }, t('webhooks.redeliver')) : null)));
  await dialog({
    title: t('webhooks.deliveriesTitle'),
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, ltr(w.url)),
      rows.length ? h('div', { class: 'row' },
        h('p', { class: 'muted small' },
          total > rows.length ? `${t('webhooks.showingNewest', { shown: fmtNum(rows.length), total: fmtNum(total) })} ` : '',
          t('webhooks.kept', { days: fmtNum(keptDays) }),
          total > exportMax ? ` ${t('webhooks.downloadMax', { max: fmtNum(exportMax) })}` : ''),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => downloadHistory(orgId, w) }, t('webhooks.download'))) : null,
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, [t('webhooks.time'), t('webhooks.event'), t('webhooks.result'), t('webhooks.attempts'), ''].map(th))),
          h('tbody', {}, rows)))
        : h('p', { class: 'empty' }, t('webhooks.noDeliveries'))),
    actions: [{ label: t('common.close'), value: true, kind: 'ghost' }],
  });
}

async function editEndpoint(orgId, w, events, refresh) {
  const f = form({
    fields: [
      { name: 'url', label: t('webhooks.url'), value: w.url, required: true, maxlength: 500, hint: t('webhooks.urlHint') },
      { name: 'description', label: t('webhooks.description'), value: w.description ?? '', maxlength: 120 },
      ...eventFields(events, w.events),
      { name: 'enabled', label: t('webhooks.enabled'), type: 'checkbox', value: w.enabled },
    ],
    submitLabel: t('common.save'),
    onSubmit: async (v) => {
      await patch(`/api/orgs/${orgId}/webhooks/${w.id}`, { url: v.url, description: v.description, events: chosenEvents(events, v), enabled: v.enabled });
      f.el.closest('dialog')?.close();
      toast(t('common.saved'));
      refresh();
    },
  });
  await dialog({ title: t('webhooks.editTitle'), body: f.el, actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }] });
}

export async function webhooksCard(orgId, info, refresh) {
  const card = h('div', { class: 'card', id: 'webhooks' }, h('h2', {}, t('webhooks.title')), h('p', { class: 'muted' }, t('webhooks.sub')));
  if (!info.plan.features.api_access) {
    card.append(h('p', {}, t('webhooks.notInPlan'), ' ', planLimitHint({ code: 'FEATURE_NOT_IN_PLAN' }, orgId, info.role)));
    return card;
  }
  const { webhooks, events, max } = await get(`/api/orgs/${orgId}/webhooks`);

  const list = webhooks.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, [t('webhooks.url'), t('webhooks.events'), t('webhooks.lastDelivery'), ''].map(th))),
      h('tbody', {}, webhooks.map((w) => h('tr', {},
        h('td', {}, ltr(w.url), w.description ? h('div', { class: 'muted small', dir: 'auto' }, w.description) : null, h('div', {}, statusPill(w))),
        h('td', {}, w.events.map(eventLabel).join(t('webhooks.listSep'))),
        h('td', {}, w.lastDelivery ? [resultText(w.lastDelivery), h('div', { class: 'muted small' }, fmtDate(w.lastDelivery.at, true))] : h('span', { class: 'muted' }, t('webhooks.never'))),
        h('td', { class: 'actions' },
          h('button', {
            type: 'button', class: 'btn small', 'aria-label': t('webhooks.testFor', { url: w.url }),
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const { delivery } = await post(`/api/orgs/${orgId}/webhooks/${w.id}/test`);
                if (delivery.status === 'delivered') toast(t('webhooks.testOk', { code: delivery.statusCode }));
                else toast(t('webhooks.testFailed', { error: delivery.error ?? delivery.statusCode }), 'error');
                refresh();
              } catch (err) { toast(errorMessage(err), 'error'); e.target.disabled = false; }
            },
          }, t('webhooks.test')),
          h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('webhooks.deliveriesFor', { url: w.url }), onclick: () => showDeliveries(orgId, w).catch((err) => toast(errorMessage(err), 'error')) }, t('webhooks.deliveries')),
          h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('webhooks.editFor', { url: w.url }), onclick: () => editEndpoint(orgId, w, events, refresh).catch((err) => toast(errorMessage(err), 'error')) }, t('common.edit')),
          h('button', {
            type: 'button', class: 'btn small ghost', 'aria-label': t('webhooks.rotateFor', { url: w.url }),
            onclick: async () => {
              if (!(await confirmDialog(t('webhooks.rotateTitle'), t('webhooks.rotateText'), { confirmLabel: t('webhooks.rotate') }))) return;
              try {
                const r = await post(`/api/orgs/${orgId}/webhooks/${w.id}/rotate-secret`);
                await showSecret(t('webhooks.newSecret'), r.secret);
                refresh();
              } catch (err) { toast(errorMessage(err), 'error'); }
            },
          }, t('webhooks.rotate')),
          h('button', {
            type: 'button', class: 'btn small danger ghost', 'aria-label': t('webhooks.deleteFor', { url: w.url }),
            onclick: async () => {
              if (!(await confirmDialog(t('webhooks.deleteTitle'), t('webhooks.deleteText', { url: w.url }), { danger: true, confirmLabel: t('common.delete') }))) return;
              try { await del(`/api/orgs/${orgId}/webhooks/${w.id}`); refresh(); } catch (err) { toast(errorMessage(err), 'error'); }
            },
          }, t('common.delete'))))))))
    : h('p', { class: 'muted' }, t('webhooks.none'));

  const add = form({
    fields: [
      { name: 'url', label: t('webhooks.url'), required: true, maxlength: 500, placeholder: 'https://', hint: t('webhooks.urlHint') },
      { name: 'description', label: t('webhooks.description'), maxlength: 120 },
      ...eventFields(events, events),
    ],
    submitLabel: t('webhooks.add'),
    onSubmit: async (v) => {
      const r = await post(`/api/orgs/${orgId}/webhooks`, { url: v.url, description: v.description, events: chosenEvents(events, v) });
      await showSecret(t('webhooks.created'), r.secret);
      refresh();
    },
  });
  card.append(list, webhooks.length < max ? h('div', { class: 'stack' }, h('h3', {}, t('webhooks.addTitle')), h('p', { class: 'muted small' }, t('webhooks.limit', { max })), add.el) : h('p', { class: 'muted' }, t('webhooks.limit', { max })));
  return card;
}
