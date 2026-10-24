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

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

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
    const d = h('dialog', { 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title),
      body,
      h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
        type: 'button', class: `btn ${a.kind || ''}`, onclick: async () => {
          if (a.validate && !(await a.validate())) return;
          d.close(); d.remove(); resolve(a.value);
        },
      }, a.label))),
    );
    d.addEventListener('cancel', () => { d.remove(); resolve(null); });
    // Closed another way (e.g. a link inside it was followed): clean up too.
    d.addEventListener('close', () => { d.remove(); resolve(null); });
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
  const errBox = h('div', { class: 'alert error', role: 'alert', hidden: true });
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
    return h('div', { class: 'field' }, h('label', { for: id }, f.label), input, f.hint ? h('span', { class: 'hint' }, f.hint) : null, h('span', { class: 'err', id: `${id}-err`, hidden: true }));
  });
  const button = h('button', { type: 'submit', class: 'btn' }, submitLabel);
  const el = h('form', { class: 'stack', novalidate: true }, errBox, rows, extra || null, h('div', {}, button));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    for (const inp of Object.values(inputs)) {
      inp.removeAttribute('aria-invalid');
      const errEl = document.getElementById(`${inp.id}-err`);
      if (errEl) errEl.hidden = true;
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
      errBox.textContent = errorMessage(err);
      errBox.hidden = shown && err.code === 'VALIDATION_ERROR';
      if (!errBox.hidden) errBox.focus?.();
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
