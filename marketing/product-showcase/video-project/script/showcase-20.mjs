// The 20-minute showcase: narration (fully diacritized Arabic, with an English translation) and the
// visual plan of every scene. One source for the scripts, the storyboard, the subtitles and the render.
//
// A scene: { id, ch, t (template), p (template parameters), lines, lead, tail, min, music }.
// A line:  { ar (shown and spoken), en (translation), say (what the narrator reads, when it differs:
//            numbers in words, English terms as pronounced) }.
// Visual beats refer to lines by index: the template shows beat k when line k starts.
// Product facts in the narration are checked against the repository (FEATURE_COVERAGE_MATRIX.md).

const L = (ar, en, say) => ({ ar, en, ...(say ? { say } : {}) });
// Camera boxes in the recorded window's CSS pixels (1440 × 810), picked with lib/grid.py.
const MONITOR_ROWS = { x: 100, y: 270, w: 770, h: 170 };

export const meta = {
  id: 'showcase-20',
  title: 'نطاق المناهج — عرض المنتج',
  titleEn: 'Curriculum Scope — Product Showcase',
  target: [1170, 1230],
};

export const chapters = [
  { n: 1, ar: 'التحدي', en: 'The education challenge' },
  { n: 2, ar: 'رؤية المنتج', en: 'Product vision' },
  { n: 3, ar: 'العملاء المستهدفون', en: 'Target customers' },
  { n: 4, ar: 'جولة في المنصة', en: 'Platform walkthrough' },
  { n: 5, ar: 'المزايا بالتفصيل', en: 'Feature showcase' },
  { n: 6, ar: 'تجربة الطالب والذكاء الاصطناعي', en: 'Student experience & AI' },
  { n: 7, ar: 'نموذج SaaS والقيمة التجارية', en: 'SaaS model & commercial value' },
  { n: 8, ar: 'الرؤية والخطوة التالية', en: 'Vision & next steps' },
];

export const scenes = [
  // ================================================================ 1 · the education challenge
  {
    id: 'c1-open', ch: 1, t: 'cold', music: 'open', lead: 2.6, tail: 0.6,
    p: {
      fragments: [
        { icon: 'sheet', ar: 'جدول بيانات', en: 'Spreadsheet' },
        { icon: 'chat', ar: 'مجموعة محادثة', en: 'Chat group' },
        { icon: 'paper', ar: 'قائمة مطبوعة', en: 'Printed list' },
        { icon: 'mail', ar: 'بريد إلكتروني', en: 'Email thread' },
        { icon: 'app', ar: 'تطبيق منفصل', en: 'Separate app' },
        { icon: 'folder', ar: 'مجلد مشترك', en: 'Shared folder' },
      ],
      words: [['أيُّ الكتب؟', 'أيُّ طبعة؟', 'لأيِّ صف؟'], ['مَن يتابع؟', 'أين تُحفظ؟']],
      beats: [0, 1, 2],
    },
    lines: [
      L('مَعَ بِدَايَةِ كُلِّ عَامٍ دِرَاسِيٍّ، تَتَكَرَّرُ الْأَسْئِلَةُ نَفْسُهَا فِي الْمَدَارِسِ وَالْمُؤَسَّسَاتِ التَّعْلِيمِيَّةِ.',
        'At the start of every academic year, schools and educational institutions face the same questions.'),
      L('أَيُّ الْكُتُبِ سَنُدَرِّسُ؟ وَبِأَيِّ طَبْعَةٍ؟ وَلِأَيِّ الصُّفُوفِ وَالْمَسَارَاتِ؟',
        'Which books will we teach? Which edition? For which grades and tracks?'),
      L('وَمَنْ يُتَابِعُ الْوَاجِبَاتِ وَالِاخْتِبَارَاتِ وَالدَّرَجَاتِ؟ وَأَيْنَ تُحْفَظُ الْإِجَابَاتُ؟',
        'Who follows up on homework, tests and grades? And where are the answers kept?'),
    ],
  },
  {
    id: 'c1-problems', ch: 1, t: 'problems', music: 'open', lead: 0.5, tail: 0.8,
    p: {
      cards: [
        { icon: 'scatter', ar: 'أدوات متفرّقة', en: 'Fragmented tools' },
        { icon: 'unlink', ar: 'عمليات غير مترابطة', en: 'Disconnected workflows' },
        { icon: 'eye', ar: 'لا صورة موحّدة', en: 'No unified view' },
        { icon: 'hand', ar: 'متابعة يدوية', en: 'Manual follow-up' },
        { icon: 'user', ar: 'دعم شخصي محدود', en: 'Limited personal support' },
        { icon: 'chart', ar: 'رؤية محدودة للتقدّم', en: 'Limited view of progress' },
      ],
      beats: [[0, 1], [2], [3], [4, 5]],
      note: { ar: 'تحدّيات شائعة نسمعها في السوق — تختلف من مؤسسة إلى أخرى', en: 'Common market challenges — they vary from one institution to another', at: 4 },
    },
    lines: [
      L('فِي مُؤَسَّسَاتٍ كَثِيرَةٍ، تَتَوَزَّعُ هَذِهِ الْإِجَابَاتُ بَيْنَ جَدَاوِلَ مُتَفَرِّقَةٍ، وَمَجْمُوعَاتِ مُحَادَثَةٍ، وَأَدَوَاتٍ لَا يَتَّصِلُ بَعْضُهَا بِبَعْضٍ.',
        'In many institutions, those answers are spread across separate spreadsheets, chat groups and tools that do not connect to each other.'),
      L('وَقَدْ يَعْمَلُ كُلُّ قِسْمٍ بِطَرِيقَتِهِ، فَيَصْعُبُ الْحُصُولُ عَلَى صُورَةٍ مُوَحَّدَةٍ لِمَا يَحْدُثُ فِعْلًا.',
        'Each department may work its own way, so a unified picture of what is really happening is hard to get.'),
      L('وَتَسْتَهْلِكُ الْمُتَابَعَةُ الْيَدَوِيَّةُ وَقْتَ الْمُعَلِّمِينَ وَالْإِدَارَةِ، بَدَلًا مِنْ أَنْ يَذْهَبَ إِلَى التَّعْلِيمِ نَفْسِهِ.',
        'Manual follow-up takes up teachers’ and administrators’ time, instead of it going to teaching itself.'),
      L('أَمَّا الطَّالِبُ، فَقَدْ لَا يَجِدُ مَكَانًا وَاحِدًا يَرَى فِيهِ مَا عَلَيْهِ، وَمَا أَنْجَزَهُ، وَكَيْفَ يَتَقَدَّمُ.',
        'And the student may have no single place to see what is due, what they have done, and how they are progressing.'),
      L('هَذِهِ لَيْسَتْ أَحْكَامًا عَلَى كُلِّ مُؤَسَّسَةٍ، بَلْ أَسْئِلَةٌ نَسْمَعُهَا كَثِيرًا، وَتَسْتَحِقُّ إِجَابَةً أَفْضَلَ.',
        'These are not verdicts on every institution, but questions we hear often — and they deserve a better answer.'),
    ],
  },
  {
    id: 'c1-question', ch: 1, t: 'question', music: 'open', lead: 0.6, tail: 1.4,
    p: {
      text: ['كيف تربط المؤسسة التعليمية', 'أفرادَها، وعملياتِها، وتجربةَ التعلّم', 'في منصة واحدة متكاملة؟'],
      accent: [1],
      en: 'How can an educational institution connect its people, its processes and the learning experience in one integrated platform?',
    },
    lines: [
      L('فَكَيْفَ تَرْبِطُ الْمُؤَسَّسَةُ التَّعْلِيمِيَّةُ أَفْرَادَهَا، وَعَمَلِيَّاتِهَا، وَتَجْرِبَةَ التَّعَلُّمِ، فِي مِنَصَّةٍ وَاحِدَةٍ مُتَكَامِلَةٍ؟',
        'So how can an educational institution connect its people, its processes and the learning experience in one integrated platform?'),
    ],
  },
  {
    id: 'c1-reveal', ch: 1, t: 'logo', music: 'reveal', lead: 1.8, tail: 2.6,
    p: { tagline: { ar: 'منصة تعليمية سحابية للمدارس والمؤسسات التعليمية', en: 'A cloud education platform for schools and education organizations' } },
    lines: [
      L('نُقَدِّمُ لَكُمْ: نِطَاقَ الْمَنَاهِجِ — Curriculum Scope.',
        'Introducing: Curriculum Scope — نطاق المناهج.',
        'نُقَدِّمُ لَكُمْ: نِطَاقَ الْمَنَاهِجِ — كَارِيكْيُولَم سْكُوب.'),
    ],
  },

  // ================================================================ 2 · product vision
  { id: 'c2-card', ch: 2, t: 'chapter', music: 'vision', min: 3.6, lines: [] },
  {
    id: 'c2-origin', ch: 2, t: 'split', music: 'vision', lead: 0.6, tail: 0.8,
    p: {
      left: { shot: 'legacy', frame: 0, ar: 'البداية: صفحة واحدة في متصفح واحد', en: 'The start: one page, one browser' },
      right: { shot: 'pick-books', frame: -1, ar: 'اليوم: منصة SaaS متكاملة', en: 'Today: an integrated SaaS platform' },
      beats: [0, 0, 1, 3],
      tags: { at: 2, items: ['بلا حسابات', 'بلا مشاركة', 'بلا سجل للقرارات'] },
    },
    lines: [
      L('بَدَأَتِ الْفِكْرَةُ بِأَدَاةٍ بَسِيطَةٍ: صَفْحَةٍ وَاحِدَةٍ لِاخْتِيَارِ مَنَاهِجِ مِصْرَ، مِنَ الصَّفِّ الْأَوَّلِ الِابْتِدَائِيِّ حَتَّى الثَّالِثِ الثَّانَوِيِّ.',
        'The idea began with a simple tool: a single page for choosing Egypt’s curriculum, from Primary 1 to Secondary 3.'),
      L('صُمِّمَتْ لِتَحْدِيدِ نِطَاقِ الْمُحْتَوَى لِمُنْتَجٍ تَعْلِيمِيٍّ فِي الْعَامِ الدِّرَاسِيِّ 2026/2027.',
        'It was designed to define the content scope of an education product for the 2026/2027 academic year.',
        'صُمِّمَتْ لِتَحْدِيدِ نِطَاقِ الْمُحْتَوَى لِمُنْتَجٍ تَعْلِيمِيٍّ فِي الْعَامِ الدِّرَاسِيِّ أَلْفَيْنِ وَسِتَّةٍ وَعِشْرِينَ، أَلْفَيْنِ وَسَبْعَةٍ وَعِشْرِينَ.'),
      L('لَكِنَّهَا كَانَتْ تَعْمَلُ فِي مُتَصَفِّحٍ وَاحِدٍ، بِلَا حِسَابَاتٍ، وَلَا مُشَارَكَةٍ، وَلَا سِجِلٍّ لِلْقَرَارَاتِ.',
        'But it worked in one browser only — no accounts, no sharing, no record of decisions.'),
      L('الْيَوْمَ، صَارَتْ مِنَصَّةً سَحَابِيَّةً مُتَكَامِلَةً تَعْمَلُ بِنَمُوذَجِ SaaS، لِفِرَقِ الْمَدَارِسِ وَمُعَلِّمِيهَا وَطُلَّابِهَا.',
        'Today it is an integrated cloud platform, delivered as SaaS, for school teams, their teachers and their students.',
        'الْيَوْمَ، صَارَتْ مِنَصَّةً سَحَابِيَّةً مُتَكَامِلَةً تَعْمَلُ بِنَمُوذَجِ سَاس، لِفِرَقِ الْمَدَارِسِ وَمُعَلِّمِيهَا وَطُلَّابِهَا.'),
    ],
  },
  {
    id: 'c2-layers', ch: 2, t: 'layers', music: 'vision', lead: 0.5, tail: 1.0,
    p: {
      layers: [
        { ar: 'المنهج', en: 'Curriculum', items: ['دليل المناهج', 'نطاقات المحتوى', 'الملاحظات والمسؤولون', 'عام دراسي جديد'] },
        { ar: 'الفصل', en: 'Classroom', items: ['الفصول', 'الواجبات', 'الاختبارات الإلكترونية', 'سجل الدرجات', 'بوابة الطالب'] },
        { ar: 'المؤسسة', en: 'Institution', items: ['الأدوار والصلاحيات', 'الاشتراكات', 'سجل التدقيق', 'الحماية', 'API'] },
      ],
      beats: [-1, 0, 1, 2],
    },
    lines: [
      L('تَقُومُ الْمِنَصَّةُ عَلَى ثَلَاثِ طَبَقَاتٍ مُتَرَابِطَةٍ.', 'The platform rests on three connected layers.'),
      L('الْأُولَى هِيَ الْمَنْهَجُ: دَلِيلٌ مُحَدَّثٌ لِلْمَنَاهِجِ الْمِصْرِيَّةِ، تُقَرِّرُ فِيهِ الْمُؤَسَّسَةُ مَا تُغَطِّيهِ، وَتَحْفَظُ قَرَارَهَا.',
        'The first is the curriculum: an up-to-date catalogue of Egypt’s curricula, where the institution decides what it covers and keeps a record of that decision.'),
      L('وَالثَّانِيَةُ هِيَ الْفَصْلُ: فُصُولٌ، وَوَاجِبَاتٌ، وَاخْتِبَارَاتٌ إِلِكْتُرُونِيَّةٌ، وَسِجِلُّ دَرَجَاتٍ، مَبْنِيَّةٌ عَلَى ذَلِكَ الْمَنْهَجِ.',
        'The second is the classroom: classes, homework, online tests and a gradebook, built on that curriculum.'),
      L('وَالثَّالِثَةُ هِيَ الْمُؤَسَّسَةُ: الْأَدْوَارُ، وَالصَّلَاحِيَّاتُ، وَالِاشْتِرَاكَاتُ، وَسِجِلُّ التَّدْقِيقِ، وَالْحِمَايَةُ.',
        'The third is the institution: roles, permissions, subscriptions, the audit log and protection.'),
    ],
  },
  {
    id: 'c2-flow', ch: 2, t: 'flow', music: 'vision', lead: 0.5, tail: 1.0,
    p: {
      nodes: [
        { icon: 'book', ar: 'الكتب المختارة', en: 'Chosen books' },
        { icon: 'class', ar: 'منهج الفصل', en: 'Class curriculum' },
        { icon: 'task', ar: 'الواجب والاختبار', en: 'Homework & tests' },
        { icon: 'grade', ar: 'سجل الدرجات', en: 'Gradebook' },
        { icon: 'student', ar: 'الطالب', en: 'The student' },
      ],
      beats: [0, 1, 2],
      footer: { ar: 'حساب واحد · تسجيل دخول واحد · العربية والإنجليزية', at: 2 },
    },
    lines: [
      L('قِيمَةُ التَّكَامُلِ أَنَّ الْمَعْلُومَةَ تُكْتَبُ مَرَّةً وَاحِدَةً، ثُمَّ تَنْتَقِلُ حَيْثُ يُحْتَاجُ إِلَيْهَا.',
        'The value of integration is that information is entered once, then travels to where it is needed.'),
      L('الْكُتُبُ الَّتِي تَخْتَارُهَا الْمَدْرَسَةُ تَصِيرُ مَنْهَجَ الْفَصْلِ، وَمِنْهَا يَخْتَارُ الْمُعَلِّمُ مَادَّةَ الْوَاجِبِ، ثُمَّ تَصِلُ الدَّرَجَةُ إِلَى سِجِلِّ الدَّرَجَاتِ وَإِلَى الطَّالِبِ.',
        'The books the school chooses become the class’s curriculum; from them the teacher picks the homework material, and the mark then reaches the gradebook and the student.'),
      L('وَكُلُّ ذَلِكَ بِحِسَابٍ وَاحِدٍ، وَتَسْجِيلِ دُخُولٍ وَاحِدٍ، وَوَاجِهَةٍ وَاحِدَةٍ بِالْعَرَبِيَّةِ وَالْإِنْجِلِيزِيَّةِ.',
        'All with one account, one sign-in and one interface, in Arabic and English.'),
    ],
  },
  {
    id: 'c2-principles', ch: 2, t: 'cards', music: 'vision', lead: 0.4, tail: 1.2,
    p: {
      title: { ar: 'مبادئ التصميم', en: 'Design principles' },
      cards: [
        { icon: 'rtl', ar: 'العربية أولًا', en: 'Arabic first, full RTL' },
        { icon: 'lock', ar: 'الخصوصية منذ التصميم', en: 'Privacy by design' },
        { icon: 'access', ar: 'سهولة الوصول للجميع', en: 'Accessible to everyone' },
        { icon: 'check', ar: 'اختبارات آلية لكل رحلة', en: 'Automated tests for every journey' },
      ],
      beats: [[0], [1, 2, 3]],
    },
    lines: [
      L('وَبُنِيَتِ الْمِنَصَّةُ عَلَى مَبَادِئَ وَاضِحَةٍ: الْعَرَبِيَّةُ أَوَّلًا، مَعَ دَعْمٍ كَامِلٍ لِلْكِتَابَةِ مِنَ الْيَمِينِ إِلَى الْيَسَارِ،',
        'And it is built on clear principles: Arabic first, with full right-to-left support;'),
      L('وَالْخُصُوصِيَّةُ مُنْذُ التَّصْمِيمِ، وَسُهُولَةُ الْوُصُولِ لِلْجَمِيعِ، وَاخْتِبَارَاتٌ آلِيَّةٌ تَتَحَقَّقُ مِنْ كُلِّ رِحْلَةِ اسْتِخْدَامٍ رَئِيسِيَّةٍ.',
        'privacy by design, accessibility for everyone, and automated tests that check every main user journey.'),
    ],
  },

  // ================================================================ 3 · target customers
  { id: 'c3-card', ch: 3, t: 'chapter', music: 'segments', min: 3.6, lines: [] },
  {
    id: 'c3-segments', ch: 3, t: 'segments', music: 'segments', lead: 0.5, tail: 1.0,
    p: {
      segments: [
        { icon: 'school', ar: 'المدارس الخاصة والدولية ومجموعات المدارس', en: 'Private & international schools, school groups', status: 'now',
          need: 'تنسيق ما يُدرَّس في كل صف وفرع، ومتابعة العمل اليومي', offer: ['نطاقات مشتركة', 'مقارنة الفروع', 'فصول وواجبات واختبارات', 'سجل درجات', 'بوابة الطالب'] },
        { icon: 'edtech', ar: 'شركات التكنولوجيا التعليمية وناشرو المحتوى', en: 'EdTech companies, content producers & publishers', status: 'now',
          need: 'أي جزء من المنهج نغطيه هذا العام؟', offer: ['نطاق موثّق لكل عام', 'API للقراءة', 'Webhooks موقّعة', 'علامات التحقق'] },
        { icon: 'center', ar: 'مراكز الدروس ومستشارو المناهج', en: 'Tutoring centres & curriculum consultants', status: 'now',
          need: 'خطط تغطية واضحة يمكن تصديرها ومقارنتها', offer: ['تصدير نصي وCSV وJSON', 'مقارنة النطاقات'] },
        { icon: 'uni', ar: 'الجامعات ومؤسسات التعليم العالي', en: 'Universities & higher education', status: 'later',
          need: 'الدليل مصمَّم للتعليم قبل الجامعي', offer: ['لا ساعات معتمدة بعد', 'لا تسجيل للمقررات بعد'] },
      ],
      // Beats: line → highlighted segment (-1: all).
      beats: [-1, 0, 0, 0, 1, 1, 2, 3, 3, -1, -1],
    },
    lines: [
      L('لِمَنْ صُمِّمَتْ هَذِهِ الْمِنَصَّةُ؟ لِفِئَاتٍ تَخْتَلِفُ احْتِيَاجَاتُهَا، وَيَجْمَعُهَا الْمَنْهَجُ.',
        'Who is this platform for? Groups with different needs, brought together by the curriculum.'),
      L('أَوَّلًا: الْمَدَارِسُ الْخَاصَّةُ وَالدَّوْلِيَّةُ، وَمَجْمُوعَاتُ الْمَدَارِسِ.', 'First: private and international schools, and school groups.'),
      L('تَحْتَاجُ إِلَى تَنْسِيقِ مَا يُدَرَّسُ فِي كُلِّ صَفٍّ وَكُلِّ فَرْعٍ، وَإِلَى مُتَابَعَةِ الْعَمَلِ الْيَوْمِيِّ لِلْمُعَلِّمِينَ وَالطُّلَّابِ.',
        'They need to coordinate what is taught in every grade and every campus, and to follow the daily work of teachers and students.'),
      L('وَتُقَدِّمُ لَهَا الْمِنَصَّةُ نِطَاقَاتِ مُحْتَوًى مُشْتَرَكَةً، وَمُقَارَنَةً بَيْنَ الْفُرُوعِ، وَفُصُولًا وَوَاجِبَاتٍ وَاخْتِبَارَاتٍ، وَسِجِلَّ دَرَجَاتٍ، وَبَوَّابَةً لِلطَّالِبِ.',
        'The platform gives them shared content scopes, comparison between campuses, classes, homework and tests, a gradebook, and a student portal.'),
      L('ثَانِيًا: شَرِكَاتُ التِّكْنُولُوجْيَا التَّعْلِيمِيَّةِ، وَمُنْتِجُو الْمُحْتَوَى، وَدُورُ النَّشْرِ.',
        'Second: education technology companies, content producers and publishers.'),
      L('سُؤَالُهُمُ الْأَهَمُّ: أَيُّ جُزْءٍ مِنَ الْمَنْهَجِ نُغَطِّيهِ هَذَا الْعَامَ؟ وَالْمِنَصَّةُ تَحْفَظُ الْإِجَابَةَ، وَتُرْسِلُهَا إِلَى أَنْظِمَتِهِمْ عَبْرَ API، وَإِشْعَارَاتِ Webhooks مُوَقَّعَةٍ.',
        'Their key question: which part of the curriculum do we cover this year? The platform keeps the answer and sends it to their systems through an API and signed webhooks.',
        'سُؤَالُهُمُ الْأَهَمُّ: أَيُّ جُزْءٍ مِنَ الْمَنْهَجِ نُغَطِّيهِ هَذَا الْعَامَ؟ وَالْمِنَصَّةُ تَحْفَظُ الْإِجَابَةَ، وَتُرْسِلُهَا إِلَى أَنْظِمَتِهِمْ عَبْرَ وَاجِهَةِ إِيه بِي آي، وَإِشْعَارَاتِ وِيب هُوكْس مُوَقَّعَةٍ.'),
      L('ثَالِثًا: مَرَاكِزُ الدُّرُوسِ وَمُسْتَشَارُو الْمَنَاهِجِ، الَّذِينَ يُعِدُّونَ خُطَطَ تَغْطِيَةٍ وَاضِحَةً، يُصَدِّرُونَهَا وَيُقَارِنُونَ بَيْنَهَا.',
        'Third: tutoring centres and curriculum consultants, who prepare clear coverage plans, export them and compare them.'),
      L('أَمَّا الْجَامِعَاتُ وَمُؤَسَّسَاتُ التَّعْلِيمِ الْعَالِي، فَهِيَ فُرْصَةُ تَوَسُّعٍ لَاحِقَةٌ، وَلَيْسَتْ مَدْعُومَةً بِالْكَامِلِ الْيَوْمَ.',
        'Universities and higher education are a later expansion opportunity; they are not fully supported today.'),
      L('فَالْفُصُولُ وَالِاخْتِبَارَاتُ وَسِجِلُّ الدَّرَجَاتِ قَابِلَةٌ لِلِاسْتِخْدَامِ، لَكِنَّ الدَّلِيلَ مُصَمَّمٌ لِلتَّعْلِيمِ قَبْلَ الْجَامِعِيِّ، وَلَا تُوجَدُ بَعْدُ سَاعَاتٌ مُعْتَمَدَةٌ وَلَا تَسْجِيلٌ لِلْمُقَرَّرَاتِ.',
        'Classes, tests and the gradebook can be used, but the catalogue is designed for pre-university education, and there are no credit hours or course registration yet.'),
      L('وَفِي كُلِّ الْحَالَاتِ، الْقِيمَةُ الْمَقْصُودَةُ وَاحِدَةٌ: قَرَارٌ وَاضِحٌ وَمُوَثَّقٌ، وَعَمَلٌ أَقَلُّ تَكْرَارًا، وَرُؤْيَةٌ أَوْضَحُ.',
        'In every case, the intended value is the same: a clear, documented decision, less repeated work, and a clearer view.'),
      L('وَهِيَ قِيمَةٌ سَتَقِيسُهَا الْمُؤَسَّسَاتُ الشَّرِيكَةُ فِي التَّشْغِيلِ التَّجْرِيبِيِّ، لَا أَرْقَامٌ نَدَّعِيهَا مُسْبَقًا.',
        'It is value that partner institutions will measure in the pilot — not figures we claim in advance.'),
    ],
  },

  // ================================================================ 4 · platform walkthrough
  { id: 'c4-card', ch: 4, t: 'chapter', music: 'demo', min: 3.6, lines: [] },
  {
    id: 'c4-signup', ch: 4, t: 'demo', music: 'demo', lead: 0.6, tail: 0.8,
    p: {
      caption: { ar: 'إنشاء حساب المؤسسة', en: 'Sign-up' }, status: 'now',
      segments: [{ shot: 'register', sync: { 0: 0 } }, { shot: 'email-confirmed' }, { shot: 'sign-in', sync: { 3: 1 } }],
    },
    lines: [
      L('لِنَبْدَأِ الْجَوْلَةَ مِنَ الْبِدَايَةِ. تُنْشِئُ مُنَى حِسَابًا لِمَدْرَسَتِهَا فِي خُطْوَةٍ وَاحِدَةٍ: اسْمُهَا، وَبَرِيدُهَا، وَاسْمُ الْمَدْرَسَةِ.',
        'Let’s start the tour at the beginning. Mona creates an account for her school in one step: her name, her email and the school’s name.'),
      L('تَصِلُهَا رِسَالَةٌ لِتَأْكِيدِ الْبَرِيدِ، ثُمَّ تَدْخُلُ، فَتَبْدَأُ مُؤَسَّسَتُهَا الْأُولَى بِفَتْرَةٍ تَجْرِيبِيَّةٍ مُدَّتُهَا أَرْبَعَةَ عَشَرَ يَوْمًا.',
        'She receives an email to confirm her address, then signs in, and her first organization starts with a 14-day trial.'),
    ],
  },
  {
    id: 'c4-2fa', ch: 4, t: 'demo', music: 'demo', lead: 0.4, tail: 0.8,
    p: { caption: { ar: 'التحقق بخطوتين', en: 'Two-step verification' }, status: 'now', segments: [{ shot: 'admin-2fa', to: 2 }] },
    lines: [
      L('وَلِحِمَايَةِ الْحِسَابَاتِ، تَدْعَمُ الْمِنَصَّةُ التَّحَقُّقَ بِخُطْوَتَيْنِ: وَهُوَ إِلْزَامِيٌّ لِمُدِيرِي الْمِنَصَّةِ، وَيُمْكِنُ لِلْمُؤَسَّسَةِ أَنْ تَفْرِضَهُ عَلَى مَالِكِهَا وَمَسْؤُولِيهَا.',
        'To protect accounts, the platform supports two-step verification: it is mandatory for platform administrators, and an organization can require it for its owner and admins.'),
    ],
  },
  {
    id: 'c4-account', ch: 4, t: 'demo', music: 'demo', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'أمان الحساب', en: 'Account security' }, status: 'now', segments: [{ shot: 'account' }] },
    lines: [
      L('وَمِنْ صَفْحَةِ الْحِسَابِ، يُفَعِّلُ كُلُّ مُسْتَخْدِمٍ التَّحَقُّقَ بِخُطْوَتَيْنِ، وَيَرَى جَلَسَاتِهِ النَّشِطَةَ، وَيُنَزِّلُ بَيَانَاتِهِ الشَّخْصِيَّةَ مَتَى شَاءَ.',
        'From the account page, each user turns on two-step verification, sees their active sessions, and downloads their personal data whenever they like.'),
    ],
  },
  {
    id: 'c4-members', ch: 4, t: 'demo', music: 'demo', lead: 0.4, tail: 0.8,
    p: {
      caption: { ar: 'الأعضاء والأدوار', en: 'Members & roles' }, status: 'now',
      segments: [{ shot: 'members-invite' }, { shot: 'invitation', sync: { 0: 1 } }, { shot: 'members' }, { shot: 'viewer', sync: { 0: 2 } }],
    },
    lines: [
      L('بَعْدَ ذَلِكَ، تَدْعُو مُنَى فَرِيقَهَا. وَلِكُلِّ عُضْوٍ دَوْرٌ: مَالِكٌ، أَوْ مَسْؤُولٌ، أَوْ مُحَرِّرٌ، أَوْ مُشَاهِدٌ.',
        'Next, Mona invites her team. Each member has a role: owner, admin, editor or viewer.'),
      L('يَصِلُ كَرِيمًا رَابِطُ الدَّعْوَةِ، فَيَخْتَارُ كَلِمَةَ مُرُورِهِ، وَيَنْضَمُّ مُبَاشَرَةً.',
        'Karim receives the invitation link, chooses his password and joins right away.'),
      L('وَالصَّلَاحِيَّاتُ تُطَبَّقُ عَلَى الْخَادِمِ نَفْسِهِ، لَا فِي الْوَاجِهَةِ فَقَطْ: فَالْمُشَاهِدُ يَرَى، لَكِنَّهُ لَا يُعَدِّلُ.',
        'Permissions are enforced on the server itself, not only in the interface: a viewer can see, but cannot change anything.'),
    ],
  },
  {
    id: 'c4-tenancy', ch: 4, t: 'demo', music: 'demo', lead: 0.4, tail: 0.4,
    p: { caption: { ar: 'أكثر من مؤسسة', en: 'Multiple organizations' }, status: 'now', segments: [{ shot: 'org-switch' }] },
    lines: [
      L('وَيُمْكِنُ لِلشَّخْصِ الْوَاحِدِ أَنْ يَنْتَمِيَ إِلَى أَكْثَرَ مِنْ مُؤَسَّسَةٍ، وَيَنْتَقِلَ بَيْنَهَا مِنَ الْقَائِمَةِ أَعْلَى الصَّفْحَةِ.',
        'One person can belong to more than one organization and switch between them from the menu at the top of the page.'),
    ],
  },
  {
    id: 'c4-isolation', ch: 4, t: 'tenants', music: 'demo', lead: 0.4, tail: 1.0,
    p: { tenants: ['مدرسة وادي النيل للغات', 'برنامج وادي النيل الصيفي', 'مؤسسة أخرى'], label: { ar: 'Multi-Tenancy · عزل على مستوى الصفوف', en: 'Row-level security in PostgreSQL' } },
    lines: [
      L('وَهُنَا يَظْهَرُ مَبْدَأُ Multi-Tenancy: كُلُّ مُؤَسَّسَةٍ مَعْزُولَةٌ عَنْ غَيْرِهَا دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ نَفْسِهَا، بِسِيَاسَاتِ أَمَانٍ عَلَى مُسْتَوَى الصُّفُوفِ.',
        'This is multi-tenancy at work: every organization is isolated from the others inside the database itself, with row-level security policies.',
        'وَهُنَا يَظْهَرُ مَبْدَأُ تَعَدُّدِ الْمُسْتَأْجِرِينَ: كُلُّ مُؤَسَّسَةٍ مَعْزُولَةٌ عَنْ غَيْرِهَا دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ نَفْسِهَا، بِسِيَاسَاتِ أَمَانٍ عَلَى مُسْتَوَى الصُّفُوفِ.'),
    ],
  },
  {
    id: 'c4-navigation', ch: 4, t: 'demo', music: 'demo', lead: 0.4, tail: 0.8,
    p: {
      caption: { ar: 'التنقّل والإشعارات واللغة', en: 'Navigation, notifications, language' }, status: 'now',
      segments: [{ shot: 'pick-books', frame: -1, hold: 'nav' }, { shot: 'karim-bell', to: 1, sync: { 0: 1 } }, { shot: 'language', sync: { 0: 2 } }],
    },
    lines: [
      L('التَّنَقُّلُ وَاضِحٌ: دَلِيلُ الْمَنَاهِجِ، وَالنِّطَاقَاتُ، وَالْفُصُولُ، وَالطُّلَّابُ، وَالْأَعْضَاءُ، وَالْفَوْتَرَةُ، وَالْإِعْدَادَاتُ، وَسِجِلُّ التَّدْقِيقِ.',
        'Navigation is clear: the curriculum guide, scopes, classes, students, members, billing, settings and the audit log.'),
      L('وَيُنَبِّهُ جَرَسُ الْإِشْعَارَاتِ كُلَّ عُضْوٍ بِمَا يَخُصُّهُ، بِلُغَتِهِ.', 'The notifications bell tells each member what concerns them, in their own language.'),
      L('وَبِنَقْرَةٍ وَاحِدَةٍ، تَتَحَوَّلُ الْوَاجِهَةُ كُلُّهَا مِنَ الْعَرَبِيَّةِ إِلَى الْإِنْجِلِيزِيَّةِ، وَمِنَ الْيَمِينِ إِلَى الْيَسَارِ.',
        'With one click, the whole interface switches from Arabic to English, and from right-to-left to left-to-right.'),
    ],
  },
  {
    id: 'c4-access', ch: 4, t: 'phone', music: 'demo', lead: 0.4, tail: 0.8,
    p: {
      caption: { ar: 'على الهاتف وسهولة الوصول', en: 'Mobile & accessibility' }, status: 'now',
      segments: [{ shot: 'picker-phone' }],
      points: [{ ar: 'الواجهة نفسها على الهاتف', at: 0 }, { ar: 'فحص آلي لـ149 شاشة وفق WCAG', at: 0 }, { ar: 'مراجعة يدوية بقارئ الشاشة: قادمة', at: 1 }],
    },
    lines: [
      L('وَالْوَاجِهَةُ نَفْسُهَا تَعْمَلُ عَلَى الْهَاتِفِ، وَصُمِّمَتْ لِتَكُونَ سَهْلَةَ الْوُصُولِ: فَقَدْ فُحِصَتْ آلِيًّا 149 شَاشَةً وَفْقَ مَعَايِيرِ WCAG، دُونَ أَيِّ مُلَاحَظَةٍ.',
        'The same interface works on a phone, and it is designed to be accessible: 149 screens were checked automatically against the WCAG guidelines, with no findings.',
        'وَالْوَاجِهَةُ نَفْسُهَا تَعْمَلُ عَلَى الْهَاتِفِ، وَصُمِّمَتْ لِتَكُونَ سَهْلَةَ الْوُصُولِ: فَقَدْ فُحِصَتْ آلِيًّا مِئَةٌ وَتِسْعٌ وَأَرْبَعُونَ شَاشَةً وَفْقَ مَعَايِيرِ دَبْلْيُو كَاج، دُونَ أَيِّ مُلَاحَظَةٍ.'),
      L('وَتَبْقَى مُرَاجَعَةٌ يَدَوِيَّةٌ بِقَارِئِ الشَّاشَةِ خُطْوَةً قَادِمَةً قَبْلَ الْإِطْلَاقِ.', 'A manual review with a screen reader is still a step ahead of the launch.'),
    ],
  },
  {
    id: 'c4-oversight', ch: 4, t: 'demo', music: 'demo', lead: 0.4, tail: 1.0,
    p: {
      caption: { ar: 'سجل التدقيق ولوحة إدارة المنصة', en: 'Audit log & platform admin' }, status: 'now',
      segments: [{ shot: 'audit' }, { shot: 'admin-overview', sync: { 0: 1 } }, { shot: 'settings', from: 3, sync: { 0: 2 } }],
    },
    lines: [
      L('وَكُلُّ إِجْرَاءٍ مُهِمٍّ يُسَجَّلُ فِي سِجِلِّ التَّدْقِيقِ: مَنْ فَعَلَ مَاذَا، وَمَتَى.', 'Every important action is recorded in the audit log: who did what, and when.'),
      L('وَعَلَى مُسْتَوَى الْمِنَصَّةِ، لِفَرِيقِ التَّشْغِيلِ لَوْحَةُ إِدَارَةٍ تَعْرِضُ الْمُؤَسَّسَاتِ، وَالِاشْتِرَاكَاتِ، وَصِحَّةَ النِّظَامِ، وَالتَّنْبِيهَاتِ.',
        'At platform level, the operations team has an admin dashboard showing organizations, subscriptions, system health and alerts.'),
      L('لَكِنَّهُ لَا يَطَّلِعُ عَلَى مُحْتَوَى عَمَلِ الْمَدْرَسَةِ إِلَّا إِذَا مَنَحَتْهُ الْمَدْرَسَةُ إِذْنًا مُؤَقَّتًا، وَكُلُّ اطِّلَاعٍ يُسَجَّلُ فِي سِجِلِّهَا.',
        'But it cannot see a school’s work unless the school grants temporary access, and every access is logged in the school’s own log.'),
    ],
  },

  // ================================================================ 5 · feature showcase
  {
    id: 'c5-card', ch: 5, t: 'chapter', music: 'features', lead: 1.2, tail: 0.6,
    lines: [L('وَالْآنَ، إِلَى الْمَزَايَا بِالتَّفْصِيلِ، كَمَا تَعْمَلُ فِعْلًا فِي الْمِنَصَّةِ.', 'Now to the features in detail, as they actually work in the platform.')],
  },
  {
    id: 'c5-catalogue', ch: 5, t: 'demo', music: 'features', lead: 0.4, tail: 0.8,
    p: {
      caption: { ar: 'دليل المناهج', en: 'Curriculum catalogue' }, status: 'now', group: { ar: 'المنهج', en: 'Curriculum' },
      stats: { at: 0, items: [['12', 'صفًّا'], ['5', 'مسارات'], ['231', 'مادة دراسية'], ['1,038', 'كتابًا ومرجعًا']] },
      segments: [{ shot: 'filters', sync: { 0: 1 } }, { shot: 'pick-books', from: 4, sync: { 0: 2 } }],
    },
    lines: [
      L('قَلْبُ الْمِنَصَّةِ هُوَ دَلِيلُ الْمَنَاهِجِ: اثْنَا عَشَرَ صَفًّا، وَخَمْسَةُ مَسَارَاتٍ، وَ231 مَادَّةً دِرَاسِيَّةً، تَضُمُّ أَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.',
        'At the heart of the platform is the curriculum catalogue: twelve grades, five tracks and 231 subjects, with more than a thousand books and references.',
        'قَلْبُ الْمِنَصَّةِ هُوَ دَلِيلُ الْمَنَاهِجِ: اثْنَا عَشَرَ صَفًّا، وَخَمْسَةُ مَسَارَاتٍ، وَمِئَتَانِ وَوَاحِدٌ وَثَلَاثُونَ مَادَّةً دِرَاسِيَّةً، تَضُمُّ أَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.'),
      L('مِنْ مَدَارِسِ الْوِزَارَةِ، إِلَى الْبَكَالُورِيَا الْمِصْرِيَّةِ الْجَدِيدَةِ، وَالثَّانَوِيَّةِ الْعَامَّةِ، وَالْبَرَامِجِ الدَّوْلِيَّةِ.',
        'From Ministry schools to the new Egyptian Bakaloria, Thanaweya Amma and international programmes.'),
      L('يَخْتَارُ الْفَرِيقُ الصُّفُوفَ، ثُمَّ يُحَدِّدُ الْكُتُبَ بِنَقْرَةٍ، وَيُحْفَظُ كُلُّ اخْتِيَارٍ تِلْقَائِيًّا.',
        'The team picks grades, then ticks books with a click, and every choice is saved automatically.'),
    ],
  },
  {
    id: 'c5-verified', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'علامات التحقق', en: 'Verification marks' }, status: 'now', segments: [{ shot: 'verify-subject', from: 1 }, { shot: 'picker-verified', to: 3, sync: { 0: 1 } }] },
    lines: [
      L('وَيُسَجِّلُ فَرِيقُ الْمِنَصَّةِ مُرَاجَعَةَ كُلِّ مَادَّةٍ وَمَصْدَرَهَا، فَتَظْهَرُ لِلْمَدَارِسِ عَلَامَةُ التَّحَقُّقِ إِلَى جَانِبِ الْمَادَّةِ.',
        'The platform team records the review of each subject and its source, and schools see a verification mark beside it.'),
      L('هَكَذَا يَعْرِفُ الْجَمِيعُ مَا رُوجِعَ، وَمِنْ أَيِّ مَصْدَرٍ.', 'So everyone knows what has been checked, and against which source.'),
    ],
  },
  {
    id: 'c5-scopes', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'نطاقات المحتوى والتصدير', en: 'Content scopes & exports' }, status: 'now', segments: [{ shot: 'duplicate' }, { shot: 'exports', sync: { 0: 1 } }] },
    lines: [
      L('وَيُحْفَظُ كُلُّ اخْتِيَارٍ فِي نِطَاقِ مُحْتَوًى بِاسْمٍ وَاضِحٍ، يُشَارِكُهُ الْفَرِيقُ كُلُّهُ، وَيُمْكِنُ نَسْخُهُ لِفَرْعٍ آخَرَ.',
        'Each selection is saved as a named content scope, shared by the whole team, and it can be copied for another campus.'),
      L('وَيُصَدَّرُ النِّطَاقُ نَصًّا، أَوْ جَدْوَلَ CSV، أَوْ مَلَفَّ JSON، أَوْ يُقْرَأُ مُبَاشَرَةً عَبْرَ الْـ API.',
        'A scope can be exported as text, a CSV table or a JSON file, or read directly through the API.',
        'وَيُصَدَّرُ النِّطَاقُ نَصًّا، أَوْ جَدْوَلَ سِي إِس فِي، أَوْ مَلَفَّ جَيْسُون، أَوْ يُقْرَأُ مُبَاشَرَةً عَبْرَ وَاجِهَةِ إِيه بِي آي.'),
    ],
  },
  {
    id: 'c5-compare', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'مقارنة النطاقات', en: 'Compare scopes' }, status: 'now', segments: [{ shot: 'scopes', zoom: { 2: { x: 100, y: 430, w: 770, h: 240 } } }] },
    lines: [
      L('وَفِي صَفْحَةِ الْمُقَارَنَةِ، يُوضَعُ نِطَاقَانِ جَنْبًا إِلَى جَنْبٍ — وَلَوْ مِنْ عَامَيْنِ دِرَاسِيَّيْنِ مُخْتَلِفَيْنِ — فَتَظْهَرُ الْفُرُوقُ وَحْدَهَا.',
        'On the comparison page, two scopes sit side by side — even from different academic years — and only the differences are shown.'),
    ],
  },
  {
    id: 'c5-notes', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'الملاحظات والمسؤولون', en: 'Notes & assignees' }, status: 'now', segments: [{ shot: 'notes', sync: { 6: 1 } }] },
    lines: [
      L('وَلِكُلِّ كِتَابٍ مُخْتَارٍ مُلَاحَظَةٌ، وَمَسْؤُولٌ عَنْ مُتَابَعَتِهِ، وَحَالَةٌ، وَتَارِيخُ اسْتِحْقَاقٍ.',
        'Each selected book can have a note, a person responsible for following it up, a status and a due date.'),
      L('وَتُوَزِّعُ مُنَى الْمَهَامَّ عَلَى فَرِيقِهَا دُفْعَةً وَاحِدَةً، فَتَصِلُ كُلَّ عُضْوٍ إِشْعَارَاتٌ بِلُغَتِهِ.',
        'Mona assigns tasks to her team in one go, and each member is notified in their own language.'),
    ],
  },
  {
    id: 'c5-assignments', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'مهامي والتذكيرات', en: 'My assignments & reminders' }, status: 'now', segments: [{ shot: 'karim-bell' }, { shot: 'assignments-all', sync: { 0: 1 } }] },
    lines: [
      L('وَفِي صَفْحَةِ «مَهَامِّي»، يَرَى كُلُّ عُضْوٍ مَا عَلَيْهِ فِي كُلِّ مُؤَسَّسَاتِهِ، وَالْمُتَأَخِّرُ أَوَّلًا.',
        'On “My assignments”, each member sees what they owe across all their organizations, overdue first.'),
      L('وَتُرْسِلُ الْمِنَصَّةُ تَذْكِيرًا عِنْدَ اقْتِرَابِ الْمَوْعِدِ وَعِنْدَ تَجَاوُزِهِ، وَيَخْتَارُ كُلُّ عُضْوٍ أَنْ تَصِلَهُ رَسَائِلُ التَّكْلِيفِ فَوْرًا، أَوْ فِي مُلَخَّصٍ صَبَاحِيٍّ وَاحِدٍ.',
        'Reminders go out as a due date approaches and once it has passed, and each member chooses to get assignment emails right away or in one morning summary.'),
    ],
  },
  {
    id: 'c5-newyear', ch: 5, t: 'demo', music: 'features', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'عام دراسي جديد', en: 'A new academic year' }, status: 'now', segments: [{ shot: 'new-year', from: 4 }, { shot: 'carry', sync: { 0: 1 } }] },
    lines: [
      L('وَمَعَ كُلِّ عَامٍ دِرَاسِيٍّ جَدِيدٍ، يَنْشُرُ فَرِيقُ الْمِنَصَّةِ نُسْخَةً مُحَدَّثَةً مِنَ الدَّلِيلِ، فَتَصِلُ الْمَدَارِسَ إِشْعَارَاتٌ فَوْرِيَّةٌ.',
        'With each new academic year, the platform team publishes an updated edition of the catalogue, and schools are notified at once.'),
      L('وَبِخُطْوَةٍ وَاحِدَةٍ، يُنْقَلُ النِّطَاقُ إِلَى الْعَامِ الْجَدِيدِ، مَعَ مُرَاجَعَةٍ تُبَيِّنُ مَا تَغَيَّرَ، وَمَا حُذِفَ، وَمَا يُمْكِنُ نَقْلُهُ.',
        'In one step, the scope is carried to the new year, with a review showing what changed, what was removed and what can be carried.'),
      L('وَتَنْتَقِلُ مَعَهُ الْمُلَاحَظَاتُ وَالْمَسْؤُولِيَّاتُ، فَلَا يَبْدَأُ الْفَرِيقُ مِنَ الصِّفْرِ.', 'Notes and responsibilities move with it, so the team does not start from zero.'),
    ],
  },
  {
    id: 'c5-students', ch: 5, t: 'demo', music: 'classroom', lead: 0.6, tail: 0.8,
    p: {
      caption: { ar: 'حسابات الطلاب', en: 'Student accounts' }, status: 'now', group: { ar: 'الفصل', en: 'Classroom' },
      segments: [{ shot: 'student-add' }, { shot: 'student-import', sync: { 0: 1 } }],
      // Built and tested, but off for every school until the legal review of minors' data (PROJECT_STATUS B-9).
      notes: [{ at: 2, ar: 'تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب', en: 'Switched on per school after the legal review of student data', kind: 'dev' }],
    },
    lines: [
      L('نَنْتَقِلُ إِلَى الْفَصْلِ الدِّرَاسِيِّ. تُنْشِئُ الْمَدْرَسَةُ حِسَابَاتِ طُلَّابِهَا بِنَفْسِهَا، وَاحِدًا وَاحِدًا، أَوْ مِنْ مَلَفِّ قَائِمَةٍ.',
        'Now to the classroom. The school creates its students’ accounts itself, one by one or from a roster file.'),
      L('وَتَكْشِفُ الْمُعَايَنَةُ أَخْطَاءَ الْمَلَفِّ قَبْلَ الِاسْتِيرَادِ بِرَسَائِلَ عَرَبِيَّةٍ وَاضِحَةٍ، ثُمَّ تُعْطِي كَلِمَاتِ مُرُورٍ لِمَرَّةٍ وَاحِدَةٍ.',
        'A preview catches the file’s mistakes before import, with clear Arabic messages, then gives out one-time passwords.'),
      L('لَا يَحْتَاجُ الطَّالِبُ إِلَى بَرِيدٍ إِلِكْتُرُونِيٍّ، وَلَا يُسَجِّلُ نَفْسَهُ؛ فَالْمَدْرَسَةُ هِيَ الْمَسْؤُولَةُ عَنِ الْحِسَابِ.',
        'Students need no email address and cannot sign themselves up: the school is responsible for the account.'),
    ],
  },
  {
    id: 'c5-classes', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'الفصول والمعلمون', en: 'Classes & teachers' }, status: 'now', segments: [{ shot: 'class-create' }] },
    lines: [
      L('ثُمَّ يُنْشَأُ الْفَصْلُ: اسْمُهُ، وَصَفُّهُ، وَمَنْهَجُهُ مِنْ نِطَاقِ الْمَدْرَسَةِ، ثُمَّ طُلَّابُهُ، وَمُعَلِّمٌ لِكُلِّ مَادَّةٍ.',
        'Then the class is created: its name, its grade and its curriculum from the school’s scope — then its students, and a teacher for each subject.'),
    ],
  },
  {
    id: 'c5-homework', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: {
      caption: { ar: 'الواجبات والتصحيح', en: 'Homework & marking' }, status: 'now',
      segments: [{ shot: 'homework-set' }, { shot: 'homework-mark', sync: { 0: 1 } }],
      callout: { at: 2, ar: 'فحص الملفات من الفيروسات · تصغير الصور وحذف بيانات الموقع', en: 'Virus scan · photos resized, location removed' },
    },
    lines: [
      L('يُكَلِّفُ الْمُعَلِّمُ طُلَّابَهُ بِوَاجِبٍ مُرْتَبِطٍ بِكُتُبِ الْمَنْهَجِ، مَعَ التَّعْلِيمَاتِ، وَالْمَوْعِدِ، وَالدَّرَجَةِ الْكَامِلَةِ.',
        'The teacher sets homework linked to the curriculum’s books, with instructions, a due time and a full mark.'),
      L('وَيَرَى مَنْ سَلَّمَ، وَمَنْ تَأَخَّرَ، وَمَنْ لَمْ يُسَلِّمْ، ثُمَّ يُصَحِّحُ، وَيَكْتُبُ تَعْلِيقَهُ، وَيُعِيدُ الْعَمَلَ إِلَى الطَّالِبِ.',
        'They see who handed in, who was late and who has not, then mark it, write a comment and return the work to the student.'),
      L('وَكُلُّ مَلَفٍّ يَرْفَعُهُ الطَّالِبُ يُفْحَصُ مِنَ الْفَيْرُوسَاتِ قَبْلَ أَنْ يَفْتَحَهُ أَحَدٌ، وَتُصَغَّرُ الصُّوَرُ وَتُحْذَفُ مِنْهَا بَيَانَاتُ الْمَوْقِعِ.',
        'Every file a student uploads is scanned for viruses before anyone opens it, and photos are resized with their location data removed.'),
    ],
  },
  {
    id: 'c5-tests', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'الاختبارات الإلكترونية', en: 'Online tests' }, status: 'now', segments: [{ shot: 'test-create', sync: { 9: 1 } }] },
    lines: [
      L('وَلِلِاخْتِبَارَاتِ الْإِلِكْتُرُونِيَّةِ أَدَوَاتٌ كَامِلَةٌ: اخْتِيَارٌ مِنْ مُتَعَدِّدٍ، وَصَوَابٌ وَخَطَأٌ، وَإِجَابَاتٌ قَصِيرَةٌ، وَأَسْئِلَةٌ مَقَالِيَّةٌ.',
        'Online tests come with complete tools: multiple choice, true or false, short answers and written questions.'),
      L('يُحَدِّدُ الْمُعَلِّمُ الْمُدَّةَ، وَعَدَدَ الْمُحَاوَلَاتِ، وَرَمْزَ بَدْءٍ يُعْلِنُهُ فِي الْقَاعَةِ. وَالْخَادِمُ هُوَ الَّذِي يَحْسُبُ الْوَقْتَ، لَا جِهَازُ الطَّالِبِ.',
        'The teacher sets the time, the number of attempts and a start code read out in the room. The server keeps the time — not the student’s device.'),
    ],
  },
  {
    id: 'c5-monitor', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'المتابعة المباشرة', en: 'Live monitoring' }, status: 'now', segments: [{ shot: 'monitor', sync: { 3: 1, 5: 2 }, zoom: { 1: MONITOR_ROWS, 2: MONITOR_ROWS, 3: MONITOR_ROWS, 4: MONITOR_ROWS, 5: MONITOR_ROWS } }] },
    lines: [
      L('وَفِي شَاشَةِ الْمُتَابَعَةِ الْمُبَاشِرَةِ، يَرَى الْمُعَلِّمُ حَالَةَ كُلِّ طَالِبٍ، وَالْوَقْتَ الْمُتَبَقِّيَ، وَعَدَدَ الْإِجَابَاتِ.',
        'On the live monitoring screen, the teacher sees each student’s state, the time left and the number of answers.'),
      L('وَيَرَى مَا لَاحَظَتْهُ الصَّفْحَةُ: مُغَادَرَتَهَا، أَوِ اللَّصْقَ فِيهَا، أَوِ انْقِطَاعَ الِاتِّصَالِ — دُونَ كَامِيرَا، وَدُونَ مِيكْرُوفُونٍ، وَدُونَ تَسْجِيلٍ لِلشَّاشَةِ.',
        'And sees what the page noticed: leaving it, pasting into it, or losing the connection — with no camera, no microphone and no screen recording.'),
      L('وَيَمْنَحُ وَقْتًا إِضَافِيًّا، أَوْ مُحَاوَلَةً أُخْرَى، أَوْ يُغْلِقُ الِاخْتِبَارَ فِي الْحَالِ.', 'They can give extra time or another attempt, or close the test at once.'),
    ],
  },
  {
    id: 'c5-marking', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'التصحيح والنتائج', en: 'Marking & results' }, status: 'now', segments: [{ shot: 'test-results' }] },
    lines: [
      L('وَيُصَحَّحُ كُلُّ سُؤَالٍ آلِيًّا بِقَوَاعِدَ ثَابِتَةٍ — مَعَ قَبُولِ اخْتِلَافَاتِ الْإِمْلَاءِ الْعَرَبِيِّ — مَا عَدَا الْمَقَالِيَّ، فَيُصَحِّحُهُ الْمُعَلِّمُ.',
        'Every question is marked automatically with fixed rules — accepting Arabic spelling variants — except written answers, which the teacher marks.'),
      L('وَلَا يَضَعُ الذَّكَاءُ الِاصْطِنَاعِيُّ أَيَّ دَرَجَةٍ؛ فَالْقَرَارُ لِلْمُعَلِّمِ دَائِمًا.', 'No AI sets any mark: the decision always rests with the teacher.'),
    ],
  },
  {
    id: 'c5-gradebook', ch: 5, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'سجل الدرجات', en: 'Gradebook' }, status: 'now', segments: [{ shot: 'gradebook', zoom: { 0: { x: 640, y: 230, w: 680, h: 330 } } }, { shot: 'class-page' }] },
    lines: [
      L('وَتَجْتَمِعُ الدَّرَجَاتُ فِي سِجِلِّ الدَّرَجَاتِ: صَفٌّ لِكُلِّ طَالِبٍ، وَعَمُودٌ لِكُلِّ وَاجِبٍ وَاخْتِبَارٍ، مَعَ الْمُتَوَسِّطِ، وَتَنْزِيلٍ بِصِيغَةِ CSV.',
        'Marks come together in the gradebook: a row per student, a column per homework and test, with the average and a CSV download.',
        'وَتَجْتَمِعُ الدَّرَجَاتُ فِي سِجِلِّ الدَّرَجَاتِ: صَفٌّ لِكُلِّ طَالِبٍ، وَعَمُودٌ لِكُلِّ وَاجِبٍ وَاخْتِبَارٍ، مَعَ الْمُتَوَسِّطِ، وَتَنْزِيلٍ بِصِيغَةِ سِي إِس فِي.'),
    ],
  },
  {
    id: 'c5-teacher-value', ch: 5, t: 'cards', music: 'classroom', lead: 0.5, tail: 1.2,
    p: {
      title: { ar: 'ماذا يكسب المعلم؟', en: 'What the teacher gains' },
      cards: [
        { icon: 'class', ar: 'الفصل كله في مكان واحد', en: 'The whole class in one place' },
        { icon: 'task', ar: 'متابعة تلقائية للتسليم', en: 'Hand-ins tracked automatically' },
        { icon: 'check', ar: 'تصحيح آلي للأسئلة الموضوعية', en: 'Objective questions marked automatically' },
        { icon: 'eye', ar: 'رؤية مباشرة أثناء الاختبار', en: 'A live view during tests' },
        { icon: 'teacher', ar: 'القرار الأخير للمعلم', en: 'The final say stays with the teacher' },
      ],
      beats: [[0], [1, 2, 3], [4]],
    },
    lines: [
      L('فَمَاذَا يَكْسِبُ الْمُعَلِّمُ مِنْ ذَلِكَ؟ يَجِدُ وَاجِبَاتِ فَصْلِهِ وَاخْتِبَارَاتِهِ وَدَرَجَاتِهِ فِي مَكَانٍ وَاحِدٍ، مَرْبُوطَةً بِالْمَنْهَجِ الَّذِي يُدَرِّسُهُ.',
        'So what does the teacher gain? Their class’s homework, tests and marks in one place, tied to the curriculum they teach.'),
      L('وَتَخِفُّ عَنْهُ الْمُتَابَعَةُ الْيَدَوِيَّةُ: فَالتَّسْلِيمُ وَالتَّأَخُّرُ يَظْهَرَانِ تِلْقَائِيًّا، وَالْأَسْئِلَةُ الْمَوْضُوعِيَّةُ تُصَحَّحُ وَحْدَهَا.',
        'Manual follow-up gets lighter: hand-ins and late work show up by themselves, and objective questions are marked automatically.'),
      L('وَيَبْقَى الْقَرَارُ التَّرْبَوِيُّ فِي يَدِهِ: يُرَاجِعُ، وَيُعَدِّلُ، وَيَكْتُبُ مُلَاحَظَاتِهِ، وَيُقَرِّرُ مَتَى يَرَى الطُّلَّابُ النَّتَائِجَ.',
        'And the educational decision stays in their hands: they review, adjust, write their comments, and decide when students see the results.'),
    ],
  },
  {
    id: 'c5-governance', ch: 5, t: 'montage', music: 'classroom', lead: 0.3, tail: 1.0,
    p: {
      items: [
        { shot: 'settings', frame: 0, ar: 'مفاتيح API', en: 'API keys' },
        { shot: 'settings', frame: 'deliveries', ar: 'سجل تسليم الإشعارات (Webhooks)', en: 'Webhook delivery history' },
        { shot: 'retention', frame: 'saved', ar: 'مدد الاحتفاظ بالبيانات', en: 'Retention periods' },
        { shot: 'audit', frame: 0, ar: 'سجل التدقيق', en: 'Audit log' },
      ],
    },
    lines: [
      L('وَحَوْلَ ذَلِكَ كُلِّهِ، أَدَوَاتٌ لِلتَّكَامُلِ وَالْحَوْكَمَةِ: مَفَاتِيحُ API، وَإِشْعَارَاتُ Webhooks مَعَ سِجِلِّ تَسْلِيمِهَا،',
        'Around all of this are tools for integration and governance: API keys, and webhooks with their delivery history;',
        'وَحَوْلَ ذَلِكَ كُلِّهِ، أَدَوَاتٌ لِلتَّكَامُلِ وَالْحَوْكَمَةِ: مَفَاتِيحُ إِيه بِي آي، وَإِشْعَارَاتُ وِيب هُوكْس مَعَ سِجِلِّ تَسْلِيمِهَا،'),
      L('وَمُدَدُ احْتِفَاظٍ بِبَيَانَاتِ الْفُصُولِ تُحَدِّدُهَا كُلُّ مَدْرَسَةٍ، مَعَ تَنْبِيهٍ قَبْلَ أَيِّ حَذْفٍ بِأَرْبَعَةَ عَشَرَ يَوْمًا، وَسِجِلُّ تَدْقِيقٍ لِذَلِكَ كُلِّهِ.',
        'retention periods for classroom data that each school sets, with notice fourteen days before anything is deleted — and an audit log for all of it.'),
    ],
  },

  // ================================================================ 6 · student experience & AI
  { id: 'c6-card', ch: 6, t: 'chapter', music: 'student', min: 3.6, lines: [] },
  {
    id: 'c6-signin', ch: 6, t: 'phone', music: 'student', lead: 0.5, tail: 0.6,
    p: {
      caption: { ar: 'بوابة الطالب', en: 'Student Portal' }, status: 'now',
      segments: [{ shot: 'student-sign-in', to: 3 }],
      points: [{ ar: 'رمز المدرسة واسم المستخدم', at: 1 }, { ar: 'من الحاسوب أو الهاتف', at: 1 }],
      notes: [{ at: 1, ar: 'تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب', en: 'Switched on per school after the legal review of student data', kind: 'dev' }],
    },
    lines: [
      L('وَالْآنَ، لِنَنْظُرْ مِنْ جِهَةِ الطَّالِبِ.', 'Now, let’s look from the student’s side.'),
      L('يَدْخُلُ عُمَرُ بِرَمْزِ مَدْرَسَتِهِ، وَاسْمِ الْمُسْتَخْدِمِ، وَكَلِمَةِ الْمُرُورِ، مِنَ الْحَاسُوبِ أَوْ مِنَ الْهَاتِفِ.',
        'Omar signs in with his school code, username and password, from a computer or a phone.'),
    ],
  },
  {
    id: 'c6-today', ch: 6, t: 'phone', music: 'student', lead: 0.3, tail: 0.8,
    p: {
      caption: { ar: 'صفحة «اليوم»', en: 'Today' }, status: 'now',
      segments: [{ shot: 'student-sign-in', from: 4 }],
      side: { shot: 'student-today-desktop' },
      points: [{ ar: 'المطلوب', at: 0 }, { ar: 'ما فاته', at: 0 }, { ar: 'ما أُعيد مصحّحًا', at: 0 }, { ar: 'الاختبارات المتاحة الآن', at: 0 }],
    },
    lines: [
      L('تَفْتَحُ بَوَّابَةُ الطَّالِبِ عَلَى صَفْحَةِ «الْيَوْمَ»: مَا عَلَيْهِ إِنْجَازُهُ، وَمَا فَاتَهُ، وَمَا أُعِيدَ إِلَيْهِ مُصَحَّحًا، وَالِاخْتِبَارَاتُ الْمُتَاحَةُ الْآنَ.',
        'The Student Portal opens on “Today”: what he has to do, what he missed, what came back marked, and the tests open right now.'),
    ],
  },
  {
    id: 'c6-homework', ch: 6, t: 'phone', music: 'student', lead: 0.3, tail: 0.8,
    p: {
      caption: { ar: 'تسليم الواجب', en: 'Handing in homework' }, status: 'now',
      segments: [{ shot: 'student-homework' }, { shot: 'student-grades', to: 1, sync: { 0: 1 } }],
      points: [{ ar: 'إجابة مكتوبة أو صورة', at: 0 }, { ar: 'مسودة قبل التسليم', at: 0 }, { ar: 'الدرجة والتعليق بعد التصحيح', at: 1 }],
    },
    lines: [
      L('يَفْتَحُ الْوَاجِبَ، فَيَكْتُبُ إِجَابَتَهُ، أَوْ يُصَوِّرُ وَرَقَتَهُ وَيُرْفِقُهَا، ثُمَّ يُسَلِّمُ.',
        'He opens the homework, writes his answer or photographs his sheet and attaches it, then hands it in.'),
      L('وَيَسْتَطِيعُ اسْتِرْجَاعَ عَمَلِهِ لِتَعْدِيلِهِ مَا لَمْ يُصَحَّحْ، وَحِينَ يُعِيدُهُ الْمُعَلِّمُ، يَرَى دَرَجَتَهُ وَتَعْلِيقَهُ.',
        'He can take his work back to change it until it is marked, and when the teacher returns it, he sees his mark and the comment.'),
    ],
  },
  {
    id: 'c6-test', ch: 6, t: 'phone', music: 'student', lead: 0.3, tail: 0.8,
    p: {
      caption: { ar: 'أداء الاختبار', en: 'Taking a test' }, status: 'now',
      segments: [{ shot: 'student-test', sync: { 4: 1 } }],
      points: [{ ar: 'رمز البدء', at: 0 }, { ar: 'حفظ تلقائي لكل إجابة', at: 0 }, { ar: 'إعادة المحاولة عند ضعف الاتصال', at: 1 }, { ar: 'يعرف ما يراه المعلم', at: 2 }],
    },
    lines: [
      L('وَفِي الِاخْتِبَارِ، يُدْخِلُ رَمْزَ الْبَدْءِ، فَيَبْدَأُ الْعَدُّ التَّنَازُلِيُّ، وَتُحْفَظُ كُلُّ إِجَابَةٍ لَحْظَةَ كِتَابَتِهَا.',
        'In a test, he enters the start code, the countdown begins, and every answer is saved as he writes it.'),
      L('وَإِنْ ضَعُفَ الِاتِّصَالُ، تُعِيدُ الصَّفْحَةُ الْمُحَاوَلَةَ تِلْقَائِيًّا، وَتُخْبِرُهُ بِمَا لَمْ يُحْفَظْ بَعْدُ.', 'If the connection weakens, the page retries by itself and tells him what is not saved yet.'),
      L('وَتُوَضِّحُ لَهُ الصَّفْحَةُ بِصَرَاحَةٍ مَا يَسْتَطِيعُ الْمُعَلِّمُ أَنْ يَرَاهُ أَثْنَاءَ الِاخْتِبَارِ.', 'And the page tells him plainly what the teacher can see during the test.'),
    ],
  },
  {
    id: 'c6-result', ch: 6, t: 'phone', music: 'student', lead: 0.3, tail: 0.8,
    p: { caption: { ar: 'النتيجة والمراجعة', en: 'Result & review' }, status: 'now', segments: [{ shot: 'student-result' }] },
    lines: [
      L('بَعْدَ التَّسْلِيمِ، تَظْهَرُ النَّتِيجَةُ فِي الْوَقْتِ الَّذِي يُحَدِّدُهُ الْمُعَلِّمُ، مَعَ الْإِجَابَاتِ الصَّحِيحَةِ إِنْ سَمَحَ بِعَرْضِهَا.',
        'After he submits, the result appears when the teacher decides, with the correct answers if the teacher allows them to be shown.'),
    ],
  },
  {
    id: 'c6-grades', ch: 6, t: 'phone', music: 'student', lead: 0.3, tail: 1.0,
    p: { caption: { ar: 'درجاتي وكتبي', en: 'My grades & My books' }, status: 'now', segments: [{ shot: 'student-grades', from: 2 }], side: { shot: 'student-grades-desktop' } },
    lines: [
      L('وَفِي «دَرَجَاتِي» يَرَى عُمَرُ دَرَجَاتِهِ فِي كُلِّ مَادَّةٍ، وَفِي «كُتُبِي» يَرَى مَنْهَجَهُ كَمَا اخْتَارَتْهُ مَدْرَسَتُهُ.',
        'In “My grades” Omar sees his marks in each subject, and in “My books” his curriculum, as his school chose it.'),
      L('بَوَّابَةٌ وَاضِحَةٌ، بِالْعَرَبِيَّةِ أَوِ الْإِنْجِلِيزِيَّةِ، صُمِّمَتْ لِتَكُونَ مُتَاحَةً لِلْجَمِيعِ، وَتَجْمَعُ لِلطَّالِبِ يَوْمَهُ الدِّرَاسِيَّ فِي مَكَانٍ وَاحِدٍ.',
        'A clear portal, in Arabic or English, designed to be accessible to all, bringing the student’s school day together in one place.'),
    ],
  },
  {
    id: 'c6-student-value', ch: 6, t: 'cards', music: 'student', lead: 0.5, tail: 1.2,
    p: {
      title: { ar: 'ماذا يكسب الطالب؟', en: 'What the student gains' },
      cards: [
        { icon: 'calendar', ar: 'يومه الدراسي في مكان واحد', en: 'The school day in one place' },
        { icon: 'clock', ar: 'وقت عادل يحسبه الخادم', en: 'Fair time, kept by the server' },
        { icon: 'save', ar: 'حفظ تلقائي للإجابات', en: 'Answers saved automatically' },
        { icon: 'eye', ar: 'وضوح فيما يراه المعلم', en: 'Clarity about what the teacher sees' },
        { icon: 'phone', ar: 'بلغته ومن هاتفه', en: 'In their language, on their phone' },
      ],
      beats: [[0], [1, 2, 3], [4]],
    },
    lines: [
      L('وَمَاذَا يَكْسِبُ الطَّالِبُ؟ مَكَانًا وَاحِدًا لِيَوْمِهِ الدِّرَاسِيِّ، يَعْرِفُ فِيهِ الْمَطْلُوبَ وَالْمَوَاعِيدَ، دُونَ أَنْ يَبْحَثَ عَنْهَا فِي رَسَائِلَ مُتَفَرِّقَةٍ.',
        'And what does the student gain? One place for the school day, showing what is due and when, without searching through scattered messages.'),
      L('وَتَجْرِبَةً عَادِلَةً فِي الِاخْتِبَارِ: وَقْتٌ يَحْسُبُهُ الْخَادِمُ لِلْجَمِيعِ بِالتَّسَاوِي، وَإِجَابَاتٌ تُحْفَظُ أَوَّلًا بِأَوَّلٍ، وَوُضُوحٌ فِيمَا يَرَاهُ الْمُعَلِّمُ.',
        'And a fair test experience: time kept by the server, equally for everyone, answers saved as they go, and clarity about what the teacher sees.'),
      L('وَكُلُّ ذَلِكَ بِلُغَتِهِ، وَمِنْ هَاتِفِهِ، وَبِحِسَابٍ تُدِيرُهُ مَدْرَسَتُهُ.', 'All in their own language, from their phone, with an account their school manages.'),
    ],
  },
  {
    id: 'c6-ai-status', ch: 6, t: 'aistatus', music: 'ai', lead: 0.6, tail: 1.0,
    p: {
      rows: [
        { ar: 'ميزات ذكاء اصطناعي داخل المنصة اليوم', en: 'AI features in the platform today', v: { ar: 'لا يوجد', en: 'None' }, at: 1 },
        { ar: 'التكامل مع Wise EduAgent', en: 'Integration with Wise EduAgent', v: { ar: 'لم يُنفَّذ بعد', en: 'Not built yet' }, at: 1 },
        { ar: 'فحص تطبيق Wise', en: 'Inspection of the Wise application', v: { ar: 'بانتظار الوصول', en: 'Awaiting access' }, at: 2 },
        { ar: 'اختيار مزوّد الذكاء الاصطناعي', en: 'Choice of AI provider', v: { ar: 'لم يُحسم', en: 'Not decided' }, at: 2 },
      ],
    },
    lines: [
      L('وَمَاذَا عَنِ الذَّكَاءِ الِاصْطِنَاعِيِّ؟ نُرِيدُ أَنْ نَكُونَ دَقِيقِينَ هُنَا.', 'And what about artificial intelligence? We want to be precise here.'),
      L('الْمِنَصَّةُ الْيَوْمَ لَا تَتَضَمَّنُ أَيَّ مِيزَةِ ذَكَاءٍ اصْطِنَاعِيٍّ، وَتَكَامُلُهَا مَعَ الْمُسَاعِدِ التَّعْلِيمِيِّ Wise EduAgent لَمْ يُنَفَّذْ بَعْدُ.',
        'Today the platform includes no artificial-intelligence feature, and its integration with the Wise EduAgent educational assistant has not been built yet.',
        'الْمِنَصَّةُ الْيَوْمَ لَا تَتَضَمَّنُ أَيَّ مِيزَةِ ذَكَاءٍ اصْطِنَاعِيٍّ، وَتَكَامُلُهَا مَعَ الْمُسَاعِدِ التَّعْلِيمِيِّ وَايْز إِيدُو إِيجِنْت لَمْ يُنَفَّذْ بَعْدُ.'),
      L('فَمَا زَالَ فَحْصُ تَطْبِيقِ Wise، وَاخْتِيَارُ مُزَوِّدِ الذَّكَاءِ الِاصْطِنَاعِيِّ، خُطْوَتَيْنِ قَادِمَتَيْنِ.',
        'Inspecting the Wise application and choosing an AI provider are both steps still ahead.',
        'فَمَا زَالَ فَحْصُ تَطْبِيقِ وَايْز، وَاخْتِيَارُ مُزَوِّدِ الذَّكَاءِ الِاصْطِنَاعِيِّ، خُطْوَتَيْنِ قَادِمَتَيْنِ.'),
    ],
  },
  {
    id: 'c6-ai-vision', ch: 6, t: 'aiconcept', music: 'ai', lead: 0.6, tail: 1.0,
    p: {
      banner: { ar: 'تصوّر مستقبلي — ليس ميزة متاحة للبيع', en: 'Future vision — not a feature for sale' },
      center: { ar: 'مساعد تعليمي', en: 'Educational assistant' },
      inputs: [{ ar: 'منهج المدرسة', en: 'School curriculum' }, { ar: 'بوابة الطالب', en: 'Student portal' }, { ar: 'الحساب نفسه', en: 'Same account' }],
      uses: [{ ar: 'فهم الدرس', en: 'Understanding a lesson', at: 2 }, { ar: 'تنظيم المذاكرة', en: 'Study planning', at: 2 }, { ar: 'التدرّب على الأسئلة', en: 'Practice questions', at: 2 }, { ar: 'مساعدة المعلم في الإعداد', en: 'Help teachers prepare', at: 2 }],
      rules: [{ ar: 'كل إجابة موسومة بأنها مولّدة آليًا', at: 3 }, { ar: 'لا يغيّر أي سجل رسمي أو درجة', at: 3 }, { ar: 'حدود استخدام ضمن الاشتراك', at: 3 }, { ar: 'المعلم صاحب القرار', at: 4 }],
      beats: [0, 1, 2, 3, 4],
    },
    lines: [
      L('مَا نَعْرِضُهُ الْآنَ تَصَوُّرٌ مُسْتَقْبَلِيٌّ، لَا مِيزَةٌ جَاهِزَةٌ لِلْبَيْعِ.', 'What we show now is a future vision, not a feature ready to sell.'),
      L('مُسَاعِدٌ تَعْلِيمِيٌّ دَاخِلَ بَوَّابَةِ الطَّالِبِ نَفْسِهَا، وَبِالْحِسَابِ نَفْسِهِ، يَعْرِفُ الْمَنْهَجَ الَّذِي اخْتَارَتْهُ الْمَدْرَسَةُ.',
        'An educational assistant inside the same student portal, with the same account, that knows the curriculum the school has chosen.'),
      L('قَدْ يُسَاعِدُ الطَّالِبَ عَلَى فَهْمِ دَرْسٍ، وَتَنْظِيمِ مُذَاكَرَتِهِ، وَالتَّدَرُّبِ عَلَى الْأَسْئِلَةِ، وَيُسَاعِدُ الْمُعَلِّمَ فِي الْإِعْدَادِ.',
        'It could help a student understand a lesson, organize their study and practise questions, and help teachers prepare.'),
      L('وَقَدْ حُدِّدَتْ ضَوَابِطُهُ مُسْبَقًا: كُلُّ إِجَابَةٍ تُوسَمُ بِأَنَّهَا مُوَلَّدَةٌ آلِيًّا، وَلَا يُغَيِّرُ أَيَّ سِجِلٍّ رَسْمِيٍّ أَوْ دَرَجَةٍ، وَيَخْضَعُ لِحُدُودِ اسْتِخْدَامٍ ضِمْنَ الِاشْتِرَاكِ نَفْسِهِ.',
        'Its rules are set in advance: every answer is labelled as machine-generated, it never changes an official record or a grade, and it is subject to usage limits within the same subscription.'),
      L('فَالذَّكَاءُ الِاصْطِنَاعِيُّ هُنَا لِدَعْمِ الْمُعَلِّمِ وَالطَّالِبِ، لَا لِيَحُلَّ مَحَلَّ الْمُعَلِّمِ.', 'AI here is meant to support teachers and students — not to replace the teacher.'),
    ],
  },
  {
    id: 'c6-ai-ready', ch: 6, t: 'cards', music: 'ai', lead: 0.4, tail: 1.2,
    p: {
      title: { ar: 'الأساس جاهز اليوم', en: 'The foundation is ready today' }, status: 'now',
      cards: [
        { icon: 'student', ar: 'هوية الطالب', en: 'Student identity' },
        { icon: 'book', ar: 'سياق المنهج', en: 'Curriculum context' },
        { icon: 'plan', ar: 'الاشتراكات', en: 'Subscriptions' },
        { icon: 'meter', ar: 'عدّادات الاستخدام', en: 'Usage metering' },
        { icon: 'audit', ar: 'سجل التدقيق', en: 'Audit log' },
      ],
      beats: [[0, 1, 2, 3, 4]],
    },
    lines: [
      L('وَالْأَسَاسُ اللَّازِمُ لَهُ جَاهِزٌ الْيَوْمَ: هُوِيَّةُ الطَّالِبِ، وَسِيَاقُ الْمَنْهَجِ، وَالِاشْتِرَاكَاتُ، وَعَدَّادَاتُ الِاسْتِخْدَامِ، وَسِجِلُّ التَّدْقِيقِ.',
        'The foundation it needs is ready today: student identity, curriculum context, subscriptions, usage metering and the audit log.'),
    ],
  },

  // ================================================================ 7 · SaaS model & commercial value
  { id: 'c7-card', ch: 7, t: 'chapter', music: 'saas', min: 3.6, lines: [] },
  {
    id: 'c7-plans', ch: 7, t: 'demo', music: 'saas', lead: 0.5, tail: 0.8,
    p: {
      caption: { ar: 'الاشتراكات والفوترة', en: 'Subscriptions & billing' }, status: 'now',
      // The billing page, then the subscribed state (the development payment simulator in between is not shown).
      segments: [{ shot: 'pricing' }, { shot: 'billing', to: 1, sync: { 0: 2 } }, { shot: 'billing', frame: 'subscribed', sync: { 0: 3 } }],
      notes: [{ at: 1, ar: 'أسعار مقترحة للإطلاق — قابلة للمراجعة', en: 'Launch price proposals — open to review', kind: 'note' },
        { at: 4, ar: 'الدفع عبر Paymob: قيد الاستكمال', en: 'Paymob payments: in development', kind: 'dev' }],
    },
    lines: [
      L('تَعْمَلُ الْمِنَصَّةُ بِنَمُوذَجِ اشْتِرَاكٍ مُؤَسَّسِيٍّ: خُطَّةٌ مَجَّانِيَّةٌ، وَخُطَطٌ مَدْفُوعَةٌ، وَخُطَّةٌ لِلْمُؤَسَّسَاتِ الْكُبْرَى بِعَقْدٍ خَاصٍّ.',
        'The platform runs on an institutional subscription model: a free plan, paid plans, and an enterprise plan under a custom contract.'),
      L('وَالْأَسْعَارُ الظَّاهِرَةُ مُقْتَرَحَاتٌ لِلْإِطْلَاقِ، قَابِلَةٌ لِلْمُرَاجَعَةِ.', 'The prices shown are launch proposals, open to review.'),
      L('حُدُودُ كُلِّ خُطَّةٍ تُطَبَّقُ عَلَى الْخَادِمِ: عَدَدُ الْأَعْضَاءِ، وَالنِّطَاقَاتُ، وَالتَّصْدِيرُ، وَطَلَبَاتُ الْـ API، وَالْمَزَايَا الْمُتَاحَةُ.',
        'Each plan’s limits are enforced on the server: members, scopes, exports, API requests and the features available.',
        'حُدُودُ كُلِّ خُطَّةٍ تُطَبَّقُ عَلَى الْخَادِمِ: عَدَدُ الْأَعْضَاءِ، وَالنِّطَاقَاتُ، وَالتَّصْدِيرُ، وَطَلَبَاتُ وَاجِهَةِ إِيه بِي آي، وَالْمَزَايَا الْمُتَاحَةُ.'),
      L('وَيُدِيرُ النِّظَامُ دَوْرَةَ الِاشْتِرَاكِ كَامِلَةً: التَّجْرِبَةَ، وَالتَّرْقِيَةَ، وَالتَّجْدِيدَ، وَالْفَوَاتِيرَ، وَفَتْرَةَ سَمَاحٍ عِنْدَ تَأَخُّرِ الدَّفْعِ.',
        'The system runs the whole subscription cycle: trial, upgrade, renewal, invoices, and a grace period when a payment is late.'),
      L('أَمَّا الرَّبْطُ بِبَوَّابَةِ الدَّفْعِ Paymob، فَجَاهِزٌ وَمُخْتَبَرٌ عَلَى مُحَاكَاةٍ لِوَاجِهَتِهَا، وَيَنْتَظِرُ مَفَاتِيحَ حِسَابِ التَّاجِرِ لِيَعْمَلَ فِعْلِيًّا.',
        'The Paymob payment integration is built and tested against a simulation of its interface, and awaits the merchant account keys to go live.',
        'أَمَّا الرَّبْطُ بِبَوَّابَةِ الدَّفْعِ بَاي مُوب، فَجَاهِزٌ وَمُخْتَبَرٌ عَلَى مُحَاكَاةٍ لِوَاجِهَتِهَا، وَيَنْتَظِرُ مَفَاتِيحَ حِسَابِ التَّاجِرِ لِيَعْمَلَ فِعْلِيًّا.'),
    ],
  },
  {
    id: 'c7-isolation', ch: 7, t: 'arch', music: 'saas', lead: 0.5, tail: 1.0,
    p: { mode: 'tenancy', beats: [0, 1, 2] },
    lines: [
      L('تِقْنِيًّا، تَعْمَلُ كُلُّ الْمُؤَسَّسَاتِ عَلَى نِظَامٍ وَاحِدٍ، لَكِنَّ بَيَانَاتِ كُلٍّ مِنْهَا مَعْزُولَةٌ بِسِيَاسَاتِ أَمَانٍ دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ.',
        'Technically, all organizations run on one system, but each one’s data is isolated by security policies inside the database.'),
      L('فَحَتَّى لَوْ أَخْطَأَ جُزْءٌ مِنَ الْكُودِ، تَرْفُضُ قَاعِدَةُ الْبَيَانَاتِ أَنْ تُظْهِرَ بَيَانَاتِ مُؤَسَّسَةٍ لِأُخْرَى.',
        'So even if a piece of code were wrong, the database would refuse to show one organization’s data to another.'),
      L('وَتُشَفَّرُ الْأَسْرَارُ الْمَحْفُوظَةُ، مَعَ أَدَوَاتٍ لِتَدْوِيرِ مَفَاتِيحِ التَّشْفِيرِ، وَحُدُودٍ لِلطَّلَبَاتِ تَحْمِي مِنْ إِسَاءَةِ الِاسْتِخْدَامِ.',
        'Stored secrets are encrypted, with tools to rotate the encryption keys, and request limits that protect against abuse.'),
    ],
  },
  {
    id: 'c7-deploy', ch: 7, t: 'arch', music: 'saas', lead: 0.5, tail: 1.0,
    p: {
      mode: 'deploy', beats: [0, 1, 2],
      stat: { at: 1, big: '300', ar: 'طالب في اختبار واحد من شبكة واحدة · لا طلب مرفوض', en: 'students, one test, one network · no request refused', note: 'اختبار حِمل على بيئة محلية بنسختين من التطبيق — ليس على خوادم الإنتاج' },
    },
    lines: [
      L('وَالْمِنَصَّةُ مَبْنِيَّةٌ فِي حَاوِيَاتٍ، بِنُسْخَتَيْنِ مِنَ التَّطْبِيقِ خَلْفَ مُوَازِنِ أَحْمَالٍ، فَيُمْكِنُ تَحْدِيثُهَا دُونَ إِيقَافِ الْخِدْمَةِ.',
        'The platform is containerized, with two application instances behind a load balancer, so it can be updated without stopping the service.'),
      L('وَفِي اخْتِبَارِ حِمْلٍ عَلَى بِيئَةٍ مَحَلِّيَّةٍ، أَدَّى ثَلَاثُمِئَةِ طَالِبٍ اخْتِبَارًا وَاحِدًا مِنْ شَبَكَةٍ وَاحِدَةٍ، دُونَ رَفْضِ أَيِّ طَلَبٍ.',
        'In a load test on a local environment, three hundred students took one test from a single network, without a single request being refused.'),
      L('وَتُؤْخَذُ نُسَخٌ احْتِيَاطِيَّةٌ مُشَفَّرَةٌ، وَقَدْ جُرِّبَتِ اسْتِعَادَتُهَا، بِمَا فِي ذَلِكَ إِعَادَةُ بِنَاءِ خَادِمٍ مَفْقُودٍ مِنْ نُسْخَةٍ خَارِجِيَّةٍ.',
        'Encrypted backups are taken, and restoring them has been rehearsed — including rebuilding a lost server from an off-site copy.'),
    ],
  },
  {
    id: 'c7-central', ch: 7, t: 'hub', music: 'saas', lead: 0.5, tail: 1.2,
    p: { center: 'نطاق المناهج', schools: 7, addon: { ar: 'وحدة الذكاء الاصطناعي (مستقبلًا)', en: 'AI module (future)', at: 1 } },
    lines: [
      L('وَلِأَنَّهَا SaaS، يَصِلُ كُلُّ تَحْدِيثٍ لِلدَّلِيلِ أَوْ لِلنِّظَامِ إِلَى كُلِّ الْمُؤَسَّسَاتِ مَعًا، دُونَ تَثْبِيتٍ عِنْدَ أَحَدٍ.',
        'And because it is SaaS, every update to the catalogue or the system reaches every institution together, with nothing to install.',
        'وَلِأَنَّهَا مِنَصَّةُ سَاس، يَصِلُ كُلُّ تَحْدِيثٍ لِلدَّلِيلِ أَوْ لِلنِّظَامِ إِلَى كُلِّ الْمُؤَسَّسَاتِ مَعًا، دُونَ تَثْبِيتٍ عِنْدَ أَحَدٍ.'),
      L('وَحِينَ يُضَافُ الذَّكَاءُ الِاصْطِنَاعِيُّ، يُمْكِنُ تَقْدِيمُهُ وَحْدَةً إِضَافِيَّةً ضِمْنَ الِاشْتِرَاكَاتِ الْحَالِيَّةِ، بِلَا نِظَامِ فَوْتَرَةٍ ثَانٍ.',
        'When AI is added, it can be offered as an add-on module within the existing subscriptions, with no second billing system.'),
    ],
  },

  {
    id: 'c7-value', ch: 7, t: 'cards', music: 'saas', lead: 0.5, tail: 1.2,
    p: {
      title: { ar: 'ماذا تكسب المؤسسة؟', en: 'What the institution gains' },
      cards: [
        { icon: 'doc', ar: 'قرار منهجي موثّق ومشترك', en: 'A documented, shared curriculum decision' },
        { icon: 'eye', ar: 'رؤية موحّدة للفصول والدرجات', en: 'A unified view of classes and grades' },
        { icon: 'audit', ar: 'حوكمة: أدوار وسجل تدقيق', en: 'Governance: roles and an audit log' },
        { icon: 'lock', ar: 'خصوصية ومدد احتفاظ تقرّرها', en: 'Privacy and retention it decides' },
        { icon: 'cloud', ar: 'بلا خوادم تديرها ولا برامج تثبّتها', en: 'No servers to run, nothing to install' },
      ],
      beats: [[0, 1], [2, 3], [4]],
    },
    lines: [
      L('وَمَاذَا تَكْسِبُ الْمُؤَسَّسَةُ؟ قَرَارًا مَنْهَجِيًّا مُوَثَّقًا يَتَشَارَكُهُ الْفَرِيقُ، وَرُؤْيَةً مُوَحَّدَةً لِلْفُصُولِ وَالْوَاجِبَاتِ وَالدَّرَجَاتِ.',
        'And what does the institution gain? A documented curriculum decision the team shares, and a unified view of classes, homework and grades.'),
      L('وَحَوْكَمَةً وَاضِحَةً: أَدْوَارٌ، وَسِجِلُّ تَدْقِيقٍ، وَمُدَدُ احْتِفَاظٍ تُقَرِّرُهَا بِنَفْسِهَا، وَخُصُوصِيَّةٌ لَا يَتَخَطَّاهَا حَتَّى فَرِيقُ الْمِنَصَّةِ.',
        'Clear governance: roles, an audit log, retention periods it decides itself, and privacy that even the platform team cannot bypass.'),
      L('وَمِنَصَّةً تَنْمُو مَعَهَا، دُونَ خَوَادِمَ تُدِيرُهَا، وَلَا بَرَامِجَ تُثَبِّتُهَا.', 'And a platform that grows with it, with no servers to run and no software to install.'),
    ],
  },

  // ================================================================ 8 · vision & next steps
  { id: 'c8-card', ch: 8, t: 'chapter', music: 'finale', min: 3.6, lines: [] },
  {
    id: 'c8-ready', ch: 8, t: 'readiness', music: 'finale', lead: 0.5, tail: 1.0,
    p: {
      stats: [
        { big: '311', ar: 'اختبار وحدة وتكامل', en: 'unit & integration tests' },
        { big: '24', ar: 'رحلة استخدام × 3 متصفحات', en: 'user journeys × 3 browser engines' },
        { big: '149', ar: 'شاشة في فحص سهولة الوصول', en: 'screens in the accessibility audit' },
      ],
      remaining: { at: 1, title: 'قبل الإطلاق التجاري', items: ['تفعيل الدفع', 'بيئة الاستضافة', 'المراجعة القانونية لبيانات الطلاب', 'المراجعة التحريرية للدليل'] },
    },
    lines: [
      L('أَيْنَ نَقِفُ الْيَوْمَ؟ الْمِنَصَّةُ مُكْتَمِلَةٌ وَظِيفِيًّا، وَمُخْتَبَرَةٌ مَحَلِّيًّا بِأَكْثَرَ مِنْ ثَلَاثِمِئَةِ اخْتِبَارٍ آلِيٍّ، وَبِرِحْلَاتِ اسْتِخْدَامٍ كَامِلَةٍ فِي ثَلَاثَةِ مُتَصَفِّحَاتٍ.',
        'Where do we stand today? The platform is functionally complete and tested locally with more than three hundred automated tests, and full user journeys in three browser engines.'),
      L('وَقَبْلَ الْإِطْلَاقِ التِّجَارِيِّ خُطُوَاتٌ وَاضِحَةٌ: تَفْعِيلُ الدَّفْعِ، وَبِيئَةُ الِاسْتِضَافَةِ، وَالْمُرَاجَعَةُ الْقَانُونِيَّةُ لِبَيَانَاتِ الطُّلَّابِ، وَالْمُرَاجَعَةُ التَّحْرِيرِيَّةُ لِلدَّلِيلِ.',
        'Before the commercial launch, clear steps remain: activating payments, the hosting environment, the legal review of student data, and the editorial review of the catalogue.'),
    ],
  },
  {
    id: 'c8-roadmap', ch: 8, t: 'roadmap', music: 'finale', lead: 0.5, tail: 1.0,
    p: {
      steps: [
        { ar: 'اليوم', en: 'Today', items: ['منصة مكتملة وظيفيًا', 'مختبرة محليًا'], kind: 'now' },
        { ar: 'الخطوة التالية', en: 'Next', items: ['تشغيل تجريبي مع مؤسسات شريكة'], kind: 'dev' },
        { ar: 'خارطة الطريق', en: 'Roadmap', items: ['المساعد التعليمي الذكي', 'حسابات أولياء الأمور', 'بنك الأسئلة', 'تقارير الفصول الدراسية', 'الدخول الموحّد (SSO)', 'مناهج دول عربية أخرى'], kind: 'later' },
      ],
      beats: [0, 0, 1],
    },
    lines: [
      L('وَالْمَرْحَلَةُ التَّالِيَةُ تَبْدَأُ بِتَشْغِيلٍ تَجْرِيبِيٍّ مَعَ عَدَدٍ مِنَ الْمُؤَسَّسَاتِ الشَّرِيكَةِ، تُحَدِّدُ مُلَاحَظَاتُهَا الْأَوْلَوِيَّاتِ.',
        'The next stage starts with a pilot with a few partner institutions, whose feedback will set the priorities.'),
      L('وَعَلَى خَارِطَةِ الطَّرِيقِ: الْمُسَاعِدُ التَّعْلِيمِيُّ الذَّكِيُّ، وَحِسَابَاتُ أَوْلِيَاءِ الْأُمُورِ، وَبَنْكُ الْأَسْئِلَةِ، وَتَقَارِيرُ الْفُصُولِ الدِّرَاسِيَّةِ، وَالدُّخُولُ الْمُوَحَّدُ، وَمَنَاهِجُ دُوَلٍ عَرَبِيَّةٍ أُخْرَى.',
        'On the roadmap: the intelligent educational assistant, parent accounts, a question bank, term reports, single sign-on, and the curricula of other Arab countries.'),
    ],
  },
  {
    id: 'c8-invite', ch: 8, t: 'endcard', music: 'finale', lead: 0.6, tail: 4.0,
    p: {
      invite: { ar: 'ندعوكم إلى البرنامج التجريبي', en: 'Join the pilot programme', at: 0 },
      slogan: { ar: 'منهجٌ واضح · فصلٌ متصل · مؤسسةٌ ترى الصورة كاملة', en: 'A clear curriculum · a connected classroom · an institution that sees the whole picture', at: 2 },
      cta: { ar: 'تواصلوا معنا لعرض مباشر أو للانضمام إلى التجربة', en: 'Contact us for a live demo or to join the pilot', at: 3 },
    },
    lines: [
      L('لِذَلِكَ نَدْعُو الْمَدَارِسَ وَمَجْمُوعَاتِ الْمَدَارِسِ، وَشَرِكَاتِ التَّعْلِيمِ وَالنَّشْرِ، إِلَى الِانْضِمَامِ لِلْبَرْنَامَجِ التَّجْرِيبِيِّ، وَبِنَاءِ الْمَرْحَلَةِ الْقَادِمَةِ مَعَنَا.',
        'So we invite schools, school groups, and education and publishing companies to join the pilot programme and build the next stage with us.'),
      L('وَنُرَحِّبُ بِالشُّرَكَاءِ وَالْمُسْتَثْمِرِينَ الَّذِينَ يُؤْمِنُونَ بِتَعْلِيمٍ أَكْثَرَ تَرَابُطًا وَوُضُوحًا.', 'And we welcome partners and investors who believe in more connected, clearer education.'),
      L('نِطَاقُ الْمَنَاهِجِ: مَنْهَجٌ وَاضِحٌ، وَفَصْلٌ مُتَّصِلٌ، وَمُؤَسَّسَةٌ تَرَى الصُّورَةَ كَامِلَةً.', 'Curriculum Scope: a clear curriculum, a connected classroom, and an institution that sees the whole picture.'),
      L('تَوَاصَلُوا مَعَنَا لِعَرْضٍ مُبَاشِرٍ، أَوْ لِلِانْضِمَامِ إِلَى التَّجْرِبَةِ.', 'Contact us for a live demo, or to join the pilot.'),
    ],
  },
];
