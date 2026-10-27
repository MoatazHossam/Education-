// How long the school keeps classroom data (docs/CLASSROOM.md §11). Owners and
// admins set three periods, see what is due to be deleted, and keep single
// homework or tests longer. Homework and test pages say what is due or gone.
import { get, post, put } from '../api.js';
import { confirmDialog, errorMessage, fmtDate, fmtNum, h, link, none, tableCard, th, toast } from '../dom.js';
import { t } from '../i18n.js';
import { act, subjectName } from './classroom-common.js';
import { pageHead } from './shell.js';

const STAGES = ['monitoring', 'work', 'records'];
const FIELD = { monitoring: 'monitoringDays', work: 'workDays', records: 'recordsDays' };
const CHOICES = [7, 30, 90, 180, 365, 730, 1095, 1825];

/** "30 days", "1 year", "3 years"; in Arabic the noun follows the number (يومان، 7 أيام، 30 يومًا، سنتان، 3 سنوات). */
export function daysText(n) {
  if (n % 365 === 0) {
    const y = n / 365;
    if (y === 1) return t('ret.year1');
    if (y === 2) return t('ret.years2');
    return t(y <= 10 ? 'ret.yearsFew' : 'ret.yearsN', { n: fmtNum(y) });
  }
  if (n === 1) return t('ret.day1');
  if (n === 2) return t('ret.days2');
  return t(n <= 10 ? 'ret.daysFew' : 'ret.daysN', { n: fmtNum(n) });
}

const itemPath = (orgId, kind, id) => (kind === 'homework' ? `/org/${orgId}/homework/${id}` : `/org/${orgId}/tests/${id}`);

/** For a homework or test page (staff): kept, already deleted, or due to be deleted. */
export function retentionNotes(kind, item, retention) {
  if (!retention) return null;
  const notes = [];
  if (retention.hold) notes.push(t('ret.heldNote'));
  if (item.monitoringRemovedAt) notes.push(t('ret.removed.monitoring', { date: fmtDate(item.monitoringRemovedAt) }));
  if (item.workRemovedAt) notes.push(t(`ret.removed.work.${kind}`, { date: fmtDate(item.workRemovedAt) }));
  for (const p of retention.pending) notes.push(t(`ret.pending.${p.stage}.${kind}`, { date: fmtDate(p.deleteAfter) }));
  if (!notes.length) return null;
  return h('div', { class: 'notice' }, notes.map((n) => h('p', {}, n)), retention.pending.length && !retention.hold ? h('p', { class: 'muted' }, t('ret.askAdmin')) : null);
}

export async function retentionView(ctx) {
  const { orgId } = ctx.params;
  const data = await get(`/api/orgs/${orgId}/classroom-retention`);
  const hold = (kind, item, keep) => act(async () => {
    await put(`/api/orgs/${orgId}/classroom-retention/hold`, { kind, id: item.id, keep });
    toast(t(keep ? 'ret.keptToast' : 'ret.releasedToast', { title: item.title }));
    ctx.render();
  });

  // ---- the periods
  const err = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const selects = {};
  const fields = STAGES.map((stage) => {
    const current = data.periods[FIELD[stage]];
    const values = current === null || CHOICES.includes(current) ? CHOICES : [...CHOICES, current].sort((a, b) => a - b);
    const sel = h('select', { id: `ret-${stage}`, 'aria-describedby': `ret-${stage}-hint` },
      h('option', { value: '', selected: current === null ? 'selected' : null }, t('ret.keepAll')),
      values.map((d) => h('option', { value: String(d), selected: current === d ? 'selected' : null }, daysText(d))));
    selects[stage] = sel;
    return h('div', { class: 'field' }, h('label', { for: `ret-${stage}` }, t(`ret.stage.${stage}`)), sel, h('span', { class: 'hint', id: `ret-${stage}-hint` }, t(`ret.hint.${stage}`)));
  });
  const chosen = () => Object.fromEntries(STAGES.map((s) => [FIELD[s], selects[s].value === '' ? null : Number(selects[s].value)]));
  const save = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const periods = chosen();
    try {
      const preview = await post(`/api/orgs/${orgId}/classroom-retention/preview`, periods);
      if (preview.homework || preview.tests) {
        const ok = await confirmDialog(t('ret.confirmTitle'), t('ret.confirmText', { homework: fmtNum(preview.homework), tests: fmtNum(preview.tests), date: fmtDate(preview.deleteFrom) }), { danger: true, confirmLabel: t('ret.save') });
        if (!ok) return;
      }
      const r = await put(`/api/orgs/${orgId}/classroom-retention`, periods);
      toast(r.noticesSent ? t('ret.savedNotices', { n: fmtNum(r.noticesSent) }) : t('common.saved'));
      ctx.render();
    } catch (x) {
      err.textContent = errorMessage(x);
      err.hidden = false;
    }
  };
  const periodsCard = h('section', { class: 'card', 'aria-labelledby': 'ret-p' },
    h('h2', { id: 'ret-p' }, t('ret.periods')),
    h('p', {}, t('ret.intro', { days: fmtNum(data.noticeDays) })),
    h('form', { class: 'stack', onsubmit: save }, err, fields,
      h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn' }, t('ret.save')))),
    data.updatedAt ? h('p', { class: 'muted' }, t('ret.lastChanged', { name: data.updatedBy ?? t('ret.someone'), when: fmtDate(data.updatedAt, true) })) : null);

  // ---- what is due to be deleted
  const itemCell = (i) => h('td', {}, link(itemPath(orgId, i.kind, i.id), i.title, { dir: 'auto' }), h('span', { class: 'cell-sub' }, t(`grades.kind.${i.kind}`), ' · ', subjectName(i)));
  const upcoming = h('section', { class: 'card', 'aria-labelledby': 'ret-u' },
    h('h2', { id: 'ret-u' }, t('ret.upcoming')),
    data.upcoming.length
      ? [h('p', { class: 'muted' }, t('ret.upcomingHelp')),
        tableCard(t('ret.upcoming'), h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, [t('classes.class'), t('ret.item'), t('ret.what'), t('ret.onOrAfter'), t('ret.actions')].map(th))),
          h('tbody', {}, data.upcoming.map((i) => h('tr', {},
            h('td', {}, h('span', { dir: 'auto' }, i.className)),
            itemCell(i),
            h('td', {}, t(`ret.what.${i.stage}.${i.kind}`)),
            h('td', { class: 'nowrap' }, fmtDate(i.deleteAfter)),
            h('td', {}, h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('ret.keepItemLabel', { title: i.title }), onclick: () => hold(i.kind, i, true) }, t('ret.keepItem')),
              link(`/org/${orgId}/classes/${i.classId}/gradebook?subject=${encodeURIComponent(i.subjectEn)}`, t('grades.title'), { 'aria-label': t('ret.gradebookOf', { name: i.className, subject: subjectName(i) }) }))))))))]
      : h('p', { class: 'empty' }, t('ret.noneUpcoming')));

  // ---- kept whatever the periods say
  const held = data.held.length
    ? h('section', { class: 'card', 'aria-labelledby': 'ret-h' },
      h('h2', { id: 'ret-h' }, t('ret.held')),
      h('p', { class: 'muted' }, t('ret.heldHelp')),
      tableCard(t('ret.held'), h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [t('classes.class'), t('ret.item'), t('ret.date'), t('ret.actions')].map(th))),
        h('tbody', {}, data.held.map((i) => h('tr', {},
          h('td', {}, h('span', { dir: 'auto' }, i.className)),
          itemCell(i),
          h('td', { class: 'nowrap' }, i.date ? fmtDate(i.date) : none()),
          h('td', {}, h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('ret.releaseLabel', { title: i.title }), onclick: () => hold(i.kind, i, false) }, t('ret.release')))))))))
    : null;

  return h('div', {},
    h('p', { class: 'crumbs' }, link(`/org/${orgId}/classes`, t('classes.title'))),
    pageHead(t('ret.title'), t('ret.sub')),
    periodsCard, upcoming, held);
}
