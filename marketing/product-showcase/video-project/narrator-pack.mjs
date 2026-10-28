// The recording pack for the narrator: how to read and record, and every line of both films with its file name,
// full tashkeel, approximate length, the hamzat al-wasl joins that are easy to misread, and the reading notes.
//   node narrator-pack.mjs   → ../NARRATOR_RECORDING_PACK.md and ../Narrator_Recording_Pack.pdf
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { general, notes, terms } from './script/narrator-notes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WPM = 110;
const DATE = '2026-10-28';
const MARKS = /[ً-ْٰ]/g;
const PUNCT = /[«»—،.؛:؟!,]/g;
const arDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const words = (t) => t.replace(MARKS, '').replace(PUNCT, ' ').split(/\s+/).filter(Boolean);
const seconds = (t) => Math.max(2, Math.round((words(t).length / WPM) * 60));

/** Joins across words where hamzat al-wasl follows a long vowel, a tanween or a sukun: the places a reader most
 *  often voices the hamza or keeps the long vowel. */
function joins(text) {
  const toks = text.replace(/\s*—\s*/g, '، ').split(/\s+/);
  const out = [];
  for (let i = 1; i < toks.length; i++) {
    const prev = toks[i - 1];
    const cur = toks[i].replace(/^[«"]/, '');
    if (/[،.؛:؟!,»]$/.test(prev) || !/^[اٱ]/.test(cur)) continue;
    const end = prev.replace(/[«»"]/g, '');
    const base = end.replace(MARKS, '');
    const marks = end.slice(end.search(/[ً-ْٰ]*$/));
    let why = null;
    if (/[ً-ٍ]/.test(marks)) why = 'التنوين يُوصَل بكسرة بلا همزة';
    else if (/[اى]$/.test(base) || (/[يو]$/.test(base) && !/[َ-ّ]/.test(marks))) why = 'يُقصَر المدّ ولا تُنطق الهمزة';
    else if (marks.includes('ْ')) why = 'حركة وصل بلا همزة';
    if (why) out.push({ pair: `${end} ${cur.replace(/[،.؛:؟!,»]+$/, '')}`, why });
  }
  return out;
}

async function cutLines(cut) {
  const { scenes, chapters, meta } = await import(`./script/${cut}.mjs`);
  const byCh = chapters.map((c) => ({ ...c, scenes: [] }));
  let count = 0;
  let total = 0;
  for (const s of scenes) {
    const ch = byCh.find((c) => c.n === s.ch);
    const lines = s.lines.map((l, k) => {
      const id = `${cut}/${s.id}-${String(k + 1).padStart(2, '0')}`;
      const read = l.say ?? l.ar;
      const sec = seconds(read);
      count++;
      total += sec;
      return { id, file: `${cut}/${s.id}-${String(k + 1).padStart(2, '0')}.wav`, ar: l.ar, say: l.say, sec, joins: joins(read), notes: notes[id] ?? [] };
    });
    ch.scenes.push({ id: s.id, lines });
  }
  return { cut, meta, chapters: byCh, count, total };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const SPECS = [
  'ملف WAV أحادي (mono)، ‏48 kHz، ‏24 بت (أو 16 بت).',
  'غرفة هادئة معالَجة صوتيًّا، بلا صدى ولا مكيّف ولا ضوضاء شارع.',
  'ميكروفون مكثّف على بعد 15–25 سم مع مرشّح أنفاس (pop filter)، وثبات المسافة طوال التسجيل.',
  'بلا أي معالجة: لا ضغط، ولا موازنة (EQ)، ولا إزالة ضوضاء، ولا موسيقى. نحن نعالج الصوت بعد التسليم.',
  'مستوى القمم نحو −6 dBFS، ولا يصل أبدًا إلى التشبّع (clipping).',
  'ثانية صمت (صوت الغرفة) قبل كل سطر وبعده؛ وتسجيل منفصل لعشر ثوانٍ من صوت الغرفة باسم room-tone.wav.',
  'تجنُّب طقطقة الفم وصوت الأوراق والملابس؛ يُفضَّل الماء الفاتر بين المقاطع.',
]
const DELIVERY = [
  'المفضَّل: ملف لكل سطر، باسمه كما هو مكتوب فوق السطر (مثل showcase-20/c1-open-01.wav)، في مجلّدين: showcase-20 و showcase-3.',
  'بديل مقبول: ملف لكل مشهد (مثل showcase-20/c1-open.wav) تُقرأ فيه أسطر المشهد بالترتيب مع صمت ثانيتين بين كل سطر وآخر؛ ونحن نقسّمه.',
  'إذا أُعيد سطر فيُعاد كاملًا من أوله (لا تصحيح من منتصف الكلمة)، ويُستخدم آخر ملف يحمل الاسم نفسه.',
  'التسليم: مجلد مشترك على Google Drive (نقرأ منه مباشرة)، أو رفع الملفات إلى المستودع في المسار marketing/product-showcase/audio/recorded/.',
]
const CHECK = [
  'كل الأسطر مسجّلة، وكل ملف باسمه الصحيح.',
  'لا تشبّع (clipping) ولا ضوضاء خلفية ظاهرة.',
  'ثانية صمت قبل كل سطر وبعده، وملف room-tone.wav.',
  'الأسماء الإنجليزية منطوقة كما في قائمة المصطلحات.',
  'المراجعة السريعة لِـ: مِنَصَّة، نِطَاق، الثاء والذال والظاء، والأرقام.',
]

function markdown(cuts) {
  const out = ['# حزمة تسجيل التعليق الصوتي — نطاق المناهج', '', '<div dir="rtl">', ''];
  const lines = cuts.reduce((a, c) => a + c.count, 0);
  const secs = cuts.reduce((a, c) => a + c.total, 0);
  out.push(`نسخة ${DATE}. تسجيل التعليق الصوتي لفيلمَي عرض المنتج: الكامل (${cuts[0].count} سطرًا) والقصير (${cuts[1].count} سطرًا)، ${lines} سطرًا في المجموع، نحو ${Math.round(secs / 60)} دقيقة من القراءة الصافية (بسرعة نحو ${WPM} كلمة في الدقيقة)؛ نحو ساعتين في الأستوديو مع الإعادات. القارئ: صوت رجل أو امرأة مصري، بالعربية الفصحى.`, '');
  out.push('## أسلوب القراءة', '', ...general.map((g) => `- ${g}`), '');
  out.push('## المواصفات الفنية', '', ...SPECS.map((g) => `- ${g}`), '');
  out.push('## التسمية والتسليم', '', ...DELIVERY.map((g) => `- ${g}`), '');
  out.push('## المصطلحات الإنجليزية', '', '| المصطلح | يُقرأ | ملاحظة |', '| --- | --- | --- |', ...terms.map(([en, ar, n]) => `| ${en} | ${ar} | ${n} |`), '');
  for (const c of cuts) {
    out.push(`## النص — ${c.meta.title}`, '', `${c.count} سطرًا، نحو ${mmss(c.total)} من القراءة.`, '');
    for (const ch of c.chapters) {
      out.push(`### ${arDigits(ch.n)}. ${ch.ar}`, '');
      for (const s of ch.scenes) for (const l of s.lines) {
        out.push(`**\`${l.file}\`** · نحو ${arDigits(l.sec)} ث`, '', `> ${l.say ?? l.ar}`, '');
        if (l.say) out.push(`على الشاشة: ${l.ar}`, '');
        if (l.joins.length) out.push(`الوصل: ${l.joins.map((j) => `«${j.pair}» (${j.why})`).join('، ')}`, '');
        for (const n of l.notes) out.push(`- ${n}`);
        if (l.notes.length) out.push('');
      }
    }
  }
  out.push('## قبل التسليم', '', ...CHECK.map((g) => `- [ ] ${g}`), '', '</div>', '');
  return out.join('\n');
}

function html(cuts) {
  const font = (w) => readFileSync(join(HERE, 'node_modules/@fontsource/amiri/files', `amiri-arabic-${w}-normal.woff2`)).toString('base64');
  const lines = cuts.reduce((a, c) => a + c.count, 0);
  const secs = cuts.reduce((a, c) => a + c.total, 0);
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const body = [];
  body.push(`<section class="cover"><div class="eyebrow">CURRICULUM SCOPE · NARRATOR RECORDING PACK</div><h1>حزمة تسجيل التعليق الصوتي</h1><h2>نطاق المناهج — فيلمَا عرض المنتج</h2>
    <table class="facts"><tr><td>الأسطر</td><td>${arDigits(lines)} سطرًا (الفيلم الكامل ${arDigits(cuts[0].count)}، القصير ${arDigits(cuts[1].count)})</td></tr>
    <tr><td>القراءة الصافية</td><td>نحو ${arDigits(Math.round(secs / 60))} دقيقة، بسرعة نحو ${arDigits(WPM)} كلمة في الدقيقة</td></tr>
    <tr><td>وقت الأستوديو</td><td>نحو ساعتين مع الإعادات</td></tr>
    <tr><td>القارئ</td><td>صوت مصري (رجل أو امرأة)، بالعربية الفصحى</td></tr>
    <tr><td>النسخة</td><td dir="ltr">${DATE}</td></tr></table></section>`);
  body.push(`<section><h3>أسلوب القراءة</h3>${list(general)}<h3>المواصفات الفنية</h3>${list(SPECS)}<h3>التسمية والتسليم</h3>${list(DELIVERY)}
    <h3>المصطلحات الإنجليزية</h3><table class="terms"><tr><th>المصطلح</th><th>يُقرأ</th><th>ملاحظة</th></tr>${terms.map(([en, ar, n]) => `<tr><td dir="ltr">${esc(en)}</td><td class="say">${esc(ar)}</td><td>${esc(n)}</td></tr>`).join('')}</table></section>`);
  for (const c of cuts) {
    body.push(`<section class="cut"><h2>${esc(c.meta.title)}</h2><p class="meta">${arDigits(c.count)} سطرًا، نحو ${arDigits(mmss(c.total))} من القراءة</p>`);
    for (const ch of c.chapters) {
      body.push(`<h3>${arDigits(ch.n)}. ${esc(ch.ar)}</h3>`);
      for (const s of ch.scenes) for (const l of s.lines) {
        body.push(`<div class="line"><div class="head"><span class="file">${esc(l.file)}</span><span class="sec">نحو ${arDigits(l.sec)} ث</span><span class="box">☐</span></div>
          <p class="text">${esc(l.say ?? l.ar)}</p>${l.say ? `<p class="screen">على الشاشة: ${esc(l.ar)}</p>` : ''}
          ${l.joins.length ? `<p class="joins">الوصل: ${l.joins.map((j) => `<span>«${esc(j.pair)}»</span> <i>${esc(j.why)}</i>`).join('؛ ')}</p>` : ''}
          ${l.notes.length ? `<ul class="notes">${l.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`);
      }
    }
    body.push('</section>');
  }
  body.push(`<section><h3>قبل التسليم</h3><ul class="check">${CHECK.map((i) => `<li>☐ ${esc(i)}</li>`).join('')}</ul></section>`);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @font-face { font-family: Amiri; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}) format('woff2'); }
    @font-face { font-family: Amiri; font-weight: 700; src: url(data:font/woff2;base64,${font(700)}) format('woff2'); }
    @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
    body { font-family: Amiri, serif; color: #1b2433; font-size: 13.5pt; line-height: 1.75; margin: 0; }
    h1 { font-size: 34pt; margin: 0 0 4mm; color: #1f4e8c; } h2 { font-size: 20pt; color: #1f4e8c; margin: 0 0 3mm; }
    h3 { font-size: 16pt; color: #1f4e8c; border-bottom: 1px solid #c9d6ea; padding-bottom: 1mm; margin: 7mm 0 3mm; break-after: avoid; }
    .cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
    .eyebrow { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; letter-spacing: 2px; color: #6b7a90; direction: ltr; text-align: right; }
    table { border-collapse: collapse; width: 100%; margin: 3mm 0; } td, th { border: 1px solid #d5deeb; padding: 2mm 3mm; vertical-align: top; text-align: right; }
    .facts td:first-child { width: 32%; color: #6b7a90; } .terms .say { font-weight: 700; } th { background: #eef3fa; }
    .cut { break-before: page; } .meta { color: #6b7a90; margin-top: 0; }
    .line { border: 1px solid #dbe3ef; border-radius: 3mm; padding: 2.5mm 4mm 2mm; margin: 0 0 3.5mm; break-inside: avoid; }
    .head { display: flex; gap: 4mm; align-items: center; font-size: 9.5pt; color: #6b7a90; }
    .file { font-family: 'DejaVu Sans Mono', monospace; direction: ltr; unicode-bidi: isolate; color: #1f4e8c; font-weight: 700; }
    .box { margin-inline-start: auto; font-size: 13pt; }
    .text { font-size: 19pt; line-height: 2.15; margin: 1mm 0 1.5mm; }
    .screen { font-size: 11pt; color: #6b7a90; margin: 0 0 1mm; }
    .joins { font-size: 11pt; color: #8a5a00; margin: 0 0 1mm; } .joins i { font-style: normal; color: #9b7a3d; font-size: 10pt; }
    .notes { margin: 0; padding-inline-start: 5mm; font-size: 11.5pt; color: #2b4a75; } .check { list-style: none; padding: 0; }
  </style></head><body>${body.join('\n')}</body></html>`;
}

const cuts = [await cutLines('showcase-20'), await cutLines('showcase-3')];
writeFileSync(join(ROOT, 'NARRATOR_RECORDING_PACK.md'), markdown(cuts));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html(cuts), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: join(ROOT, 'Narrator_Recording_Pack.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#8a97ab;text-align:center;font-family:sans-serif">Curriculum Scope · Narrator recording pack · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
});
await browser.close();
const n = cuts.reduce((a, c) => a + c.count, 0);
const j = cuts.reduce((a, c) => a + c.chapters.flatMap((ch) => ch.scenes.flatMap((s) => s.lines)).reduce((b, l) => b + l.joins.length, 0), 0);
console.log(`${n} lines, ${j} wasl joins marked, ${Object.keys(notes).length} lines with notes → NARRATOR_RECORDING_PACK.md, Narrator_Recording_Pack.pdf`);
