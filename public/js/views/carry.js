// Carrying a content scope to a newer catalogue version (usually the next
// academic year): the server matches the selection, the customer reviews what
// is missing, what changed and what is new, then copies or moves the scope.
import { get, post } from '../api.js';
import { errorMessage, h, link, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg } from '../state.js';
import { pageHead, planLimitHint } from './shell.js';

/** The published version a scope should move to, if any: a later academic year, or any published one when its own was archived. */
export function newerVersionFor(scope, versions) {
  const own = versions.find((v) => v.id === scope.catalogVersionId);
  return versions.find((v) => v.status === 'published' && v.id !== scope.catalogVersionId && (v.academicYear > scope.academicYear || own?.status === 'archived')) || null;
}

const FIELDS = ['nameEn', 'nameAr', 'block', 'status', 'note'];
const fieldValue = (field, v) => (v === null || v === '' ? '—' : field === 'status' ? t(`status.${v}`) : v);

export async function carryView(ctx) {
  const { orgId, scopeId } = ctx.params;
  const info = ctx.info;
  const canEdit = can(info.role, 'editor');
  const [{ scopes, limit }, { versions }] = await Promise.all([get(`/api/orgs/${orgId}/scopes`), get('/api/catalog/versions')]);
  const scope = scopes.find((s) => s.id === scopeId);
  const back = link(`/org/${orgId}/scopes`, t('carry.back'));
  if (!scope) return h('div', {}, pageHead(t('notfound.title'), null, back));
  const targets = versions.filter((v) => v.status === 'published' && v.id !== scope.catalogVersionId);
  if (!targets.length) return h('div', {}, pageHead(t('carry.title', { name: scope.name }), null, back), h('div', { class: 'card' }, h('p', { class: 'empty' }, t('carry.noTarget'))));
  const wanted = ctx.query.get('to');
  const to = targets.find((v) => v.id === wanted) || newerVersionFor(scope, versions) || targets[0];
  const preview = await get(`/api/orgs/${orgId}/scopes/${scopeId}/carry-forward?to=${to.id}`);
  const { plan } = preview;
  const year = preview.to.academicYear;
  const ar = locale() === 'ar';
  const subjectTitle = (s) => `${t('picker.grade')} ${s.source.grade} · ${ar ? s.source.nameAr : s.source.nameEn}`;

  // Ticked new books are added; unticked carried books are skipped.
  const add = new Set();
  const skip = new Set();
  const checkbox = (checked, onchange) => h('input', { type: 'checkbox', checked, onchange, disabled: canEdit ? null : true });
  const addChoice = (m) => h('label', { class: 'check' },
    checkbox(false, (e) => { if (e.target.checked) add.add(m.id); else add.delete(m.id); }), h('span', { dir: 'auto' }, m.title));
  const keepChoice = (c) => h('label', { class: 'check' },
    checkbox(true, (e) => { if (e.target.checked) skip.delete(c.toId); else skip.add(c.toId); }), h('span', { dir: 'auto' }, c.title),
    c.renamedFrom ? h('span', { class: 'muted', dir: 'auto' }, ` (${t('carry.renamedFrom', { title: c.renamedFrom })})`) : null);

  const withMissing = plan.subjects.filter((s) => s.missing.length);
  const withChanges = plan.subjects.filter((s) => s.changes.length);
  const withNew = plan.subjects.filter((s) => !s.missing.length && s.added.length);
  const carried = plan.subjects.flatMap((s) => s.carried);

  const missingCard = withMissing.length ? h('div', { class: 'card' },
    h('h2', {}, t('carry.missingTitle', { year })),
    h('p', { class: 'muted' }, t('carry.missingSub')),
    withMissing.map((s) => h('div', { class: 'carry-subj' },
      h('h3', { dir: 'auto' }, subjectTitle(s), ' ', s.target ? null : h('span', { class: 'pill warn' }, t('carry.subjectRemoved'))),
      h('ul', {}, s.missing.map((m) => h('li', { dir: 'auto' }, m.title))),
      s.added.length ? [h('p', { class: 'muted' }, t('carry.addInstead', { year })), s.added.map(addChoice)] : null))) : null;

  const changesCard = withChanges.length ? h('div', { class: 'card' },
    h('h2', {}, t('carry.changesTitle')),
    withChanges.map((s) => h('div', { class: 'carry-subj' },
      h('h3', { dir: 'auto' }, subjectTitle(s)),
      h('ul', {}, s.changes.filter((c) => FIELDS.includes(c.field)).map((c) => h('li', {},
        h('b', {}, t(`carry.field.${c.field}`)), ': ', h('span', { dir: 'auto' }, fieldValue(c.field, c.from)), ' → ', h('span', { dir: 'auto' }, fieldValue(c.field, c.to)))))))) : null;

  const newCard = withNew.length ? h('div', { class: 'card' },
    h('h2', {}, t('carry.newTitle')),
    withNew.map((s) => h('div', { class: 'carry-subj' }, h('h3', { dir: 'auto' }, subjectTitle(s)), s.added.map(addChoice)))) : null;

  const carriedCard = carried.length ? h('details', { class: 'card' },
    h('summary', {}, t('carry.carriedTitle', { n: carried.length })),
    h('div', { class: 'stack' }, carried.map(keepChoice))) : null;

  // Options: copying needs a free scope slot; moving reuses this one.
  const atLimit = limit !== null && scopes.length >= limit;
  const err = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', maxlength: '120', value: preview.suggestedName });
  const nameField = h('label', { class: 'field' }, t('carry.newName'), name);
  let mode = atLimit ? 'move' : 'copy';
  const radio = (value, label, disabled) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'carry-mode', value, checked: value === mode, disabled: disabled ? true : null, onchange: () => { mode = value; nameField.hidden = value !== 'copy'; } }), label);
  nameField.hidden = mode !== 'copy';
  const submit = h('button', {
    type: 'button', class: 'btn', onclick: async () => {
      submit.disabled = true;
      err.hidden = true;
      try {
        const r = await post(`/api/orgs/${orgId}/scopes/${scopeId}/carry-forward`, { targetVersionId: to.id, mode, ...(mode === 'copy' ? { name: name.value } : {}), add: [...add], skip: [...skip] });
        invalidateOrg(orgId);
        toast(t('carry.done', { n: r.itemCount }));
        navigate(`/org/${orgId}?scope=${r.scope.id}`);
      } catch (e) {
        err.replaceChildren(errorMessage(e), ' ', planLimitHint(e, orgId, info.role) || '');
        err.hidden = false;
        submit.disabled = false;
      }
    },
  }, t('carry.submit'));
  const optionsCard = canEdit
    ? h('div', { class: 'card stack' },
      h('h2', {}, t('carry.how')),
      err,
      radio('copy', t('carry.modeCopy', { year, name: scope.name }), atLimit),
      atLimit ? h('p', { class: 'muted' }, t('carry.limitHint', { limit })) : null,
      radio('move', t('carry.modeMove', { year, name: scope.name }), scope.readOnly),
      nameField,
      h('div', { class: 'row' }, submit, back))
    : h('div', { class: 'card' }, h('p', { class: 'muted' }, t('carry.viewerNote')));

  const targetPicker = targets.length > 1 ? h('label', { class: 'row' }, t('carry.target'), h('select', { onchange: (e) => navigate(`/org/${orgId}/scopes/${scopeId}/carry?to=${e.target.value}`) },
    targets.map((v) => h('option', { value: v.id, selected: v.id === to.id ? 'selected' : null }, `${v.academicYear} — ${v.label}`)))) : null;

  const s = plan.summary;
  return h('div', {},
    // In right-to-left text the "from" year sits on the right, so the arrow points left.
    pageHead(t('carry.title', { name: scope.name }), `${preview.from.academicYear} ${ar ? '←' : '→'} ${year}`, h('div', { class: 'row' }, back, targetPicker)),
    h('div', { class: 'card' }, h('p', {}, s.selected ? t('carry.summary', { carried: s.carried, selected: s.selected, missing: s.missing }) : t('carry.empty'))),
    missingCard, changesCard, newCard, carriedCard, optionsCard);
}
