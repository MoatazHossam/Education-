// Turns recorded shots (capture/recorder.ts) into a timed demonstration for one scene: which real
// frame shows when, where the pointer travels and clicks, and where the camera looks. Steps are laid
// out at an unhurried pace, then stretched or compressed so that anchored steps start with the line
// of narration that describes them ("sync": { stepIndex: lineIndex }).

const BASE = {
  segStart: { m: 0.45, h: 0.9 },
  click: { m: 0.62, h: 0.9 },
  type: { m: 0.6, h: 0.55, per: 0.075 },
  scroll: { m: 0, h: 0.5, per: 0.045 },
  state: { m: 0.3, h: 1.0 },
  hold: { m: 0, h: 2.2 },
};
const MAX_ZOOM = 1.6;
// The app's pages sit in a 1180-px column of the 1440-px window: the overview crops the empty sides.
const OVERVIEW_ZOOM = 1.16;

/** The frame shown before step k of a shot. */
function frameBefore(shot, k) {
  for (let i = k - 1; i >= 0; i--) {
    const s = shot.steps[i];
    if (s.kind === 'focus') continue;
    return lastFrame(s);
  }
  return 0;
}
function lastFrame(s) {
  return s.kind === 'type' || s.kind === 'scroll' ? s.frames[s.frames.length - 1] : s.frame;
}

function resolveFrame(shot, spec) {
  if (spec === undefined || spec === null) return shot.frames.length - 1;
  if (typeof spec === 'number') return spec < 0 ? shot.frames.length + spec : spec;
  const i = shot.frames.findIndex((f) => f.label === spec);
  if (i < 0) {
    const st = shot.steps.find((s) => s.label === spec);
    if (st) return lastFrame(st);
    throw new Error(`No frame "${spec}" in shot ${shot.id}`);
  }
  return i;
}

/** Expands a scene's segments into timed items with base durations. */
function items(segments, shots) {
  const out = [];
  segments.forEach((seg, si) => {
    const shot = shots[seg.shot];
    if (!shot) throw new Error(`Unknown shot ${seg.shot}`);
    if (seg.frame !== undefined) {
      out.push({ seg: si, shot, kind: 'hold', frame: resolveFrame(shot, seg.frame), focus: seg.hold, zoom: seg.zoom?.[0], anchor: seg.sync?.[0], ...BASE.hold });
      return;
    }
    const from = seg.from ?? 0;
    const to = Math.min(seg.to ?? shot.steps.length - 1, shot.steps.length - 1);
    const first = shot.steps[from]?.kind === 'start' ? shot.steps[from].frame : frameBefore(shot, from);
    out.push({ seg: si, shot, kind: 'segStart', frame: first, stepIndex: from, zoom: seg.zoom?.[from], ...BASE.segStart });
    for (let k = from; k <= to; k++) {
      const s = shot.steps[k];
      if (s.kind === 'start') continue;
      const anchor = seg.sync && Object.prototype.hasOwnProperty.call(seg.sync, k) ? seg.sync[k] : undefined;
      if (s.kind === 'focus') { out.push({ seg: si, shot, kind: 'focus', box: s.box, m: 0, h: 0, anchor }); continue; }
      const base = BASE[s.kind];
      const it = { seg: si, shot, kind: s.kind, at: s.at ?? null, m: base.m, h: base.h, anchor, stepIndex: k, zoom: seg.zoom?.[k] };
      if (s.kind === 'click' || s.kind === 'state') it.frame = s.frame;
      if (s.kind === 'type' || s.kind === 'scroll') { it.frames = s.frames; it.m += base.per * s.frames.length; }
      out.push(it);
    }
    // A segment's own first anchor (sync on its start step) belongs to its segStart.
    if (seg.sync && Object.prototype.hasOwnProperty.call(seg.sync, from)) {
      const startItem = out.find((x) => x.seg === si && x.kind === 'segStart');
      startItem.anchor = seg.sync[from];
      const dup = out.find((x) => x.seg === si && x.stepIndex === from && x.kind !== 'segStart');
      if (dup) delete dup.anchor;
    }
  });
  return out;
}

export function naturalDuration(segments, shots) {
  return items(segments, shots).reduce((a, x) => a + x.m + x.h, 0);
}

/**
 * Lays out the scene: `lineStarts` are the scene-relative start times of its narration lines,
 * `D` the scene's duration. Returns frames, pointer keyframes, clicks and camera keyframes.
 */
export function planDemo(scene, shots, lineStarts, D) {
  const list = items(scene.p.segments, shots);
  // Anchor times; the first item starts at 0.
  const anchorTime = (x) => (x.anchor === undefined ? undefined : lineStarts[x.anchor] ?? undefined);
  const blocks = [];
  let cur = { start: 0, items: [] };
  list.forEach((x, i) => {
    const at = i === 0 ? 0 : anchorTime(x);
    if (at !== undefined && i > 0) { blocks.push(cur); cur = { start: at, items: [] }; }
    cur.items.push(x);
  });
  blocks.push(cur);
  // Fit each block between its start and the next block's start (or the scene's end).
  let t = 0;
  blocks.forEach((b, bi) => {
    const begin = Math.max(t, b.start);
    const end = bi + 1 < blocks.length ? Math.max(blocks[bi + 1].start, begin) : D;
    const T = end - begin;
    const M = b.items.reduce((a, x) => a + x.m, 0);
    const H = b.items.reduce((a, x) => a + x.h, 0);
    let mScale = 1;
    let hScale = H > 0 ? Math.max(0, (T - M) / H) : 0;
    if (T < M) { mScale = Math.max(0.55, T / M); hScale = 0; }
    let tt = begin;
    for (const x of b.items) {
      x.t = tt;
      x.mm = x.m * mScale;
      x.hh = x.h * hScale;
      // A last hold that would stretch past ~6 s makes a long still frame: cap it unless it is the scene's end.
      tt += x.mm + x.hh;
    }
    t = tt;
  });

  const shot0 = list[0].shot;
  const W = shot0.viewport.width;
  const H = shot0.viewport.height;
  const phone = shot0.device === 'phone';
  const frames = [];
  const cursor = [];
  const clicks = [];
  const overview = phone ? { cx: W / 2, cy: H / 2, z: 1 } : { cx: W / 2, cy: H / 2, z: OVERVIEW_ZOOM };
  const cams = [{ t: 0, ...overview }];
  let cam = { ...overview };
  let pos = null;
  const media = (shot, i) => ({ src: shot.frames[i].file, title: shot.frames[i].title });

  const moveCam = (t0, dur, next) => {
    if (Math.abs(next.cx - cam.cx) < 1 && Math.abs(next.cy - cam.cy) < 1 && Math.abs(next.z - cam.z) < 0.01) return;
    cams.push({ t: t0, ...cam });
    cams.push({ t: t0 + dur, ...next });
    cam = next;
  };
  const view = (box, maxZ = MAX_ZOOM) => {
    // Phones are not zoomed: the Arabic pages are right-aligned edge to edge, so any zoom cuts labels.
    if (phone) return { cx: W / 2, cy: H / 2, z: 1 };
    const zw = W / Math.max(box.w * 3.4, W / maxZ);
    const zh = H / Math.max(box.h * 5.5, H / maxZ);
    const z = Math.max(OVERVIEW_ZOOM, Math.min(maxZ, zw, zh));
    const hw = W / z / 2;
    const hh = H / z / 2;
    const cx = Math.min(W - hw, Math.max(hw, box.x + box.w / 2));
    const cy = Math.min(H - hh, Math.max(hh, box.y + box.h / 2));
    return { cx, cy, z };
  };
  // A hand-placed box: fill about 88 % of the view with it.
  const fit = (box, maxZ = 1.8) => {
    if (phone) return overview;
    const z = Math.max(OVERVIEW_ZOOM, Math.min(maxZ, (W * 0.88) / box.w, (H * 0.88) / box.h));
    const hw = W / z / 2;
    const hh = H / z / 2;
    return { cx: Math.min(W - hw, Math.max(hw, box.x + box.w / 2)), cy: Math.min(H - hh, Math.max(hh, box.y + box.h / 2)), z };
  };
  // Keep the camera when the target is comfortably in view at about the zoom it would choose.
  const keep = (box, want) => {
    const hw = (W / cam.z / 2) * 0.8;
    const hh = (H / cam.z / 2) * 0.8;
    const inside = box.x >= cam.cx - hw && box.x + box.w <= cam.cx + hw && box.y >= cam.cy - hh && box.y + box.h <= cam.cy + hh;
    return inside && Math.abs(cam.z - want.z) < 0.18;
  };
  // Hand-placed camera boxes for a segment: { stepIndex: box }.
  const manual = (x) => x.zoom;

  for (const x of list) {
    const t0 = x.t;
    if (x.kind === 'segStart') {
      frames.push({ t: t0, ...media(x.shot, x.frame), fade: t0 === 0 ? 0 : 0.45 });
      if (pos) cursor.push({ t: t0, ...pos, v: 0 });
      pos = null;
      moveCam(t0, 0.45, overview);
      if (manual(x)) moveCam(t0 + 0.8, 1.2, fit(manual(x)));
      continue;
    }
    if (x.kind === 'hold') {
      frames.push({ t: t0, ...media(x.shot, x.frame), fade: t0 === 0 ? 0 : 0.45 });
      if (x.focus === 'nav') moveCam(t0 + 0.6, 1.4, view({ x: 600, y: 0, w: 840, h: 100 }, 1.5));
      else if (manual(x)) moveCam(t0 + 0.6, 1.4, fit(manual(x)));
      continue;
    }
    if (x.kind === 'focus') {
      moveCam(t0, 0.9, view(x.box, 1.7));
      continue;
    }
    if (x.kind === 'state') {
      frames.push({ t: t0, ...media(x.shot, x.frame), fade: 0.3 });
      if (manual(x)) moveCam(t0, 1.0, fit(manual(x)));
      else if (Math.abs(cam.z - overview.z) > 0.01) moveCam(t0, 0.9, overview);
      continue;
    }
    if (x.kind === 'scroll') {
      if (Math.abs(cam.z - overview.z) > 0.01) moveCam(t0, 0.6, overview);
      const per = x.frames.length ? x.mm / x.frames.length : 0;
      x.frames.forEach((f, i) => frames.push({ t: t0 + per * (i + 1), ...media(x.shot, f), fade: 0 }));
      if (manual(x)) moveCam(t0 + x.mm + 0.1, 1.1, fit(manual(x)));
      continue;
    }
    // click and type: travel, press, then the app's response.
    const box = x.at;
    const target = box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : pos ?? { x: W / 2, y: H / 2 };
    const travel = x.kind === 'type' ? Math.min(0.6, x.mm * 0.5) : x.mm;
    if (manual(x)) moveCam(t0, Math.max(0.8, travel + 0.15), fit(manual(x)));
    else if (box) { const want = view(box); if (!keep(box, want)) moveCam(t0, Math.max(0.7, travel + 0.15), want); }
    if (!phone) {
      const from = pos ?? { x: Math.min(W - 40, target.x + 180), y: Math.min(H - 30, target.y + 140) };
      cursor.push({ t: t0, ...from, v: 1 });
      cursor.push({ t: t0 + travel, ...target, v: 1 });
    }
    pos = target;
    clicks.push({ t: t0 + travel, ...target, phone });
    if (x.kind === 'click') {
      frames.push({ t: t0 + travel + 0.1, ...media(x.shot, x.frame), fade: 0.16 });
    } else {
      const span = Math.max(0.05, x.mm - travel - 0.08);
      const per = span / x.frames.length;
      x.frames.forEach((f, i) => frames.push({ t: t0 + travel + 0.08 + per * (i + 1), ...media(x.shot, f), fade: 0 }));
      // The pointer steps aside so it does not hide the typed text.
      if (!phone) {
        cursor.push({ t: t0 + travel + 0.15, ...target, v: 1 });
        const aside = { x: target.x - 70, y: target.y + 46 };
        cursor.push({ t: t0 + travel + 0.55, ...aside, v: 1 });
        pos = aside;
      }
    }
  }
  if (pos && !phone) cursor.push({ t: D, ...pos, v: 1 });
  frames.sort((a, b) => a.t - b.t);
  cams.sort((a, b) => a.t - b.t);
  return { device: shot0.device, W, H, frames, cursor, clicks, cams };
}
