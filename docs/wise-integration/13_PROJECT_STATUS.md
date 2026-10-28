# Wise EduAgent integration — project status

**Overall: PARTIALLY COMPLETE — Wise features BLOCKED** (2026-10-25). The owner decided to add
students with school-created accounts, and the student portal foundation is built and tested
(`../STUDENT_ACCOUNTS.md`, `04_STUDENT_EXPERIENCE_DESIGN.md`). Nothing of Wise EduAgent itself is
implemented: the application could not be inspected and no AI provider is chosen, so building its
features would mean inventing them.

| Phase (integration brief) | Status | Evidence / blocker |
| --- | --- | --- |
| Baseline of the repository | COMPLETE | `02_EXISTING_SAAS_ASSESSMENT.md` §1: 159/159 unit and integration tests, 14/14 E2E |
| Phase 0: reverse-engineer Wise EduAgent | **BLOCKED** | Proxy 403: the environment's network policy denies `wise-eduagent.ai.studio`; no source export. `../WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md` |
| Phase 1: audit the existing SaaS | COMPLETE | `02_EXISTING_SAAS_ASSESSMENT.md`; no student portal, no AI |
| Gap analysis | COMPLETE (with Wise side NOT ACCESSIBLE) | `../WISE_INTEGRATION_GAP_ANALYSIS.md` |
| Executive report (Arabic) | COMPLETE | `01_WISE_PROJECT_ANALYSIS.md` |
| Decision on students | DECIDED (owner, 2026-10-25) | School-created accounts |
| Phase 2: student experience design (`04`) | PARTIALLY COMPLETE | Foundation designed and built; Wise features wait for the inventory |
| Student portal foundation: accounts, sign-in, staff management, curriculum view, entitlement switch | COMPLETE (off for every school; legal assessment pending before real use) | `../STUDENT_ACCOUNTS.md`; 25 integration tests, E2E journey 13, 12 more accessibility screens with 0 findings |
| AI layer, independent of the provider (part of the AI architecture) | COMPLETE (2026-10-28; not yet run against a real provider) | `../AI_LAYER.md`: Gemini, Claude or OpenAI by configuration, per-school allowance, usage log, staff only; 48 tests |
| Phases 3–5: functionality, the rest of the AI architecture, SaaS integration (`05`–`10`) | BLOCKED | Needs the Wise inventory (B-8) and an AI provider with its key (B-10) |
| Phase 6: implementation of Wise features | BLOCKED | Same |
| Phase 7: tests (`12`) | PARTIALLY COMPLETE | Tests of the foundation done (above); Wise features not built |
| Roadmap (`11`) | NOT STARTED | Written with the design |

Documents `04`–`12` will be written with the design and implementation they describe, not ahead of
them.

## Decisions needed from the owner

1. Access to Wise EduAgent: an AI Studio source export (preferred) and/or network access to
   `wise-eduagent.ai.studio` with an authorized account.
2. ~~Whether to add students~~ — **decided: school-created accounts.** Still needed: the legal
   assessment (age range, parental consent, terms with schools) before real students use it.
3. The AI provider and model, and who holds the key and pays for usage. The layer that uses them is built
   (`../AI_LAYER.md`); with a key, `npm run ai:check` checks it.

## Branch

Work for this integration is on `claude/friendly-rubin-hmemjl`. This session can push only to that
branch. It is a non-production branch, kept separate from `main` until a pull request is merged.
