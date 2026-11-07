// Builds the Word guide for deploying a handover package on one Ubuntu server for a free pilot, in Arabic (right to
// left) or English (docs/deployment/README.md):
//
//   npm i --no-save docx@9.7.1
//   node scripts/deployment-guide/build.mjs ar <package version> docs/deployment/Midad-Deployment-Guide-AR.docx
//   node scripts/deployment-guide/build.mjs en <package version> docs/deployment/Midad-Deployment-Guide-EN.docx
//
// The text is in guide-ar.mjs and guide-en.mjs (keep them in step); the settings commands, shown word for word in both,
// are in settings.sh.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, PageNumber, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import JSZip from 'jszip';

// The package the guide's steps were last run on from start to finish, and when (docs/TEST_REPORT.md). A guide built
// for another package says so in its section 1.
const TESTED = '4d92a28';
const TESTED_ON = '2026-11-07';

const [LANG, VERSION, OUT] = process.argv.slice(2);
if (!['ar', 'en'].includes(LANG) || !VERSION || !OUT) {
  console.error('usage: node scripts/deployment-guide/build.mjs ar|en <package version> <out.docx>');
  process.exit(2);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const RTL = LANG === 'ar';
const FONT = 'Arial';
const MONO = 'Consolas';
const PAGE_W = 11906; // A4
const MARGIN = 1134; // 2 cm
const TEXT_W = PAGE_W - 2 * MARGIN;
const fonts = (f) => ({ ascii: f, hAnsi: f, cs: f });
const dateText = (iso) => new Intl.DateTimeFormat(RTL ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

// ------------------------------------------------------------ text helpers
// A segment is a string (text in the guide's language), {c: 'code'} (inline, left to right), {b: 'bold text'} or
// {l: 'Latin text'}. In the Arabic guide, inline code or Latin text that starts or ends with a symbol (/, -, ., [, !...)
// gets a left-to-right mark at that end, so the symbol stays on its side inside an Arabic sentence. Commands to copy
// are in code blocks, never inline.
const LRM = '‎';
const ltr = (t) => (RTL ? `${/^[A-Za-z0-9]/.test(t) ? '' : LRM}${t}${/[A-Za-z0-9]$/.test(t) ? '' : LRM}` : t);
function runs(segs, base = {}) {
  const list = Array.isArray(segs) ? segs : [segs];
  return list.map((s) => {
    if (typeof s === 'string') return new TextRun({ text: s, rightToLeft: RTL, font: fonts(FONT), size: 22, sizeComplexScript: 22, ...base });
    if (s.c !== undefined) return new TextRun({ text: ltr(s.c), rightToLeft: false, font: fonts(MONO), size: 19, sizeComplexScript: 19, shading: { type: ShadingType.CLEAR, fill: 'EEF1F4', color: 'auto' } });
    if (s.l !== undefined) return new TextRun({ text: ltr(s.l), rightToLeft: false, font: fonts(FONT), size: 22, sizeComplexScript: 22, ...base });
    if (s.b !== undefined) return new TextRun({ text: s.b, rightToLeft: RTL, bold: true, boldComplexScript: true, font: fonts(FONT), size: 22, sizeComplexScript: 22, ...base });
    throw new Error(`bad segment ${JSON.stringify(s)}`);
  });
}
const body = [];
const p = (segs, opts = {}) => body.push(new Paragraph({ bidirectional: RTL, spacing: { after: 120, line: 300 }, children: runs(segs), ...opts }));
const h1 = (text) => body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, bidirectional: RTL, pageBreakBefore: body.length > 6, children: runs(text, { size: 32, sizeComplexScript: 32, bold: true, boldComplexScript: true, color: '1F3A5F' }) }));
const h2 = (text) => body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: RTL, children: runs(text, { size: 26, sizeComplexScript: 26, bold: true, boldComplexScript: true, color: '2E5C8A' }) }));
const bullet = (segs) => body.push(new Paragraph({ bidirectional: RTL, numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60, line: 300 }, children: runs(segs) }));
const check = (segs) => body.push(new Paragraph({ bidirectional: RTL, numbering: { reference: 'checks', level: 0 }, spacing: { after: 80, line: 300 }, children: runs(segs) }));
let stepList = 0;
/** A numbered list; numbering restarts at 1 unless carryOn continues the previous list. */
function steps(items, carryOn = false) {
  if (!carryOn) stepList++;
  for (const it of items) body.push(new Paragraph({ bidirectional: RTL, numbering: { reference: 'steps', level: 0, instance: stepList }, spacing: { after: 80, line: 300 }, children: runs(it) }));
}
function code(lines, caption) {
  if (caption) p([{ b: caption }], { spacing: { before: 60, after: 40 } });
  lines.forEach((line, i) => body.push(new Paragraph({
    bidirectional: false,
    alignment: AlignmentType.LEFT,
    keepNext: i < lines.length - 1,
    keepLines: true,
    spacing: { before: i === 0 ? 40 : 0, after: i === lines.length - 1 ? 160 : 0, line: 260 },
    shading: { type: ShadingType.CLEAR, fill: 'F4F6F8', color: 'auto' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: '2E5C8A', space: 6 },
      ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE', space: 2 } } : {}),
      ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE', space: 2 } } : {}),
    },
    indent: { left: 120, right: 120 },
    children: [new TextRun({ text: line === '' ? ' ' : line, font: fonts(MONO), size: 18, sizeComplexScript: 18 })],
  })));
}
const BOX_LABELS = RTL ? { warn: 'تحذير: ', note: 'ملاحظة: ', ok: 'تم التحقق: ' } : { warn: 'Warning: ', note: 'Note: ', ok: 'Verified: ' };
function box(kind, segs) {
  const [fill, color] = { warn: ['FDECEA', 'B3261E'], note: ['EAF3FB', '2E5C8A'], ok: ['EAF6EC', '2E7D32'] }[kind];
  const edge = { style: BorderStyle.SINGLE, size: 24, color, space: 8 };
  body.push(new Paragraph({
    bidirectional: RTL,
    spacing: { before: 80, after: 160, line: 300 },
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    border: RTL ? { right: edge } : { left: edge },
    indent: { left: 120, right: 120 },
    children: [...runs([{ b: BOX_LABELS[kind] }], { color }), ...runs(segs)],
  }));
}
const codeOnly = (segs) => (Array.isArray(segs) ? segs : [segs]).every((x) => typeof x === 'object' && x.c !== undefined);
function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scaled = widths.map((w) => Math.floor((w / total) * TEXT_W));
  scaled[0] += TEXT_W - scaled.reduce((a, b) => a + b, 0);
  const cell = (segs, isHead, i) => new TableCell({
    width: { size: scaled[i], type: WidthType.DXA },
    shading: isHead ? { type: ShadingType.CLEAR, fill: '1F3A5F', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [codeOnly(segs)
      ? new Paragraph({ bidirectional: false, alignment: AlignmentType.LEFT, spacing: { after: 0, line: 276 }, children: (Array.isArray(segs) ? segs : [segs]).map((x) => new TextRun({ text: x.c, font: fonts(MONO), size: 19, sizeComplexScript: 19 })) })
      : new Paragraph({ bidirectional: RTL, spacing: { after: 0, line: 276 }, children: runs(segs, isHead ? { bold: true, boldComplexScript: true, color: 'FFFFFF' } : {}) })],
  });
  body.push(new Table({
    visuallyRightToLeft: RTL,
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: scaled,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((hd, i) => cell(hd, true, i)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, false, i)) })),
    ],
  }));
  body.push(new Paragraph({ children: [], spacing: { after: 120 } }));
}
/** The title page's lines: the title, the subtitle, then plain centred lines. */
function title(main, sub, lines) {
  body.push(new Paragraph({ bidirectional: RTL, alignment: AlignmentType.CENTER, spacing: { before: 1800, after: 240 }, children: runs(main, { size: 48, sizeComplexScript: 48, bold: true, boldComplexScript: true, color: '1F3A5F' }) }));
  body.push(new Paragraph({ bidirectional: RTL, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: runs(sub, { size: 28, sizeComplexScript: 28, color: '2E5C8A' }) }));
  lines.forEach((segs, i) => body.push(new Paragraph({ bidirectional: RTL, alignment: AlignmentType.CENTER, spacing: { after: i === lines.length - 1 ? 1200 : 120 }, children: runs(segs) })));
}

// ------------------------------------------------------------ content
const { default: write } = await import(`./guide-${LANG}.mjs`);
const text = write({
  p, h1, h2, bullet, check, steps, code, box, table, title,
  VERSION,
  TESTED,
  TESTED_ON: dateText(TESTED_ON),
  TODAY: dateText(new Date().toISOString().slice(0, 10)),
  ZIP: `midad-${VERSION}.zip`,
  DOMAIN: 'midad.example.com',
  DC: 'docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production',
  SETTINGS: readFileSync(join(HERE, 'settings.sh'), 'utf8').trimEnd().split('\n'),
});

// ------------------------------------------------------------ document
const small = { size: 16, sizeComplexScript: 16, color: '777777' };
const heading = (id, name, size, color, level, before, after) => ({
  id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: fonts(FONT), size, sizeComplexScript: size, bold: true, boldComplexScript: true, color },
  paragraph: { spacing: { before, after }, keepNext: true, keepLines: true, bidirectional: RTL, outlineLevel: level },
});
const listLevel = (format, glyph, run) => ({ level: 0, format, text: glyph, alignment: AlignmentType.START, style: { paragraph: { indent: { start: 540, hanging: 360 }, bidirectional: RTL }, ...(run ? { run } : {}) } });
const doc = new Document({
  creator: 'Midad',
  title: text.title,
  styles: {
    default: { document: { run: { font: fonts(FONT), size: 22, sizeComplexScript: 22, rightToLeft: RTL }, paragraph: { bidirectional: RTL } } },
    paragraphStyles: [heading('Heading1', 'Heading 1', 32, '1F3A5F', 0, 240, 160), heading('Heading2', 'Heading 2', 26, '2E5C8A', 1, 240, 120)],
  },
  numbering: {
    config: [
      { reference: 'steps', levels: [listLevel(LevelFormat.DECIMAL, '%1.', { bold: true, boldComplexScript: true, color: '2E5C8A' })] },
      { reference: 'bullets', levels: [listLevel(LevelFormat.BULLET, '•')] },
      { reference: 'checks', levels: [listLevel(LevelFormat.BULLET, '☐')] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    headers: { default: new Header({ children: [new Paragraph({ bidirectional: RTL, alignment: AlignmentType.CENTER, children: runs([text.header, { l: VERSION }], small) })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ bidirectional: RTL, alignment: AlignmentType.CENTER, children: [
      ...runs(text.page, small),
      new TextRun({ children: [PageNumber.CURRENT], ...small }),
      ...runs(text.of, small),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], ...small }),
    ] })] }) },
    children: body,
  }],
});

// docx writes a paragraph's borders as top, bottom, left, right; the schema (and Word) want top, left, bottom, right.
// The ZIP's folder entries are dropped too: Word has refused files with them when opened through a co-editing service.
async function finish(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const order = ['top', 'left', 'bottom', 'right', 'between', 'bar'];
  zip.file('word/document.xml', xml.replace(/<w:pBdr>(.*?)<\/w:pBdr>/g, (_, inner) => {
    const parts = new Map([...inner.matchAll(/<w:(\w+) [^>]*\/>/g)].map((m) => [m[1], m[0]]));
    return `<w:pBdr>${order.filter((k) => parts.has(k)).map((k) => parts.get(k)).join('')}</w:pBdr>`;
  }), { createFolders: false });
  for (const [name, entry] of Object.entries(zip.files)) if (entry.dir) delete zip.files[name];
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const out = await finish(await Packer.toBuffer(doc));
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${out.length} bytes, ${body.length} blocks)`);
