// Small, deterministic animation helpers: every value is a pure function of time.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
/** 0 → 1 as t goes from t0 to t1 (clamped). */
export const prog = (t, t0, t1) => (t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));

export const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  outQuint: (k) => 1 - Math.pow(1 - k, 5),
  in: (k) => k * k * k,
  outBack: (k) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
};

/** Fades in over `d` at `t0` and out over `d` ending at `t1` (when given). */
export function fadeWindow(t, t0, t1 = Infinity, d = 0.5) {
  const a = ease.out(prog(t, t0, t0 + d));
  const b = t1 === Infinity ? 1 : 1 - ease.in(prog(t, t1 - d, t1));
  return Math.min(a, b);
}

/** Entrance: opacity and a small upward slide, eased. */
export function enter(el, t, t0, { d = 0.7, dy = 26, dx = 0, scale = 0, exit = Infinity, blur = 0 } = {}) {
  const k = ease.out(prog(t, t0, t0 + d));
  const out = exit === Infinity ? 1 : 1 - ease.in(prog(t, exit - 0.45, exit));
  const o = Math.min(k, out);
  el.style.opacity = o.toFixed(3);
  const s = scale ? 1 - scale * (1 - k) : 1;
  el.style.transform = `translate(${(dx * (1 - k)).toFixed(2)}px, ${(dy * (1 - k)).toFixed(2)}px) scale(${s.toFixed(4)})`;
  if (blur) el.style.filter = k < 1 ? `blur(${(blur * (1 - k)).toFixed(2)}px)` : 'none';
  return o;
}

/** A deterministic pseudo-random number in [0, 1) for a seed. */
export function rand(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Arabic-Indic digits for numbers shown in Arabic text. */
export const arDigits = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
