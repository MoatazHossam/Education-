// The 3-minute cut: the same product, recordings and visual system as the 20-minute showcase, told
// briefly for meetings and for sending to prospective customers. Same rules: every claim is checked
// against the product (FEATURE_COVERAGE_MATRIX.md); AI is shown only as a labelled future vision.

const L = (ar, en, say) => ({ ar, en, ...(say ? { say } : {}) });
const MONITOR_ROWS = { x: 100, y: 270, w: 770, h: 170 };

export const meta = {
  id: 'showcase-3',
  title: 'نطاق المناهج — في ثلاث دقائق',
  titleEn: 'Curriculum Scope — in three minutes',
  target: [170, 190],
};

export const chapters = [
  { n: 1, ar: 'التحدي والحل', en: 'The challenge and the answer' },
  { n: 2, ar: 'المنصة في العمل', en: 'The platform at work' },
  { n: 3, ar: 'الثقة والرؤية', en: 'Trust and vision' },
  { n: 4, ar: 'الخطوة التالية', en: 'Next step' },
];

export const scenes = [
  {
    id: 'm-open', ch: 1, t: 'cold', music: 'open', lead: 1.6, tail: 0.4,
    p: {
      fragments: [
        { icon: 'sheet', ar: 'جدول بيانات', en: 'Spreadsheet' },
        { icon: 'chat', ar: 'مجموعة محادثة', en: 'Chat group' },
        { icon: 'paper', ar: 'قائمة مطبوعة', en: 'Printed list' },
        { icon: 'mail', ar: 'بريد إلكتروني', en: 'Email thread' },
        { icon: 'app', ar: 'تطبيق منفصل', en: 'Separate app' },
        { icon: 'folder', ar: 'مجلد مشترك', en: 'Shared folder' },
      ],
      words: [['أيُّ الكتب؟', 'مَن يتابع؟', 'أين الدرجات؟']],
    },
    lines: [
      L('مَعَ كُلِّ عَامٍ دِرَاسِيٍّ، تَتَوَزَّعُ قَرَارَاتُ الْمَنْهَجِ وَمُتَابَعَةُ الطُّلَّابِ بَيْنَ أَدَوَاتٍ مُتَفَرِّقَةٍ.',
        'Every academic year, curriculum decisions and student follow-up get spread across separate tools.'),
      L('أَيُّ الْكُتُبِ؟ مَنْ يُتَابِعُ؟ وَأَيْنَ الدَّرَجَاتُ؟', 'Which books? Who follows up? And where are the grades?'),
    ],
  },
  {
    id: 'm-reveal', ch: 1, t: 'logo', music: 'reveal', lead: 1.6, tail: 1.6,
    p: { tagline: { ar: 'منصة تعليمية سحابية للمدارس والمؤسسات التعليمية', en: 'A cloud education platform for schools and education organizations' } },
    lines: [
      L('نِطَاقُ الْمَنَاهِجِ: مِنَصَّةٌ وَاحِدَةٌ تَرْبِطُ الْمَنْهَجَ، وَالْفَصْلَ، وَالْمُؤَسَّسَةَ.',
        'Curriculum Scope: one platform that connects the curriculum, the classroom and the institution.'),
    ],
  },
  {
    id: 'm-layers', ch: 1, t: 'layers', music: 'vision', lead: 0.4, tail: 0.6,
    p: {
      layers: [
        { ar: 'المنهج', en: 'Curriculum', items: ['دليل المناهج', 'نطاقات المحتوى', 'المسؤولون والمواعيد'] },
        { ar: 'الفصل', en: 'Classroom', items: ['الواجبات', 'الاختبارات الإلكترونية', 'سجل الدرجات', 'بوابة الطالب'] },
        { ar: 'المؤسسة', en: 'Institution', items: ['الأدوار', 'الاشتراكات', 'سجل التدقيق', 'العربية والإنجليزية'] },
      ],
    },
    lines: [
      L('ثَلَاثُ طَبَقَاتٍ مُتَرَابِطَةٍ:', 'Three connected layers:'),
      L('دَلِيلٌ مُحَدَّثٌ لِلْمَنَاهِجِ الْمِصْرِيَّةِ، تُقَرِّرُ فِيهِ الْمَدْرَسَةُ مَا تُغَطِّيهِ،', 'an up-to-date catalogue of Egypt’s curricula, where the school decides what it covers;'),
      L('وَفُصُولٌ وَوَاجِبَاتٌ وَاخْتِبَارَاتٌ مَبْنِيَّةٌ عَلَيْهِ،', 'classes, homework and tests built on it;'),
      L('وَإِدَارَةٌ مُؤَسَّسِيَّةٌ آمِنَةٌ، بِالْعَرَبِيَّةِ وَالْإِنْجِلِيزِيَّةِ.', 'and secure institutional management, in Arabic and English.'),
    ],
  },
  {
    id: 'm-who', ch: 1, t: 'segments', music: 'segments', lead: 0.4, tail: 0.8,
    p: {
      segments: [
        { icon: 'school', ar: 'المدارس الخاصة والدولية ومجموعات المدارس', en: 'Private & international schools, school groups', status: 'now', need: 'تنسيق ما يُدرَّس ومتابعة العمل اليومي', offer: ['نطاقات مشتركة', 'فصول واختبارات', 'بوابة الطالب'] },
        { icon: 'edtech', ar: 'شركات التكنولوجيا التعليمية وناشرو المحتوى', en: 'EdTech companies & publishers', status: 'now', need: 'أي جزء من المنهج نغطيه هذا العام؟', offer: ['API', 'Webhooks موقّعة'] },
        { icon: 'center', ar: 'مراكز الدروس ومستشارو المناهج', en: 'Tutoring centres & consultants', status: 'now', need: 'خطط تغطية واضحة', offer: ['تصدير ومقارنة'] },
        { icon: 'uni', ar: 'الجامعات ومؤسسات التعليم العالي', en: 'Universities & higher education', status: 'later', need: 'الدليل مصمَّم للتعليم قبل الجامعي', offer: ['توسّع لاحق'] },
      ],
      beats: [-1, 3],
    },
    lines: [
      L('صُمِّمَتْ لِلْمَدَارِسِ الْخَاصَّةِ وَالدَّوْلِيَّةِ وَمَجْمُوعَاتِهَا، وَلِشَرِكَاتِ التِّكْنُولُوجْيَا التَّعْلِيمِيَّةِ وَالنَّاشِرِينَ، وَلِمَرَاكِزِ الدُّرُوسِ.',
        'It is built for private and international schools and school groups, education technology companies and publishers, and tutoring centres.'),
      L('أَمَّا الْجَامِعَاتُ، فَتَوَسُّعٌ لَاحِقٌ.', 'Universities are a later expansion.'),
    ],
  },
  {
    id: 'm-curriculum', ch: 2, t: 'demo', music: 'demo', lead: 0.4, tail: 0.5,
    p: {
      caption: { ar: 'دليل المناهج ونطاقات المحتوى', en: 'Curriculum catalogue & scopes' }, status: 'now',
      stats: { at: 0, items: [['12', 'صفًّا'], ['5', 'مسارات'], ['231', 'مادة دراسية'], ['1,038', 'كتابًا ومرجعًا']] },
      segments: [{ shot: 'pick-books', from: 3, to: 9, sync: { 4: 1 } }, { shot: 'carry', from: 3, to: 3, sync: { 3: 2 } }],
    },
    lines: [
      L('دَلِيلٌ يَضُمُّ اثْنَيْ عَشَرَ صَفًّا، وَ231 مَادَّةً دِرَاسِيَّةً، وَأَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.',
        'A catalogue of twelve grades, 231 subjects and more than a thousand books and references.',
        'دَلِيلٌ يَضُمُّ اثْنَيْ عَشَرَ صَفًّا، وَمِئَتَيْنِ وَإِحْدَى وَثَلَاثِينَ مَادَّةً دِرَاسِيَّةً، وَأَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.'),
      L('يَخْتَارُ الْفَرِيقُ الْكُتُبَ لِكُلِّ صَفٍّ وَمَسَارٍ، فَيُحْفَظُ الْقَرَارُ نِطَاقًا مُشْتَرَكًا،', 'The team picks the books for each grade and track, and the decision is kept as a shared scope,'),
      L('يُصَدَّرُ، وَيُقَارَنُ، وَيُنْقَلُ إِلَى الْعَامِ التَّالِي بِخُطْوَةٍ وَاحِدَةٍ.', 'exported, compared, and carried to the next year in one step.'),
    ],
  },
  {
    id: 'm-notes', ch: 2, t: 'demo', music: 'demo', lead: 0.3, tail: 0.5,
    p: { caption: { ar: 'المسؤولون والمواعيد', en: 'Assignees & due dates' }, status: 'now', segments: [{ shot: 'notes', from: 2, to: 7 }, { shot: 'assignments-all' }] },
    lines: [
      L('وَلِكُلِّ كِتَابٍ مَسْؤُولٌ، وَمَوْعِدٌ، وَتَذْكِيرٌ، فَلَا يَضِيعُ شَيْءٌ بَيْنَ الرَّسَائِلِ.', 'Every book has an owner, a due date and a reminder, so nothing gets lost between messages.'),
    ],
  },
  {
    id: 'm-homework', ch: 2, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.5,
    p: { caption: { ar: 'الواجبات والتصحيح', en: 'Homework & marking' }, status: 'now', segments: [{ shot: 'homework-set', from: 2, to: 4 }, { shot: 'homework-mark', from: 2, sync: { 2: 1 } }] },
    lines: [
      L('وَيُكَلِّفُ الْمُعَلِّمُ طُلَّابَهُ بِوَاجِبَاتٍ مَرْبُوطَةٍ بِالْمَنْهَجِ،', 'The teacher sets homework linked to the curriculum,'),
      L('ثُمَّ يُصَحِّحُهَا، وَيُعِيدُهَا بِتَعْلِيقِهِ.', 'then marks it and returns it with comments.'),
    ],
  },
  {
    id: 'm-tests', ch: 2, t: 'demo', music: 'classroom', lead: 0.3, tail: 0.5,
    p: { caption: { ar: 'الاختبارات والمتابعة المباشرة', en: 'Online tests & live monitoring' }, status: 'now', segments: [{ shot: 'monitor', from: 3, to: 5, zoom: { 3: MONITOR_ROWS, 4: MONITOR_ROWS, 5: MONITOR_ROWS } }, { shot: 'gradebook', sync: { 0: 1 }, zoom: { 0: { x: 640, y: 230, w: 680, h: 330 } } }] },
    lines: [
      L('وَيُدِيرُ اخْتِبَارَاتٍ إِلِكْتْرُونِيَّةً بِوَقْتٍ يَحْسُبُهُ الْخَادِمُ، وَمُتَابَعَةٍ مُبَاشِرَةٍ، وَتَصْحِيحٍ آلِيٍّ يَبْقَى فِيهِ الْقَرَارُ لَهُ.',
        'Online tests run on time kept by the server, with live monitoring and automatic marking — the final say stays with the teacher.'),
      L('ثُمَّ تَجْتَمِعُ الدَّرَجَاتُ فِي سِجِلٍّ وَاحِدٍ.', 'Then the marks come together in one gradebook.'),
    ],
  },
  {
    id: 'm-student', ch: 2, t: 'phone', music: 'student', lead: 0.3, tail: 0.6,
    p: {
      caption: { ar: 'بوابة الطالب', en: 'Student Portal' }, status: 'now',
      segments: [{ shot: 'student-test', from: 4, to: 8 }, { shot: 'student-grades', from: 2, to: 3, sync: { 2: 1 } }],
      points: [{ ar: 'الواجبات والاختبارات', at: 0 }, { ar: 'الدرجات والكتب', at: 1 }, { ar: 'بلغته ومن هاتفه', at: 1 }],
      // Built and tested, but off for every school until the legal review of minors' data (PROJECT_STATUS B-9).
      notes: [{ at: 1, ar: 'تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب', en: 'Switched on per school after the legal review of student data', kind: 'dev' }],
    },
    lines: [
      L('وَيَجِدُ الطَّالِبُ يَوْمَهُ الدِّرَاسِيَّ عَلَى هَاتِفِهِ: وَاجِبَاتِهِ، وَاخْتِبَارَاتِهِ،', 'Students find their school day on their phone: homework and tests,'),
      L('وَدَرَجَاتِهِ، وَكُتُبَهُ، بِحِسَابٍ تُدِيرُهُ مَدْرَسَتُهُ.', 'their grades and their books, with an account their school manages.'),
    ],
  },
  {
    id: 'm-value', ch: 2, t: 'cards', music: 'student', lead: 0.4, tail: 1.0,
    p: {
      title: { ar: 'قيمة لكل طرف', en: 'Value for everyone' },
      cards: [
        { icon: 'teacher', ar: 'المعلم: متابعة يدوية أقل، والقرار له', en: 'Teacher: less manual follow-up, the final say' },
        { icon: 'student', ar: 'الطالب: يومه الدراسي في مكان واحد', en: 'Student: the school day in one place' },
        { icon: 'school', ar: 'المؤسسة: قرار موثّق ورؤية موحّدة', en: 'Institution: a documented decision, one view' },
      ],
      beats: [[0, 1, 2]],
    },
    lines: [
      L('فَتَخِفُّ عَنِ الْمُعَلِّمِ الْمُتَابَعَةُ الْيَدَوِيَّةُ، وَيَجِدُ الطَّالِبُ كُلَّ مَا يَخُصُّهُ فِي مَكَانٍ وَاحِدٍ، وَتَرَى الْمُؤَسَّسَةُ الصُّورَةَ كَامِلَةً.',
        'Teachers get lighter manual follow-up, students find everything in one place, and the institution sees the whole picture.'),
    ],
  },
  {
    id: 'm-trust', ch: 3, t: 'arch', music: 'saas', lead: 0.4, tail: 0.8,
    p: { mode: 'tenancy' },
    lines: [
      L('كُلُّ مُؤَسَّسَةٍ مَعْزُولَةٌ بِبَيَانَاتِهَا دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ، مَعَ أَدْوَارٍ، وَتَحَقُّقٍ بِخُطْوَتَيْنِ، وَسِجِلِّ تَدْقِيقٍ،',
        'Each institution’s data is isolated inside the database, with roles, two-step verification and an audit log,'),
      L('وَلَا يَطَّلِعُ فَرِيقُ الْمِنَصَّةِ عَلَى عَمَلِ الْمَدْرَسَةِ إِلَّا بِإِذْنِهَا.', 'and the platform team sees a school’s work only with its permission.'),
    ],
  },
  {
    id: 'm-ai', ch: 3, t: 'aiconcept', music: 'ai', lead: 0.4, tail: 0.8,
    p: {
      banner: { ar: 'تصوّر مستقبلي — ليس ميزة متاحة للبيع', en: 'Future vision — not a feature for sale' },
      center: { ar: 'مساعد تعليمي', en: 'Educational assistant' },
      inputs: [{ ar: 'منهج المدرسة', en: 'School curriculum' }, { ar: 'بوابة الطالب', en: 'Student portal' }, { ar: 'الحساب نفسه', en: 'Same account' }],
      uses: [{ ar: 'فهم الدرس', en: 'Understanding a lesson', at: 0 }, { ar: 'تنظيم المذاكرة', en: 'Study planning', at: 0 }, { ar: 'التدرّب على الأسئلة', en: 'Practice questions', at: 0 }, { ar: 'مساعدة المعلم في الإعداد', en: 'Help teachers prepare', at: 0 }],
      rules: [{ ar: 'إجابات موسومة بأنها مولّدة آليًا', at: 1 }, { ar: 'لا يغيّر أي درجة', at: 1 }, { ar: 'حدود استخدام ضمن الاشتراك', at: 1 }, { ar: 'المعلم صاحب القرار', at: 1 }],
      inputsAt: 0, highlightAt: 1,
    },
    lines: [
      L('أَمَّا الْمُسَاعِدُ التَّعْلِيمِيُّ الذَّكِيُّ، فَرُؤْيَةٌ مُسْتَقْبَلِيَّةٌ لَمْ تُنَفَّذْ بَعْدُ،', 'The intelligent educational assistant is a future vision, not built yet;'),
      L('وَسَيَعْمَلُ بِضَوَابِطَ وَاضِحَةٍ: لَا يُغَيِّرُ أَيَّ دَرَجَةٍ، وَالْقَرَارُ لِلْمُعَلِّمِ.', 'it will work under clear rules: it never changes a grade, and the teacher decides.'),
    ],
  },
  {
    id: 'm-next', ch: 4, t: 'roadmap', music: 'finale', lead: 0.4, tail: 0.8,
    p: {
      steps: [
        { ar: 'اليوم', en: 'Today', items: ['منصة مكتملة وظيفيًا', 'مختبرة محليًا'], kind: 'now' },
        { ar: 'الخطوة التالية', en: 'Next', items: ['تشغيل تجريبي مع مؤسسات شريكة'], kind: 'dev' },
        { ar: 'خارطة الطريق', en: 'Roadmap', items: ['المساعد التعليمي الذكي', 'حسابات أولياء الأمور', 'بنك الأسئلة'], kind: 'later' },
      ],
      beats: [0, 0, 0],
    },
    lines: [
      L('الْمِنَصَّةُ مُكْتَمِلَةٌ وَظِيفِيًّا وَمُخْتَبَرَةٌ مَحَلِّيًّا، وَتَسْتَعِدُّ لِتَشْغِيلٍ تَجْرِيبِيٍّ مَعَ مُؤَسَّسَاتٍ شَرِيكَةٍ.',
        'The platform is functionally complete and tested locally, and is getting ready for a pilot with partner institutions.'),
    ],
  },
  {
    id: 'm-end', ch: 4, t: 'endcard', music: 'finale', lead: 0.4, tail: 4.4,
    p: {
      invite: { ar: 'ندعوكم إلى البرنامج التجريبي', en: 'Join the pilot programme', at: 0 },
      slogan: { ar: 'منهجٌ واضح · فصلٌ متصل · مؤسسةٌ ترى الصورة كاملة', en: 'A clear curriculum · a connected classroom · an institution that sees the whole picture', at: 1 },
      cta: { ar: 'تواصلوا معنا لعرض مباشر أو للانضمام إلى التجربة', en: 'Contact us for a live demo or to join the pilot', at: 2 },
    },
    lines: [
      L('نَدْعُو الْمَدَارِسَ، وَشَرِكَاتِ التَّعْلِيمِ وَالنَّشْرِ، إِلَى الْبَرْنَامَجِ التَّجْرِيبِيِّ.', 'We invite schools and education and publishing companies to the pilot programme.'),
      L('نِطَاقُ الْمَنَاهِجِ: مَنْهَجٌ وَاضِحٌ، وَفَصْلٌ مُتَّصِلٌ، وَمُؤَسَّسَةٌ تَرَى الصُّورَةَ كَامِلَةً.', 'Curriculum Scope: a clear curriculum, a connected classroom, and an institution that sees the whole picture.'),
      L('تَوَاصَلُوا مَعَنَا لِعَرْضٍ مُبَاشِرٍ.', 'Contact us for a live demo.'),
    ],
  },
];
