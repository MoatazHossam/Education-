// Subtitles from the narration lines: each line is split into cues of at most two short lines,
// timed in proportion to their length within the line's spoken time.
import { plain } from './estimate.mjs';

const MAX = 84; // characters per cue (two lines of ~42)
const BREAK = /[،,.:؛;—?؟!]$/;

function chunks(text, measure) {
  const words = text.split(/\s+/).filter(Boolean);
  const len = (ws) => measure(ws.join(' ')).length;
  const total = len(words);
  const k = Math.max(1, Math.ceil(total / MAX));
  const target = total / k;
  const out = [];
  let cur = [];
  for (const [i, w] of words.entries()) {
    cur.push(w);
    const left = words.length - i - 1;
    const room = k - out.length - 1;
    // Close a cue near its share of the line, preferring a punctuation mark; never leave the rest too long.
    if (room > 0 && left > 0 && (len(cur) >= target || (len(cur) >= target * 0.7 && BREAK.test(w)))) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.map((ws) => wrap(ws, measure));
}

function wrap(ws, measure) {
  const full = ws.join(' ');
  if (measure(full).length <= 42) return full;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < ws.length; i++) {
    const d = Math.abs(measure(ws.slice(0, i).join(' ')).length - measure(ws.slice(i).join(' ')).length);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return `${ws.slice(0, best).join(' ')}\n${ws.slice(best).join(' ')}`;
}

const stamp = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** Cues for lines [{ t, d, ar, en }] with absolute times. lang: 'ar' (diacritized), 'ar-plain' or 'en'. */
export function cueList(lines, lang) {
  const cues = [];
  for (const l of lines) {
    const text = lang === 'en' ? l.en : lang === 'ar-plain' ? plain(l.ar) : l.ar;
    const parts = chunks(text, lang === 'en' ? (x) => x : plain);
    const weights = parts.map((p) => plain(p).length + 6);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = l.t;
    parts.forEach((p, i) => {
      const d = (l.d * weights[i]) / total;
      cues.push({ t0: t, t1: t + Math.max(1.0, d) - 0.04, text: p });
      t += d;
    });
  }
  // No overlaps.
  for (let i = 0; i + 1 < cues.length; i++) cues[i].t1 = Math.min(cues[i].t1, cues[i + 1].t0 - 0.02);
  return cues;
}

export function toSrt(lines, lang) {
  return cueList(lines, lang).map((c, i) => `${i + 1}\n${stamp(c.t0)} --> ${stamp(c.t1)}\n${c.text}\n`).join('\n');
}
