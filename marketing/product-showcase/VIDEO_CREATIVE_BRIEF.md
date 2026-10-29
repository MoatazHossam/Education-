# Video creative brief

## Objective

Show school leaders, education companies and partners what Midad (مِداد) does **today**,
using the running product rather than generic imagery, with plenty of time on the value for the teacher, the
student and the institution, and end with one action: **join the pilot as a partner institution**.

## Single-minded message

> One Arabic-first platform where an institution decides what it teaches, keeps that decision on record,
> and runs the daily classroom on top of it — built with security, isolation and honesty about what is next.

In the film: «قَرَارٌ وَاضِحٌ وَمُوَثَّقٌ، وَعَمَلٌ أَقَلُّ تَكْرَارًا، وَرُؤْيَةٌ أَوْضَحُ» (chapter 3); end-card slogan «منهجٌ واضح · فصلٌ متصل · مؤسسةٌ ترى الصورة كاملة».

## Two cuts from one project

Both are built from the same script data, recordings, design system and score (`video-project/`).

| | 20-minute showcase | 3-minute version |
| --- | --- | --- |
| Script | `video-project/script/showcase-20.mjs` | `video-project/script/showcase-3.mjs` |
| Length (estimated narration timing) | 19:38.6 (target 19:30–20:30) | 2:54.7 (target 2:50–3:10) |
| Scenes / narration lines | 59 / 134 | 14 / 28 |
| Running product on screen | 8:53 of demonstrations (45 %) from 46 recordings, plus real-screen montages | 1:03 (36 %) from 11 recordings |
| Purpose | Sales meetings, partner and investor presentations | First contact, social, landing page |

Lengths follow the narration. With no recorded voice yet, each line's length is estimated (12 characters per
second, calm pace, plus pauses); once a voice is recorded the timeline is rebuilt from the recordings (see
PRODUCTION_STATUS.md).

## Structure of the 20-minute cut

| # | Chapter | Time | What happens |
| --- | --- | --- | --- |
| 1 | التحدي · The education challenge | 00:00–01:18 | Scattered curriculum decisions: spreadsheets, chat threads, versions; the question the product answers; product reveal |
| 2 | رؤية المنتج · Product vision | 01:18–03:09 | From the original one-page picker to a platform; three layers (curriculum, classroom, institution); the flow from decision to grade; principles |
| 3 | العملاء المستهدفون · Target customers | 03:09–04:47 | Schools and groups, EdTech and publishers, tutoring centres and consultants (now); higher education (later) |
| 4 | جولة في المنصة · Platform walkthrough | 04:47–07:20 | Sign-up, two-step verification, account, members and roles, organizations, data isolation, navigation, phone and accessibility, platform oversight with permission |
| 5 | المزايا بالتفصيل · Feature showcase | 07:20–12:41 | Catalogue, verification, scopes, comparison, notes and assignments, new academic year; student accounts, classes, homework, tests, live monitoring, marking, gradebook; value for the teacher; governance |
| 6 | تجربة الطالب والذكاء الاصطناعي · Student experience & AI | 12:41–15:50 | The student's day on a phone: sign-in, Today, homework, a test, result, grades; value for the student; AI: where we stand, the future vision (labelled), the foundation that exists |
| 7 | نموذج SaaS والقيمة التجارية · SaaS model | 15:50–18:15 | Plans and billing (launch price proposals; Paymob in development), isolation and security, deployment and recovery, central updates, value for the institution |
| 8 | الرؤية والخطوة التالية · Vision & next steps | 18:15–19:39 | What is ready and what remains before launch; roadmap; invitation to the pilot |

The 3-minute cut keeps the same arc in four parts: challenge and answer, the platform at work (curriculum,
notes, homework, tests, the student), trust and the AI vision, next step.

## Tone and voice

- Modern Standard Arabic, **fully diacritized** in the script, subtitles and the voice's input, readable across
  Egypt, the Gulf and the Levant; calm, warm and confident; never hype.
- Narrator: one adult voice, 105–115 words per minute, clear pauses; English product terms said as they are
  (SaaS, API, Webhooks, Paymob). Directions are at the top of ARABIC_NARRATION_SCRIPT.md.
- Honest by construction: the status of every capability is on screen (green *available now*, amber
  *in development*, violet *future roadmap*, dashed amber *concept*), and the narration says the same.

## Visual language

- **The product is the hero.** Product screens are recordings of the real application in Arabic
  (3600 × 2025 captures), played back in a browser window or phone frame with a redrawn pointer, click
  ripples, taps and gentle camera push-ins on the action.
- Motion graphics only where the product cannot show something (the problem, layers, isolation, deployment,
  roadmap), in the product's own font (Readex Pro, with IBM Plex Mono) and colours (ink #18243a, accent
  #1f4e8c, margin red #c0473b, paper #f7f8fb) and its logo mark.
- Every product window carries "DEMO DATA · بيانات تجريبية"; all names are invented.
- Chapter cards, a chapter progress strip, and a caption with the feature's name and status on each
  demonstration.
- No stock footage, no generated people, no imitation of any other product's screens.

## Music and sound

An original score generated for this project (`video-project/audio/mix.py`): D major, 84 BPM, pads, bass,
arpeggio, bells and a light pulse, changing with the chapters (sparse in the challenge, warmer for the
vision, a steady pulse for the walkthrough, lighter for the student, ethereal for AI, full for the finale).
Soft whooshes on chapter cards, clicks on demonstrated clicks, a riser and impact at the reveal. Music ducks
about 10 dB under the voice; final loudness −16 LUFS integrated, true peak ≤ −1.5 dBTP. A licensed track can
replace the score (`music/<cut>-override.wav`).

## Subtitles

Arabic (diacritized and plain) and English SRT for each cut, from the same lines as the narration, at most two
lines of about 42 characters.

## Call to action

End card: «ندعوكم إلى البرنامج التجريبي · Join the pilot programme», the logo and slogan, then
«تواصلوا معنا لعرض مباشر أو للانضمام إلى التجربة · Contact us for a live demo or to join the pilot».
No contact details are invented; add the real address or link before publishing.

## Mandatory rules

- Show only what exists as available; label everything else; never present the AI assistant or Wise
  EduAgent as a product feature.
- No invented customers, testimonials, statistics, partnerships, certifications or results.
- No secrets, keys, one-time passwords or local addresses on screen.
- Do not publish the video publicly without the owner's explicit authorization.

## Technical specification

| | Main (20 min) | 1080p (20 min) | 3 min |
| --- | --- | --- | --- |
| File | Education_SaaS_Product_Showcase_20min.mp4 | Education_SaaS_Product_Showcase_1080p.mp4 | Education_SaaS_Product_Showcase_3min.mp4 |
| Picture | 3840 × 2160, 30 fps, H.264 High, yuv420p | 1920 × 1080, 30 fps, H.264 | 1920 × 1080, 30 fps, H.264 |
| Sound | AAC 48 kHz stereo | AAC 48 kHz stereo | AAC 48 kHz stereo |
| Subtitles | arabic.srt, arabic-plain.srt, english.srt | same | arabic-3min.srt, arabic-3min-plain.srt, english-3min.srt |

Until the narration is recorded, the cuts are produced as previews with the narration burned in as Arabic
captions (`*_PREVIEW_no-narration.mp4`); see PRODUCTION_STATUS.md.
