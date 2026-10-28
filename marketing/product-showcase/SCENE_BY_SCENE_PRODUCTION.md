# Scene-by-scene production sheet

For each scene: timeline, Arabic narration, visual, recording, camera, overlays, transition, music and sound. Generated from the script data (`node docs.mjs`); the render uses the same data.

**Common to all scenes.** 1920 × 1080 stage (rendered at 1080p or, at device scale 2, 3840 × 2160), 30 fps. Fonts: Readex Pro (the product's font) and IBM Plex Mono. Colours from `public/app.css` (ink #18243a, accent #1f4e8c, margin red #c0473b, paper #f7f8fb). Transitions: 0.6 s cross-fade between scenes (0.4 s between two product demonstrations); chapter cards carry a soft whoosh. Product demonstrations show a "DEMO DATA · بيانات تجريبية" tag; all names, schools and addresses are invented. Sound: the generated score (`audio/mix.py`), ducked about 10 dB under narration; soft clicks on demonstrated clicks.

## Curriculum Scope — Product Showcase

### 1. `c1-open` — 00:00.0–00:22.6 (22.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:02.6` مَعَ بِدَايَةِ كُلِّ عَامٍ دِرَاسِيٍّ، تَتَكَرَّرُ الْأَسْئِلَةُ نَفْسُهَا فِي الْمَدَارِسِ وَالْمُؤَسَّسَاتِ التَّعْلِيمِيَّةِ.<br>`00:10.7` أَيَّ الْكُتُبِ سَنُدَرِّسُ؟ وَبِأَيِّ طَبْعَةٍ؟ وَلِأَيِّ الصُّفُوفِ وَالْمَسَارَاتِ؟<br>`00:16.5` وَمَنْ يُتَابِعُ الْوَاجِبَاتِ وَالِاخْتِبَارَاتِ وَالدَّرَجَاتِ؟ وَأَيْنَ تُحْفَظُ الْإِجَابَاتُ؟</div> |
| Visual | Dark stage. Glass "fragments" (جدول بيانات، مجموعة محادثة، قائمة مطبوعة، بريد إلكتروني، تطبيق منفصل، مجلد مشترك) drift; the academic year 2026 / 2027 fades in, then the narration's questions appear in large type (أيُّ الكتب؟ · أيُّ طبعة؟ · لأيِّ صف؟ · مَن يتابع؟ · أين تُحفظ؟). |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | from black |
| Music & sound | cue `open`: sparse, dark pads and bass; bells |

### 2. `c1-problems` — 00:22.6–01:06.3 (43.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:23.1` فِي مُؤَسَّسَاتٍ كَثِيرَةٍ، تَتَوَزَّعُ هَذِهِ الْإِجَابَاتُ بَيْنَ جَدَاوِلَ مُتَفَرِّقَةٍ، وَمَجْمُوعَاتِ مُحَادَثَةٍ، وَأَدَوَاتٍ لَا يَتَّصِلُ بَعْضُهَا بِبَعْضٍ.<br>`00:33.9` وَقَدْ يَعْمَلُ كُلُّ قِسْمٍ بِطَرِيقَتِهِ، فَيَصْعُبُ الْحُصُولُ عَلَى صُورَةٍ مُوَحَّدَةٍ لِمَا يَحْدُثُ فِعْلًا.<br>`00:41.5` وَتَسْتَهْلِكُ الْمُتَابَعَةُ الْيَدَوِيَّةُ وَقْتَ الْمُعَلِّمِينَ وَالْإِدَارَةِ، بَدَلًا مِنْ أَنْ يَذْهَبَ إِلَى التَّعْلِيمِ نَفْسِهِ.<br>`00:49.6` أَمَّا الطَّالِبُ، فَرُبَّمَا لَا يَجِدُ مَكَانًا وَاحِدًا يَرَى فِيهِ مَا عَلَيْهِ، وَمَا أَنْجَزَهُ، وَكَيْفَ يَتَقَدَّمُ.<br>`00:57.9` هَذِهِ لَيْسَتْ أَحْكَامًا عَلَى كُلِّ مُؤَسَّسَةٍ، بَلْ أَسْئِلَةٌ نَسْمَعُهَا كَثِيرًا، وَتَسْتَحِقُّ إِجَابَةً أَفْضَلَ.</div> |
| Visual | Dark stage, title "أين تضيع الصورة؟". Six cards appear with the narration: أدوات متفرّقة (Fragmented tools); عمليات غير مترابطة (Disconnected workflows); لا صورة موحّدة (No unified view); متابعة يدوية (Manual follow-up); دعم شخصي محدود (Limited personal support); رؤية محدودة للتقدّم (Limited view of progress). Note at the end: "تحدّيات شائعة نسمعها في السوق — تختلف من مؤسسة إلى أخرى". |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `open`: sparse, dark pads and bass; bells |

### 3. `c1-question` — 01:06.3–01:17.1 (10.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:06.9` فَكَيْفَ تَرْبِطُ الْمُؤَسَّسَةُ التَّعْلِيمِيَّةُ أَفْرَادَهَا، وَعَمَلِيَّاتِهَا، وَتَجْرِبَةَ التَّعَلُّمِ، فِي مِنَصَّةٍ وَاحِدَةٍ مُتَكَامِلَةٍ؟</div> |
| Visual | Dark stage. The question in three lines, the middle line in sky blue, with the product's red margin rule; English translation beneath. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `open`: sparse, dark pads and bass; bells |

### 4. `c1-reveal` — 01:17.1–01:25.0 (8.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:18.9` نُقَدِّمُ لَكُمْ: نِطَاقَ الْمَنَاهِجِ — Curriculum Scope.</div> |
| Visual | Product reveal: the logo mark (public/favicon.svg) builds — square, red margin, three lines — then "نطاق المناهج" / "Curriculum Scope" and the tagline "منصة تعليمية سحابية للمدارس والمؤسسات التعليمية". |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `reveal`: swell to full pad, arpeggio enters; riser + impact |

### 5. `c2-card` — 01:25.0–01:28.6 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio; whoosh |

### 6. `c2-origin` — 01:28.6–02:07.1 (38.5 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:29.2` بَدَأَتِ الْفِكْرَةُ بِأَدَاةٍ بَسِيطَةٍ: صَفْحَةٍ وَاحِدَةٍ لِاخْتِيَارِ مَنَاهِجِ مِصْرَ، مِنَ الصَّفِّ الْأَوَّلِ الِابْتِدَائِيِّ حَتَّى الثَّالِثِ الثَّانَوِيِّ.<br>`01:39.2` صُمِّمَتْ لِتَحْدِيدِ نِطَاقِ الْمُحْتَوَى لِمُنْتَجٍ تَعْلِيمِيٍّ فِي الْعَامِ الدِّرَاسِيِّ 2026/2027.<br>`01:49.4` لَكِنَّهَا كَانَتْ تَعْمَلُ فِي مُتَصَفِّحٍ وَاحِدٍ، بِلَا حِسَابَاتٍ، وَلَا مُشَارَكَةٍ، وَلَا سِجِلٍّ لِلْقَرَارَاتِ.<br>`01:57.8` الْيَوْمَ، صَارَتْ مِنَصَّةً سَحَابِيَّةً مُتَكَامِلَةً تَعْمَلُ بِنَمُوذَجِ SaaS، لِفِرَقِ الْمَدَارِسِ وَمُعَلِّمِيهَا وَطُلَّابِهَا.</div> |
| Visual | Paper stage. Right: the original single-page artifact (legacy/, recording "legacy"), labelled "البداية: صفحة واحدة في متصفح واحد"; red tags (بلا حسابات، بلا مشاركة، بلا سجل للقرارات). Left, on the last line: today's picker (recording "pick-books"), "اليوم: منصة SaaS متكاملة", with an arrow. |
| Screen recording | Stills from capture/showcase.spec.ts (see Visual). |
| Camera | Slow push-in (Ken Burns, ≤ 6 %) on each screenshot. |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio |

### 7. `c2-layers` — 02:07.1–02:38.8 (31.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:07.6` تَقُومُ الْمِنَصَّةُ عَلَى ثَلَاثِ طَبَقَاتٍ مُتَرَابِطَةٍ.<br>`02:11.8` الْأُولَى هِيَ الْمَنْهَجُ: دَلِيلٌ مُحَدَّثٌ لِلْمَنَاهِجِ الْمِصْرِيَّةِ، تُقَرِّرُ فِيهِ الْمُؤَسَّسَةُ مَا تُغَطِّيهِ، وَتَحْفَظُ قَرَارَهَا.<br>`02:21.1` وَالثَّانِيَةُ هِيَ الْفَصْلُ: فُصُولٌ، وَوَاجِبَاتٌ، وَاخْتِبَارَاتٌ إِلِكْتْرُونِيَّةٌ، وَسِجِلُّ دَرَجَاتٍ، مَبْنِيَّةٌ عَلَى ذَلِكَ الْمَنْهَجِ.<br>`02:30.7` وَالثَّالِثَةُ هِيَ الْمُؤَسَّسَةُ: الْأَدْوَارُ، وَالصَّلَاحِيَّاتُ، وَالِاشْتِرَاكَاتُ، وَسِجِلُّ التَّدْقِيقِ، وَالْحِمَايَةُ.</div> |
| Visual | Three bands appear with the narration: المنهج (دليل المناهج، نطاقات المحتوى، الملاحظات والمسؤولون، عام دراسي جديد) / الفصل (الفصول، الواجبات، الاختبارات الإلكترونية، سجل الدرجات، بوابة الطالب) / المؤسسة (الأدوار والصلاحيات، الاشتراكات، سجل التدقيق، الحماية، API). |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio |

### 8. `c2-flow` — 02:38.8–03:06.4 (27.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:39.3` قِيمَةُ التَّكَامُلِ أَنَّ الْمَعْلُومَةَ تُكْتَبُ مَرَّةً وَاحِدَةً، ثُمَّ تَنْتَقِلُ حَيْثُ يُحْتَاجُ إِلَيْهَا.<br>`02:46.3` الْكُتُبُ الَّتِي تَخْتَارُهَا الْمَدْرَسَةُ تَصِيرُ مَنْهَجَ الْفَصْلِ، وَمِنْهَا يَخْتَارُ الْمُعَلِّمُ مَادَّةَ الْوَاجِبِ، ثُمَّ تَصِلُ الدَّرَجَةُ إِلَى سِجِلِّ الدَّرَجَاتِ وَإِلَى الطَّالِبِ.<br>`02:57.7` وَكُلُّ ذَلِكَ بِحِسَابٍ وَاحِدٍ، وَتَسْجِيلِ دُخُولٍ وَاحِدٍ، وَوَاجِهَةٍ وَاحِدَةٍ بِالْعَرَبِيَّةِ وَالْإِنْجِلِيزِيَّةِ.</div> |
| Visual | Five nodes, right to left: الكتب المختارة → منهج الفصل → الواجب والاختبار → سجل الدرجات → الطالب; a light travels along them on line 2; chips: حساب واحد · تسجيل دخول واحد · العربية والإنجليزية. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio |

### 9. `c2-principles` — 03:06.4–03:26.1 (19.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`03:06.8` وَبُنِيَتِ الْمِنَصَّةُ عَلَى مَبَادِئَ وَاضِحَةٍ: الْعَرَبِيَّةُ أَوَّلًا، مَعَ دَعْمٍ كَامِلٍ لِلْكِتَابَةِ مِنَ الْيَمِينِ إِلَى الْيَسَارِ،<br>`03:15.7` وَالْخُصُوصِيَّةُ مُنْذُ التَّصْمِيمِ، وَسُهُولَةُ الْوُصُولِ لِلْجَمِيعِ، وَاخْتِبَارَاتٌ آلِيَّةٌ تَتَحَقَّقُ مِنْ كُلِّ رِحْلَةِ اسْتِخْدَامٍ رَئِيسِيَّةٍ.</div> |
| Visual | Title "مبادئ التصميم" (Design principles); cards: العربية أولًا · الخصوصية منذ التصميم · سهولة الوصول للجميع · اختبارات آلية لكل رحلة. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | مبادئ التصميم<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio |

### 10. `c3-card` — 03:26.1–03:29.7 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `segments`: pads, arpeggio, light pulse; whoosh |

### 11. `c3-segments` — 03:29.7–05:14.0 (104.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`03:30.2` لِمَنْ صُمِّمَتْ هَذِهِ الْمِنَصَّةُ؟ لِفِئَاتٍ تَخْتَلِفُ احْتِيَاجَاتُهَا، وَيَجْمَعُهَا الْمَنْهَجُ.<br>`03:37.0` أَوَّلًا: الْمَدَارِسُ الْخَاصَّةُ وَالدَّوْلِيَّةُ، وَمَجْمُوعَاتُ الْمَدَارِسِ.<br>`03:42.4` تَحْتَاجُ إِلَى تَنْسِيقِ مَا يُدَرَّسُ فِي كُلِّ صَفٍّ وَكُلِّ فَرْعٍ، وَإِلَى مُتَابَعَةِ الْعَمَلِ الْيَوْمِيِّ لِلْمُعَلِّمِينَ وَالطُّلَّابِ.<br>`03:51.4` وَتُقَدِّمُ لَهَا الْمِنَصَّةُ نِطَاقَاتِ مُحْتَوًى مُشْتَرَكَةً، وَمُقَارَنَةً بَيْنَ الْفُرُوعِ، وَفُصُولًا وَوَاجِبَاتٍ وَاخْتِبَارَاتٍ، وَسِجِلَّ دَرَجَاتٍ، وَبَوَّابَةً لِلطَّالِبِ.<br>`04:03.4` ثَانِيًا: شَرِكَاتُ التِّكْنُولُوجْيَا التَّعْلِيمِيَّةِ، وَمُنْتِجُو الْمُحْتَوَى، وَدُورُ النَّشْرِ.<br>`04:09.7` سُؤَالُهُمُ الْأَهَمُّ: أَيُّ جُزْءٍ مِنَ الْمَنْهَجِ نُغَطِّيهِ هَذَا الْعَامَ؟ وَالْمِنَصَّةُ تَحْفَظُ الْإِجَابَةَ، وَتُرْسِلُهَا إِلَى أَنْظِمَتِهِمْ عَبْرَ وَاجِهَةِ API، وَإِشْعَارَاتِ Webhooks مُوَقَّعَةٍ.<br>`04:23.4` ثَالِثًا: مَرَاكِزُ الدُّرُوسِ وَمُسْتَشَارُو الْمَنَاهِجِ، الَّذِينَ يُعِدُّونَ خُطَطَ تَغْطِيَةٍ وَاضِحَةً، يُصَدِّرُونَهَا وَيُقَارِنُونَ بَيْنَهَا.<br>`04:33.3` أَمَّا الْجَامِعَاتُ وَمُؤَسَّسَاتُ التَّعْلِيمِ الْعَالِي، فَهِيَ فُرْصَةُ تَوَسُّعٍ لَاحِقَةٌ، وَلَيْسَتْ مَدْعُومَةً بِالْكَامِلِ الْيَوْمَ.<br>`04:42.3` فَالْفُصُولُ وَالِاخْتِبَارَاتُ وَسِجِلُّ الدَّرَجَاتِ قَابِلَةٌ لِلِاسْتِخْدَامِ، لَكِنَّ الدَّلِيلَ مُصَمَّمٌ لِلتَّعْلِيمِ قَبْلَ الْجَامِعِيِّ، وَلَا تُوجَدُ بَعْدُ سَاعَاتٌ مُعْتَمَدَةٌ وَلَا تَسْجِيلٌ لِلْمُقَرَّرَاتِ.<br>`04:56.3` وَفِي كُلِّ الْحَالَاتِ، الْقِيمَةُ الْمَقْصُودَةُ وَاحِدَةٌ: قَرَارٌ وَاضِحٌ وَمُوَثَّقٌ، وَعَمَلٌ أَقَلُّ تَكْرَارًا، وَرُؤْيَةٌ أَوْضَحُ.<br>`05:05.8` وَهِيَ قِيمَةٌ سَتَقِيسُهَا الْمُؤَسَّسَاتُ الشَّرِيكَةُ فِي التَّشْغِيلِ التَّجْرِيبِيِّ، لَا أَرْقَامٌ نَدَّعِيهَا مُسْبَقًا.</div> |
| Visual | Four segment cards with need and offer; status badges (available now / later expansion). The segment being described is highlighted: المدارس الخاصة والدولية ومجموعات المدارس [now]; شركات التكنولوجيا التعليمية وناشرو المحتوى [now]; مراكز الدروس ومستشارو المناهج [now]; الجامعات ومؤسسات التعليم العالي [later]. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `segments`: pads, arpeggio, light pulse |

### 12. `c4-card` — 05:14.0–05:17.6 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; whoosh |

### 13. `c4-signup` — 05:17.6–05:38.3 (20.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`05:18.2` لِنَبْدَأِ الْجَوْلَةَ مِنَ الْبِدَايَةِ. تُنْشِئُ مُنَى حِسَابًا لِمَدْرَسَتِهَا فِي خُطْوَةٍ وَاحِدَةٍ: اسْمُهَا، وَبَرِيدُهَا، وَاسْمُ الْمَدْرَسَةِ.<br>`05:28.1` تَصِلُهَا رِسَالَةٌ لِتَأْكِيدِ الْبَرِيدِ، ثُمَّ تَدْخُلُ، فَتَبْدَأُ مُؤَسَّسَتُهَا الْأُولَى بِفَتْرَةٍ تَجْرِيبِيَّةٍ مُدَّتُهَا أَرْبَعَةَ عَشَرَ يَوْمًا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "register" (desktop, steps 0–5) → "email-confirmed" (desktop, steps 0–0) → "sign-in" (desktop, steps 0–3). Caption "إنشاء حساب المؤسسة · Sign-up" + متاح الآن · Available now. |
| Screen recording | **register**: start, type (name), type (email), type (password), type (school), click (check email)<br>**email-confirmed**: start<br>**sign-in**: start, type (email), type (password), click (picker) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | إنشاء حساب المؤسسة · Sign-up<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 8 soft click(s) |

### 14. `c4-2fa` — 05:38.3–05:51.0 (12.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`05:38.7` وَلِحِمَايَةِ الْحِسَابَاتِ، تَدْعَمُ الْمِنَصَّةُ التَّحَقُّقَ بِخُطْوَتَيْنِ: وَهُوَ إِلْزَامِيٌّ لِمُدِيرِي الْمِنَصَّةِ، وَيُمْكِنُ لِلْمُؤَسَّسَةِ أَنْ تَفْرِضَهُ عَلَى مَالِكِهَا وَمَسْؤُولِيهَا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "admin-2fa" (desktop, steps 0–2). Caption "التحقق بخطوتين · Two-step verification" + متاح الآن · Available now. |
| Screen recording | **admin-2fa**: start, type (code), click (signed in) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | التحقق بخطوتين · Two-step verification<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 2 soft click(s) |

### 15. `c4-account` — 05:51.0–06:01.9 (10.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`05:51.3` وَمِنْ صَفْحَةِ الْحِسَابِ، يُفَعِّلُ كُلُّ مُسْتَخْدِمٍ التَّحَقُّقَ بِخُطْوَتَيْنِ، وَيَرَى جَلَسَاتِهِ النَّشِطَةَ، وَيُنَزِّلُ بَيَانَاتِهِ الشَّخْصِيَّةَ مَتَى شَاءَ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "account" (desktop, steps 0–2). Caption "أمان الحساب · Account security" + متاح الآن · Available now. |
| Screen recording | **account**: start, state, scroll (two-factor (QR blurred)) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | أمان الحساب · Account security<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 0 soft click(s) |

### 16. `c4-members` — 06:01.9–06:25.0 (23.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`06:02.3` بَعْدَ ذَلِكَ، تَدْعُو مُنَى فَرِيقَهَا. وَلِكُلِّ عُضْوٍ دَوْرٌ: مَالِكٌ، أَوْ مَسْؤُولٌ، أَوْ مُحَرِّرٌ، أَوْ مُشَاهِدٌ.<br>`06:10.5` يَصِلُ كَرِيمًا رَابِطُ الدَّعْوَةِ، فَيَخْتَارُ كَلِمَةَ مُرُورِهِ، وَيَنْضَمُّ مُبَاشَرَةً.<br>`06:16.6` وَالصَّلَاحِيَّاتُ تُطَبَّقُ عَلَى الْخَادِمِ نَفْسِهِ، لَا فِي الْوَاجِهَةِ فَقَطْ: فَالْمُشَاهِدُ يَرَى، لَكِنَّهُ لَا يُعَدِّلُ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "members-invite" (desktop, steps 0–3) → "invitation" (desktop, steps 0–3) → "members" (desktop, steps 0–0) → "viewer" (desktop, steps 0–1). Caption "الأعضاء والأدوار · Members & roles" + متاح الآن · Available now. |
| Screen recording | **members-invite**: start, type (email), click (editor), click (invited)<br>**invitation**: start, type (name), type (password), click (joined)<br>**members**: start<br>**viewer**: start, click |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الأعضاء والأدوار · Members & roles<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 7 soft click(s) |

### 17. `c4-tenancy` — 06:25.0–06:33.6 (8.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`06:25.4` وَيُمْكِنُ لِلشَّخْصِ الْوَاحِدِ أَنْ يَنْتَمِيَ إِلَى أَكْثَرَ مِنْ مُؤَسَّسَةٍ، وَيَنْتَقِلَ بَيْنَهَا مِنَ الْقَائِمَةِ أَعْلَى الصَّفْحَةِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "org-switch" (desktop, steps 0–2). Caption "أكثر من مؤسسة · Multiple organizations" + متاح الآن · Available now. |
| Screen recording | **org-switch**: start, click (school), state (school picker) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | أكثر من مؤسسة · Multiple organizations<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 1 soft click(s) |

### 18. `c4-isolation` — 06:33.6–06:46.2 (12.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`06:34.0` وَهُنَا يَظْهَرُ مَبْدَأُ Multi-Tenancy: كُلُّ مُؤَسَّسَةٍ مَعْزُولَةٌ عَنْ غَيْرِهَا دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ نَفْسِهَا، بِسِيَاسَاتِ أَمَانٍ عَلَى مُسْتَوَى الصُّفُوفِ.</div> |
| Visual | Three organizations (مدرسة وادي النيل للغات، برنامج وادي النيل الصيفي، مؤسسة أخرى) above one PostgreSQL database; each sees only its rows (RLS). A dashed attempt to read another organization's rows is stopped (red ✕). |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under |

### 19. `c4-navigation` — 06:46.2–07:10.4 (24.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`06:46.6` التَّنَقُّلُ وَاضِحٌ: دَلِيلُ الْمَنَاهِجِ، وَالنِّطَاقَاتُ، وَالْفُصُولُ، وَالطُّلَّابُ، وَالْأَعْضَاءُ، وَالْفَوْتَرَةُ، وَالْإِعْدَادَاتُ، وَسِجِلُّ التَّدْقِيقِ.<br>`06:56.5` وَيُنَبِّهُ جَرَسُ الْإِشْعَارَاتِ كُلَّ عُضْوٍ بِمَا يَخُصُّهُ، بِلُغَتِهِ.<br>`07:01.9` وَبِنَقْرَةٍ وَاحِدَةٍ، تَتَحَوَّلُ الْوَاجِهَةُ كُلُّهَا مِنَ الْعَرَبِيَّةِ إِلَى الْإِنْجِلِيزِيَّةِ، وَمِنَ الْيَمِينِ إِلَى الْيَسَارِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "pick-books" (desktop, frame -1) → "karim-bell" (desktop, steps 0–1) → "language" (desktop, steps 0–2). Caption "التنقّل والإشعارات واللغة · Navigation, notifications, language" + متاح الآن · Available now. |
| Screen recording | **pick-books**: single frame -1<br>**karim-bell**: start, click (notifications)<br>**language**: start, click (english), click (grade 1) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | التنقّل والإشعارات واللغة · Navigation, notifications, language<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 3 soft click(s) |

### 20. `c4-access` — 07:10.4–07:30.7 (20.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`07:10.8` وَالْوَاجِهَةُ نَفْسُهَا تَعْمَلُ عَلَى الْهَاتِفِ، وَصُمِّمَتْ لِتَكُونَ سَهْلَةَ الْوُصُولِ: فَقَدْ فُحِصَتْ آلِيًّا 149 شَاشَةً وَفْقَ مَعَايِيرِ WCAG، دُونَ أَيِّ مُلَاحَظَةٍ.<br>`07:24.3` وَتَبْقَى مُرَاجَعَةٌ يَدَوِيَّةٌ بِقَارِئِ الشَّاشَةِ خُطْوَةً قَادِمَةً قَبْلَ الْإِطْلَاقِ.</div> |
| Visual | Phone (390 × 844) on paper: "picker-phone" (phone, steps 0–1). Caption "على الهاتف وسهولة الوصول · Mobile & accessibility" + متاح الآن · Available now. Points: الواجهة نفسها على الهاتف، فحص آلي لـ149 شاشة وفق WCAG، مراجعة يدوية بقارئ الشاشة: قادمة. |
| Screen recording | **picker-phone**: start, scroll (books) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | على الهاتف وسهولة الوصول · Mobile & accessibility<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 0 soft click(s) |

### 21. `c4-oversight` — 07:30.7–07:57.7 (27.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`07:31.1` وَكُلُّ إِجْرَاءٍ مُهِمٍّ يُسَجَّلُ فِي سِجِلِّ التَّدْقِيقِ: مَنْ فَعَلَ مَاذَا، وَمَتَى.<br>`07:37.3` وَعَلَى مُسْتَوَى الْمِنَصَّةِ، لِفَرِيقِ التَّشْغِيلِ لَوْحَةُ إِدَارَةٍ تَعْرِضُ الْمُؤَسَّسَاتِ، وَالِاشْتِرَاكَاتِ، وَصِحَّةَ النِّظَامِ، وَالتَّنْبِيهَاتِ.<br>`07:47.2` لَكِنَّهُ لَا يَطَّلِعُ عَلَى مُحْتَوَى عَمَلِ الْمَدْرَسَةِ إِلَّا إِذَا مَنَحَتْهُ الْمَدْرَسَةُ إِذْنًا مُؤَقَّتًا، وَكُلُّ اطِّلَاعٍ يُسَجَّلُ فِي سِجِلِّهَا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "audit" (desktop, steps 0–1) → "admin-overview" (desktop, steps 0–1) → "settings" (desktop, steps 3–6). Caption "سجل التدقيق ولوحة إدارة المنصة · Audit log & platform admin" + متاح الآن · Available now. |
| Screen recording | **audit**: start, scroll (entries)<br>**admin-overview**: start, scroll (alerts)<br>**settings**: state, scroll (support), type (reason), click (granted) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | سجل التدقيق ولوحة إدارة المنصة · Audit log & platform admin<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 2 soft click(s) |

### 22. `c5-card` — 07:57.7–08:04.2 (6.4 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`07:58.9` وَالْآنَ، إِلَى الْمَزَايَا بِالتَّفْصِيلِ، كَمَا تَعْمَلُ فِعْلًا فِي الْمِنَصَّةِ.</div> |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `features`: as demo, a little more movement; whoosh |

### 23. `c5-catalogue` — 08:04.2–08:32.4 (28.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`08:04.6` قَلْبُ الْمِنَصَّةِ هُوَ دَلِيلُ الْمَنَاهِجِ: اثْنَا عَشَرَ صَفًّا، وَخَمْسَةُ مَسَارَاتٍ، وَ231 مَادَّةً دِرَاسِيَّةً، تَضُمُّ أَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.<br>`08:17.3` مِنْ مَدَارِسِ الْوِزَارَةِ، إِلَى الْبَكَالُورِيَا الْمِصْرِيَّةِ الْجَدِيدَةِ، وَالثَّانَوِيَّةِ الْعَامَّةِ، وَالْبَرَامِجِ الدَّوْلِيَّةِ.<br>`08:25.5` يَخْتَارُ الْفَرِيقُ الصُّفُوفَ، ثُمَّ يُحَدِّدُ الْكُتُبَ بِنَقْرَةٍ، وَيُحْفَظُ كُلُّ اخْتِيَارٍ تِلْقَائِيًّا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "filters" (desktop, steps 0–5) → "pick-books" (desktop, steps 4–10). Caption "دليل المناهج · Curriculum catalogue" + متاح الآن · Available now. Figures overlay: 12 صفًّا · 5 مسارات · 231 مادة دراسية · 1,038 كتابًا ومرجعًا. |
| Screen recording | **filters**: start, click (bakaloria), click (grade 10), click (international), type (search), scroll (results)<br>**pick-books**: click (book), click (book), click (book), click (book), click (book), state (saved), scroll (scroll) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | دليل المناهج · Curriculum catalogue<br>متاح الآن · Available now<br>12 صفًّا · 5 مسارات · 231 مادة دراسية · 1,038 كتابًا ومرجعًا<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `features`: as demo, a little more movement; 9 soft click(s) |

### 24. `c5-verified` — 08:32.4–08:46.3 (13.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`08:32.7` وَيُسَجِّلُ فَرِيقُ الْمِنَصَّةِ مُرَاجَعَةَ كُلِّ مَادَّةٍ وَمَصْدَرَهَا، فَتَظْهَرُ لِلْمَدَارِسِ عَلَامَةُ التَّحَقُّقِ إِلَى جَانِبِ الْمَادَّةِ.<br>`08:42.0` هَكَذَا يَعْرِفُ الْجَمِيعُ مَا رُوجِعَ، وَمِنْ أَيِّ مَصْدَرٍ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "verify-subject" (desktop, steps 1–6) → "picker-verified" (desktop, steps 0–3). Caption "علامات التحقق · Verification marks" + متاح الآن · Available now. |
| Screen recording | **verify-subject**: click (grade 1), click (dialog), click (verified), type (source), type (url), click (saved)<br>**picker-verified**: start, click (grade 1), scroll (to grade), click (verified details) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | علامات التحقق · Verification marks<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 8 soft click(s) |

### 25. `c5-scopes` — 08:46.3–09:04.4 (18.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`08:46.6` وَيُحْفَظُ كُلُّ اخْتِيَارٍ فِي نِطَاقِ مُحْتَوًى بِاسْمٍ وَاضِحٍ، يُشَارِكُهُ الْفَرِيقُ كُلُّهُ، وَيُمْكِنُ نَسْخُهُ لِفَرْعٍ آخَرَ.<br>`08:55.4` وَيُصَدَّرُ النِّطَاقُ نَصًّا، أَوْ جَدْوَلَ CSV، أَوْ مَلَفَّ JSON، أَوْ يُقْرَأُ مُبَاشَرَةً عَبْرَ وَاجِهَةِ API.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "duplicate" (desktop, steps 0–3) → "exports" (desktop, steps 0–1). Caption "نطاقات المحتوى والتصدير · Content scopes & exports" + متاح الآن · Available now. |
| Screen recording | **duplicate**: start, click (dialog), type (name), click (copy)<br>**exports**: start, scroll (tray) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | نطاقات المحتوى والتصدير · Content scopes & exports<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 3 soft click(s) |

### 26. `c5-compare` — 09:04.4–09:14.4 (10.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`09:04.7` وَفِي صَفْحَةِ الْمُقَارَنَةِ، يُوضَعُ نِطَاقَانِ جَنْبًا إِلَى جَنْبٍ — وَلَوْ مِنْ عَامَيْنِ دِرَاسِيَّيْنِ مُخْتَلِفَيْنِ — فَتَظْهَرُ الْفُرُوقُ وَحْدَهَا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "scopes" (desktop, steps 0–2). Caption "مقارنة النطاقات · Compare scopes" + متاح الآن · Available now. |
| Screen recording | **scopes**: start, click (compare), scroll (differences) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls; hand-placed zooms on key rows (see script). Pointer redrawn over the real frames; click ripples. |
| Text overlays | مقارنة النطاقات · Compare scopes<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 1 soft click(s) |

### 27. `c5-notes` — 09:14.4–09:29.6 (15.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`09:14.7` وَلِكُلِّ كِتَابٍ مُخْتَارٍ مُلَاحَظَةٌ، وَمَسْؤُولٌ عَنْ مُتَابَعَتِهِ، وَحَالَةٌ، وَتَارِيخُ اسْتِحْقَاقٍ.<br>`09:22.1` وَتُوَزِّعُ مُنَى الْمَهَامَّ عَلَى فَرِيقِهَا دَفْعَةً وَاحِدَةً، فَتَصِلُ كُلَّ عُضْوٍ إِشْعَارَاتٌ بِلُغَتِهِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "notes" (desktop, steps 0–11). Caption "الملاحظات والمسؤولون · Notes & assignees" + متاح الآن · Available now. |
| Screen recording | **notes**: start, click (notes page), click (dialog), type (note), click (assignee), click (status), state, click (saved), state, click (pick), click (pick) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الملاحظات والمسؤولون · Notes & assignees<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 8 soft click(s) |

### 28. `c5-assignments` — 09:29.6–09:49.4 (19.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`09:29.9` وَفِي صَفْحَةِ «مَهَامِّي»، يَرَى كُلُّ عُضْوٍ مَا عَلَيْهِ فِي كُلِّ مُؤَسَّسَاتِهِ، وَالْمُتَأَخِّرُ أَوَّلًا.<br>`09:37.3` وَتُرْسِلُ الْمِنَصَّةُ تَذْكِيرًا عِنْدَ اقْتِرَابِ الْمَوْعِدِ وَعِنْدَ تَجَاوُزِهِ، وَيَخْتَارُ كُلُّ عُضْوٍ أَنْ تَصِلَهُ رَسَائِلُ التَّكْلِيفِ فَوْرًا، أَوْ فِي مُلَخَّصٍ صَبَاحِيٍّ وَاحِدٍ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "karim-bell" (desktop, steps 0–3) → "assignments-all" (desktop, steps 0–0). Caption "مهامي والتذكيرات · My assignments & reminders" + متاح الآن · Available now. |
| Screen recording | **karim-bell**: start, click (notifications), state, click (my assignments)<br>**assignments-all**: start |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | مهامي والتذكيرات · My assignments & reminders<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 2 soft click(s) |

### 29. `c5-newyear` — 09:49.4–10:15.2 (25.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`09:49.7` وَمَعَ كُلِّ عَامٍ دِرَاسِيٍّ جَدِيدٍ، يَنْشُرُ فَرِيقُ الْمِنَصَّةِ نُسْخَةً مُحَدَّثَةً مِنَ الدَّلِيلِ، فَتَصِلُ الْمَدَارِسَ إِشْعَارَاتٌ فَوْرِيَّةٌ.<br>`09:59.6` وَبِخُطْوَةٍ وَاحِدَةٍ، يُنْقَلُ النِّطَاقُ إِلَى الْعَامِ الْجَدِيدِ، مَعَ مُرَاجَعَةٍ تُبَيِّنُ مَا تَغَيَّرَ، وَمَا حُذِفَ، وَمَا يُمْكِنُ نَقْلُهُ.<br>`10:09.3` وَتَنْتَقِلُ مَعَهُ الْمُلَاحَظَاتُ وَالْمَسْؤُولِيَّاتُ، فَلَا يَبْدَأُ الْفَرِيقُ مِنَ الصِّفْرِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "new-year" (desktop, steps 4–8) → "carry" (desktop, steps 0–5). Caption "عام دراسي جديد · A new academic year" + متاح الآن · Available now. |
| Screen recording | **new-year**: state (editor), state (sheet preview), state, click (publish dialog), click (published)<br>**carry**: start, click (notification), state, click (review), scroll (details), click (carried) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | عام دراسي جديد · A new academic year<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `features`: as demo, a little more movement; 5 soft click(s) |

### 30. `c5-students` — 10:15.2–10:42.5 (27.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`10:15.8` نَنْتَقِلُ إِلَى الْفَصْلِ. تُنْشِئُ الْمَدْرَسَةُ حِسَابَاتِ طُلَّابِهَا بِنَفْسِهَا، وَاحِدًا وَاحِدًا، أَوْ مِنْ مَلَفِّ قَائِمَةٍ.<br>`10:24.5` وَتَكْشِفُ الْمُعَايَنَةُ أَخْطَاءَ الْمَلَفِّ قَبْلَ الِاسْتِيرَادِ بِرَسَائِلَ عَرَبِيَّةٍ وَاضِحَةٍ، ثُمَّ تُعْطِي كَلِمَاتِ مُرُورٍ لِمَرَّةٍ وَاحِدَةٍ.<br>`10:34.3` لَا يَحْتَاجُ الطَّالِبُ إِلَى بَرِيدٍ إِلِكْتْرُونِيٍّ، وَلَا يُسَجِّلُ نَفْسَهُ؛ فَالْمَدْرَسَةُ هِيَ الْمَسْؤُولَةُ عَنِ الْحِسَابِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "student-add" (desktop, steps 0–6) → "student-import" (desktop, steps 0–5). Caption "حسابات الطلاب · Student accounts" + متاح الآن · Available now. Notes: "تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب". |
| Screen recording | **student-add**: start, click (dialog), type (username), type (name), click (grade), click (curriculum), state (one-time password (blurred))<br>**student-import**: start, click (dialog), state (problems), state (fixed), state (passwords (blurred)), state (students) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | حسابات الطلاب · Student accounts<br>متاح الآن · Available now<br>تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 6 soft click(s) |

### 31. `c5-classes` — 10:42.5–11:01.5 (19.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`10:42.8` ثُمَّ يُنْشَأُ الْفَصْلُ: اسْمُهُ، وَصَفُّهُ، وَمَنْهَجُهُ مِنْ نِطَاقِ الْمَدْرَسَةِ، ثُمَّ طُلَّابُهُ، وَمُعَلِّمٌ لِكُلِّ مَادَّةٍ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "class-create" (desktop, steps 0–14). Caption "الفصول والمعلمون · Classes & teachers" + متاح الآن · Available now. |
| Screen recording | **class-create**: start, click (dialog), type (name), click (grade), click (curriculum), click (class), click (choose students), click (عمر خالد), click (هنا سمير), click (آدم طارق), click (students), click (teacher dialog), click (teacher), click (subject), click (teacher added) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الفصول والمعلمون · Classes & teachers<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 14 soft click(s) |

### 32. `c5-homework` — 11:01.5–11:29.4 (27.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`11:01.8` يُكَلِّفُ الْمُعَلِّمُ طُلَّابَهُ بِوَاجِبٍ مُرْتَبِطٍ بِكُتُبِ الْمَنْهَجِ، مَعَ التَّعْلِيمَاتِ، وَالْمَوْعِدِ، وَالدَّرَجَةِ الْكَامِلَةِ.<br>`11:10.7` وَيَرَى مَنْ سَلَّمَ، وَمَنْ تَأَخَّرَ، وَمَنْ لَمْ يُسَلِّمْ، ثُمَّ يُصَحِّحُ، وَيَكْتُبُ تَعْلِيقَهُ، وَيُعِيدُ الْعَمَلَ إِلَى الطَّالِبِ.<br>`11:19.6` وَكُلُّ مَلَفٍّ يَرْفَعُهُ الطَّالِبُ يُفْحَصُ مِنَ الْفَيْرُوسَاتِ قَبْلَ أَنْ يَفْتَحَهُ أَحَدٌ، وَتُصَغَّرُ الصُّوَرُ وَتُحْذَفُ مِنْهَا بَيَانَاتُ الْمَوْقِعِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "homework-set" (desktop, steps 0–6) → "homework-mark" (desktop, steps 0–5). Caption "الواجبات والتصحيح · Homework & marking" + متاح الآن · Available now. Callout: "فحص الملفات من الفيروسات · تصغير الصور وحذف بيانات الموقع". |
| Screen recording | **homework-set**: start, click (dialog), type (title), type (instructions), click (book), type (points), click (set)<br>**homework-mark**: start, click (roster), click (work), type (mark), type (feedback), click (returned) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الواجبات والتصحيح · Homework & marking<br>متاح الآن · Available now<br>فحص الملفات من الفيروسات · تصغير الصور وحذف بيانات الموقع<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 11 soft click(s) |

### 33. `c5-tests` — 11:29.4–11:51.6 (22.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`11:29.7` وَلِلِاخْتِبَارَاتِ الْإِلِكْتْرُونِيَّةِ أَدَوَاتٌ كَامِلَةٌ: اخْتِيَارٌ مِنْ مُتَعَدِّدٍ، وَصَوَابٌ وَخَطَأٌ، وَإِجَابَاتٌ قَصِيرَةٌ، وَأَسْئِلَةٌ مَقَالِيَّةٌ.<br>`11:40.6` يُحَدِّدُ الْمُعَلِّمُ الْمُدَّةَ، وَعَدَدَ الْمُحَاوَلَاتِ، وَرَمْزَ بَدْءٍ يُعْلِنُهُ فِي الْقَاعَةِ. وَالْخَادِمُ هُوَ الَّذِي يَحْسُبُ الْوَقْتَ، لَا جِهَازُ الطَّالِبِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "test-create" (desktop, steps 0–18). Caption "الاختبارات الإلكترونية · Online tests" + متاح الآن · Available now. |
| Screen recording | **test-create**: start, click (dialog), type (title), type (minutes), click (start code), click (test page), click (question dialog), type (prompt), type (choice), type (choice), type (choice), click (correct), type (points), click (saved), state (short answer with spelling variants), state, scroll (questions), click (publish dialog), click (published) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الاختبارات الإلكترونية · Online tests<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 15 soft click(s) |

### 34. `c5-monitor` — 11:51.6–12:18.2 (26.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`11:51.9` وَفِي شَاشَةِ الْمُتَابَعَةِ الْمُبَاشِرَةِ، يَرَى الْمُعَلِّمُ حَالَةَ كُلِّ طَالِبٍ، وَالْوَقْتَ الْمُتَبَقِّيَ، وَعَدَدَ الْإِجَابَاتِ.<br>`12:00.3` وَيَرَى مَا لَاحَظَتْهُ الصَّفْحَةُ: مُغَادَرَتَهَا، أَوِ اللَّصْقَ فِيهَا، أَوِ انْقِطَاعَ الِاتِّصَالِ — دُونَ كَامِيرَا، وَدُونَ مِيكْرُوفُونٍ، وَدُونَ تَسْجِيلٍ لِلشَّاشَةِ.<br>`12:11.7` وَيَمْنَحُ وَقْتًا إِضَافِيًّا، أَوْ مُحَاوَلَةً أُخْرَى، أَوْ يُغْلِقُ الِاخْتِبَارَ فِي الْحَالِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "monitor" (desktop, steps 0–7). Caption "المتابعة المباشرة · Live monitoring" + متاح الآن · Available now. |
| Screen recording | **monitor**: start, state (Omar working), state (Hana started), state (both working), click (extra time dialog), state (submitted), click (close dialog), click (closed) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls; hand-placed zooms on key rows (see script). Pointer redrawn over the real frames; click ripples. |
| Text overlays | المتابعة المباشرة · Live monitoring<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 3 soft click(s) |

### 35. `c5-marking` — 12:18.2–12:34.8 (16.6 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`12:18.5` وَيُصَحَّحُ كُلُّ سُؤَالٍ آلِيًّا بِقَوَاعِدَ ثَابِتَةٍ — مَعَ قَبُولِ اخْتِلَافَاتِ الْإِمْلَاءِ الْعَرَبِيِّ — مَا عَدَا الْمَقَالِيَّ، فَيُصَحِّحُهُ الْمُعَلِّمُ.<br>`12:28.7` وَلَا يَضَعُ الذَّكَاءُ الِاصْطِنَاعِيُّ أَيَّ دَرَجَةٍ؛ فَالْقَرَارُ لِلْمُعَلِّمِ دَائِمًا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "test-results" (desktop, steps 0–5). Caption "التصحيح والنتائج · Marking & results" + متاح الآن · Available now. |
| Screen recording | **test-results**: start, click (attempt), scroll (written answer), type (mark), type (comment), click (saved) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | التصحيح والنتائج · Marking & results<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 4 soft click(s) |

### 36. `c5-gradebook` — 12:34.8–12:45.8 (11.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`12:35.1` وَتَجْتَمِعُ الدَّرَجَاتُ فِي سِجِلِّ الدَّرَجَاتِ: صَفٌّ لِكُلِّ طَالِبٍ، وَعَمُودٌ لِكُلِّ وَاجِبٍ وَاخْتِبَارٍ، مَعَ الْمُتَوَسِّطِ، وَتَنْزِيلٍ بِصِيغَةِ CSV.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "gradebook" (desktop, steps 0–0) → "class-page" (desktop, steps 0–1). Caption "سجل الدرجات · Gradebook" + متاح الآن · Available now. |
| Screen recording | **gradebook**: start<br>**class-page**: start, scroll (class) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls; hand-placed zooms on key rows (see script). Pointer redrawn over the real frames; click ripples. |
| Text overlays | سجل الدرجات · Gradebook<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 0 soft click(s) |

### 37. `c5-teacher-value` — 12:45.8–13:16.2 (30.4 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`12:46.3` فَمَاذَا يَكْسِبُ الْمُعَلِّمُ مِنْ ذَلِكَ؟ يَجِدُ وَاجِبَاتِ فَصْلِهِ وَاخْتِبَارَاتِهِ وَدَرَجَاتِهِ فِي مَكَانٍ وَاحِدٍ، مَرْبُوطَةً بِالْمَنْهَجِ الَّذِي يُدَرِّسُهُ.<br>`12:57.2` وَتَخِفُّ عَنْهُ الْمُتَابَعَةُ الْيَدَوِيَّةُ: فَالتَّسْلِيمُ وَالتَّأَخُّرُ يَظْهَرَانِ تِلْقَائِيًّا، وَالْأَسْئِلَةُ الْمَوْضُوعِيَّةُ تُصَحَّحُ وَحْدَهَا.<br>`13:06.6` وَيَبْقَى الْقَرَارُ التَّرْبَوِيُّ فِي يَدِهِ: يُرَاجِعُ، وَيُعَدِّلُ، وَيَكْتُبُ مُلَاحَظَاتِهِ، وَيُقَرِّرُ مَتَى يَرَى الطُّلَّابُ النَّتَائِجَ.</div> |
| Visual | Title "ماذا يكسب المعلم؟" (What the teacher gains); cards: الفصل كله في مكان واحد · متابعة تلقائية للتسليم · تصحيح آلي للأسئلة الموضوعية · رؤية مباشرة أثناء الاختبار · القرار الأخير للمعلم. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | ماذا يكسب المعلم؟<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `classroom`: as demo, brighter |

### 38. `c5-governance` — 13:16.2–13:37.3 (21.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`13:16.5` وَحَوْلَ ذَلِكَ كُلِّهِ، أَدَوَاتٌ لِلتَّكَامُلِ وَالْحَوْكَمَةِ: مَفَاتِيحُ API، وَإِشْعَارَاتُ Webhooks مَعَ سِجِلِّ تَسْلِيمِهَا،<br>`13:25.8` وَمُدَدُ احْتِفَاظٍ بِبَيَانَاتِ الْفُصُولِ تُحَدِّدُهَا كُلُّ مَدْرَسَةٍ، مَعَ تَنْبِيهٍ قَبْلَ أَيِّ حَذْفٍ بِأَرْبَعَةَ عَشَرَ يَوْمًا، وَسِجِلُّ تَدْقِيقٍ لِذَلِكَ كُلِّهِ.</div> |
| Visual | Montage of real screens: مفاتيح API (settings) · سجل تسليم الإشعارات (Webhooks) (settings) · مدد الاحتفاظ بالبيانات (retention) · سجل التدقيق (audit). |
| Screen recording | Stills from capture/showcase.spec.ts (see Visual). |
| Camera | Slow push-in (Ken Burns, ≤ 6 %) on each screenshot. |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `classroom`: as demo, brighter |

### 39. `c6-card` — 13:37.3–13:40.9 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; whoosh |

### 40. `c6-signin` — 13:40.9–13:52.2 (11.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`13:41.4` وَالْآنَ، لِنَنْظُرْ مِنْ جِهَةِ الطَّالِبِ.<br>`13:44.6` يَدْخُلُ عُمَرُ بِرَمْزِ مَدْرَسَتِهِ، وَاسْمِ الْمُسْتَخْدِمِ، وَكَلِمَةِ الْمُرُورِ، مِنَ الْحَاسُوبِ أَوْ مِنَ الْهَاتِفِ.</div> |
| Visual | Phone (390 × 844) on paper: "student-sign-in" (phone, steps 0–3). Caption "بوابة الطالب · Student Portal" + متاح الآن · Available now. Points: رمز المدرسة واسم المستخدم، من الحاسوب أو الهاتف. Notes: "تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب". |
| Screen recording | **student-sign-in**: start, type (username), type (password), click (today) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | بوابة الطالب · Student Portal<br>متاح الآن · Available now<br>تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 3 soft click(s) |

### 41. `c6-today` — 13:52.2–14:03.1 (10.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`13:52.5` تُفْتَحُ بَوَّابَةُ الطَّالِبِ عَلَى صَفْحَةِ «الْيَوْمِ»: مَا عَلَيْهِ إِنْجَازُهُ، وَمَا فَاتَهُ، وَمَا أُعِيدَ إِلَيْهِ مُصَحَّحًا، وَالِاخْتِبَارَاتُ الْمُتَاحَةُ الْآنَ.</div> |
| Visual | Phone (390 × 844) on paper: "student-sign-in" (phone, steps 4–4). Caption "صفحة «اليوم» · Today" + متاح الآن · Available now. Points: المطلوب، ما فاته، ما أُعيد مصحّحًا، الاختبارات المتاحة الآن. |
| Screen recording | **student-sign-in**: scroll (today) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | صفحة «اليوم» · Today<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 0 soft click(s) |

### 42. `c6-homework` — 14:03.1–14:18.9 (15.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`14:03.4` يَفْتَحُ الْوَاجِبَ، فَيَكْتُبُ إِجَابَتَهُ، أَوْ يُصَوِّرُ وَرَقَتَهُ وَيُرْفِقُهَا، ثُمَّ يُسَلِّمُ.<br>`14:10.3` وَيَسْتَطِيعُ اسْتِرْجَاعَ عَمَلِهِ لِتَعْدِيلِهِ مَا لَمْ يُصَحَّحْ، وَحِينَ يُعِيدُهُ الْمُعَلِّمُ، يَرَى دَرَجَتَهُ وَتَعْلِيقَهُ.</div> |
| Visual | Phone (390 × 844) on paper: "student-homework" (phone, steps 0–5) → "student-grades" (phone, steps 0–1). Caption "تسليم الواجب · Handing in homework" + متاح الآن · Available now. Points: إجابة مكتوبة أو صورة، مسودة قبل التسليم، الدرجة والتعليق بعد التصحيح. |
| Screen recording | **student-homework**: start, click (homework), type (answer), state (photo being checked), state (photo checked), click (handed in)<br>**student-grades**: start, scroll (returned) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | تسليم الواجب · Handing in homework<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 3 soft click(s) |

### 43. `c6-test` — 14:18.9–14:41.1 (22.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`14:19.2` وَفِي الِاخْتِبَارِ، يُدْخِلُ رَمْزَ الْبَدْءِ، فَيَبْدَأُ الْعَدُّ التَّنَازُلِيُّ، وَتُحْفَظُ كُلُّ إِجَابَةٍ لَحْظَةَ كِتَابَتِهَا.<br>`14:27.2` وَإِنْ ضَعُفَ الِاتِّصَالُ، تُعِيدُ الصَّفْحَةُ الْمُحَاوَلَةَ تِلْقَائِيًّا، وَتُخْبِرُهُ بِمَا لَمْ يُحْفَظْ بَعْدُ.<br>`14:34.6` وَتُوَضِّحُ لَهُ الصَّفْحَةُ بِصَرَاحَةٍ مَا يَسْتَطِيعُ الْمُعَلِّمُ أَنْ يَرَاهُ فِي أَثْنَاءِ الِاخْتِبَارِ.</div> |
| Visual | Phone (390 × 844) on paper: "student-test" (phone, steps 0–11). Caption "أداء الاختبار · Taking a test" + متاح الآن · Available now. Points: رمز البدء، حفظ تلقائي لكل إجابة، إعادة المحاولة عند ضعف الاتصال، يعرف ما يراه المعلم. |
| Screen recording | **student-test**: start, click (start page), type (code), click (confirm), click (started), click (choice), type (short), type (essay), state (saved), scroll (to submit), click (submit dialog), click (submitted) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | أداء الاختبار · Taking a test<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 9 soft click(s) |

### 44. `c6-result` — 14:41.1–14:50.2 (9.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`14:41.4` بَعْدَ التَّسْلِيمِ، تَظْهَرُ النَّتِيجَةُ فِي الْوَقْتِ الَّذِي يُحَدِّدُهُ الْمُعَلِّمُ، مَعَ الْإِجَابَاتِ الصَّحِيحَةِ إِنْ سَمَحَ بِعَرْضِهَا.</div> |
| Visual | Phone (390 × 844) on paper: "student-result" (phone, steps 0–2). Caption "النتيجة والمراجعة · Result & review" + متاح الآن · Available now. |
| Screen recording | **student-result**: start, click (review), scroll (answers) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | النتيجة والمراجعة · Result & review<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 1 soft click(s) |

### 45. `c6-grades` — 14:50.2–15:09.9 (19.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`14:50.5` وَفِي «دَرَجَاتِي» يَرَى عُمَرُ دَرَجَاتِهِ فِي كُلِّ مَادَّةٍ، وَفِي «كُتُبِي» يَرَى مَنْهَجَهُ كَمَا اخْتَارَتْهُ مَدْرَسَتُهُ.<br>`14:58.5` بَوَّابَةٌ وَاضِحَةٌ، بِالْعَرَبِيَّةِ أَوِ الْإِنْجِلِيزِيَّةِ، صُمِّمَتْ لِتَكُونَ مُتَاحَةً لِلْجَمِيعِ، وَتَجْمَعُ لِلطَّالِبِ يَوْمَهُ الدِّرَاسِيَّ فِي مَكَانٍ وَاحِدٍ.</div> |
| Visual | Phone (390 × 844) on paper: "student-grades" (phone, steps 2–7). Caption "درجاتي وكتبي · My grades & My books" + متاح الآن · Available now. |
| Screen recording | **student-grades**: state, click (grades), click (books), scroll (books), state, click (english) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | درجاتي وكتبي · My grades & My books<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 3 soft click(s) |

### 46. `c6-student-value` — 15:09.9–15:39.0 (29.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`15:10.4` وَمَاذَا يَكْسِبُ الطَّالِبُ؟ مَكَانًا وَاحِدًا لِيَوْمِهِ الدِّرَاسِيِّ، يَعْرِفُ فِيهِ الْمَطْلُوبَ وَالْمَوَاعِيدَ، دُونَ أَنْ يَبْحَثَ عَنْهَا فِي رَسَائِلَ مُتَفَرِّقَةٍ.<br>`15:21.3` وَتَجْرِبَةً عَادِلَةً فِي الِاخْتِبَارِ: وَقْتٌ يَحْسُبُهُ الْخَادِمُ لِلْجَمِيعِ بِالتَّسَاوِي، وَإِجَابَاتٌ تُحْفَظُ أَوَّلًا بِأَوَّلٍ، وَوُضُوحٌ فِيمَا يَرَاهُ الْمُعَلِّمُ.<br>`15:32.9` وَكُلُّ ذَلِكَ بِلُغَتِهِ، وَمِنْ هَاتِفِهِ، وَبِحِسَابٍ تُدِيرُهُ مَدْرَسَتُهُ.</div> |
| Visual | Title "ماذا يكسب الطالب؟" (What the student gains); cards: يومه الدراسي في مكان واحد · وقت عادل يحسبه الخادم · حفظ تلقائي للإجابات · وضوح فيما يراه المعلم · بلغته ومن هاتفه. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | ماذا يكسب الطالب؟<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells |

### 47. `c6-ai-status` — 15:39.0–16:02.8 (23.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`15:39.6` وَمَاذَا عَنِ الذَّكَاءِ الِاصْطِنَاعِيِّ؟ نُرِيدُ أَنْ نَكُونَ دَقِيقِينَ هُنَا.<br>`15:45.0` الْمِنَصَّةُ الْيَوْمَ لَا تَتَضَمَّنُ أَيَّ مِيزَةِ ذَكَاءٍ اصْطِنَاعِيٍّ، وَتَكَامُلُهَا مَعَ الْمُسَاعِدِ التَّعْلِيمِيِّ Wise EduAgent لَمْ يُنَفَّذْ بَعْدُ.<br>`15:55.3` فَمَا زَالَ فَحْصُ تَطْبِيقِ Wise، وَاخْتِيَارُ مُزَوِّدِ الذَّكَاءِ الِاصْطِنَاعِيِّ، خُطْوَتَيْنِ قَادِمَتَيْنِ.</div> |
| Visual | Status board "الذكاء الاصطناعي: أين نقف اليوم؟": ميزات ذكاء اصطناعي داخل المنصة اليوم → لا يوجد; التكامل مع Wise EduAgent → لم يُنفَّذ بعد; فحص تطبيق Wise → بانتظار الوصول; اختيار مزوّد الذكاء الاصطناعي → لم يُحسم. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `ai`: ethereal: bells forward, no pulse |

### 48. `c6-ai-vision` — 16:02.8–16:47.9 (45.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`16:03.4` مَا نَعْرِضُهُ الْآنَ تَصَوُّرٌ مُسْتَقْبَلِيٌّ، لَا مِيزَةٌ جَاهِزَةٌ لِلْبَيْعِ.<br>`16:09.4` مُسَاعِدٌ تَعْلِيمِيٌّ دَاخِلَ بَوَّابَةِ الطَّالِبِ نَفْسِهَا، وَبِالْحِسَابِ نَفْسِهِ، يَعْرِفُ الْمَنْهَجَ الَّذِي اخْتَارَتْهُ الْمَدْرَسَةُ.<br>`16:18.3` قَدْ يُسَاعِدُ الطَّالِبَ عَلَى فَهْمِ دَرْسٍ، وَتَنْظِيمِ مُذَاكَرَتِهِ، وَالتَّدَرُّبِ عَلَى الْأَسْئِلَةِ، وَيُسَاعِدُ الْمُعَلِّمَ فِي الْإِعْدَادِ.<br>`16:27.3` وَقَدْ حُدِّدَتْ ضَوَابِطُهُ مُسْبَقًا: كُلُّ إِجَابَةٍ تُوسَمُ بِأَنَّهَا مُوَلَّدَةٌ آلِيًّا، وَلَا يُغَيِّرُ أَيَّ سِجِلٍّ رَسْمِيٍّ أَوْ دَرَجَةٍ، وَيَخْضَعُ لِحُدُودِ اسْتِخْدَامٍ ضِمْنَ الِاشْتِرَاكِ نَفْسِهِ.<br>`16:41.1` فَالذَّكَاءُ الِاصْطِنَاعِيُّ هُنَا لِدَعْمِ الْمُعَلِّمِ وَالطَّالِبِ، لَا لِيَحُلَّ مَحَلَّ الْمُعَلِّمِ.</div> |
| Visual | Labelled concept (dashed lines throughout), banner "تصوّر مستقبلي — ليس ميزة متاحة للبيع · Future vision — not a feature for sale": inputs (منهج المدرسة، بوابة الطالب، الحساب نفسه) → assistant → uses (فهم الدرس، تنظيم المذاكرة، التدرّب على الأسئلة، مساعدة المعلم في الإعداد); rules: كل إجابة موسومة بأنها مولّدة آليًا، لا يغيّر أي سجل رسمي أو درجة، حدود استخدام ضمن الاشتراك، المعلم صاحب القرار. No product screen is imitated. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | تصوّر مستقبلي — ليس ميزة متاحة للبيع<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `ai`: ethereal: bells forward, no pulse |

### 49. `c6-ai-ready` — 16:47.9–16:59.2 (11.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`16:48.3` وَالْأَسَاسُ اللَّازِمُ لَهُ جَاهِزٌ الْيَوْمَ: هُوِيَّةُ الطَّالِبِ، وَسِيَاقُ الْمَنْهَجِ، وَالِاشْتِرَاكَاتُ، وَعَدَّادَاتُ الِاسْتِخْدَامِ، وَسِجِلُّ التَّدْقِيقِ.</div> |
| Visual | Title "الأساس جاهز اليوم" (The foundation is ready today) with status متاح الآن · Available now; cards: هوية الطالب · سياق المنهج · الاشتراكات · عدّادات الاستخدام · سجل التدقيق. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | متاح الآن · Available now<br>الأساس جاهز اليوم<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `ai`: ethereal: bells forward, no pulse |

### 50. `c7-card` — 16:59.2–17:02.8 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward; whoosh |

### 51. `c7-plans` — 17:02.8–17:51.5 (48.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`17:03.3` تَعْمَلُ الْمِنَصَّةُ بِنَمُوذَجِ اشْتِرَاكٍ مُؤَسَّسِيٍّ: خُطَّةٌ مَجَّانِيَّةٌ، وَخُطَطٌ مَدْفُوعَةٌ، وَخُطَّةٌ لِلْمُؤَسَّسَاتِ الْكُبْرَى بِعَقْدٍ خَاصٍّ.<br>`17:13.9` وَالْأَسْعَارُ الظَّاهِرَةُ مُقْتَرَحَاتٌ لِلْإِطْلَاقِ، قَابِلَةٌ لِلْمُرَاجَعَةِ.<br>`17:19.4` حُدُودُ كُلِّ خُطَّةٍ تُطَبَّقُ عَلَى الْخَادِمِ: عَدَدُ الْأَعْضَاءِ، وَالنِّطَاقَاتُ، وَالتَّصْدِيرُ، وَطَلَبَاتُ وَاجِهَةِ API، وَالْمَزَايَا الْمُتَاحَةُ.<br>`17:30.2` وَيُدِيرُ النِّظَامُ دَوْرَةَ الِاشْتِرَاكِ كَامِلَةً: التَّجْرِبَةَ، وَالتَّرْقِيَةَ، وَالتَّجْدِيدَ، وَالْفَوَاتِيرَ، وَفَتْرَةَ سَمَاحٍ عِنْدَ تَأَخُّرِ الدَّفْعِ.<br>`17:40.5` أَمَّا الرَّبْطُ بِبَوَّابَةِ الدَّفْعِ Paymob، فَجَاهِزٌ وَمُخْتَبَرٌ عَلَى مُحَاكَاةٍ لِوَاجِهَتِهَا، وَيَنْتَظِرُ مَفَاتِيحَ حِسَابِ التَّاجِرِ لِيَعْمَلَ فِعْلِيًّا.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "pricing" (desktop, steps 0–1) → "billing" (desktop, steps 0–1) → "billing" (desktop, frame subscribed). Caption "الاشتراكات والفوترة · Subscriptions & billing" + متاح الآن · Available now. Notes: "أسعار مقترحة للإطلاق — قابلة للمراجعة", "الدفع عبر Paymob: قيد الاستكمال". |
| Screen recording | **pricing**: start, scroll<br>**billing**: start, scroll (plans)<br>**billing**: single frame subscribed |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الاشتراكات والفوترة · Subscriptions & billing<br>متاح الآن · Available now<br>أسعار مقترحة للإطلاق — قابلة للمراجعة<br>الدفع عبر Paymob: قيد الاستكمال<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward; 0 soft click(s) |

### 52. `c7-isolation` — 17:51.5–18:21.2 (29.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`17:52.0` تِقْنِيًّا، تَعْمَلُ كُلُّ الْمُؤَسَّسَاتِ عَلَى نِظَامٍ وَاحِدٍ، لَكِنَّ بَيَانَاتِ كُلٍّ مِنْهَا مَعْزُولَةٌ بِسِيَاسَاتِ أَمَانٍ دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ.<br>`18:03.1` فَقَاعِدَةُ الْبَيَانَاتِ تَرْفُضُ أَنْ تُظْهِرَ بَيَانَاتِ مُؤَسَّسَةٍ لِأُخْرَى، حَتَّى لَوْ أَخْطَأَ جُزْءٌ مِنَ الْكُودِ.<br>`18:11.2` وَتُشَفَّرُ الْأَسْرَارُ الْمَحْفُوظَةُ، مَعَ أَدَوَاتٍ لِتَدْوِيرِ مَفَاتِيحِ التَّشْفِيرِ، وَحُدُودٍ لِلطَّلَبَاتِ تَحْمِي مِنْ إِسَاءَةِ الِاسْتِخْدَامِ.</div> |
| Visual | Diagram: tenants → one application → database with forced row-level security; a "bug" path is refused by the database; then encryption of secrets, key rotation and request limits. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward |

### 53. `c7-deploy` — 18:21.2–18:52.4 (31.2 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`18:21.7` وَالْمِنَصَّةُ مَبْنِيَّةٌ فِي حَاوِيَاتٍ، بِنُسْخَتَيْنِ مِنَ التَّطْبِيقِ خَلْفَ مُوَازِنِ أَحْمَالٍ، فَيُمْكِنُ تَحْدِيثُهَا دُونَ إِيقَافِ الْخِدْمَةِ.<br>`18:31.4` وَفِي اخْتِبَارِ حِمْلٍ عَلَى بِيئَةٍ مَحَلِّيَّةٍ، أَدَّى ثَلَاثُمِئَةِ طَالِبٍ اخْتِبَارًا وَاحِدًا مِنْ شَبَكَةٍ وَاحِدَةٍ، دُونَ رَفْضِ أَيِّ طَلَبٍ.<br>`18:41.6` وَتُؤْخَذُ نُسَخٌ احْتِيَاطِيَّةٌ مُشَفَّرَةٌ، وَقَدْ جُرِّبَتِ اسْتِعَادَتُهَا، بِمَا فِي ذَلِكَ إِعَادَةُ بِنَاءِ خَادِمٍ مَفْقُودٍ مِنْ نُسْخَةٍ خَارِجِيَّةٍ.</div> |
| Visual | Diagram: users → Caddy (TLS, load balancer) → app ×2 → PostgreSQL; worker; encrypted backups → off-site copy. Figure: "300 — طالب في اختبار واحد من شبكة واحدة · لا طلب مرفوض" with the note "اختبار حِمل على بيئة محلية بنسختين من التطبيق — ليس على خوادم الإنتاج". |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward |

### 54. `c7-central` — 18:52.4–19:13.1 (20.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`18:52.9` وَلِأَنَّهَا SaaS، يَصِلُ كُلُّ تَحْدِيثٍ لِلدَّلِيلِ أَوْ لِلنِّظَامِ إِلَى كُلِّ الْمُؤَسَّسَاتِ مَعًا، دُونَ تَثْبِيتٍ عِنْدَ أَحَدٍ.<br>`19:02.5` وَحِينَ يُضَافُ الذَّكَاءُ الِاصْطِنَاعِيُّ، يُمْكِنُ تَقْدِيمُهُ وَحْدَةً إِضَافِيَّةً ضِمْنَ الِاشْتِرَاكَاتِ الْحَالِيَّةِ، بِلَا نِظَامِ فَوْتَرَةٍ ثَانٍ.</div> |
| Visual | The product mark at the centre of 7 institutions; update waves reach all of them; a dashed "وحدة الذكاء الاصطناعي (مستقبلًا)" module joins on line 2. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward |

### 55. `c7-value` — 19:13.1–19:41.4 (28.3 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`19:13.6` وَمَاذَا تَكْسِبُ الْمُؤَسَّسَةُ؟ قَرَارًا مَنْهَجِيًّا مُوَثَّقًا يَتَشَارَكُهُ الْفَرِيقُ، وَرُؤْيَةً مُوَحَّدَةً لِلْفُصُولِ وَالْوَاجِبَاتِ وَالدَّرَجَاتِ.<br>`19:23.7` وَحَوْكَمَةً وَاضِحَةً: أَدْوَارٌ، وَسِجِلُّ تَدْقِيقٍ، وَمُدَدُ احْتِفَاظٍ تُقَرِّرُهَا بِنَفْسِهَا، وَخُصُوصِيَّةٌ لَا يَتَخَطَّاهَا حَتَّى فَرِيقُ الْمِنَصَّةِ.<br>`19:34.8` وَمِنَصَّةً تَنْمُو مَعَهَا، دُونَ خَوَادِمَ تُدِيرُهَا، وَلَا بَرَامِجَ تُثَبِّتُهَا.</div> |
| Visual | Title "ماذا تكسب المؤسسة؟" (What the institution gains); cards: قرار منهجي موثّق ومشترك · رؤية موحّدة للفصول والدرجات · حوكمة: أدوار وسجل تدقيق · خصوصية ومدد احتفاظ تقرّرها · بلا خوادم تديرها ولا برامج تثبّتها. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | ماذا تكسب المؤسسة؟<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward |

### 56. `c8-card` — 19:41.4–19:45.0 (3.6 s)

| | |
| --- | --- |
| Narration | — (music only) |
| Visual | Chapter card: outlined chapter number, red bar, Arabic title, "CHAPTER n · English title", chapter dots. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card; whoosh |

### 57. `c8-ready` — 19:45.0–20:11.9 (26.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`19:45.5` أَيْنَ نَقِفُ الْيَوْمَ؟ الْمِنَصَّةُ مُكْتَمِلَةٌ وَظِيفِيًّا، وَمُخْتَبَرَةٌ مَحَلِّيًّا بِأَكْثَرَ مِنْ ثَلَاثِمِئَةِ اخْتِبَارٍ آلِيٍّ، وَبِرِحْلَاتِ اسْتِخْدَامٍ كَامِلَةٍ فِي ثَلَاثَةِ مُتَصَفِّحَاتٍ.<br>`19:58.8` وَقَبْلَ الْإِطْلَاقِ التِّجَارِيِّ خُطُوَاتٌ وَاضِحَةٌ: تَفْعِيلُ الدَّفْعِ، وَبِيئَةُ الِاسْتِضَافَةِ، وَالْمُرَاجَعَةُ الْقَانُونِيَّةُ لِبَيَانَاتِ الطُّلَّابِ، وَالْمُرَاجَعَةُ التَّحْرِيرِيَّةُ لِلدَّلِيلِ.</div> |
| Visual | Three verified figures (311 اختبار وحدة وتكامل · 24 رحلة استخدام × 3 متصفحات · 149 شاشة في فحص سهولة الوصول), then "قبل الإطلاق التجاري": تفعيل الدفع، بيئة الاستضافة، المراجعة القانونية لبيانات الطلاب، المراجعة التحريرية للدليل. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card |

### 58. `c8-roadmap` — 20:11.9–20:36.6 (24.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`20:12.4` وَالْمَرْحَلَةُ التَّالِيَةُ تَبْدَأُ بِتَشْغِيلٍ تَجْرِيبِيٍّ مَعَ عَدَدٍ مِنَ الْمُؤَسَّسَاتِ الشَّرِيكَةِ، تُحَدِّدُ مُلَاحَظَاتُهَا الْأَوْلَوِيَّاتِ.<br>`20:21.9` وَعَلَى خَارِطَةِ الطَّرِيقِ: الْمُسَاعِدُ التَّعْلِيمِيُّ الذَّكِيُّ، وَحِسَابَاتُ أَوْلِيَاءِ الْأُمُورِ، وَبَنْكُ الْأَسْئِلَةِ، وَتَقَارِيرُ الْفُصُولِ الدِّرَاسِيَّةِ، وَالدُّخُولُ الْمُوَحَّدُ، وَمَنَاهِجُ دُوَلٍ عَرَبِيَّةٍ أُخْرَى.</div> |
| Visual | Timeline right to left: اليوم [now]: منصة مكتملة وظيفيًا، مختبرة محليًا → الخطوة التالية [dev]: تشغيل تجريبي مع مؤسسات شريكة → خارطة الطريق [later]: المساعد التعليمي الذكي، حسابات أولياء الأمور، بنك الأسئلة، تقارير الفصول الدراسية، الدخول الموحّد (SSO)، مناهج دول عربية أخرى. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card |

### 59. `c8-invite` — 20:36.6–21:11.1 (34.5 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`20:37.2` لِذَلِكَ نَدْعُو الْمَدَارِسَ وَمَجْمُوعَاتِ الْمَدَارِسِ، وَشَرِكَاتِ التَّعْلِيمِ وَالنَّشْرِ، إِلَى الِانْضِمَامِ لِلْبَرْنَامَجِ التَّجْرِيبِيِّ، وَبِنَاءِ الْمَرْحَلَةِ الْقَادِمَةِ مَعَنَا.<br>`20:48.4` وَنُرَحِّبُ بِالشُّرَكَاءِ وَالْمُسْتَثْمِرِينَ الَّذِينَ يُؤْمِنُونَ بِتَعْلِيمٍ أَكْثَرَ تَرَابُطًا وَوُضُوحًا.<br>`20:55.6` نِطَاقُ الْمَنَاهِجِ: مَنْهَجٌ وَاضِحٌ، وَفَصْلٌ مُتَّصِلٌ، وَمُؤَسَّسَةٌ تَرَى الصُّورَةَ كَامِلَةً.<br>`21:02.6` تَوَاصَلُوا مَعَنَا لِعَرْضٍ مُبَاشِرٍ، أَوْ لِلِانْضِمَامِ إِلَى التَّجْرِبَةِ.</div> |
| Visual | "ندعوكم إلى البرنامج التجريبي" with audience chips; then the logo, "نطاق المناهج / Curriculum Scope", "منهجٌ واضح · فصلٌ متصل · مؤسسةٌ ترى الصورة كاملة", and the call to action "تواصلوا معنا لعرض مباشر أو للانضمام إلى التجربة"; fade to black. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card |

## Curriculum Scope — in three minutes

### 1. `m-open` — 00:00.0–00:13.4 (13.4 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:01.6` مَعَ كُلِّ عَامٍ دِرَاسِيٍّ، تَتَوَزَّعُ قَرَارَاتُ الْمَنْهَجِ وَمُتَابَعَةُ الطُّلَّابِ بَيْنَ أَدَوَاتٍ مُتَفَرِّقَةٍ.<br>`00:09.5` أَيُّ الْكُتُبِ؟ مَنْ يُتَابِعُ؟ وَأَيْنَ الدَّرَجَاتُ؟</div> |
| Visual | Dark stage. Glass "fragments" (جدول بيانات، مجموعة محادثة، قائمة مطبوعة، بريد إلكتروني، تطبيق منفصل، مجلد مشترك) drift; the academic year 2026 / 2027 fades in, then the narration's questions appear in large type (أيُّ الكتب؟ · مَن يتابع؟ · أين الدرجات؟). |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | from black |
| Music & sound | cue `open`: sparse, dark pads and bass; bells |

### 2. `m-reveal` — 00:13.4–00:22.2 (8.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:15.0` نِطَاقُ الْمَنَاهِجِ: مِنَصَّةٌ وَاحِدَةٌ تَرْبِطُ الْمَنْهَجَ، وَالْفَصْلَ، وَالْمُؤَسَّسَةَ.</div> |
| Visual | Product reveal: the logo mark (public/favicon.svg) builds — square, red margin, three lines — then "نطاق المناهج" / "Curriculum Scope" and the tagline "منصة تعليمية سحابية للمدارس والمؤسسات التعليمية". |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `reveal`: swell to full pad, arpeggio enters; riser + impact |

### 3. `m-layers` — 00:22.2–00:40.2 (18.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:22.6` ثَلَاثُ طَبَقَاتٍ مُتَرَابِطَةٍ:<br>`00:25.0` دَلِيلٌ مُحَدَّثٌ لِلْمَنَاهِجِ الْمِصْرِيَّةِ، تُقَرِّرُ فِيهِ الْمَدْرَسَةُ مَا تُغَطِّيهِ،<br>`00:30.8` وَفُصُولٌ وَوَاجِبَاتٌ وَاخْتِبَارَاتٌ مَبْنِيَّةٌ عَلَيْهِ،<br>`00:35.0` وَإِدَارَةٌ مُؤَسَّسِيَّةٌ آمِنَةٌ، بِالْعَرَبِيَّةِ وَالْإِنْجِلِيزِيَّةِ.</div> |
| Visual | Three bands appear with the narration: المنهج (دليل المناهج، نطاقات المحتوى، المسؤولون والمواعيد) / الفصل (الواجبات، الاختبارات الإلكترونية، سجل الدرجات، بوابة الطالب) / المؤسسة (الأدوار، الاشتراكات، سجل التدقيق، العربية والإنجليزية). |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `vision`: warm pads, slow arpeggio |

### 4. `m-who` — 00:40.2–00:53.9 (13.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:40.6` صُمِّمَتْ لِلْمَدَارِسِ الْخَاصَّةِ وَالدَّوْلِيَّةِ وَمَجْمُوعَاتِهَا، وَلِشَرِكَاتِ التِّكْنُولُوجْيَا التَّعْلِيمِيَّةِ وَالنَّاشِرِينَ، وَلِمَرَاكِزِ الدُّرُوسِ.<br>`00:50.6` أَمَّا الْجَامِعَاتُ، فَتَوَسُّعٌ لَاحِقٌ.</div> |
| Visual | Four segment cards with need and offer; status badges (available now / later expansion). The segment being described is highlighted: المدارس الخاصة والدولية ومجموعات المدارس [now]; شركات التكنولوجيا التعليمية وناشرو المحتوى [now]; مراكز الدروس ومستشارو المناهج [now]; الجامعات ومؤسسات التعليم العالي [later]. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `segments`: pads, arpeggio, light pulse |

### 5. `m-curriculum` — 00:53.9–01:15.0 (21.0 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`00:54.3` دَلِيلٌ يَضُمُّ اثْنَيْ عَشَرَ صَفًّا، وَ231 مَادَّةً دِرَاسِيَّةً، وَأَكْثَرَ مِنْ أَلْفِ كِتَابٍ وَمَرْجِعٍ.<br>`01:03.7` يَخْتَارُ الْفَرِيقُ الْكُتُبَ لِكُلِّ صَفٍّ وَمَسَارٍ، فَيُحْفَظُ الْقَرَارُ نِطَاقًا مُشْتَرَكًا،<br>`01:09.8` يُصَدَّرُ، وَيُقَارَنُ، وَيُنْقَلُ إِلَى الْعَامِ التَّالِي بِخُطْوَةٍ وَاحِدَةٍ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "pick-books" (desktop, steps 3–9) → "carry" (desktop, steps 3–3). Caption "دليل المناهج ونطاقات المحتوى · Curriculum catalogue & scopes" + متاح الآن · Available now. Figures overlay: 12 صفًّا · 5 مسارات · 231 مادة دراسية · 1,038 كتابًا ومرجعًا. |
| Screen recording | **pick-books**: click (grade 3), click (book), click (book), click (book), click (book), click (book), state (saved)<br>**carry**: click (review) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | دليل المناهج ونطاقات المحتوى · Curriculum catalogue & scopes<br>متاح الآن · Available now<br>12 صفًّا · 5 مسارات · 231 مادة دراسية · 1,038 كتابًا ومرجعًا<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 7 soft click(s) |

### 6. `m-notes` — 01:15.0–01:24.9 (9.9 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:15.3` وَلِكُلِّ كِتَابٍ مَسْؤُولٌ، وَمَوْعِدٌ، وَتَذْكِيرٌ، فَلَا يَضِيعُ شَيْءٌ بَيْنَ الرَّسَائِلِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "notes" (desktop, steps 2–7) → "assignments-all" (desktop, steps 0–0). Caption "المسؤولون والمواعيد · Assignees & due dates" + متاح الآن · Available now. |
| Screen recording | **notes**: click (dialog), type (note), click (assignee), click (status), state, click (saved)<br>**assignments-all**: start |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | المسؤولون والمواعيد · Assignees & due dates<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `demo`: light pulse, 16th-note arpeggio, pads under; 5 soft click(s) |

### 7. `m-homework` — 01:24.9–01:36.0 (11.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:25.2` وَيُكَلِّفُ الْمُعَلِّمُ طُلَّابَهُ بِوَاجِبَاتٍ مَرْبُوطَةٍ بِالْمَنْهَجِ،<br>`01:30.0` ثُمَّ يُصَحِّحُهَا، وَيُعِيدُهَا بِتَعْلِيقِهِ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "homework-set" (desktop, steps 2–4) → "homework-mark" (desktop, steps 2–5). Caption "الواجبات والتصحيح · Homework & marking" + متاح الآن · Available now. |
| Screen recording | **homework-set**: type (title), type (instructions), click (book)<br>**homework-mark**: click (work), type (mark), type (feedback), click (returned) |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls. Pointer redrawn over the real frames; click ripples. |
| Text overlays | الواجبات والتصحيح · Homework & marking<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 7 soft click(s) |

### 8. `m-tests` — 01:36.0–01:49.7 (13.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:36.3` وَيُدِيرُ اخْتِبَارَاتٍ إِلِكْتْرُونِيَّةً بِوَقْتٍ يَحْسُبُهُ الْخَادِمُ، وَمُتَابَعَةٍ مُبَاشِرَةٍ، وَتَصْحِيحٍ آلِيٍّ يَبْقَى فِيهِ الْقَرَارُ لَهُ.<br>`01:46.3` ثُمَّ تَجْتَمِعُ الدَّرَجَاتُ فِي سِجِلٍّ وَاحِدٍ.</div> |
| Visual | Browser window (1440 × 810 recording) on paper: "monitor" (desktop, steps 3–5) → "gradebook" (desktop, steps 0–0). Caption "الاختبارات والمتابعة المباشرة · Online tests & live monitoring" + متاح الآن · Available now. |
| Screen recording | **monitor**: state (both working), click (extra time dialog), state (submitted)<br>**gradebook**: start |
| Camera | Overview at 1.16× (the app column), smooth push-ins (≤ 1.6×) to each click or field, back to the overview for page changes and scrolls; hand-placed zooms on key rows (see script). Pointer redrawn over the real frames; click ripples. |
| Text overlays | الاختبارات والمتابعة المباشرة · Online tests & live monitoring<br>متاح الآن · Available now<br>chapter strip |
| Transition in | cross-fade 0.4 s |
| Music & sound | cue `classroom`: as demo, brighter; 1 soft click(s) |

### 9. `m-student` — 01:49.7–02:00.5 (10.8 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`01:50.0` وَيَجِدُ الطَّالِبُ يَوْمَهُ الدِّرَاسِيَّ عَلَى هَاتِفِهِ: وَاجِبَاتِهِ، وَاخْتِبَارَاتِهِ،<br>`01:55.7` وَدَرَجَاتِهِ، وَكُتُبَهُ، بِحِسَابٍ تُدِيرُهُ مَدْرَسَتُهُ.</div> |
| Visual | Phone (390 × 844) on paper: "student-test" (phone, steps 4–8) → "student-grades" (phone, steps 2–3). Caption "بوابة الطالب · Student Portal" + متاح الآن · Available now. Points: الواجبات والاختبارات، الدرجات والكتب، بلغته ومن هاتفه. Notes: "تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب". |
| Screen recording | **student-test**: click (started), click (choice), type (short), type (essay), state (saved)<br>**student-grades**: state, click (grades) |
| Camera | Static phone, slight rise on entry; taps shown as soft circles (no zoom: right-aligned Arabic pages). |
| Text overlays | بوابة الطالب · Student Portal<br>متاح الآن · Available now<br>تُفعَّل لكل مدرسة بعد المراجعة القانونية لبيانات الطلاب<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells; 5 soft click(s) |

### 10. `m-value` — 02:00.5–02:11.0 (10.5 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:00.9` فَتَخِفُّ عَنِ الْمُعَلِّمِ الْمُتَابَعَةُ الْيَدَوِيَّةُ، وَيَجِدُ الطَّالِبُ كُلَّ مَا يَخُصُّهُ فِي مَكَانٍ وَاحِدٍ، وَتَرَى الْمُؤَسَّسَةُ الصُّورَةَ كَامِلَةً.</div> |
| Visual | Title "قيمة لكل طرف" (Value for everyone); cards: المعلم: متابعة يدوية أقل، والقرار له · الطالب: يومه الدراسي في مكان واحد · المؤسسة: قرار موثّق ورؤية موحّدة. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | قيمة لكل طرف<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `student`: higher arpeggio, bells |

### 11. `m-trust` — 02:11.0–02:25.7 (14.7 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:11.4` كُلُّ مُؤَسَّسَةٍ مَعْزُولَةٌ بِبَيَانَاتِهَا دَاخِلَ قَاعِدَةِ الْبَيَانَاتِ، مَعَ أَدْوَارٍ، وَتَحَقُّقٍ بِخُطْوَتَيْنِ، وَسِجِلِّ تَدْقِيقٍ،<br>`02:20.4` وَلَا يَطَّلِعُ فَرِيقُ الْمِنَصَّةِ عَلَى عَمَلِ الْمَدْرَسَةِ إِلَّا بِإِذْنِهَا.</div> |
| Visual | Diagram: tenants → one application → database with forced row-level security; a "bug" path is refused by the database; then encryption of secrets, key rotation and request limits. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `saas`: steady pulse, bass forward |

### 12. `m-ai` — 02:25.7–02:38.2 (12.5 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:26.1` أَمَّا الْمُسَاعِدُ التَّعْلِيمِيُّ الذَّكِيُّ، فَرُؤْيَةٌ مُسْتَقْبَلِيَّةٌ لَمْ تُنَفَّذْ بَعْدُ،<br>`02:31.7` وَسَيَعْمَلُ بِضَوَابِطَ وَاضِحَةٍ: لَا يُغَيِّرُ أَيَّ دَرَجَةٍ، وَالْقَرَارُ لِلْمُعَلِّمِ.</div> |
| Visual | Labelled concept (dashed lines throughout), banner "تصوّر مستقبلي — ليس ميزة متاحة للبيع · Future vision — not a feature for sale": inputs (منهج المدرسة، بوابة الطالب، الحساب نفسه) → assistant → uses (فهم الدرس، تنظيم المذاكرة، التدرّب على الأسئلة، مساعدة المعلم في الإعداد); rules: إجابات موسومة بأنها مولّدة آليًا، لا يغيّر أي درجة، حدود استخدام ضمن الاشتراك، المعلم صاحب القرار. No product screen is imitated. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | تصوّر مستقبلي — ليس ميزة متاحة للبيع<br>chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `ai`: ethereal: bells forward, no pulse |

### 13. `m-next` — 02:38.2–02:47.7 (9.5 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:38.6` الْمِنَصَّةُ مُكْتَمِلَةٌ وَظِيفِيًّا وَمُخْتَبَرَةٌ مَحَلِّيًّا، وَتَسْتَعِدُّ لِتَشْغِيلٍ تَجْرِيبِيٍّ مَعَ مُؤَسَّسَاتٍ شَرِيكَةٍ.</div> |
| Visual | Timeline right to left: اليوم [now]: منصة مكتملة وظيفيًا، مختبرة محليًا → الخطوة التالية [dev]: تشغيل تجريبي مع مؤسسات شريكة → خارطة الطريق [later]: المساعد التعليمي الذكي، حسابات أولياء الأمور، بنك الأسئلة. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | chapter strip |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card |

### 14. `m-end` — 02:47.7–03:07.8 (20.1 s)

| | |
| --- | --- |
| Narration | <div dir="rtl">`02:48.1` نَدْعُو الْمَدَارِسَ، وَشَرِكَاتِ التَّعْلِيمِ وَالنَّشْرِ، إِلَى الْبَرْنَامَجِ التَّجْرِيبِيِّ.<br>`02:54.1` نِطَاقُ الْمَنَاهِجِ: مَنْهَجٌ وَاضِحٌ، وَفَصْلٌ مُتَّصِلٌ، وَمُؤَسَّسَةٌ تَرَى الصُّورَةَ كَامِلَةً.<br>`03:01.2` تَوَاصَلُوا مَعَنَا لِعَرْضٍ مُبَاشِرٍ.</div> |
| Visual | "ندعوكم إلى البرنامج التجريبي" with audience chips; then the logo, "نطاق المناهج / Curriculum Scope", "منهجٌ واضح · فصلٌ متصل · مؤسسةٌ ترى الصورة كاملة", and the call to action "تواصلوا معنا لعرض مباشر أو للانضمام إلى التجربة"; fade to black. |
| Screen recording | — |
| Camera | Locked frame; elements animate in with the narration (fade, rise, light blur). |
| Text overlays | — |
| Transition in | cross-fade 0.6 s |
| Music & sound | cue `finale`: full: pads, arpeggio, pulse, bells; resolves and fades with the end card |
