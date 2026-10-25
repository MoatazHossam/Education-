# Wise EduAgent — functional inventory

**Status: NOT ACCESSIBLE** (2026-10-25). No feature of the application could be observed, so none is
recorded as a Wise feature. This file records what was attempted, the little that is verified, and what
is needed to complete the inventory. Classification values follow the integration brief: VERIFIED
IMPLEMENTED, OBSERVED BUT IMPLEMENTATION UNKNOWN, PARTIALLY IMPLEMENTED, MOCKED, NOT ACCESSIBLE,
NOT VERIFIED.

## 1. How the application was approached

| Attempt | Result |
| --- | --- |
| `GET https://wise-eduagent.ai.studio/` from the development environment (curl, through the environment's egress proxy) | Refused by the proxy before reaching the host: `CONNECT tunnel failed, response 403`. The environment's network policy does not allow this host. As the environment's rules require, the denial was reported and **not routed around**: no third-party fetchers, mirrors or caches were used to retrieve the page. |
| Browser automation (Playwright/Chromium in the same environment) | Not attempted separately: it uses the same egress proxy and policy. |
| Application source (AI Studio export or a repository) | None available in this session; none was supplied. |
| Public web search: `"Paradise EduAgent" Wise`, `"wise-eduagent" ai.studio` | No page describes the application. Results concern unrelated products: Wise (tutor-management software), Paradise (a study-abroad agency), and PolyU's WiseLearn "EduAgents" research platform. **None is used as evidence.** |

## 2. What is verified

| ID | Fact | Evidence |
| --- | --- | --- |
| V-1 | The application is served from a Google AI Studio domain (`*.ai.studio`). AI Studio "Build" apps call the Gemini API (`GEMINI_API_KEY`) and can be exported by their owner as a ZIP file or pushed to GitHub. | The URL; [Google: Build apps in Google AI Studio](https://ai.google.dev/gemini-api/docs/aistudio-build-mode). **Whether Wise EduAgent is such an app, and what it does, is NOT VERIFIED.** |
| V-2 | This repository's original artifact is headed "Paradise EduAgent · Content scope · Academic year 2026/2027". Curriculum Scope began as the tool that defines which Egyptian curriculum materials Paradise EduAgent covers. | `legacy/egypt-curriculum-picker.html`, line 105; `docs/PRODUCT_OVERVIEW.md`. This is the only verified link between the two products. |

## 3. Inventory

| ID | Feature | Description / observed behaviour | Inputs / outputs | Data and dependencies | Implementation evidence | Status | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W-0 | Any feature of the application | — | — | — | — | **NOT ACCESSIBLE** | Repeat Phase 0 once access is provided (§4) |

The integration brief lists *possible* capabilities: tutoring chat, study plans, practice and quizzes,
progress tracking. None of them is recorded above, because none was observed. Recording them would
mean inventing the application's functionality.

## 4. What is needed to complete this inventory

1. **Source access (preferred).** The application's owner exports it from Google AI Studio (Download ZIP,
   or push to a GitHub repository that is then added to this session). Source shows the prompts, agent
   structure, data handling, persistence and model calls, which browser inspection cannot.
2. **Network access (additionally, to observe behaviour).** Add `wise-eduagent.ai.studio` to the cloud
   environment's allowed domains (environment settings → Network access), plus any hosts the first
   successful page load reveals. If the application requires sign-in, provide an authorized test
   account.
3. **Authorization.** Confirmation of who owns the application and that its code and prompts may be
   ported into Education SaaS.

When access exists, each feature gets one row with every field above (ID, name, description, user
benefit, observed behaviour, inputs, outputs, required data, external dependencies, implementation
evidence, status, recommendation), with screenshots in `docs/wise-integration/screens/`.
