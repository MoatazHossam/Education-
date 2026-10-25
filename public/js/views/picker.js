// The original Egypt Curriculum Picker, now persisted per organization.
// Rendering follows the original artifact (grade ruler, track/kind filters,
// search, blocks of subjects, selection tray, copy list). Selections are saved
// to a server-side "content scope" instead of localStorage.
import { ApiError, del, get, post } from '../api.js';
import { confirmDialog, dialog, downloadText, errorMessage, h, link, toast } from '../dom.js';
import { locale, t } from '../i18n.js';
import { navigate } from '../router.js';
import { can, invalidateOrg } from '../state.js';
import { coverageLine, materialMark, verificationDetails } from '../verify.js';
import { newerVersionFor } from './carry.js';
import { planLimitHint } from './shell.js';

const TRACKS = ['all', 'moe', 'sec', 'bac', 'ta', 'intl'];
const KINDS = ['moe', 'lang', 'ext', 'prog', 'exam'];
const STATUS_CLASS = { scored: 'st-scored', pass: 'st-pass', act: 'st-act' };
const FLUSH_MS = 400;

function gradeShort(g) {
  if (g <= 6) return `${t('picker.short.p')}${g}`;
  if (g <= 9) return `${t('picker.short.prep')}${g - 6}`;
  return `${t('picker.short.sec')}${g - 9}`;
}

function stageLabel(g) {
  return g <= 6 ? t('picker.stage.primary') : g <= 9 ? t('picker.stage.prep') : t('picker.stage.secondary');
}

/** Same layout as the original "Copy list" (and the server's text export). */
export function listText(tree, sel) {
  let s = '';
  let grade = -1;
  let group = '';
  const names = Object.fromEntries(tree.grades.map((g) => [g.grade, g]));
  for (const subj of tree.subjects) {
    for (const m of subj.materials) {
      if (!sel.has(m.id)) continue;
      if (subj.grade !== grade) {
        grade = subj.grade;
        group = '';
        s += `\n${names[grade].nameEn} / ${names[grade].nameAr}\n`;
      }
      const key = `${subj.block} — ${subj.nameEn}`;
      if (key !== group) { group = key; s += `  • ${key}\n`; }
      s += `      - ${m.title}\n`;
    }
  }
  return s.trim() || t('picker.nothingSelected');
}

const prefKey = (orgId) => `cs-scope-${orgId}`;
const readPref = (orgId) => { try { return localStorage.getItem(prefKey(orgId)); } catch { return null; } };
const writePref = (orgId, id) => { try { localStorage.setItem(prefKey(orgId), id); } catch { /* optional convenience */ } };

export async function pickerView(ctx) {
  const { orgId } = ctx.params;
  const info = ctx.info;
  const canEdit = can(info.role, 'editor');
  const [{ scopes }, { versions }] = await Promise.all([get(`/api/orgs/${orgId}/scopes`), get('/api/catalog/versions')]);
  const wanted = ctx.query.get('scope') || readPref(orgId);
  let scope = scopes.find((s) => s.id === wanted) || scopes[0] || null;
  const published = versions.filter((v) => v.status === 'published');
  const versionId = scope?.catalogVersionId || published[0]?.id;
  if (!versionId) return h('div', { class: 'wrap' }, h('div', { class: 'alert' }, t('picker.noCatalog')));
  const [tree, scopeData] = await Promise.all([
    get(`/api/catalog/versions/${versionId}`),
    scope ? get(`/api/orgs/${orgId}/scopes/${scope.id}`) : Promise.resolve({ materialIds: [] }),
  ]);
  if (scope) writePref(orgId, scope.id);

  const sel = new Set(scopeData.materialIds);
  // Notes and assignees on selected books (managed on the scope's notes page).
  const notes = new Map((scopeData.annotations ?? []).map((a) => [a.materialId, a]));
  const noteMark = (id) => {
    const a = notes.get(id);
    if (!a) return null;
    return h('span', { class: 'note-mark' }, h('span', { class: 'mnote', 'aria-hidden': 'true' }, '✎'),
      h('span', { class: 'sr-only' }, ` (${a.note ? t('items.markNote') : a.assigneeName ? t('items.markAssigned', { name: a.assigneeName }) : t('items.markTracked')})`));
  };
  const readOnly = !scope || !canEdit || scope.readOnly;
  const st = { track: 'all', grades: new Set(), kinds: new Set(KINDS), q: '' };
  const pending = { add: new Set(), remove: new Set() };
  let flushTimer = null;
  let flushing = Promise.resolve();
  let shownIds = [];
  const ar = locale() === 'ar';

  // ------------------------------------------------------------ persistence
  const buttonsById = new Map();
  const cnt = h('span', {}, String(sel.size));
  const toastEl = h('span', { class: 'toast', 'aria-live': 'polite' });
  const say = (msg) => { toastEl.textContent = msg; setTimeout(() => { if (toastEl.textContent === msg) toastEl.textContent = ''; }, 1800); };

  function setPressed(id) {
    const b = buttonsById.get(id);
    if (b) b.setAttribute('aria-pressed', String(sel.has(id)));
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushing = flushing.then(flush); }, FLUSH_MS);
  }

  async function flush() {
    if (!pending.add.size && !pending.remove.size) return;
    const add = [...pending.add];
    const remove = [...pending.remove];
    pending.add.clear();
    pending.remove.clear();
    try {
      for (let i = 0; i < Math.max(add.length, remove.length); i += 2000) {
        const res = await post(`/api/orgs/${orgId}/scopes/${scope.id}/items`, { add: add.slice(i, i + 2000), remove: remove.slice(i, i + 2000) });
        scope.itemCount = res.itemCount;
      }
      say(t('picker.saved'));
    } catch (err) {
      // Roll back the optimistic change so the screen matches the server.
      for (const id of add) { sel.delete(id); setPressed(id); }
      for (const id of remove) { sel.add(id); setPressed(id); }
      updTray();
      toast(errorMessage(err), 'error');
    }
  }

  async function toggle(id) {
    if (readOnly) return explainReadOnly();
    // Deselecting a book drops its note and assignee: ask first.
    if (sel.has(id) && notes.has(id)) {
      if (!(await confirmDialog(t('items.removeTitle'), t('items.removeText'), { danger: true, confirmLabel: t('items.removeConfirm') }))) return;
      notes.delete(id);
      buttonsById.get(id)?.querySelector('.note-mark')?.remove();
    }
    if (sel.has(id)) {
      sel.delete(id);
      if (pending.add.has(id)) pending.add.delete(id); else pending.remove.add(id);
    } else {
      sel.add(id);
      if (pending.remove.has(id)) pending.remove.delete(id); else pending.add.add(id);
    }
    setPressed(id);
    updTray();
    scheduleFlush();
  }

  function explainReadOnly() {
    if (!scope) toast(t('picker.createScopeFirst'));
    else if (!canEdit) toast(t('picker.viewerReadOnly'));
    else toast(t('picker.scopeReadOnly'));
  }

  window.addEventListener('beforeunload', () => { if (pending.add.size || pending.remove.size) void flush(); }, { once: true });

  // ------------------------------------------------------------ controls
  const mkBtn = (cls, label, pressed, on, extra = {}) => h('button', { type: 'button', class: cls, 'aria-pressed': String(pressed), onclick: on, ...extra }, label);
  const tracksEl = h('div', { class: 'seg' });
  const gradesEl = h('div', { class: 'grades' });
  const kindsEl = h('div', { class: 'seg' });
  const out = h('div', { id: 'out' });

  function drawControls() {
    tracksEl.replaceChildren(...TRACKS.map((k) => mkBtn('chipbtn', t(`track.${k}`), st.track === k, () => { st.track = k; drawControls(); render(); })));
    const gb = [];
    for (let i = 1; i <= 12; i++) {
      gb.push(mkBtn('gbtn', [gradeShort(i), h('small', {}, `G${i}`)], st.grades.has(i), () => { if (st.grades.has(i)) st.grades.delete(i); else st.grades.add(i); drawControls(); render(); }, { 'aria-label': `${t('picker.grade')} ${i}` }));
    }
    gradesEl.replaceChildren(...gb);
    kindsEl.replaceChildren(...KINDS.map((k) => mkBtn('chipbtn', t(`kind.${k}`), st.kinds.has(k), () => { if (st.kinds.has(k)) st.kinds.delete(k); else st.kinds.add(k); drawControls(); render(); })));
  }

  // ------------------------------------------------------------ catalogue rendering
  const gradeNames = Object.fromEntries(tree.grades.map((g) => [g.grade, g]));
  function render() {
    const q = st.q.trim().toLowerCase();
    out.replaceChildren();
    buttonsById.clear();
    shownIds = [];
    for (let g = 1; g <= 12; g++) {
      if (st.grades.size && !st.grades.has(g)) continue;
      const rows = tree.subjects.filter((it) => it.grade === g && (st.track === 'all' || it.track === st.track));
      const blocks = new Map();
      for (const it of rows) {
        const mats = it.materials.filter((m) => st.kinds.has(m.kind));
        // Match against visible materials only (the original also matched hidden kinds, showing rows for no visible reason).
        const hay = `${it.nameEn} ${it.nameAr} ${it.block} ${mats.map((m) => m.title).join(' ')}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        if (!mats.length) continue;
        if (!blocks.has(it.block)) blocks.set(it.block, []);
        blocks.get(it.block).push([it, mats]);
      }
      if (!blocks.size) continue;
      const gn = gradeNames[g];
      const sec = h('section', { class: 'grade', id: `g${g}`, 'aria-labelledby': `g${g}-h` },
        h('div', { class: 'ghead' },
          h('h2', { id: `g${g}-h` }, ar ? gn.nameAr : gn.nameEn),
          h('span', { class: 'ar', lang: ar ? 'en' : 'ar', dir: ar ? 'ltr' : 'rtl' }, ar ? gn.nameEn : gn.nameAr),
          h('span', { class: 'meta' }, `${t('picker.grade')} ${g} · ${stageLabel(g)}`)),
        tree.version.gradeNotes[String(g)] ? h('p', { class: 'gnote', dir: 'auto' }, tree.version.gradeNotes[String(g)]) : null);
      for (const [bname, list] of blocks) {
        const b = h('div', { class: 'block' }, h('div', { class: 'bhead' }, h('span', { dir: 'auto', class: 'bname' }, bname), h('span', {}, t(list.length > 1 ? 'picker.subjects' : 'picker.subject', { n: list.length }))));
        for (const [it, mats] of list) {
          const matWrap = h('div', { class: 'mats' });
          for (const m of mats) {
            shownIds.push(m.id);
            const btn = mkBtn(`mat ${m.kind}`, [m.title, materialMark(m), noteMark(m.id)], sel.has(m.id), () => toggle(m.id), { dir: 'auto', ...(readOnly ? { 'aria-disabled': 'true' } : {}) });
            buttonsById.set(m.id, btn);
            matWrap.append(btn);
          }
          b.append(h('div', { class: 'subj' },
            h('div', { class: 'sname' },
              h('b', {}, ar ? it.nameAr : it.nameEn),
              h('span', { class: 'ar', lang: ar ? 'en' : 'ar', dir: ar ? 'ltr' : 'rtl' }, ar ? it.nameEn : it.nameAr),
              h('span', { class: `status ${STATUS_CLASS[it.status]}` }, t(`status.${it.status}`)),
              verificationDetails(it)),
            matWrap,
            it.note ? h('p', { class: 'snote', dir: 'auto' }, it.note) : null));
        }
        sec.append(b);
      }
      out.append(sec);
    }
    if (!out.children.length) out.append(h('p', { class: 'empty' }, t('picker.noMatch')));
    updTray();
  }

  // ------------------------------------------------------------ tray
  const listPre = h('pre', { dir: 'auto' });
  const panel = h('div', { class: 'panel', hidden: true }, listPre);
  const viewBtn = h('button', { class: 'act ghost', type: 'button' }, t('picker.viewList'));
  function updTray() {
    cnt.textContent = String(sel.size);
    if (!panel.hidden) listPre.textContent = listText(tree, sel);
  }

  const selAll = h('button', {
    class: 'act ghost', type: 'button', onclick: () => {
      if (readOnly) return explainReadOnly();
      for (const id of shownIds) if (!sel.has(id)) { sel.add(id); pending.remove.delete(id); pending.add.add(id); setPressed(id); }
      updTray();
      scheduleFlush();
    },
  }, t('picker.selectAll'));

  const clearBtn = h('button', {
    class: 'act ghost', type: 'button', onclick: async () => {
      if (readOnly) return explainReadOnly();
      if (!sel.size || !(await confirmDialog(t('picker.clearTitle'), t('picker.clearText', { n: sel.size, scope: scope.name }), { danger: true, confirmLabel: t('picker.clear') }))) return;
      clearTimeout(flushTimer);
      await flushing;
      pending.add.clear();
      pending.remove.clear();
      try {
        await del(`/api/orgs/${orgId}/scopes/${scope.id}/items`);
        sel.clear();
        render();
        say(t('picker.cleared'));
      } catch (err) { toast(errorMessage(err), 'error'); }
    },
  }, t('picker.clear'));

  viewBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    viewBtn.textContent = panel.hidden ? t('picker.viewList') : t('picker.hideList');
    updTray();
  });

  const copyBtn = h('button', {
    class: 'act', type: 'button', onclick: () => {
      const text = listText(tree, sel);
      const fallback = () => {
        panel.hidden = false;
        listPre.textContent = text;
        const r = document.createRange();
        r.selectNodeContents(listPre);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        say(t('picker.pressCopy'));
      };
      try { navigator.clipboard.writeText(text).then(() => say(t('picker.copied')), fallback); } catch { fallback(); }
    },
  }, t('picker.copyList'));

  async function download(format) {
    if (!scope) return explainReadOnly();
    await flushing;
    try {
      const res = await fetch(`/api/orgs/${orgId}/scopes/${scope.id}/export?format=${format}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body);
      }
      const cd = res.headers.get('content-disposition') || '';
      const name = /filename="([^"]+)"/.exec(cd)?.[1] || `scope.${format}`;
      downloadText(name, await res.text(), res.headers.get('content-type') || 'text/plain');
      invalidateOrg(orgId);
    } catch (err) {
      const hint = planLimitHint(err, orgId, info.role);
      await dialog({ title: t('picker.exportFailed'), body: h('p', {}, errorMessage(err), ' ', hint), actions: [{ label: t('common.close'), value: true, kind: 'ghost' }] });
    }
  }
  const dlSelect = h('select', {
    'aria-label': t('picker.download'),
    onchange: (e) => { const f = e.target.value; e.target.value = ''; if (f) download(f); },
  }, h('option', { value: '' }, t('picker.download')), h('option', { value: 'txt' }, 'TXT'), h('option', { value: 'csv' }, 'CSV'), h('option', { value: 'json' }, 'JSON'));

  // ------------------------------------------------------------ scope bar
  async function createScope() {
    const name = h('input', { type: 'text', required: true, maxlength: 120 });
    const desc = h('textarea', { maxlength: 2000 });
    const ver = h('select', {}, published.map((v) => h('option', { value: v.id }, `${v.academicYear} — ${v.label}`)));
    const err = h('div', { class: 'alert error', hidden: true });
    let created = null;
    const ok = await dialog({
      title: t('scopes.new'),
      body: h('div', { class: 'stack' }, err,
        h('label', { class: 'field' }, t('scopes.name'), name),
        h('label', { class: 'field' }, t('scopes.description'), desc),
        h('label', { class: 'field' }, t('scopes.catalogVersion'), ver)),
      actions: [
        { label: t('common.cancel'), value: false, kind: 'ghost' },
        {
          label: t('common.create'), value: true, validate: async () => {
            try {
              created = (await post(`/api/orgs/${orgId}/scopes`, { name: name.value, description: desc.value || null, catalogVersionId: ver.value })).scope;
              return true;
            } catch (e) {
              err.replaceChildren(errorMessage(e), ' ', planLimitHint(e, orgId, info.role) || '');
              err.hidden = false;
              return false;
            }
          },
        },
      ],
    });
    if (ok && created) {
      invalidateOrg(orgId);
      navigate(`/org/${orgId}?scope=${created.id}`);
    }
  }

  const scopeSelect = scopes.length
    ? h('select', { 'aria-label': t('picker.scope'), onchange: async (e) => { await flushing; navigate(`/org/${orgId}?scope=${e.target.value}`); } },
      scopes.map((s) => h('option', { value: s.id, selected: s.id === scope?.id ? 'selected' : null }, s.name.includes(s.academicYear) ? s.name : `${s.name} (${s.academicYear})`)))
    : null;
  const scopeBar = h('div', { class: 'scopebar' },
    h('span', { class: 'lbl' }, t('picker.scope')),
    scopeSelect || h('span', { class: 'muted' }, t('picker.noScopes')),
    canEdit ? h('button', { type: 'button', class: 'btn small ghost', onclick: createScope }, t('scopes.new')) : null,
    scope ? link(`/org/${orgId}/scopes/${scope.id}/items`, t('items.link'), { class: 'btn small ghost' }) : null,
    readOnly && scope ? h('span', { class: 'ro-note' }, canEdit ? t('picker.scopeReadOnly') : t('picker.viewerReadOnly')) : null);

  const search = h('input', { type: 'search', placeholder: t('picker.searchPlaceholder'), 'aria-label': t('picker.search'), oninput: (e) => { st.q = e.target.value; render(); } });
  const notice = tree.version.notice || '';
  const firstStop = notice.indexOf('. ');
  const noticeEl = notice ? h('div', { class: 'notice', dir: 'auto' }, firstStop > 0 ? [h('b', {}, notice.slice(0, firstStop + 1)), notice.slice(firstStop + 1)] : notice) : null;

  const onboarding = !scopes.length
    ? h('div', { class: 'card', role: 'region', 'aria-label': t('picker.onboardTitle') },
      h('h2', {}, t('picker.onboardTitle')),
      h('p', { class: 'muted' }, t('picker.onboardText')),
      canEdit ? h('button', { type: 'button', class: 'btn', onclick: createScope }, t('scopes.createFirst')) : h('p', {}, t('picker.askEditor')))
    : null;

  // A newer catalogue has been published since this scope was made: offer to carry it forward.
  const next = scope ? newerVersionFor(scope, versions) : null;
  const carryBanner = next
    ? h('div', { class: 'notice carry-banner', role: 'status' }, t('carry.banner', { year: next.academicYear }), ' ',
      canEdit ? link(`/org/${orgId}/scopes/${scope.id}/carry?to=${next.id}`, t('carry.bannerLink')) : null)
    : null;

  drawControls();
  render();

  return h('div', { class: 'wrap picker' },
    onboarding,
    h('header', {},
      h('div', { class: 'eyebrow' }, `${info.organization.name} · ${t('picker.contentScope')} · ${t('picker.academicYear')} ${tree.version.academicYear}`),
      h('h1', {}, 'Egypt Curriculum Picker ', h('span', { lang: 'ar' }, '· دليل المناهج')),
      h('p', { class: 'lede' }, t('picker.lede')),
      noticeEl,
      coverageLine(tree),
      carryBanner),
    h('div', { class: 'controls', role: 'region', 'aria-label': t('picker.filters') },
      scopeBar,
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('picker.track')), tracksEl),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('picker.grade')), gradesEl),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('picker.show')), kindsEl, search),
      h('div', { class: 'legend' },
        ['scored', 'pass', 'act'].map((k) => h('span', {}, h('i', { class: `sw-${k}` }), t(`legend.${k}`))),
        KINDS.map((k) => h('span', {}, h('i', { class: `sw-${k}` }), t(`legend.${k}`))),
        h('span', {}, h('b', { class: 'mv ok', 'aria-hidden': 'true' }, '✓'), ' ', t('verify.legend')))),
    out,
    tree.sources.length ? h('div', { class: 'sources' }, h('h3', {}, t('picker.sources')),
      h('ul', {}, tree.sources.map((s) => h('li', { dir: 'auto' }, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title))))) : null,
    h('div', { class: 'tray', role: 'region', 'aria-label': t('picker.selection') },
      h('div', { class: 'in' },
        h('div', { class: 'count' }, t('picker.selected'), ' ', cnt, ' ', t('picker.items')),
        h('div', { class: 'row' }, toastEl, selAll, clearBtn, viewBtn, copyBtn, dlSelect)),
      panel),
  );
}
pickerView.wide = true;
