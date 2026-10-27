import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

// Records a "shot": the real states a page goes through while a person uses it, as screenshots,
// with where each click or keystroke happened. The renderer replays them: the cursor travels to
// each recorded target, and the next real screenshot appears when the app showed it. Nothing is
// drawn into the app's pages; every frame is the running application.

export type Box = { x: number; y: number; w: number; h: number };
export type Step =
  | { kind: 'start'; frame: number; label?: string }
  | { kind: 'click'; at: Box | null; frame: number; label?: string }
  | { kind: 'type'; at: Box | null; frames: number[]; label?: string }
  | { kind: 'scroll'; frames: number[]; label?: string }
  | { kind: 'state'; frame: number; label?: string }
  | { kind: 'focus'; box: Box; label?: string };

export type ShotData = {
  id: string;
  device: 'desktop' | 'phone';
  viewport: { width: number; height: number };
  scale: number;
  frames: { file: string; label?: string; title: string }[];
  steps: Step[];
};

const pad = (n: number) => String(n).padStart(3, '0');

export async function settle(page: Page, ms = 250) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

export class Shots {
  readonly all: Record<string, ShotData> = {};
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  /** A new shot on `page`; its first frame is the page as it is now. */
  async start(page: Page, id: string, label?: string) {
    if (this.all[id]) throw new Error(`Shot ${id} recorded twice`);
    const rec = new Recorder(this, page, id);
    await rec.begin(label);
    return rec;
  }

  save() {
    writeFileSync(join(this.root, 'shots.json'), JSON.stringify(this.all, null, 1));
  }
}

export class Recorder {
  readonly data: ShotData;
  private dirtyState = false;

  constructor(private readonly shots: Shots, readonly page: Page, readonly id: string) {
    const vp = page.viewportSize()!;
    const phone = vp.width < 600;
    this.data = { id, device: phone ? 'phone' : 'desktop', viewport: vp, scale: 0, frames: [], steps: [] };
    shots.all[id] = this.data;
    mkdirSync(join(shots.root, id), { recursive: true });
  }

  async begin(label?: string) {
    this.data.scale = await this.page.evaluate(() => window.devicePixelRatio);
    const frame = await this.snap(label);
    this.data.steps.push({ kind: 'start', frame, label });
  }

  /** The page changed outside the recorder (an unrecorded action); the next action snaps it first. */
  dirty() {
    this.dirtyState = true;
  }

  async snap(label?: string, settleMs = 250) {
    await settle(this.page, settleMs);
    // The test server's own address (shown in sign-in links) is not part of the product: blurred.
    await this.page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/localhost:|127\.0\.0\.1/.test(n.textContent ?? '') && n.parentElement) n.parentElement.style.filter = 'blur(6px)';
      }
    });
    const file = `${this.id}/${pad(this.data.frames.length)}.jpg`;
    await this.page.screenshot({ path: join(this.shots.root, file), type: 'jpeg', quality: 92, animations: 'disabled' });
    this.data.frames.push({ file, label, title: await this.page.title() });
    this.dirtyState = false;
    return this.data.frames.length - 1;
  }

  private async before() {
    if (this.dirtyState) this.data.steps.push({ kind: 'state', frame: await this.snap() });
  }

  async box(target: Locator): Promise<Box | null> {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  }

  /** The page as it is now, after something happened by itself (a live refresh, a message). */
  async state(label?: string, settleMs?: number) {
    this.data.steps.push({ kind: 'state', frame: await this.snap(label, settleMs), label });
  }

  /** A camera hint: what the next steps are about. */
  async focus(target: Locator | Box, label?: string) {
    const box = 'x' in target ? target : await this.box(target);
    if (box) this.data.steps.push({ kind: 'focus', box, label });
  }

  async click(target: Locator, label?: string, after?: () => Promise<unknown>) {
    await this.before();
    const at = await this.box(target);
    await target.click();
    if (after) await after();
    this.data.steps.push({ kind: 'click', at, frame: await this.snap(label), label });
  }

  async check(target: Locator, label?: string) {
    await this.before();
    const at = await this.box(target);
    await target.check();
    this.data.steps.push({ kind: 'click', at, frame: await this.snap(label), label });
  }

  async select(target: Locator, option: Parameters<Locator['selectOption']>[0], label?: string) {
    await this.before();
    const at = await this.box(target);
    await target.selectOption(option);
    this.data.steps.push({ kind: 'click', at, frame: await this.snap(label, 150), label });
  }

  /** Typing, seen as the text growing in a few frames (the field's own rendering, password dots included). */
  async type(target: Locator, text: string, label?: string, pieces?: number) {
    await this.before();
    const at = await this.box(target);
    await target.click();
    const chars = [...text];
    const n = Math.max(1, Math.min(pieces ?? Math.ceil(chars.length / 5), 14, chars.length));
    const frames: number[] = [];
    for (let i = 1; i <= n; i++) {
      await target.fill(chars.slice(0, Math.round((chars.length * i) / n)).join(''));
      frames.push(await this.snap(undefined, i === n ? 250 : 60));
    }
    this.data.steps.push({ kind: 'type', at, frames, label });
  }

  /** Scrolls the window to `y` (or an element to just under the sticky bars) in small steps, a frame each. */
  async scroll(to: number | Locator, label?: string, stepPx = 45) {
    await this.before();
    const target = typeof to === 'number' ? to : await to.evaluate((node) => {
      const covered = Math.max(0, ...Array.from(document.querySelectorAll('.topbar, .controls'))
        .filter((s) => getComputedStyle(s).position === 'sticky')
        .map((s) => (parseFloat(getComputedStyle(s).top) || 0) + s.getBoundingClientRect().height));
      return Math.max(0, node.getBoundingClientRect().top + window.scrollY - covered - 16);
    });
    const from = await this.page.evaluate(() => window.scrollY);
    const max = await this.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const end = Math.max(0, Math.min(target, max));
    const count = Math.max(1, Math.round(Math.abs(end - from) / stepPx));
    const frames: number[] = [];
    for (let i = 1; i <= count; i++) {
      const y = Math.round(from + ((end - from) * i) / count);
      await this.page.evaluate((y) => window.scrollTo(0, y), y);
      frames.push(await this.snap(undefined, i === count ? 200 : 30));
    }
    this.data.steps.push({ kind: 'scroll', frames, label });
  }

  /** Scrolls an element with its own scrollbar (a dialog's body), a frame each step. */
  async scrollWithin(el: Locator, to: number, label?: string, stepPx = 45) {
    await this.before();
    const from = await el.evaluate((e) => e.scrollTop);
    const count = Math.max(1, Math.round(Math.abs(to - from) / stepPx));
    const frames: number[] = [];
    for (let i = 1; i <= count; i++) {
      await el.evaluate((e, y) => { e.scrollTop = y; }, Math.round(from + ((to - from) * i) / count));
      frames.push(await this.snap(undefined, i === count ? 200 : 30));
    }
    this.data.steps.push({ kind: 'scroll', frames, label });
  }
}

/** Blurs secrets (one-time passwords, keys, QR codes) on the page before it is recorded. */
export async function blur(target: Locator) {
  await target.evaluateAll((els) => els.forEach((e) => { (e as HTMLElement).style.filter = 'blur(10px)'; }));
}
