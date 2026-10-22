// Catalog data ported from the original "Egypt Curriculum Picker" artifact
// (legacy/egypt-curriculum-picker.html). The builder below mirrors the original
// add()/intl() calls one-for-one so the two can be compared mechanically
// (see tests/unit/catalog-fidelity.test.ts).
//
// One deliberate correction: the original tagged international programme
// components as Ministry material ('moe') and programme assessments as
// language-school variants ('lang'). They are now 'prog' and 'exam'.
import type { MaterialKind, SubjectStatus, Track } from '../db/types.js';

export interface DatasetMaterial {
  kind: MaterialKind;
  title: string;
}

export interface DatasetSubject {
  grade: number;
  track: Track;
  block: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: SubjectStatus;
  materials: DatasetMaterial[];
  note: string | null;
}

export interface Dataset {
  academicYear: string;
  label: string;
  notice: string;
  gradeNotes: Record<string, string>;
  sources: { title: string; url: string }[];
  subjects: DatasetSubject[];
}

export const GRADE_NAMES: Record<number, [string, string]> = {
  1: ['Primary 1', 'الصف الأول الابتدائي'],
  2: ['Primary 2', 'الصف الثاني الابتدائي'],
  3: ['Primary 3', 'الصف الثالث الابتدائي'],
  4: ['Primary 4', 'الصف الرابع الابتدائي'],
  5: ['Primary 5', 'الصف الخامس الابتدائي'],
  6: ['Primary 6', 'الصف السادس الابتدائي'],
  7: ['Preparatory 1', 'الصف الأول الإعدادي'],
  8: ['Preparatory 2', 'الصف الثاني الإعدادي'],
  9: ['Preparatory 3', 'الصف الثالث الإعدادي'],
  10: ['Secondary 1', 'الصف الأول الثانوي'],
  11: ['Secondary 2', 'الصف الثاني الثانوي'],
  12: ['Secondary 3', 'الصف الثالث الثانوي'],
};

const EXT = {
  ar: ['Al-Adwaa (الأضواء)', 'Selah El-Telmeez (سلاح التلميذ)', 'El-Emtehan (الامتحان)'],
  arP: ['Qatr El-Nada (قطر الندى)'],
  en: ['Gem', 'Bit by Bit', 'El-Moasser (المعاصر)', 'Al-Adwaa English'],
  ma: ['Selah El-Telmeez', 'Al-Adwaa', 'El-Emtehan'],
  maL: ['El-Moasser Math (English edition)', 'Selah El-Telmeez — Language edition'],
  sc: ['Al-Adwaa', 'Selah El-Telmeez', 'El-Emtehan'],
  scL: ['El-Moasser Science (English edition)', 'Selah El-Telmeez — Language edition'],
  ss: ['Al-Adwaa', 'Selah El-Telmeez', 'El-Emtehan'],
  re: ['Al-Adwaa Religion'],
  sec: ['Al-Adwaa', 'El-Emtehan'],
  secL: ['El-Moasser (English edition)'],
  fl2: ['El-Moasser French / German', 'Bit by Bit (French)'],
};

export function buildLegacyDataset(): Dataset {
  const items: DatasetSubject[] = [];
  const add = (
    g: number,
    track: Track,
    block: string,
    sid: string,
    name: string,
    ar: string,
    st: SubjectStatus,
    mats: DatasetMaterial[],
    note?: string,
  ) => items.push({ grade: g, track, block, code: sid, nameEn: name, nameAr: ar, status: st, materials: mats, note: note ?? null });
  const M = (t: string): DatasetMaterial => ({ kind: 'moe', title: t });
  const L = (t: string): DatasetMaterial => ({ kind: 'lang', title: t });
  const X = (t: string): DatasetMaterial => ({ kind: 'ext', title: t });
  const book = 'Ministry textbook (Term 1 & Term 2)';
  const assess = 'Ministry assessments book (weekly tests)';
  const digital = 'Ministry digital library PDF / EKB';

  // ---------- PRIMARY 1–3 ----------
  for (let g = 1; g <= 3; g++) {
    const B = 'Ministry schools — Arabic, official language, private Arabic & language';
    add(g, 'moe', B, 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), M(assess), M(digital), ...EXT.ar.map(X), ...EXT.arP.map(X)], '4.5 periods/week; half a period reserved for reading & listening.');
    add(g, 'moe', B, 'en', 'English Language (Connect)', 'اللغة الإنجليزية', 'scored', [M('Connect — Ministry English textbook'), M(assess), L('Connect Plus — 2 extra periods/week (language schools)'), ...EXT.en.map(X)], '2.5 periods/week, plus 2 Connect Plus periods in official & private language schools.');
    add(g, 'moe', B, 'ma', 'Mathematics', 'الرياضيات', 'scored', [M(book + ' — Arabic edition'), L('Mathematics — English-medium edition (language schools)'), M(assess), ...EXT.ma.map(X), ...EXT.maL.map(X)], '3.5 periods/week.');
    add(g, 'moe', B, 're', 'Religious Education (Islamic / Christian)', 'التربية الدينية', 'pass', [M(book), ...EXT.re.map(X)], '2.5 periods/week. Curriculum redeveloped from 2025/26.');
    add(g, 'moe', B, 'pe', 'Physical & Health Education', 'التربية البدنية والصحية', 'act', [M('PE teacher activity guide')], '1 period/week.');
    add(g, 'moe', B, 'tk', 'Tokkatsu Activities', 'أنشطة التوكاتسو', 'act', [M('Tokkatsu activity guide')], 'Half a period/week.');
  }
  // ---------- PRIMARY 4–6 ----------
  for (let g = 4; g <= 6; g++) {
    const B = 'Ministry schools — Arabic, official language, private Arabic & language';
    add(g, 'moe', B, 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), M(assess), M(digital), ...EXT.ar.map(X), ...EXT.arP.map(X)], 'Half a period of Arabic reserved for reading & listening.');
    add(g, 'moe', B, 'en', 'English Language (Connect)', 'اللغة الإنجليزية', 'scored', [M('Connect — Ministry English textbook'), M(assess), L('Connect Plus — 2 extra periods/week (language schools)'), ...EXT.en.map(X)]);
    add(g, 'moe', B, 'ma', 'Mathematics', 'الرياضيات', 'scored', [M(book + ' — Arabic edition'), L('Mathematics — English-medium edition (language schools)'), M(assess), ...EXT.ma.map(X), ...EXT.maL.map(X)]);
    add(g, 'moe', B, 'sc', 'Science', 'العلوم', 'scored', [M(book + ' — Arabic edition'), L('Science — English-medium edition (language schools)'), M(assess), ...EXT.sc.map(X), ...EXT.scL.map(X)]);
    add(g, 'moe', B, 'ss', 'Social Studies', 'الدراسات الاجتماعية', 'scored', [M(book), M(assess), ...EXT.ss.map(X)]);
    add(g, 'moe', B, 're', 'Religious Education (Islamic / Christian)', 'التربية الدينية', 'pass', [M(book), ...EXT.re.map(X)]);
    add(g, 'moe', B, 'vr', 'Values & Respect for Others', 'القيم واحترام الآخر', 'act', [M('Ministry values book')], 'Half period; introduced 2025/26.');
    add(g, 'moe', B, 'ict', 'ICT', 'تكنولوجيا المعلومات والاتصالات', 'pass', [M(book)], 'Half a period/week; studied but not added to the total.');
    add(g, 'moe', B, 'art', 'Art Education', 'التربية الفنية', 'act', [M('Activity guide')]);
    add(g, 'moe', B, 'voc', 'Vocational skills: agriculture, industry, home management', 'المهارات المهنية (زراعة – صناعة – إدارة منزل)', 'act', [M('Activity guide')], 'Shares a slot with Music; schools run them by capacity.');
    add(g, 'moe', B, 'mus', 'Music Education', 'التربية الموسيقية', 'act', [M('Activity guide')]);
    add(g, 'moe', B, 'oth', 'School media, theatre, library', 'الإعلام التربوي – التربية المسرحية – المكتبات', 'act', [M('Activity guide')]);
    add(g, 'moe', B, 'pe', 'Physical & Health Education', 'التربية البدنية والصحية', 'act', [M('PE teacher activity guide')]);
  }
  // ---------- PREPARATORY 7–9 ----------
  for (let g = 7; g <= 9; g++) {
    const B = 'Ministry schools — Arabic, official language, private Arabic & language';
    add(g, 'moe', B, 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), M(digital), ...EXT.ar.map(X)], '8 periods/week · 80 marks (Prep 1 plan).');
    add(g, 'moe', B, 'ma', 'Mathematics (Algebra & Geometry)', 'الرياضيات', 'scored', [M(book + ' — Arabic edition'), L('Mathematics — English-medium edition (language schools)'), ...EXT.ma.map(X), ...EXT.maL.map(X)], '6 periods · 60 marks.');
    add(g, 'moe', B, 'en', 'English Language', 'اللغة الإنجليزية', 'scored', [M('Ministry English textbook'), L('Advanced English — language-school edition'), ...EXT.en.map(X)], '5 periods · 60 marks.');
    add(g, 'moe', B, 'sc', 'Science', 'العلوم', 'scored', [M(book + ' — Arabic edition'), L('Science — English-medium edition (language schools)'), ...EXT.sc.map(X), ...EXT.scL.map(X)], '4 periods · 40 marks.');
    add(g, 'moe', B, 'ss', 'Social Studies', 'الدراسات الاجتماعية', 'scored', [M(book), ...EXT.ss.map(X)], '4 periods · 40 marks.');
    add(g, 'moe', B, 're', 'Religious Education (Islamic / Christian)', 'التربية الدينية', 'pass', [M(book), ...EXT.re.map(X)], '3 periods · 40 marks, pass/fail.');
    add(g, 'moe', B, 'fl2', 'Second Foreign Language (French / German / Italian…)', 'اللغة الأجنبية الثانية', 'pass', [L('Ministry FL2 textbook'), ...EXT.fl2.map(X)], 'Language schools. Normally outside the total; confirm with each school.');
    add(g, 'moe', B, 'ict', 'Computer & ICT', 'الكمبيوتر وتكنولوجيا المعلومات', 'pass', [M(book)], '1 period · 20 marks, outside the total.');
    add(g, 'moe', B, 'art', 'Art Education', 'التربية الفنية', 'act', [M('Activity guide')], 'Half a period from 2025/26.');
    add(g, 'moe', B, 'mus', 'Music / Vocational skills', 'التربية الموسيقية / المهارات المهنية', 'act', [M('Activity guide')], 'Class split between music and vocational skills.');
    add(g, 'moe', B, 'pe', 'Physical Education', 'التربية الرياضية', 'act', [M('Activity guide')]);
  }
  // ---------- SECONDARY 1 (shared) ----------
  {
    const g = 10;
    const B = 'Foundation year — same subjects for Bakaloria and Thanaweya Amma';
    add(g, 'sec', B, 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), M('Tablet / EKB digital edition'), ...EXT.sec.map(X)]);
    add(g, 'sec', B, 'ma', 'Mathematics', 'الرياضيات', 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)]);
    add(g, 'sec', B, 'hi', 'History', 'التاريخ', 'scored', [M(book), ...EXT.sec.map(X)]);
    add(g, 'sec', B, 'ph', 'Philosophy & Logic', 'الفلسفة والمنطق', 'scored', [M(book), ...EXT.sec.map(X)]);
    add(g, 'sec', B, 'is', 'Integrated Science', 'العلوم المتكاملة', 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)]);
    add(g, 'sec', B, 'fl1', 'First Foreign Language (English)', 'اللغة الأجنبية الأولى', 'scored', [M('Ministry English textbook'), X('Gem'), X('Bit by Bit'), X('El-Moasser')]);
    add(g, 'sec', B, 're', 'Religious Education', 'التربية الدينية', 'pass', [M(book)]);
    add(g, 'sec', B, 'fl2', 'Second Foreign Language', 'اللغة الأجنبية الثانية', 'pass', [M('Ministry FL2 textbook'), ...EXT.fl2.map(X)]);
    add(g, 'sec', B, 'pcs', 'Programming & Computer Science', 'البرمجة وعلوم الحاسب', 'pass', [M('Ministry programming course (digital)')]);
  }
  // ---------- SECONDARY 2–3 Bakaloria ----------
  {
    const g = 11;
    const B = 'Egyptian Bakaloria — Year 1 of the certificate';
    const core: [string, string, string][] = [['ar', 'Arabic Language', 'اللغة العربية'], ['fl1', 'First Foreign Language', 'اللغة الأجنبية الأولى'], ['hi', 'History', 'التاريخ']];
    core.forEach(([s, n, a]) => add(g, 'bac', B + ' · core (all tracks)', s, n, a, 'scored', [M(book), ...EXT.sec.map(X)]));
    const tr: [string, string, string, [string, string, string][]][] = [
      ['med', 'Medicine & Life Sciences', 'الطب وعلوم الحياة', [['ph', 'Physics', 'الفيزياء'], ['ma', 'Mathematics', 'الرياضيات']]],
      ['eng', 'Engineering & Computer Science', 'الهندسة وعلوم الحاسب', [['ch', 'Chemistry', 'الكيمياء'], ['pai', 'Programming & AI', 'البرمجة والذكاء الاصطناعي']]],
      ['bus', 'Business', 'الأعمال', [['acc', 'Accounting', 'المحاسبة'], ['ba', 'Business Administration', 'إدارة الأعمال']]],
      ['art', 'Arts & Humanities', 'الآداب والفنون', [['psy', 'Psychology', 'علم النفس'], ['fl2', 'Second Foreign Language', 'اللغة الأجنبية الثانية']]],
    ];
    tr.forEach(([k, n, , subs]) => subs.forEach(([s, sn, sa]) => add(g, 'bac', `${B} · ${n} track (choose one)`, k + s, sn, sa, 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X)])));
    add(g, 'bac', B + ' · all tracks', 'fin', 'Financial Literacy', 'الثقافة المالية', 'pass', [M(book)], 'Not added to the total.');
    add(g, 'bac', B + ' · all tracks', 're', 'Religious Education', 'التربية الدينية', 'pass', [M(book)]);
    add(g, 'bac', B + ' · all tracks', 'pe', 'Physical Education (practical exam)', 'التربية الرياضية', 'act', [M('Activity guide')]);
  }
  {
    const g = 12;
    const B = 'Egyptian Bakaloria — Year 2 of the certificate';
    const tr: [string, string, [string, string, string][]][] = [
      ['med', 'Medicine & Life Sciences', [['bio', 'Biology (advanced)', 'الأحياء – مستوى رفيع'], ['ch', 'Chemistry (advanced)', 'الكيمياء – مستوى رفيع']]],
      ['eng', 'Engineering & Computer Science', [['ma', 'Mathematics (advanced)', 'الرياضيات – مستوى رفيع'], ['ph', 'Physics (advanced)', 'الفيزياء – مستوى رفيع']]],
      ['bus', 'Business', [['ec', 'Economics (advanced)', 'الاقتصاد – مستوى رفيع'], ['ma', 'Mathematics', 'الرياضيات']]],
      ['art', 'Arts & Humanities', [['geo', 'Geography (advanced)', 'الجغرافيا – مستوى رفيع'], ['st', 'Statistics', 'الإحصاء']]],
    ];
    tr.forEach(([k, n, subs]) => subs.forEach(([s, sn, sa]) => add(g, 'bac', `${B} · ${n} track`, k + s, sn, sa, 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)], 'Multiple exam attempts allowed.')));
    add(g, 'bac', B + ' · all tracks', 're', 'Religious Education', 'التربية الدينية', 'pass', [M(book)]);
  }
  // ---------- SECONDARY 2–3 Thanaweya Amma ----------
  {
    const g = 11;
    const B = 'Thanaweya Amma (classic system)';
    add(g, 'ta', B + ' · common', 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), ...EXT.sec.map(X)]);
    add(g, 'ta', B + ' · common', 'fl1', 'First Foreign Language', 'اللغة الأجنبية الأولى', 'scored', [M('Ministry English textbook'), X('Gem'), X('Bit by Bit')]);
    ([['ma', 'Mathematics', 'الرياضيات'], ['ch', 'Chemistry', 'الكيمياء'], ['ph', 'Physics', 'الفيزياء']] as const).forEach(([s, n, a]) => add(g, 'ta', B + ' · Scientific division', s, n, a, 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)], 'Confirm the full Secondary 2 plan against the 2026/27 decree.'));
    ([['hi', 'History', 'التاريخ'], ['geo', 'Geography', 'الجغرافيا'], ['psy', 'Psychology', 'علم النفس'], ['ma', 'Mathematics (general)', 'الرياضيات']] as const).forEach(([s, n, a]) => add(g, 'ta', B + ' · Literary division', s, n, a, 'scored', [M(book), ...EXT.sec.map(X)]));
    add(g, 'ta', B + ' · common', 're', 'Religious Education', 'التربية الدينية', 'pass', [M(book)]);
    add(g, 'ta', B + ' · common', 'fl2', 'Second Foreign Language', 'اللغة الأجنبية الثانية', 'pass', [M('Ministry FL2 textbook'), ...EXT.fl2.map(X)]);
  }
  {
    const g = 12;
    const B = 'Thanaweya Amma certificate (total 320)';
    add(g, 'ta', B + ' · common', 'ar', 'Arabic Language', 'اللغة العربية', 'scored', [M(book), ...EXT.sec.map(X)]);
    add(g, 'ta', B + ' · common', 'fl1', 'First Foreign Language', 'اللغة الأجنبية الأولى', 'scored', [M('Ministry English textbook'), X('Gem'), X('Bit by Bit'), X('El-Moasser')]);
    ([['bio', 'Biology', 'الأحياء'], ['ch', 'Chemistry', 'الكيمياء'], ['ph', 'Physics', 'الفيزياء']] as const).forEach(([s, n, a]) => add(g, 'ta', B + ' · Science (علمي علوم)', 's' + s, n, a, 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)]));
    ([['ma', 'Mathematics (Pure & Applied)', 'الرياضيات (بحتة وتطبيقية)'], ['ch', 'Chemistry', 'الكيمياء'], ['ph', 'Physics', 'الفيزياء']] as const).forEach(([s, n, a]) => add(g, 'ta', B + ' · Mathematics (علمي رياضيات)', 'm' + s, n, a, 'scored', [M(book), L('English-medium edition (language schools)'), ...EXT.sec.map(X), ...EXT.secL.map(X)]));
    ([['hi', 'History', 'التاريخ'], ['geo', 'Geography', 'الجغرافيا'], ['st', 'Statistics', 'الإحصاء']] as const).forEach(([s, n, a]) => add(g, 'ta', B + ' · Literary (أدبي)', 'l' + s, n, a, 'scored', [M(book), ...EXT.sec.map(X)]));
    add(g, 'ta', B + ' · outside the total', 'fl2', 'Second Foreign Language', 'اللغة الأجنبية الثانية', 'pass', [M('Ministry FL2 textbook'), ...EXT.fl2.map(X)]);
    add(g, 'ta', B + ' · outside the total', 're', 'Religious Education', 'التربية الدينية', 'pass', [M(book)]);
    add(g, 'ta', B + ' · outside the total', 'cit', 'Citizenship / National Education', 'التربية الوطنية', 'pass', [M(book)], 'Pass mark 70%.');
  }

  // ---------- INTERNATIONAL ----------
  const intl = (gs: number[], block: string, sid: string, name: string, ar: string, st: SubjectStatus, mats: DatasetMaterial[], note?: string) =>
    gs.forEach((g) => add(g, 'intl', block, sid, name, ar, st, mats, note));
  const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const I = (t: string): DatasetMaterial => ({ kind: 'prog', title: t }); // programme component (was 'moe')
  const P = (t: string): DatasetMaterial => ({ kind: 'exam', title: t }); // programme assessment (was 'lang')
  // Cambridge
  intl(r(1, 6), 'British — Cambridge', 'camP', 'Cambridge Primary (Stages 1–6)', 'كامبريدج – المرحلة الابتدائية', 'scored', [I('English'), I('Mathematics'), I('Science'), I('Global Perspectives'), I('Computing'), I('Digital Literacy'), P('Cambridge Primary Checkpoint (Stage 6)')]);
  intl(r(7, 9), 'British — Cambridge', 'camL', 'Cambridge Lower Secondary (Stages 7–9)', 'كامبريدج – الإعدادي', 'scored', [I('English'), I('Mathematics'), I('Science'), I('Global Perspectives'), I('Computing'), P('Lower Secondary Checkpoint (Stage 9)')]);
  intl(r(10, 11), 'British — Cambridge', 'igcse', 'Cambridge IGCSE (O-Level)', 'آي جي سي إس إي', 'scored', [I('English (First / Second Language)'), I('Mathematics / Additional Maths'), I('Physics'), I('Chemistry'), I('Biology'), I('Computer Science / ICT'), I('Business / Economics / Accounting'), I('Arabic (First Language)'), I('French / German')], 'Egyptian equivalence usually needs 8 O-Level subjects plus 2 AS/A-Level subjects.');
  intl([12], 'British — Cambridge', 'asal', 'Cambridge AS & A Level', 'المستوى المتقدم AS / A', 'scored', [I('Mathematics / Further Maths'), I('Physics'), I('Chemistry'), I('Biology'), I('Computer Science'), I('Economics / Business'), I('Psychology')]);
  // Edexcel
  intl(r(1, 6), 'British — Pearson Edexcel', 'iprim', 'Pearson Edexcel iPrimary', 'بيرسون – ابتدائي', 'scored', [I('English'), I('Mathematics'), I('Science'), I('Computing'), P('iPrimary Achievement Tests')]);
  intl(r(7, 9), 'British — Pearson Edexcel', 'ilow', 'Pearson Edexcel iLowerSecondary', 'بيرسون – إعدادي', 'scored', [I('English'), I('Mathematics'), I('Science'), I('Global Citizenship'), P('iLowerSecondary Achievement Tests')]);
  intl(r(10, 11), 'British — Pearson Edexcel', 'eigcse', 'Pearson Edexcel International GCSE', 'الشهادة الإنجليزية – إدكسل', 'scored', [I('English Language A/B'), I('Mathematics A/B, Further Pure'), I('Physics'), I('Chemistry'), I('Biology'), I('ICT / Computer Science'), I('Business / Economics / Accounting')]);
  intl([12], 'British — Pearson Edexcel', 'ial', 'Pearson Edexcel International AS & A Level', 'إدكسل – المستوى المتقدم', 'scored', [I('Mathematics / Further Maths'), I('Physics'), I('Chemistry'), I('Biology'), I('Economics / Business'), I('IT')]);
  // American
  intl(r(1, 8), 'American Diploma', 'usK8', 'US K–8 standards (Common Core, NGSS)', 'المنهج الأمريكي – حتى الصف الثامن', 'scored', [I('ELA (Common Core)'), I('Mathematics (Common Core)'), I('Science (NGSS)'), I('Social Studies'), I('Computer / STEM'), P('MAP Growth assessment')]);
  intl(r(9, 12), 'American Diploma', 'usHS', 'US High School Diploma', 'الدبلومة الأمريكية', 'scored', [I('English 9–12'), I('Algebra I/II, Geometry, Pre-Calculus, Calculus'), I('Biology, Chemistry, Physics'), I('World & US History'), I('Electives'), P('AP courses'), P('SAT / ACT / EST'), P('GPA')], 'Egyptian equivalence: 40% GPA, 40% standardized tests, 20% Arabic & History exams.');
  // IB
  intl(r(1, 5), 'International Baccalaureate', 'pyp', 'IB Primary Years Programme (PYP)', 'البكالوريا الدولية – PYP', 'scored', [I('Transdisciplinary units of inquiry'), I('Language'), I('Mathematics'), I('Science'), I('Social Studies'), I('Arts'), I('PSPE'), P('PYP Exhibition (final year)')]);
  intl(r(6, 10), 'International Baccalaureate', 'myp', 'IB Middle Years Programme (MYP)', 'البكالوريا الدولية – MYP', 'scored', [I('Language & Literature'), I('Language Acquisition'), I('Individuals & Societies'), I('Sciences'), I('Mathematics'), I('Arts'), I('PHE'), I('Design'), P('Personal Project')]);
  intl(r(11, 12), 'International Baccalaureate', 'dp', 'IB Diploma Programme (DP)', 'دبلومة البكالوريا الدولية', 'scored', [I('Six subject groups (HL / SL)'), I('Theory of Knowledge'), I('Extended Essay'), I('CAS')]);
  // German / French
  intl(r(1, 12), 'German schools', 'de', 'German curriculum (Abitur / DIA)', 'المنهج الألماني – الأبيتور', 'scored', [I('Deutsch'), I('Mathematik'), I('Naturwissenschaften'), I('Englisch'), P('Deutsches Sprachdiplom (DSD)'), P('Abitur / DIA (Grade 12)')]);
  intl(r(1, 12), 'French schools', 'fr', 'French curriculum (AEFE)', 'المنهج الفرنسي', 'scored', [I('Français'), I('Mathématiques'), I('Sciences'), I('Histoire-Géographie'), I('Anglais'), P('Diplôme national du brevet (3e)'), P('Baccalauréat français')]);
  // Identity subjects (Ministry material, so they keep 'moe')
  intl(r(1, 3), 'Egyptian identity subjects — required in all international schools', 'id13', 'Arabic + Religious Education', 'اللغة العربية + التربية الدينية', 'pass', [M('Ministry Arabic textbook (grade-equivalent)'), M('Ministry Religion textbook')]);
  intl(r(4, 9), 'Egyptian identity subjects — required in all international schools', 'id49', 'Arabic + Social Studies + Religious Education', 'العربية + الدراسات الاجتماعية + الدين', 'scored', [M('Ministry Arabic textbook'), M('Ministry Social Studies textbook'), M('Ministry Religion textbook')], 'Arabic and Social Studies each 10% of the grade total; Religion pass/fail.');
  intl(r(10, 12), 'Egyptian identity subjects — required in all international schools', 'id1012', 'Arabic + History + Religious Education', 'العربية + التاريخ + الدين', 'scored', [M('Ministry-set Arabic content'), M('Ministry-set History content'), M('Ministry Religion textbook')], 'Arabic & History added to the certificate total (10% each); under appeal at the Supreme Administrative Court.');

  return {
    academicYear: '2026/2027',
    label: 'Egypt K-12 curriculum — academic year 2026/2027',
    notice:
      'Check before contracting content. Subjects follow the Ministry decrees announced for 2026/27. External reference brands are commercial titles schools commonly use; confirm each edition matches the current curriculum. The rule adding Arabic and History to international-certificate totals is still before the Supreme Administrative Court.',
    gradeNotes: {
      '10': 'Students choose Bakaloria or Thanaweya Amma at Secondary 1 and cannot switch later. Bakaloria allows several exam attempts at full marks; Thanaweya Amma allows one attempt plus a second round.',
    },
    sources: [
      { title: 'Parlmany — Primary subjects, periods and assessment for 2026/27 (Aug 2026)', url: 'https://www.parlmany.com/News/2/613417/' },
      { title: 'Fil Gamaa — Grades 4–6 plan 2026/27 and Bakaloria tracks', url: 'https://filgamaa.com/?p=304796' },
      { title: 'Masrawy — Bakaloria subjects for Secondary 2 and 3 (Aug 2026)', url: 'https://www.masrawy.com/news/education-schooleducation/details/2026/8/17/3034293' },
      { title: 'Egypt Telegraph — Bakaloria vs Thanaweya Amma subjects', url: 'https://www.egypttelegraph.com/172389' },
      { title: 'Shbabbek — Preparatory subjects and marks 2027', url: 'https://shbabbek.com/show/281272' },
      { title: 'Al-Bawaba — Thanaweya Amma subject reduction', url: 'https://www.albawabhnews.com/5053794' },
      { title: 'Al-Ain — Identity subjects required in international schools', url: 'https://al-ain.com/article/international-schools-egypt-teach-arabic-language' },
      { title: 'Enterprise — American Diploma 40/40/20 weighting', url: 'https://enterpriseam.com/egypt-ar/blackboards/ردود-فعل-متباينة-من-قبل-المدارس-الدولي/' },
      { title: 'Parlmany — Parliamentary briefing on Arabic/History in international totals (Oct 2026)', url: 'https://www.parlmany.com/News/3/617238/' },
      { title: 'Ministry of Education digital library (textbook PDFs)', url: 'https://ellibrary.moe.gov.eg/' },
    ],
    subjects: items,
  };
}
