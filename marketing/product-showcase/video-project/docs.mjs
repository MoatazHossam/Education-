// Writes the script documents from the same data the video is built from, so they cannot drift:
// ARABIC_NARRATION_SCRIPT.md, ENGLISH_TRANSLATION.md, STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md and
// FEATURE_COVERAGE_MATRIX.md.
//   node docs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, wordCount } from './lib/estimate.mjs';
import { buildTimeline } from './lib/timeline.mjs';
import { features, notShown } from './script/features.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const shots = JSON.parse(readFileSync(join(ROOT, 'recordings', 'shots.json'), 'utf8'));
const cuts = [];
for (const id of ['showcase-20', 'showcase-3']) {
  const script = await import(`./script/${id}.mjs`);
  cuts.push({ id, script, tl: await buildTimeline({ root: ROOT, script, cut: id, shots }) });
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const status = { now: 'متاح الآن · Available now', dev: 'قيد الاستكمال · In development', later: 'رؤية مستقبلية · Future roadmap' };
const MUSIC = {
  open: 'sparse, dark pads and bass; bells', reveal: 'swell to full pad, arpeggio enters; riser + impact', vision: 'warm pads, slow arpeggio',
  segments: 'pads, arpeggio, light pulse', demo: 'light pulse, 16th-note arpeggio, pads under', features: 'as demo, a little more movement',
  classroom: 'as demo, brighter', student: 'higher arpeggio, bells', ai: 'ethereal: bells forward, no pulse', saas: 'steady pulse, bass forward',
  finale: 'full: pads, arpeggio, pulse, bells; resolves and fades with the end card',
};

function visual(s, shotsMap) {
  const p = s.p ?? {};
  switch (s.t) {
    case 'cold': return `Dark stage. Glass "fragments" (${p.fragments.map((f) => f.ar).join('، ')}) drift; the academic year 2026 / 2027 fades in, then the narration's questions appear in large type (${p.words.flat().join(' · ')}).`;
    case 'problems': return `Dark stage, title "أين تضيع الصورة؟". Six cards appear with the narration: ${p.cards.map((c) => `${c.ar} (${c.en})`).join('; ')}. Note at the end: "${p.note.ar}".`;
    case 'question': return `Dark stage. The question in three lines, the middle line in sky blue, with the product's red margin rule; English translation beneath.`;
    case 'logo': return `Product reveal: the logo mark (public/favicon.svg) builds — square, red margin, three lines — then "مِداد" / "Midad" and the tagline "${p.tagline.ar}".`;
    case 'chapter': return `Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots.`;
    case 'split': return `Paper stage. Right: the original single-page artifact (legacy/, recording "legacy"), labelled "${p.left.ar}"; red tags (${p.tags.items.join('، ')}). Left, on the last line: today's picker (recording "${p.right.shot}"), "${p.right.ar}", with an arrow.`;
    case 'layers': return `Three bands appear with the narration: ${p.layers.map((l) => `${l.ar} (${l.items.join('، ')})`).join(' / ')}.`;
    case 'flow': return `Five nodes, right to left: ${p.nodes.map((n) => n.ar).join(' → ')}; a light travels along them on line 2; chips: ${p.footer.ar}.`;
    case 'cards': return `Title "${p.title.ar}" (${p.title.en})${p.status ? ` with status ${status[p.status]}` : ''}; cards: ${p.cards.map((c) => c.ar).join(' · ')}.`;
    case 'segments': return `Four segment cards with need and offer; status badges (available now / later expansion). The segment being described is highlighted: ${p.segments.map((x) => `${x.ar} [${x.status === 'later' ? 'later' : 'now'}]`).join('; ')}.`;
    case 'tenants': return `Three organizations (${p.tenants.join('، ')}) above one PostgreSQL database; each sees only its rows (RLS). A dashed attempt to read another organization's rows is stopped (red ✕).`;
    case 'demo':
    case 'phone': {
      const segs = p.segments.map((g) => {
        const sh = shotsMap[g.shot];
        const range = g.frame !== undefined ? `frame ${g.frame}` : `steps ${g.from ?? 0}–${g.to ?? sh.steps.length - 1}`;
        return `"${g.shot}" (${sh.device}, ${range})`;
      }).join(' → ');
      return `${s.t === 'phone' ? 'Phone (390 × 844) on paper' : 'Browser window (1440 × 810 recording) on paper'}: ${segs}. Caption "${p.caption.ar} · ${p.caption.en}" + ${status[p.status] ?? ''}.${p.points ? ` Points: ${p.points.map((x) => x.ar).join('، ')}.` : ''}${p.stats ? ` Figures overlay: ${p.stats.items.map((x) => x.join(' ')).join(' · ')}.` : ''}${p.callout ? ` Callout: "${p.callout.ar}".` : ''}${p.notes ? ` Notes: ${p.notes.map((x) => `"${x.ar}"`).join(', ')}.` : ''}`;
    }
    case 'montage': return `Montage of real screens: ${p.items.map((x) => `${x.ar} (${x.shot})`).join(' · ')}.`;
    case 'aistatus': return `Status board "الذكاء الاصطناعي: أين نقف اليوم؟": ${p.rows.map((r) => `${r.ar} → ${r.v.ar}`).join('; ')}.`;
    case 'aiconcept': return `Labelled concept (dashed lines throughout), banner "${p.banner.ar} · ${p.banner.en}": inputs (${p.inputs.map((x) => x.ar).join('، ')}) → assistant → uses (${p.uses.map((x) => x.ar).join('، ')}); rules: ${p.rules.map((x) => x.ar).join('، ')}. No product screen is imitated.`;
    case 'arch': return p.mode === 'tenancy' ? 'Diagram: tenants → one application → database with forced row-level security; a "bug" path is refused by the database; then encryption of secrets, key rotation and request limits.' : `Diagram: users → Caddy (TLS, load balancer) → app ×2 → PostgreSQL; worker; encrypted backups → off-site copy. Figure: "${p.stat.big} — ${p.stat.ar}" with the note "${p.stat.note}".`;
    case 'hub': return `The product mark at the centre of ${p.schools} institutions; update waves reach all of them; a dashed "${p.addon.ar}" module joins on line 2.`;
    case 'readiness': return `Three verified figures (${p.stats.map((x) => `${x.big} ${x.ar}`).join(' · ')}), then "${p.remaining.title}": ${p.remaining.items.join('، ')}.`;
    case 'roadmap': return `Timeline right to left: ${p.steps.map((x) => `${x.ar} [${x.kind}]: ${x.items.join('، ')}`).join(' → ')}.`;
    case 'endcard': return `"${p.invite.ar}" with audience chips; then the logo, "مِداد / Midad", "${p.slogan.ar}", and the call to action "${p.cta.ar}"; fade to black.`;
    default: return s.t;
  }
}

function camera(s) {
  if (s.t === 'demo') return 'Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls' + (s.p.segments.some((g) => g.zoom) ? '; hand-placed zooms on key rows (see script)' : '') + '. Pointer redrawn over the real frames; click ripples.';
  if (s.t === 'phone') return 'Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages).';
  if (['split', 'montage'].includes(s.t)) return 'Slow push-in (Ken Burns, ≤ 6 %) on each screenshot.';
  return 'Locked frame; elements animate in with the narration (fade, rise, light blur).';
}

function recordingNote(s, shotsMap) {
  if (s.t !== 'demo' && s.t !== 'phone') return s.t === 'split' || s.t === 'montage' ? 'Stills from capture/showcase.spec.ts (see Visual).' : '—';
  return s.p.segments.map((g) => {
    const sh = shotsMap[g.shot];
    const steps = g.frame !== undefined ? [] : sh.steps.slice(g.from ?? 0, (g.to ?? sh.steps.length - 1) + 1).filter((x) => x.kind !== 'focus').map((x) => `${x.kind}${x.label ? ` (${x.label})` : ''}`);
    return `**${g.shot}**: ${g.frame !== undefined ? `single frame ${g.frame}` : steps.join(', ')}`;
  }).join('<br>');
}

function textOverlays(s) {
  const p = s.p ?? {};
  const out = [];
  if (p.caption) out.push(`${p.caption.ar} · ${p.caption.en}`);
  if (p.status) out.push(status[p.status]);
  if (p.title) out.push(p.title.ar);
  if (p.stats && s.t === 'demo') out.push(p.stats.items.map((x) => x.join(' ')).join(' · '));
  if (p.callout) out.push(p.callout.ar);
  for (const n of p.notes ?? []) out.push(n.ar);
  if (p.banner) out.push(p.banner.ar);
  if (s.t !== 'cold' && s.t !== 'logo' && s.t !== 'endcard') out.push('chapter strip');
  return out.join('<br>') || '—';
}

const voiced = cuts.every((c) => c.tl.narration.estimated === 0);
const TIMING = {
  ar: voiced
    ? 'الأزمنة محسوبة من تسجيلات التعليق الصوتي الحالية (صوت مولَّد للمراجعة؛ انظر PRODUCTION_STATUS.md).'
    : 'الأزمنة تقديرية إلى أن يُسجَّل التعليق الصوتي (سرعة قراءة هادئة؛ انظر PRODUCTION_STATUS.md)، ثم تُحسب من التسجيل نفسه.',
  en: voiced
    ? 'Times come from the current narration takes (a generated guide voice; see PRODUCTION_STATUS.md).'
    : 'Times are estimates until the narration is recorded; then they come from the recording.',
};
const cell = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function narrationDoc(lang) {
  const isAr = lang === 'ar';
  const out = [];
  out.push(isAr ? '# نصّ التعليق الصوتي — بالتشكيل الكامل' : '# English translation of the narration');
  out.push('');
  out.push(isAr
    ? `<div dir="rtl">\n\nهذا هو النصّ الذي يُقرأ في الفيديو، مشكولًا بالكامل كما طُلب. ${TIMING.ar} حيث يختلف ما يُنطق عمّا يُكتب (أرقام، مصطلحات إنجليزية) يظهر تحت السطر «يُقرأ:».\n\n**توجيهات للقارئ:** فصحى مصرية رصينة (انظر Narrator_Recording_Pack.pdf وNARRATOR_RECORDING_PACK.md: أسلوب القراءة، والمواصفات، وملاحظات كل سطر)؛ صوت دافئ وواثق بلا مبالغة؛ سرعة نحو ١٠٥–١١٥ كلمة في الدقيقة؛ وقفة قصيرة عند الفاصلة وأطول عند النقطة؛ تُنطق المصطلحات الإنجليزية كما هي (SaaS «ساس»، API «إيه بي آي»، Webhooks «ويب هوكس»، Paymob «باي موب»، Wise EduAgent «وايز إيدو إيجنت»).\n\n</div>`
    : `The English translation used for the English subtitles (english.srt, english-3min.srt). ${TIMING.en}`);
  out.push('');
  for (const c of cuts) {
    const words = c.script.scenes.reduce((a, s) => a + s.lines.reduce((b, l) => b + wordCount(l.ar), 0), 0);
    out.push(`## ${isAr ? c.script.meta.title : c.script.meta.titleEn}`);
    out.push('');
    out.push(isAr
      ? `<div dir="rtl">${voiced ? 'المدة' : 'المدة المقدّرة'}: ${mmss(c.tl.duration)} · عدد الكلمات: ${words} · المشاهد: ${c.tl.scenes.length} · الأسطر: ${c.tl.scenes.reduce((a, s) => a + s.lines.length, 0)}</div>`
      : `${voiced ? 'Duration' : 'Estimated duration'} ${mmss(c.tl.duration)} · ${words} Arabic words · ${c.tl.scenes.length} scenes · ${c.tl.scenes.reduce((a, s) => a + s.lines.length, 0)} lines`);
    out.push('');
    let ch = 0;
    for (const s of c.tl.scenes) {
      if (s.ch !== ch) {
        ch = s.ch;
        const chapter = c.script.chapters[ch - 1];
        out.push(`### ${ch}. ${isAr ? chapter.ar : chapter.en}`);
        out.push('');
      }
      if (!s.lines.length) continue;
      out.push(isAr ? `<div dir="rtl">\n\n**${s.id}** · ${mmss(s.start)}–${mmss(s.end)}\n` : `**${s.id}** · ${mmss(s.start)}–${mmss(s.end)}\n`);
      for (const l of s.lines) {
        const at = mmss(s.start + l.t);
        if (isAr) {
          out.push(`- \`${at}\` ${l.ar}`);
          if (l.say) out.push(`  <br>يُقرأ: ${l.say}`);
        } else out.push(`- \`${at}\` ${l.en}`);
      }
      out.push(isAr ? '\n</div>\n' : '');
    }
  }
  return out.join('\n');
}

function storyboard() {
  const out = ['# Storyboard', '', 'One row per scene, generated from `video-project/script/*.mjs` (`node docs.mjs`). ' + TIMING.en + ' Every product screen is a recording of the running application (`recordings/`, captured by `video-project/capture/showcase.spec.ts`); diagrams and cards are motion graphics in the product\'s colours and font.', ''];
  for (const c of cuts) {
    out.push(`## ${c.script.meta.titleEn} — ${mmss(c.tl.duration)}`, '');
    out.push('| # | Time | Scene | Template | Visual | Narration (summary) |', '| --- | --- | --- | --- | --- | --- |');
    c.tl.scenes.forEach((s, i) => {
      const summary = s.lines.length ? s.lines.map((l) => l.en).join(' ').slice(0, 220) + (s.lines.map((l) => l.en).join(' ').length > 220 ? '…' : '') : '— (music)';
      out.push(`| ${i + 1} | ${mmss(s.start)} | \`${s.id}\` (ch. ${s.ch}) | ${s.t} | ${cell(visual(s, shots))} | ${cell(summary)} |`);
    });
    out.push('');
  }
  return out.join('\n');
}

function sceneByScene() {
  const out = ['# Scene-by-scene production sheet', '', 'For each scene: timeline, Arabic narration, visual, recording, camera, overlays, transition, music and sound. Generated from the script data (`node docs.mjs`); the render uses the same data.', ''];
  out.push('**Common to all scenes.** 1920 × 1080 stage (rendered at 1080p or, at device scale 2, 3840 × 2160), 30 fps. Fonts: Readex Pro (the product\'s font) and IBM Plex Mono. Colours from `public/app.css` (ink #18243a, accent #1f4e8c, margin red #c0473b, paper #f7f8fb). Transitions: 0.6 s cross-fade between scenes (0.4 s between two product demonstrations); chapter cards carry a soft whoosh. Product demonstrations show a "DEMO DATA · بيانات تجريبية" tag; all names, schools and addresses are invented. Sound: the generated score (`audio/mix.py`), ducked about 10 dB under narration; soft clicks on demonstrated clicks.', '');
  for (const c of cuts) {
    out.push(`## ${c.script.meta.titleEn}`, '');
    let n = 0;
    for (const s of c.tl.scenes) {
      n++;
      out.push(`### ${n}. \`${s.id}\` — ${mmss(s.start)}–${mmss(s.end)} (${s.dur.toFixed(1)} s)`, '');
      out.push('| | |', '| --- | --- |');
      out.push(`| Narration | ${s.lines.length ? `<div dir="rtl">${s.lines.map((l) => `\`${mmss(s.start + l.t)}\` ${l.ar}`).join('<br>')}</div>` : '— (music only)'} |`);
      out.push(`| Visual | ${cell(visual(s, shots))} |`);
      out.push(`| Screen recording | ${cell(recordingNote(s, shots))} |`);
      out.push(`| Camera | ${cell(camera(s))} |`);
      out.push(`| Text overlays | ${textOverlays(s)} |`);
      out.push(`| Transition in | ${s.trans > 0 ? `cross-fade ${s.trans} s` : 'from black'} |`);
      out.push(`| Music & sound | cue \`${s.music}\`: ${MUSIC[s.music] ?? ''}${s.t === 'chapter' ? '; whoosh' : ''}${s.plan ? `; ${s.plan.clicks.length} soft click(s)` : ''} |`);
      out.push('');
    }
  }
  return out.join('\n');
}

const STATUS_LABEL = { now: 'Available now · متاح الآن', dev: 'In development · قيد الاستكمال', later: 'Future roadmap · رؤية مستقبلية' };

function coverageMatrix() {
  const [c20, c3] = cuts;
  const sceneAt = (c, id) => {
    const s = c.tl.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`features.mjs: no scene ${id} in ${c.id}`);
    return `\`${id}\` ${mmss(s.start)}`;
  };
  for (const f of features) for (const sh of f.shots) if (!shots[sh]) throw new Error(`features.mjs: no recording ${sh}`);
  const out = ['# Feature coverage matrix', '',
    'Every capability the video mentions, its status, who it serves, and where it appears in each cut. Generated by `node docs.mjs` from `video-project/script/features.mjs` and the timelines, so scene times match the render; the build fails if a scene or recording named here does not exist.', '',
    '**Status.** *Available now*: implemented in this repository, covered by the tests named under Evidence, and shown in the video from a recording of the running application. *In development*: partly built, or built but waiting on an outside step (keys, hosting, a legal or editorial review); the video says so on screen. *Future roadmap*: not built; the video shows it only as a labelled plan or concept. Nothing in the video is presented as available unless it is in the first group.', '',
    '**Important limits.** "Available now" means implemented and tested on local and CI environments; the product is not yet deployed to production (see In development). The AI assistant and the Wise EduAgent integration are not built, and Wise EduAgent itself could not be inspected from this environment (`docs/PROJECT_STATUS.md` B-8, B-10).', ''];
  const counts = Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, features.filter((f) => f.status === k).length]));
  out.push(`**Totals.** ${features.length} capabilities: ${counts.now} available now, ${counts.dev} in development, ${counts.later} future roadmap.`, '');
  for (const area of [...new Set(features.map((f) => f.area))]) {
    out.push(`## ${area}`, '');
    out.push('| Capability | Status | Users | Value | How it is shown | 20-min cut | 3-min cut | Recordings | Evidence |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of features.filter((x) => x.area === area)) {
      out.push(`| ${cell(f.name)} | ${STATUS_LABEL[f.status]} | ${cell(f.user)} | ${cell(f.value)} | ${cell(f.flow)} | ${f.s20.map((id) => sceneAt(c20, id)).join('<br>') || '—'} | ${f.s3.map((id) => sceneAt(c3, id)).join('<br>') || '—'} | ${f.shots.map((x) => `\`${x}\``).join(', ') || '— (graphic)'} | ${cell(f.evidence)} |`);
    }
    out.push('');
  }
  out.push('## Implemented but not featured on their own', '', '| Capability | Evidence | Why not featured |', '| --- | --- | --- |');
  for (const [name, ev, why] of notShown) out.push(`| ${cell(name)} | ${cell(ev)} | ${cell(why)} |`);
  out.push('');
  // Scenes that present a product capability and the status they show on screen.
  out.push('## Status shown on screen, per scene', '', 'The badge each scene displays, so a reviewer can check that nothing in development or planned is shown as available.', '');
  for (const c of cuts) {
    out.push(`**${c.script.meta.titleEn}**`, '', '| Scene | Time | Badge on screen |', '| --- | --- | --- |');
    for (const s of c.tl.scenes) if (s.p?.status) out.push(`| \`${s.id}\` | ${mmss(s.start)} | ${status[s.p.status] ?? s.p.status} |`);
    out.push('');
  }
  return out.join('\n');
}

writeFileSync(join(ROOT, 'FEATURE_COVERAGE_MATRIX.md'), coverageMatrix());
writeFileSync(join(ROOT, 'ARABIC_NARRATION_SCRIPT.md'), narrationDoc('ar'));
writeFileSync(join(ROOT, 'ENGLISH_TRANSLATION.md'), narrationDoc('en'));
writeFileSync(join(ROOT, 'STORYBOARD.md'), storyboard());
writeFileSync(join(ROOT, 'SCENE_BY_SCENE_PRODUCTION.md'), sceneByScene());
for (const c of cuts) {
  const spoken = c.tl.scenes.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.d, 0), 0);
  console.log(`${c.id}: ${mmss(c.tl.duration)} total, ${mmss(spoken)} of narration (${c.tl.narration.recorded} lines recorded, ${c.tl.narration.estimated} estimated), ${c.script.scenes.reduce((a, s) => a + s.lines.reduce((b, l) => b + plain(l.ar).length, 0), 0)} characters`);
}
