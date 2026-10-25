import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

// A simulated screen reader (Guidepup's Virtual Screen Reader) loaded into the
// test browser. It walks the accessibility tree in reading order and logs the
// phrases a screen reader would speak. It is not NVDA, VoiceOver or TalkBack:
// it has no voices, no language switching, no browse/focus modes and no
// verbosity settings (docs/SCREEN_READER_PRECHECK.md). The pages need a
// browser context with bypassCSP, since the app's CSP forbids injected scripts.

const require = createRequire(import.meta.url);
const BUNDLE = readFileSync(require.resolve('@guidepup/virtual-screen-reader/browser.js'), 'utf8');
export const TRANSCRIPTS = 'test-results/screen-reader';

interface VirtualScreenReader {
  start(o: { container: Element }): Promise<void>;
  clearSpokenPhraseLog(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
}
declare global {
  interface Window { __sr?: VirtualScreenReader }
}

async function load(page: Page) {
  await page.evaluate(async (src) => {
    if (window.__sr) return;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    window.__sr = (await import(/* @vite-ignore */ url)).virtual;
  }, BUNDLE);
}

/**
 * Reads the page from the top, as with a screen reader's "next item" command,
 * or only the open dialog (a modal dialog keeps a screen reader inside it).
 */
export async function readPage(page: Page, max = 20_000): Promise<{ phrases: string[]; complete: boolean }> {
  await load(page);
  return page.evaluate(async (max) => {
    const sr = window.__sr!;
    // With scripts running a browser shows no <noscript> content, but the simulator reads its text.
    for (const n of document.querySelectorAll('noscript')) n.remove();
    const container = document.querySelector('dialog[open]') ?? document.body;
    await sr.start({ container });
    let steps = 0;
    const isEnd = (phrase: string) => (container === document.body ? phrase === 'end of document' : phrase.startsWith('end of dialog'));
    while (steps < max && !isEnd(await sr.lastSpokenPhrase())) {
      await sr.next();
      steps++;
    }
    const phrases = await sr.spokenPhraseLog();
    await sr.stop();
    return { phrases, complete: steps < max };
  }, max);
}

/** Starts listening: what the page announces from now on (live regions, focus moves) is logged. */
export async function listen(page: Page) {
  await load(page);
  await page.evaluate(async () => {
    await window.__sr!.start({ container: document.body });
    await window.__sr!.clearSpokenPhraseLog();
  });
}

/** What was announced since `listen`, then stops listening. */
export function heard(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const log = await window.__sr!.spokenPhraseLog();
    await window.__sr!.stop();
    return log;
  });
}

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'slider', 'spinbutton', 'img', 'image', 'meter', 'progressbar']);
const STATE = /^(not )?(pressed|checked|expanded|selected|required|disabled|invalid|readonly|current page|has popup.*|level \d+|position \d+|set size \d+|placeholder .*|partially checked)$/;

export interface SrFinding { where: string; problem: string; phrase: string }

/** Problems a screen-reader user would hear, found in a transcript. */
export function checkTranscript(where: string, phrases: string[]): SrFinding[] {
  const out: SrFinding[] = [];
  for (const phrase of phrases) {
    if (phrase.startsWith('end of ')) continue;
    const [role, second] = phrase.split(', ');
    if (INTERACTIVE.has(role!) && (second === undefined || STATE.test(second))) out.push({ where, problem: 'control without a name', phrase });
    if (phrase === 'columnheader' || phrase === 'rowheader') out.push({ where, problem: 'table header without a name', phrase });
    // A symbol that stands for something is read by its name ("check mark", "bell") or skipped, never as its
    // meaning. Separators between words (·, —, :) are left out: screen readers read them inline with the line.
    if (/^[\p{Extended_Pictographic}\u2713\u2714\u2717\u2715\u270E!?*\s]+$/u.test(phrase)) out.push({ where, problem: 'symbol read on its own', phrase });
  }
  return out;
}

/** Headings that skip a level going down (h1 → h3), which breaks navigation by heading level. */
export function headingSkips(where: string, phrases: string[]): SrFinding[] {
  const out: SrFinding[] = [];
  let previous = 0;
  for (const phrase of phrases) {
    const m = /^heading, (.*), level (\d)$/.exec(phrase);
    if (!m) continue;
    const level = Number(m[2]);
    if (previous && level > previous + 1) out.push({ where, problem: `heading level ${previous} followed by level ${level}`, phrase });
    previous = level;
  }
  return out;
}

/**
 * Text in the other language that is not marked with `lang`, so a screen reader
 * reads it with the wrong voice: Arabic in the English interface, and English
 * words in the Arabic one. Reads the DOM (the simulator has no voices).
 */
export async function unmarkedLanguage(page: Page, where: string): Promise<SrFinding[]> {
  const runs = await page.evaluate(() => {
    const root = document.querySelector('dialog[open]') ?? document.body;
    const pageLang = document.documentElement.lang;
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (el.closest('script, style, noscript, [aria-hidden="true"], [hidden], option')) continue;
      if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const text = n.textContent!.trim();
      const lang = el.closest('[lang]')?.getAttribute('lang') ?? pageLang;
      const arabic = /[؀-ۿ]/.test(text);
      const latinWords = /[A-Za-z]{3,}/.test(text);
      if (lang === 'en' && arabic) found.push(text);
      else if (lang === 'ar' && latinWords && !arabic) found.push(text);
    }
    return [...new Set(found)];
  });
  return runs.map((phrase) => ({ where, problem: 'other-language text without lang', phrase: phrase.slice(0, 120) }));
}

export function saveTranscript(index: number, where: string, phrases: string[], complete: boolean) {
  mkdirSync(TRANSCRIPTS, { recursive: true });
  const file = `${TRANSCRIPTS}/${String(index).padStart(2, '0')}-${where.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.txt`;
  writeFileSync(file, `${where}\n${complete ? '' : '(stopped before the end)\n'}\n${phrases.join('\n')}\n`);
  return file;
}
