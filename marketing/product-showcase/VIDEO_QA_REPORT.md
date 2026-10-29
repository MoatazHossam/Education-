# Video QA report

Checks of the final films on 2026-10-29, rebuilt under the platform's name, Midad (مِداد).
- **Narration:** synthetic, with rule-based Arabic pronunciation (PRODUCTION_STATUS.md, "The narration voice").
- **Music:** the recorded-instrument score.
- **Pauses:** a full pause at the end of every sentence.

The cuts of 2026-10-28, which carried the working name, and the earlier review and preview cuts are superseded.

## 1. Technical checks

Measured with `video-project/lib/qa.py` (FFmpeg `blackdetect` d ≥ 0.5 s, `freezedetect` d ≥ 8 s,
`silencedetect` −50 dB for ≥ 1.5 s, `ebur128` with true peak), and a full decode with FFmpeg.

| | 20-minute, 4K | 20-minute, 1080p | 3-minute, 1080p |
| --- | --- | --- | --- |
| File | Education_SaaS_Product_Showcase_20min.mp4 | Education_SaaS_Product_Showcase_1080p.mp4 | Education_SaaS_Product_Showcase_3min.mp4 |
| Duration | 21:08.8 (1,268.8 s; see §5) | 21:08.8 (1,268.8 s) | 3:06.4 (186.4 s; target 2:50–3:10) |
| Picture | H.264 High, 3840 × 2160, 30 fps, yuv420p, 38,064 frames; rendered natively at 4K | H.264 High, 1920 × 1080, 30 fps, yuv420p, 38,064 frames | H.264 High, 1920 × 1080, 30 fps, yuv420p, 5,592 frames |
| Sound | AAC, 48 kHz, stereo | AAC, 48 kHz, stereo | AAC, 48 kHz, stereo |
| Size / bitrate | 395.6 MB / 2.49 Mb/s | 217.6 MB / 1.37 Mb/s | 38.2 MB / 1.64 Mb/s |
| Integrated loudness | −16.0 LUFS (target −16) | −16.0 LUFS | −16.0 LUFS |
| Loudness range | 3.1 LU | 3.1 LU | 3.6 LU |
| True peak | −1.6 dBTP (limit −1.5) | −1.6 dBTP | −1.8 dBTP |
| Black segments | none | none | none |
| Frozen picture (≥ 8 s) | none | none | none |
| Silences (≥ 1.5 s) | none | none | none |
| Full decode | no errors | no errors | no errors |

## 2. Narration

| Check | Result |
| --- | --- |
| Pronunciation follows the diacritized script | The voice is given phonemes, not text: `audio/arabic_g2p.py` applies the reading rules (vowels, shadda, tanween, sukun, long vowels, hidden alif, hamzat al-wasl, sun letters, iqlab, ta marbuta, pausal forms, stress); 15 rule tests pass; the rules were compared with espeak-ng on all 2,087 words of the scripts and every difference reviewed |
| Every take matches the reviewed script | Yes: the text each take was spoken from was compared with the script; the 7 lines changed in the tashkeel review were spoken again, and so were the 4 lines that say the name after the rename |
| Speech recognition (Whisper small) on the takes | 162 lines at 4.7 % character error rate when the voice was set up; the 7 new takes 5.1 % |
| Speech recognition on the finished soundtrack (voice under music and effects) | Measured on the renamed films (2026-10-29), each line cut from the final mix and scored against its spoken form (numbers in words, technical terms as pronounced). 20-minute: 4.5 % over 134 lines; 3-minute: 5.6 % over 28 lines (2026-10-28: 4.6 % and 5.1 %). The 3-minute cut's highest scores are on takes unchanged since 2026-10-28. One is the three short opening questions under the music (26.7 %), the other a long line where recognition swaps consonants («مبتملة» for «مكتملة») and runs two words together (19.7 %). The music does not mask the voice |
| The four lines that say the name, on the renamed films' final soundtracks | All heard as «مداد». 20-minute: the reveal «نقدم لكم منصة مداد» exactly (0 %); the closing line 4.2 % (one dropped article: «صورة» for «الصورة»). 3-minute: its reveal exactly (0 %); its closing line 4.2 % (the same article) |
| Pauses | 0.8 s after every sentence, 0.45 s after a comma or colon, at least 0.6 s at the end of a scene; no silence of 1.5 s or more anywhere (§1) |
| Pace | About 9 letters a second including pauses; no time-stretching |
| Egyptian accent | Not achievable with this voice: ج as a hard g was heard as ك by speech recognition (PRODUCTION_STATUS.md); the voice reads MSA in a neutral accent |

The recognition rate counts recognition errors too: Whisper writes numbers as digits ("2026", "14", "300"),
drops or adds the article, and confuses emphatic and plain letters in synthetic speech. The lines above 10 %
were read against their phonemes: the phonemes are right; what remains is the voice's articulation of some
sounds (emphatic ص/ط, ع at the end of a question) and recognition noise.

**Not done: a listening review by an Arabic speaker.** The checks above show that what the voice is asked to
say is correct and that it is understood; how natural it sounds can only be judged by ear.

## 3. Subtitles

| File | Cues | Ends at | Overlaps | Longest line | Lines per cue | Shortest cue | Fastest cue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| arabic.srt (diacritized) | 201 | 1,264.8 s | 0 | 77 characters incl. diacritics | ≤ 2 | 1.85 s | 19.5 chars/s incl. diacritics |
| arabic-plain.srt | 201 | 1,264.8 s | 0 | 44 | ≤ 2 | 1.85 s | 11.7 chars/s |
| english.srt | 245 | 1,264.8 s | 0 | 54 | ≤ 2 | 1.85 s | 18.9 chars/s |
| arabic-3min.srt | 31 | 182.0 s | 0 | 79 incl. diacritics | ≤ 2 | 1.90 s | 19.4 incl. diacritics |
| arabic-3min-plain.srt | 31 | 182.0 s | 0 | 46 | ≤ 2 | 1.90 s | 11.6 |
| english-3min.srt | 39 | 182.0 s | 0 | 46 | ≤ 2 | 1.90 s | 18.3 |

The shortest cue is now the reveal, «نُقَدِّمُ لَكُمْ مِنَصَّةَ مِدَادٍ» (1.85 s for a short line).

All files are numbered in order, UTF-8, timed to the narration of the final films, and end inside their video.
Every cue is under 20 characters a second. The subtitles were validated as files, not tried in a particular
player.

## 4. Content checks (honesty and claims)

| Check | Result |
| --- | --- |
| Every product screen is a recording of the running application | Yes: 54 recordings from `capture/showcase.spec.ts`, recorded again from the renamed application on 2026-10-29; no screen is mocked or drawn |
| The platform's name is Midad (مِداد) throughout | Yes. Checked on frames of the final files: the logo scene, the closing card, the diagram, the browser frame's page titles, and the application's own headings (sign-up, student sign-in). The Arabic is joined and carries its kasra. In the narration, the name is heard as «مداد» by speech recognition on the final soundtrack (§2). The working name appears nowhere in the scripts, subtitles or graphics |
| Every capability shown as "available now" is implemented and tested | Yes: FEATURE_COVERAGE_MATRIX.md lists each with its tests |
| Things not finished are labelled on screen | Yes: Paymob payments (c7-plans); launch prices as proposals (c7-plans); student accounts and portal "switched on per school after the legal review of student data" (c5-students, c6-signin, m-student); manual screen-reader review (c4-access); readiness list (c8-ready) |
| The AI assistant is shown only as future vision | Yes: status board says not built (c6-ai-status); the concept carries "Future vision — not a feature for sale" (c6-ai-vision, m-ai); no Wise screen is imitated |
| Figures have sources | Yes: PRODUCT_AUDIT.md §4; the 300-student figure carries its "local environment" note |
| No invented customers, testimonials, usage figures, partnerships or certifications | None appear |
| Demo data is marked and invented | "DEMO DATA · بيانات تجريبية" on every product window; all names invented. The Arabic half of the tag is set without the mono font's letter spacing, which had broken its letters apart |
| No secrets or local addresses on screen | One-time passwords, the 2FA QR code and key, and local addresses are blurred at capture |

## 5. Visual checks

- Contact sheets of the final files reviewed (one frame every 30 s for the 20-minute cut, every 10 s for the
  3-minute cut).
- Arabic text, diacritics and right-to-left layout render correctly; English and numbers stay left-to-right.
- Demo windows push in slowly across each scene and the audience board drifts, so no stretch of picture is
  still for 8 s or more.
- The 20-minute cut is 21:09. The full pauses after every sentence added 29 s to the 20:42 of an earlier cut.
  The rename's shorter reveal line then took off 2.3 s. The narration was kept at the pace where it was clearest
  in the speech-recognition check rather than sped up.

**Known, accepted**

- Date fields in the recordings show `mm/dd/yyyy`, drawn by the capture browser's own locale.
- On phone scenes the drawn notch covers a few pixels at the top of the application's header, as on a real phone.

## 6. Audio checks

- Loudness, peaks, silences: §1. The music ducks under the voice (−10 dB) and its cues follow the chapters.
- The score is played by sampled acoustic instruments (FluidR3 soundfont, MIT licence) and mastered with a bus
  compressor and limiter; its peaks stay below the film's limit (§1).
- **Not listened to by a person**: neither the score nor the voice. Before release, a listening pass on
  headphones and on laptop speakers is needed.

## 7. Not tested

- A listening review of the narration and the music by a person.
- Playback on target devices and platforms (TV, projector, phones, YouTube or LinkedIn processing).
- Subtitle display in specific players.
