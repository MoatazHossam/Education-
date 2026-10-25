// Two scopes side by side: which books each includes, grade by grade. Across
// catalogue years the server matches books by subject and title.
import { ApiError, get } from '../api.js';
import { dialog, downloadText, errorMessage, h, link, tableCard } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { invalidateOrg } from '../state.js';
import { pageHead, planLimitHint } from './shell.js';

const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)));
// The mark is shown; the words are read out.
// Text direction goes on inner spans: a cell keeps the page's direction, so columns line up in Arabic.
const auto = (...c) => h('span', { dir: 'auto' }, ...c);
const mark = (included) => included
  ? h('span', {}, h('span', { class: 'yes', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'sr-only' }, t('compare.included')))
  : h('span', { class: 'muted' }, h('span', { 'aria-hidden': 'true' }, '—'), h('span', { class: 'sr-only' }, t('compare.notIncluded')));

export async function compareView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const { scopes } = await get(`/api/orgs/${orgId}/scopes`);
  const back = link(`/org/${orgId}/scopes`, t('carry.back'));
  if (scopes.length < 2) return h('div', {}, pageHead(t('compare.title'), null, back), h('div', { class: 'card' }, h('p', { class: 'empty' }, t('compare.needTwo'))));

  const known = (id) => scopes.some((s) => s.id === id);
  const a = known(ctx.query.get('a')) ? ctx.query.get('a') : scopes[0].id;
  const wantedB = ctx.query.get('b');
  const b = known(wantedB) && wantedB !== a ? wantedB : scopes.find((s) => s.id !== a).id;
  const cmp = await get(`/api/orgs/${orgId}/scopes/compare?a=${a}&b=${b}`);
  const go = (na, nb) => navigate(`/org/${orgId}/scopes/compare?a=${na}&b=${nb}`);

  const chooser = (label, value, other, onpick) => h('label', { class: 'field' }, label,
    h('select', { onchange: (e) => onpick(e.target.value) },
      scopes.filter((s) => s.id !== other).map((s) => h('option', { value: s.id, selected: s.id === value }, `${s.name} · ${s.academicYear}`))));
  const controls = h('div', { class: 'card compare-controls' },
    chooser(t('compare.first'), a, b, (v) => go(v, b)),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => go(b, a) }, t('compare.swap')),
    chooser(t('compare.second'), b, a, (v) => go(a, v)));

  async function download() {
    try {
      const res = await fetch(`/api/orgs/${orgId}/scopes/compare?a=${a}&b=${b}&format=csv`, { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'compare.csv';
      downloadText(name, await res.text(), 'text/csv');
      invalidateOrg(orgId);
    } catch (err) {
      await dialog({ title: t('picker.exportFailed'), body: h('p', {}, errorMessage(err), ' ', planLimitHint(err, orgId, info.role)), actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
    }
  }

  const ar = locale() === 'ar';
  const nameOf = (s) => (ar ? s.nameAr : s.nameEn);
  const notes = (m) => [
    m.titleInB ? h('span', { class: 'muted' }, ' (', auto(t('compare.titledInB', { title: m.titleInB, name: cmp.b.name })), ')') : null,
    m.notInOtherCatalog ? h('span', { class: 'muted' }, ` (${t('compare.notInCatalogue', { year: m.side === 'a' ? cmp.b.academicYear : cmp.a.academicYear })})`) : null,
  ];
  const results = h('div', {});
  function renderResults(differencesOnly) {
    const subjects = cmp.subjects
      .map((s) => ({ ...s, materials: differencesOnly ? s.materials.filter((m) => m.side !== 'both') : s.materials }))
      .filter((s) => s.materials.length);
    const grades = [...new Set(subjects.map((s) => s.grade))];
    results.replaceChildren(
      ...(subjects.length
        ? grades.map((g) => {
          const title = `${t('picker.grade')} ${g}`;
          return tableCard(title, h('h2', {}, title), h('table', { class: 'data compare' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('compare.material')), h('th', { scope: 'col' }, auto(cmp.a.name)), h('th', { scope: 'col' }, auto(cmp.b.name)))),
            subjects.filter((s) => s.grade === g).map((s) => h('tbody', {},
              h('tr', { class: 'group' }, h('th', { scope: 'colgroup', colspan: '3' }, auto(nameOf(s)),
                s.onlyIn ? h('span', { class: 'muted' }, ` (${t('compare.notInCatalogue', { year: s.onlyIn === 'a' ? cmp.b.academicYear : cmp.a.academicYear })})`) : null)),
              s.materials.map((m) => h('tr', { class: m.side === 'both' ? '' : `only-${m.side}` },
                h('th', { scope: 'row' }, auto(m.title), notes(m)),
                h('td', {}, mark(m.side !== 'b')),
                h('td', {}, mark(m.side !== 'a'))))))));
        })
        : [h('div', { class: 'card' }, h('p', { class: 'empty' }, cmp.subjects.length ? t('compare.noDifferences') : t('compare.empty')))]));
  }
  const filter = h('input', { type: 'checkbox', checked: true, onchange: (e) => renderResults(e.target.checked) });
  renderResults(true);

  return h('div', {},
    pageHead(t('compare.title'), t('compare.sub'), back),
    controls,
    h('div', { class: 'stats' },
      stat(t('compare.onlyIn', { name: cmp.a.name }), cmp.summary.onlyA),
      stat(t('compare.onlyIn', { name: cmp.b.name }), cmp.summary.onlyB),
      stat(t('compare.inBoth'), cmp.summary.both)),
    cmp.sameVersion ? null : h('p', { class: 'notice' }, t('compare.versionsDiffer', { a: cmp.a.academicYear, b: cmp.b.academicYear })),
    h('div', { class: 'row compare-tools' },
      h('label', { class: 'check' }, filter, h('span', {}, t('compare.differencesOnly'))),
      h('button', { type: 'button', class: 'btn ghost', onclick: download }, t('compare.download'))),
    results);
}
