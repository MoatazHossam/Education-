# Video QA report

Checks of the rendered cuts on 2026-10-27. These are the **preview** cuts: no voice is recorded yet (see
PRODUCTION_STATUS.md), so the narration is burned in as diacritized Arabic captions and the files carry a
"PREVIEW — NO NARRATION" tag. Every check below must be repeated on the narrated cuts.

## 1. Technical checks

Measured with `video-project/lib/qa.py` (FFmpeg `blackdetect` d ≥ 0.5 s, `freezedetect` d ≥ 8 s,
`silencedetect` −50 dB for ≥ 1.5 s, `ebur128` with true peak).

| | 20-minute, 1080p | 3-minute, 1080p |
| --- | --- | --- |
| File | Education_SaaS_Product_Showcase_1080p_PREVIEW_no-narration.mp4 | Education_SaaS_Product_Showcase_3min_PREVIEW_no-narration.mp4 |
| Duration | 19:38.6 (1,178.57 s; target 19:30–20:30) | 2:54.7 (174.67 s; target 2:50–3:10) |
| Picture | H.264 High, 1920 × 1080, 30 fps, yuv420p, 35,357 frames | H.264 High, 1920 × 1080, 30 fps, yuv420p, 5,240 frames |
| Sound | AAC, 48 kHz, stereo | AAC, 48 kHz, stereo |
| Size / bitrate | 173.1 MB / 1.17 Mb/s | 30.7 MB / 1.41 Mb/s |
| Integrated loudness | −18.0 LUFS (target without voice: −18) | −18.0 LUFS |
| Loudness range | 3.5 LU | 5.3 LU |
| True peak | −1.5 dBTP (limit −1.5) | −1.5 dBTP |
| Black segments | none | none |
| Frozen picture (≥ 8 s) | none | none |
| Silences | none | none |
| Full decode | no errors | no errors |

The 4K file is reported in §7.

## 2. Subtitles

| File | Cues | Ends at | Overlaps | Longest line | Lines per cue | Shortest cue | Fastest cue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| arabic.srt (diacritized) | 202 | 1,174.5 s | 0 | 77 characters incl. diacritics | ≤ 2 | 2.66 s | 20.3 chars/s incl. diacritics |
| arabic-plain.srt | 202 | 1,174.5 s | 0 | 44 | ≤ 2 | 2.66 s | 11.7 chars/s |
| english.srt | 245 | 1,174.5 s | 0 | 54 | ≤ 2 | 2.01 s | 20.5 chars/s |
| arabic-3min.srt | 31 | 170.2 s | 0 | 79 incl. diacritics | ≤ 2 | 1.86 s | 20.9 incl. diacritics |
| arabic-3min-plain.srt | 31 | 170.2 s | 0 | 46 | ≤ 2 | 1.86 s | 11.7 |
| english-3min.srt | 40 | 170.2 s | 0 | 44 | ≤ 2 | 1.86 s | 19.0 |

All files are numbered in order, UTF-8, with valid times, and end inside their video. Diacritics count as
characters but take no width, so the plain Arabic files give the real reading load (≤ 11.7 chars/s, comfortable).
The densest English cue (20.5 chars/s) is just above the common 20 chars/s ceiling; acceptable for a preview,
to recheck once the recorded narration sets the real timing. The subtitles were validated as files; they were
not tried in a particular player or platform.

## 3. Content checks (honesty and claims)

| Check | Result |
| --- | --- |
| Every product screen is a recording of the running application | Yes: 54 recordings from `capture/showcase.spec.ts`; no screen is mocked or drawn |
| Every capability shown as "available now" is implemented and tested | Yes: FEATURE_COVERAGE_MATRIX.md lists each with its tests; its last section lists the badge each scene shows |
| Things not finished are labelled on screen | Yes: Paymob payments (amber note, c7-plans); launch prices as proposals (c7-plans); student accounts and portal "switched on per school after the legal review of student data" (c5-students, c6-signin, m-student); manual screen-reader review (c4-access narration); readiness list (c8-ready) |
| The AI assistant is shown only as future vision | Yes: status board says not built (c6-ai-status); the concept carries "Future vision — not a feature for sale" and dashed lines (c6-ai-vision, m-ai); no Wise screen is imitated |
| Figures have sources | Yes: PRODUCT_AUDIT.md §4 lists every figure with its source and conditions; the 300-student figure carries its "local environment" note on screen |
| No invented customers, testimonials, usage figures, partnerships or certifications | None appear; the narration says value will be measured in the pilot (c3-segments) |
| Demo data is marked and invented | "DEMO DATA · بيانات تجريبية" on every product window; all names invented |
| No secrets or local addresses on screen | One-time passwords, the 2FA QR code and key, and `localhost` / `127.0.0.1` text are blurred at capture; the contact sheets and scene reviews show none |
| No development payment simulator page | Skipped in c7-plans (billing page → subscribed state) |

**Found and fixed during QA**

- The student-account scenes showed only "Available now", while the feature is switched off for every school
  until the legal review (PROJECT_STATUS B-9). An amber note now says so in both cuts.
- Notes and callouts at the bottom of demonstrations collided with the burned-in captions (and would collide
  with player subtitles). Moved up (`.callout` bottom 250 px); checked on four scenes.
- The phone scenes had no way to show such a note; one was added beside the phone.

## 4. Visual checks

- Contact sheets of the final files reviewed: one frame every 20 s (20-minute) and every 6 s (3-minute); plus,
  during production, frames of every scene at several points (`preview.mjs`).
- Arabic text, diacritics and right-to-left layout render correctly in Readex Pro across titles, captions and
  the application's own screens; English and numbers stay left-to-right where they should.
- Chapter cards, chapter dots and the progress strip advance correctly (chapters 1–8; 1–4 in the 3-minute cut).
- A frame taken during a transition can show half-revealed text (e.g. the chapter 5 title at 07:21); the cards
  are complete once their entry animation ends (checked at 1.0 s and 2.5 s).

**Known, accepted**

- Date fields in the recordings show `mm/dd/yyyy`, drawn by the capture browser's own locale (PRODUCT_AUDIT §7).
- On phone scenes the drawn notch covers a few pixels at the top of the application's header, as on a real
  phone.

## 5. Audio checks

- Loudness, peaks, silences: §1. The music cues follow the chapters (events in `build/<cut>/events.json`).
- **Not listened to by a person.** The generated score was checked by measurement only. Before release, a
  listening pass on headphones and on laptop speakers is needed, or the score can be replaced by a licensed
  track (`music/<cut>-override.wav`).
- No narration to check yet: intelligibility, pronunciation of the diacritized text, and music ducking under
  the voice (−10 dB) must be checked on the narrated cuts.

## 6. Production issues found and fixed

| Issue | Fix |
| --- | --- |
| The 3-minute file was cut at 2:12 when the container restarted during its final mux | Mux re-run from the complete picture file; 2:54.7 verified |
| "4K" render produced 1920 × 1080 frames: Chromium's capture ignored the device scale factor | Capture now passes a clip with `scale`; verified 3840 × 2160, pixel-identical to Playwright's own screenshot |
| A container restart lost a render in progress | `render.mjs` now keeps finished chunks (keyed by timeline and settings) and resumes; tested by interrupting a render and re-running it |

## 7. 4K file

The 4K render (3840 × 2160) of the 20-minute preview was started after the capture fix above. Its results are
recorded in PRODUCTION_STATUS.md when it completes.

## 8. Not tested

- Narrated cuts (no voice yet).
- Playback on target devices and platforms (TV, projector, phones, YouTube or LinkedIn processing).
- Subtitle display in specific players.
- A listening review of the music.
