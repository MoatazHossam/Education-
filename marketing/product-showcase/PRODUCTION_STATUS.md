# Production status

State on 2026-10-28. **The narrated cuts are finished: 20-minute in 4K and 1080p, 3-minute in 1080p, with
rule-based Arabic pronunciation.** Nothing has been published.

## Deliverables

| Deliverable | Status |
| --- | --- |
| PRODUCT_AUDIT.md, TARGET_AUDIENCE.md, VIDEO_CREATIVE_BRIEF.md | Done |
| FEATURE_COVERAGE_MATRIX.md | Done (generated): 52 capabilities, 42 available now, 5 in development, 5 future roadmap |
| STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md | Done (generated), timed to the voice |
| ARABIC_NARRATION_SCRIPT.md | Done: 20-minute (134 lines) and 3-minute (28 lines), fully diacritized. Second tashkeel review on 2026-10-27: «أَيَّ الْكُتُبِ» (fronted object), «إِحْدَى وَثَلَاثُونَ مَادَّةً» (the unit agrees with the feminine noun, both cuts), «صَفْحَةِ "الْيَوْم"» (a page name), «إِلِكْتْرُونِيّ» (four lines) |
| ENGLISH_TRANSLATION.md | Done |
| arabic.srt, arabic-plain.srt, english.srt (+ the 3-minute set) | Done, timed to the voice |
| Recordings of the product | Done: 54 recordings, 538 frames (kept out of git; `npm run capture` recreates them) |
| screenshots/, graphics/, Education_SaaS_Thumbnail.png | Done |
| Music | Done: original generated score (`music/`, rebuilt by `build.mjs audio`); not yet reviewed by ear |
| Narration | Done (generated; takes kept out of git, `node narrate.mjs` recreates them) — see below |
| Education_SaaS_Product_Showcase_3min.mp4 | Done: 3:04.9, 1920 × 1080, 37.9 MB |
| Education_SaaS_Product_Showcase_1080p.mp4 | Done: 20:41.8, 1920 × 1080, 212.3 MB |
| Education_SaaS_Product_Showcase_20min.mp4 | Done: 20:41.8, 3840 × 2160, 388.3 MB |
| Preview cuts without narration (…_PREVIEW_no-narration.mp4) | Superseded by the narrated cuts |
| VIDEO_QA_REPORT.md | Done for the three narrated files (technical, narration, subtitles, content, visual, audio) |

## The narration voice

- **The problem with the first voice was mostly its pronunciation engine.** Open Arabic voices read text through
  espeak-ng, which mispronounces fully diacritized Arabic. Compared word by word over both scripts, it drops the
  vowel after every shadda (الشَّمْسُ → "ash-shmsu", سَنُدَرِّسُ → "sanudarrsu"), reads a waw or ya that carries a
  vowel as a vowel (هِيَ → "hīa"), ignores hamzat al-wasl (بِالْمَنْهَجِ → "bi āl-manhaji"), reads ذَلِكَ and هَذَا
  with a short a, and has no pausal forms. The first takes also had to be sped up by about 40 %.
- **Now:** the text is turned into phonemes by our own rules (`video-project/audio/arabic_g2p.py`, 15 tests), and
  the phonemes go straight to the voice: every vowel, shadda, tanween and sukun as written; long vowels and
  diphthongs; the hidden alif of هٰذَا / ذٰلِكَ / لٰكِنَّ / هٰكَذَا; hamzat al-wasl; sun letters; iqlab; ta marbuta; pausal
  forms (الوقف) before every pause; stress. Checked against espeak on all 2,087 words of the scripts; every
  difference was reviewed and the rules corrected where they were wrong (hamza with sukun, a wasl alif before a
  second wasl, tanween on alif maqsura).
- **Voice:** `ar_JO-kareem-medium` (Piper, male), at the pace the script was written for (about 9 letters a second
  including pauses), with no time-stretching. Settings chosen by speech recognition (Whisper) on the hardest lines.
- **Voices ruled out:** Azure AI Speech (no key; its host is blocked in this environment), the newer Piper Arabic
  voices (CC BY-NC-SA 4.0, no commercial use), Nabra-82M (much less intelligible in the same check, 15–17 % against
  3.7 %; clips line endings; cannot tell س from ص).
- **Licence:** the voice's licence could not be confirmed (its model card refers to a training-data repository that
  states no licence). It should be confirmed, or the narration recorded by a person, before public release. A human
  narrator's takes drop in as files (`audio/narration/<cut>/<sceneId>-NN.wav`) with no other change.

## Other open points

| Point | Needed from |
| --- | --- |
| Listening review of the generated score, or a licensed track to replace it | Owner |
| Real contact details or a link for the end card ("Contact us…") | Owner |
| Wise EduAgent could not be inspected (network policy); the video shows the AI only as labelled future vision | Owner: allow the host and provide a test account, or the source export, if Wise features should appear |
| Authorization to publish, and where | Owner — the files are private until then |

## Rebuilding

See video-project/README.md. The renderer resumes an interrupted render: re-running the same command
reuses the finished parts.
