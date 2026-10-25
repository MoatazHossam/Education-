# Wise EduAgent integration — project status

**Overall: BLOCKED** (2026-10-25). Nothing of Wise EduAgent has been implemented, because the
application could not be inspected and the SaaS has no student concept. Building student features now
would mean inventing Wise's functionality and reversing a documented security decision without the
owner's say.

| Phase (integration brief) | Status | Evidence / blocker |
| --- | --- | --- |
| Baseline of the repository | COMPLETE | `02_EXISTING_SAAS_ASSESSMENT.md` §1: 159/159 unit and integration tests, 14/14 E2E |
| Phase 0: reverse-engineer Wise EduAgent | **BLOCKED** | Proxy 403: the environment's network policy denies `wise-eduagent.ai.studio`; no source export. `../WISE_EDUAGENT_FUNCTIONAL_INVENTORY.md` |
| Phase 1: audit the existing SaaS | COMPLETE | `02_EXISTING_SAAS_ASSESSMENT.md`; no student portal, no AI |
| Gap analysis | COMPLETE (with Wise side NOT ACCESSIBLE) | `../WISE_INTEGRATION_GAP_ANALYSIS.md` |
| Executive report (Arabic) | COMPLETE | `01_WISE_PROJECT_ANALYSIS.md` |
| Phase 2: student experience design (`04`) | NOT STARTED | Needs the Wise inventory and the decision on students |
| Phases 3–5: functionality, AI architecture, SaaS integration (`05`–`10`) | NOT STARTED | Same |
| Phase 6: implementation | NOT STARTED | Same |
| Phase 7: tests (`12`) | NOT STARTED | Same |
| Roadmap (`11`) | NOT STARTED | Written with the design |

Documents `04`–`12` will be written with the design and implementation they describe, not ahead of
them.

## Decisions needed from the owner

1. Access to Wise EduAgent: an AI Studio source export (preferred) and/or network access to
   `wise-eduagent.ai.studio` with an authorized account.
2. Whether to add students to Curriculum Scope, and how they join (school-managed accounts or
   invitations; age range; parental consent), with a legal assessment.
3. The AI provider and model, and who holds the key and pays for usage.

## Branch

Work for this integration is on `claude/friendly-rubin-hmemjl`. This session can push only to that
branch. It is a non-production branch, kept separate from `main` until a pull request is merged.
