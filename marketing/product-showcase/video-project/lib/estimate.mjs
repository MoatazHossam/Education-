// Estimated speaking time of a narration line, used until recorded narration exists (then the
// recording's own duration is used). Calibrated for unhurried Modern Standard Arabic narration.
const DIACRITICS = /[ً-ْٰـ]/g;
// About 105 words a minute: the unhurried pace of documentary narration in Arabic.
export const CHARS_PER_SECOND = 12.0;

export function plain(text) {
  return text.replace(DIACRITICS, '');
}

export function estimateSeconds(text) {
  const t = plain(text);
  const chars = [...t.replace(/[.,،؛:!?؟—«»()"']/g, '')].length;
  const pauses = (t.match(/[،,]/g) ?? []).length * 0.22 + (t.match(/[.؟?!:؛]/g) ?? []).length * 0.4 + (t.match(/—/g) ?? []).length * 0.25;
  return chars / CHARS_PER_SECOND + pauses;
}

export function wordCount(text) {
  return plain(text).split(/\s+/).filter((w) => /[؀-ۿA-Za-z0-9]/.test(w)).length;
}
