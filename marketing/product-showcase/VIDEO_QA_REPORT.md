# Video QA report

Checks of the narrated cuts on 2026-10-28. The narration is a synthetic voice with rule-based Arabic
pronunciation (PRODUCTION_STATUS.md, "The narration voice"); the earlier preview cuts without narration are
superseded.

## 1. Technical checks

Measured with `video-project/lib/qa.py` (FFmpeg `blackdetect` d ≥ 0.5 s, `freezedetect` d ≥ 8 s,
`silencedetect` −50 dB for ≥ 1.5 s, `ebur128` with true peak), and a full decode with FFmpeg.

| | 20-minute, 1080p | 20-minute, 4K | 3-minute, 1080p |
| --- | --- | --- | --- |
| File | Education_SaaS_Product_Showcase_1080p.mp4 | Education_SaaS_Product_Showcase_20min.mp4 | Education_SaaS_Product_Showcase_3min.mp4 |
| Duration | 20:41.8 (1,241.77 s) (target about 20 minutes; see §5) | rendering | 3:04.9 (184.93 s; target 2:50–3:10) |
| Picture | H.264 High, 1920 × 1080, 30 fps, yuv420p, 37,253 frames | rendering | H.264 High, 1920 × 1080, 30 fps, yuv420p, 5,548 frames |
| Sound | AAC, 48 kHz, stereo | rendering | AAC, 48 kHz, stereo |
| Size / bitrate | 212.3 MB / 1.37 Mb/s | rendering | 37.9 MB / 1.64 Mb/s |
| Integrated loudness | −16.0 LUFS (target −16) | rendering | −16.0 LUFS |
| Loudness range | 2.9 LU | rendering | 3.6 LU |
| True peak | −1.8 dBTP (limit −1.5) | rendering | −1.8 dBTP |
| Black segments | none | rendering | none |
| Frozen picture (≥ 8 s) | none | rendering | none |
| Silences | none | rendering | none |
| Full decode | no errors | rendering | no errors |

## 2. Narration

| Check | Result |
| --- | --- |
| Pronunciation follows the diacritized script | The voice is given phonemes, not text: `audio/arabic_g2p.py` applies the reading rules (vowels, shadda, tanween, sukun, long vowels, hidden alif, hamzat al-wasl, sun letters, iqlab, ta marbuta, pausal forms, stress); 15 rule tests pass; the rules were compared with espeak-ng on all 2,087 words of the scripts and every difference reviewed |
| Speech recognition (Whisper small) on every take | 162 lines: character error rate 4.7 % (20-minute 4.7 %, median 4.1 %; 3-minute 5.0 %); 7 lines above 10 %, 2 above 15 % |
| Speech recognition on the finished 3-minute soundtrack (voice under music and effects) | 5.1 % over 28 lines: the music does not mask the voice |
| Pace | About 9 letters a second including pauses (the pace the script was written for); no time-stretching |

The recognition rate counts recognition errors too: Whisper writes numbers as digits ("2026", "14", "300"),
drops or adds the article, and confuses emphatic and plain letters in synthetic speech. The highest line
(c2-origin-2, 39 %) is the academic year said in words, transcribed as digits. The lines above 10 % were read
against their phonemes: the phonemes are right; what remains is the voice's articulation of some sounds
(emphatic ص/ط, ع at the end of a question) and recognition noise.

**Not done: a listening review by an Arabic speaker.** The checks above show that what the voice is asked to
say is correct and that it is understood; how natural it sounds can only be judged by ear.

## 3. Subtitles

| File | Cues | Ends at | Overlaps | Longest line | Lines per cue | Shortest cue | Fastest cue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| arabic.srt (diacritized) | 202 | 1,237.7 s | 0 | 77 characters incl. diacritics | ≤ 2 | 2.33 s | 19.5 chars/s incl. diacritics |
| arabic-plain.srt | 202 | 1,237.7 s | 0 | 44 | ≤ 2 | 2.33 s | 11.7 chars/s |
| english.srt | 245 | 1,237.7 s | 0 | 54 | ≤ 2 | 2.22 s | 18.7 chars/s |
| arabic-3min.srt | 31 | 180.5 s | 0 | 79 incl. diacritics | ≤ 2 | 1.90 s | 19.2 incl. diacritics |
| arabic-3min-plain.srt | 31 | 180.5 s | 0 | 46 | ≤ 2 | 1.90 s | 11.4 |
| english-3min.srt | 40 | 180.5 s | 0 | 44 | ≤ 2 | 1.90 s | 18.0 |

All files are numbered in order, UTF-8, timed to the recorded narration, and end inside their video. Every cue is
now under 20 characters a second. The subtitles were validated as files, not tried in a particular player.

## 4. Content checks (honesty and claims)

| Check | Result |
| --- | --- |
| Every product screen is a recording of the running application | Yes: 54 recordings from `capture/showcase.spec.ts`; no screen is mocked or drawn |
| Every capability shown as "available now" is implemented and tested | Yes: FEATURE_COVERAGE_MATRIX.md lists each with its tests |
| Things not finished are labelled on screen | Yes: Paymob payments (c7-plans); launch prices as proposals (c7-plans); student accounts and portal "switched on per school after the legal review of student data" (c5-students, c6-signin, m-student); manual screen-reader review (c4-access); readiness list (c8-ready) |
| The AI assistant is shown only as future vision | Yes: status board says not built (c6-ai-status); the concept carries "Future vision — not a feature for sale" (c6-ai-vision, m-ai); no Wise screen is imitated |
| Figures have sources | Yes: PRODUCT_AUDIT.md §4; the 300-student figure carries its "local environment" note |
| No invented customers, testimonials, usage figures, partnerships or certifications | None appear |
| Demo data is marked and invented | "DEMO DATA · بيانات تجريبية" on every product window; all names invented |
| No secrets or local addresses on screen | One-time passwords, the 2FA QR code and key, and local addresses are blurred at capture |

## 5. Visual checks

- Contact sheets of the final files reviewed (one frame every 30 s for the 20-minute cut, every 10 s for the
  3-minute cut); frames of the scenes changed in this round checked at 1080p.
- Arabic text, diacritics and right-to-left layout render correctly; English and numbers stay left-to-right.
- The 20-minute cut is 20:42, 12 s over the 20:30 aimed for: the narration was kept at the pace where it was
  clearest in the speech-recognition check rather than sped up.

**Found and fixed in this round**

- Two 8.3 s stretches of unchanging picture in the 20-minute cut (the audience board while one segment is
  described; a demo holding its last frame). Demo windows now push in by about 1 % across the scene and the
  board drifts slowly closer; the re-rendered files have no frozen stretch.
- True peak −1.3 dBTP (AAC encoding adds about 0.2 dB). Normalisation now aims at −2 dBTP.
- A resumed render could reuse chunks drawn by an older version of a scene template: the chunk key now
  includes the player code.

**Known, accepted**

- Date fields in the recordings show `mm/dd/yyyy`, drawn by the capture browser's own locale.
- On phone scenes the drawn notch covers a few pixels at the top of the application's header, as on a real phone.

## 6. Audio checks

- Loudness, peaks, silences: §1. The music ducks under the voice (−10 dB) and the cues follow the chapters.
- **Not listened to by a person**: neither the generated score nor the voice. Before release, a listening pass
  on headphones and on laptop speakers is needed.

## 7. Not tested

- A listening review of the narration and the music by a person.
- Playback on target devices and platforms (TV, projector, phones, YouTube or LinkedIn processing).
- Subtitle display in specific players.
