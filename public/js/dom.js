import { hasKey, locale, t } from './i18n.js';

/**
 * Element factory. Children that are strings become text nodes, so data from
 * the API is never interpreted as HTML (XSS-safe by construction).
 * h('button', { class: 'btn', onclick: fn, 'aria-pressed': 'true' }, 'Label')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

// Text in the other language than the page (English book titles in the Arabic
// interface, Arabic names in the English one) is wrapped in <span lang dir> so screen
// readers read it with the right voice (WCAG 3.1.2) and it keeps its own direction
// ("(Term 1 & Term 2)" stays in order inside Arabic text). Elements that set their own
// lang, and those whose text cannot hold markup, are left as they are.
const NO_LANG_MARKING = new Set(['OPTION', 'TEXTAREA', 'PRE', 'TITLE', 'STYLE', 'SCRIPT']);
const ARABIC = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const OTHER_LANGUAGE = {
  // In the English interface: Arabic words, with the spaces and punctuation between them.
  en: { lang: 'ar', dir: 'rtl', any: new RegExp(`[${ARABIC}]`), own: /[A-Za-z]/, runs: new RegExp(`[${ARABIC}]+(?:[\\s\\d\u060C\u061B\u061F.,:()\u2013\u2014-]*[${ARABIC}]+)*`, 'g') },
  // In the Arabic interface: Latin text up to the next Arabic word, so an email address, a URL or a code
  // ("scope.items_changed") stays one piece; it ends on a letter, digit, "/" or "…", or on a bracket it opened.
  // Digits written against its first letter belong to it, so a class called "7A" is not shown as "A7".
  ar: { lang: 'en', dir: 'ltr', any: /[A-Za-z]/, own: new RegExp(`[${ARABIC}]`), runs: new RegExp(`[0-9]*[A-Za-z](?:[^${ARABIC}]*[A-Za-z0-9/\u2026])?\\)?`, 'g') },
};

function otherSpan(other, text) {
  const span = document.createElement('span');
  span.lang = other.lang;
  span.dir = other.dir;
  span.textContent = text;
  return span;
}

function textNodes(text) {
  const other = OTHER_LANGUAGE[locale()];
  if (!other || !other.any.test(text)) return [document.createTextNode(text)];
  const out = [];
  if (!other.own.test(text)) {
    // Nothing in the page's language (a question written in English in the Arabic interface): one piece
    // with its punctuation, so a final "?" is not left to be read on its own.
    const [, before, body, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (before) out.push(document.createTextNode(before));
    out.push(otherSpan(other, body));
    if (after) out.push(document.createTextNode(after));
  } else {
    let last = 0;
    for (const m of text.matchAll(other.runs)) {
      // A closing bracket belongs to the run only when the run opened it.
      const run = m[0].endsWith(')') && !m[0].includes('(') ? m[0].slice(0, -1) : m[0];
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      out.push(otherSpan(other, run));
      last = m.index + run.length;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  }
  if (out.length === 1) return out;
  // Mixed text stays one inline piece, so a flex parent (a book button, a chip) lays it out as one item.
  const group = document.createElement('span');
  group.append(...out);
  return [group];
}

export function append(el, children) {
  const mark = !NO_LANG_MARKING.has(el.tagName) && !el.hasAttribute('lang');
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) el.append(c);
    else if (mark) el.append(...textNodes(String(c)));
    else el.append(document.createTextNode(String(c)));
  }
  return el;
}

/** Replaces an element's text, marking other-language runs as `append` does (for text set after rendering). */
export function setText(el, text) {
  el.replaceChildren(...textNodes(text));
}

/** A column header; the blank one over a row's buttons is named for screen readers. */
export function th(label) {
  return h('th', { scope: 'col' }, label || h('span', { class: 'sr-only' }, t('common.actions')));
}

/** An empty value: a dash on screen, "None" for screen readers. */
export function none() {
  return h('span', { class: 'muted' }, h('span', { 'aria-hidden': 'true' }, '\u2014'), h('span', { class: 'sr-only' }, t('common.none')));
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

/** A card holding a table that may scroll sideways: a labelled, focusable region so keyboard users can scroll it. */
export function tableCard(label, ...children) {
  return h('div', { class: 'card table-wrap', tabindex: '0', role: 'region', 'aria-label': label }, ...children);
}

export function link(href, text, attrs = {}) {
  return h('a', { href, 'data-link': '', ...attrs }, text);
}

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast-msg ${kind === 'error' ? 'error' : ''}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

/** Server messages are specific English text; Arabic uses the translated message for the error code. */
export function errorMessage(err) {
  const key = `err.${err?.code}`;
  if (locale() === 'ar' && hasKey(key)) return t(key);
  if (err?.message && !/^Request failed/.test(err.message)) return err.message;
  return hasKey(key) ? t(key) : t('err.generic');
}

/** Modal dialog built on <dialog>; resolves with the clicked action value. */
export function dialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    let value = null;
    const d = h('dialog', { 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title),
      body,
      h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
        type: 'button', class: `btn ${a.kind || ''}`, onclick: async () => {
          if (a.validate && !(await a.validate())) return;
          value = a.value;
          d.close();
        },
      }, a.label))),
    );
    // However it closes (an action, Escape, a link inside it), clean up and return
    // focus to the control that opened it, when that is still on the page.
    d.addEventListener('close', () => {
      d.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(value);
    });
    document.body.append(d);
    d.showModal();
  });
}

export async function confirmDialog(title, message, { confirmLabel, danger = false } = {}) {
  const v = await dialog({
    title,
    body: h('p', {}, message),
    actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: confirmLabel || t('common.confirm'), value: true, kind: danger ? 'danger' : '' }],
  });
  return Boolean(v);
}

/** Prompt for a single value (e.g. password confirmation). */
export async function promptDialog(title, label, { type = 'text', confirmLabel, danger = false, hint } = {}) {
  const input = h('input', { type, required: true, autocomplete: type === 'password' ? 'current-password' : 'off' });
  const v = await dialog({
    title,
    body: h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null),
    actions: [{ label: t('common.cancel'), value: null, kind: 'ghost' }, { label: confirmLabel || t('common.confirm'), value: 'ok', kind: danger ? 'danger' : '', validate: () => input.value.trim().length > 0 }],
  });
  return v ? input.value : null;
}

export function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB', opts).format(new Date(d));
}

export function fmtMoney(cents, currency) {
  return new Intl.NumberFormat(locale() === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function fmtNum(n) {
  return n === null || n === undefined ? '∞' : new Intl.NumberFormat(locale() === 'ar' ? 'ar-EG' : 'en-GB').format(n);
}

/** Builds a form whose fields show server-side validation errors next to inputs. */
export function form({ fields, submitLabel, onSubmit, extra }) {
  // Empty, it is not displayed (app.css); filling it is the one change a screen reader announces.
  const errBox = h('div', { class: 'alert error', role: 'alert' });
  const inputs = {};
  const rows = fields.map((f) => {
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name }, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value ? 'selected' : null }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, maxlength: f.maxlength }, f.value || '');
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox', checked: f.value });
      inputs[f.name] = input;
      return h('label', { class: 'check', for: id }, input, f.label);
    } else {
      input = h('input', { id, name: f.name, type: f.type || 'text', value: f.value ?? null, required: f.required ? true : null, autocomplete: f.autocomplete, minlength: f.minlength, maxlength: f.maxlength, inputmode: f.inputmode, placeholder: f.placeholder });
    }
    inputs[f.name] = input;
    // Screen readers read the hint and any error with the field.
    input.setAttribute('aria-describedby', f.hint ? `${id}-hint ${id}-err` : `${id}-err`);
    return h('div', { class: 'field' }, h('label', { for: id }, f.label), input, f.hint ? h('span', { class: 'hint', id: `${id}-hint` }, f.hint) : null, h('span', { class: 'err', id: `${id}-err`, hidden: true }));
  });
  const button = h('button', { type: 'submit', class: 'btn' }, submitLabel);
  const el = h('form', { class: 'stack', novalidate: true }, errBox, rows, extra || null, h('div', {}, button));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';
    for (const inp of Object.values(inputs)) {
      inp.removeAttribute('aria-invalid');
      const errEl = document.getElementById(`${inp.id}-err`);
      // Emptied too: a hidden element still describes the field it is referenced from.
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    }
    const values = Object.fromEntries(Object.entries(inputs).map(([k, inp]) => [k, inp.type === 'checkbox' ? inp.checked : inp.value]));
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await onSubmit(values);
    } catch (err) {
      let shown = false;
      if (Array.isArray(err?.details)) {
        for (const d of err.details) {
          const inp = inputs[d.path];
          const errEl = inp && document.getElementById(`${inp.id}-err`);
          if (errEl) { errEl.textContent = d.message; errEl.hidden = false; inp.setAttribute('aria-invalid', 'true'); shown = true; }
        }
      }
      if (shown && err.code === 'VALIDATION_ERROR') {
        // Field errors are not announced on their own: move to the first one, which reads its label and error.
        Object.values(inputs).find((inp) => inp.getAttribute('aria-invalid') === 'true')?.focus();
      } else {
        errBox.textContent = errorMessage(err);
      }
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
  return { el, inputs };
}

/** Triggers a browser download of text built on the client. */
export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
