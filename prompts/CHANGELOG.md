# Prompts Changelog

All prompt versions are documented here. Versions are never edited after creation — changes produce a new version file.

---

## 2026-04-20

### brief_extraction/v1.md — initial version

- Wrote production system prompt with refusal clause, anti-pattern list, and output schema.
- Added two few-shot examples: (1) Upwork message producing a complete brief, (2) vague input triggering the refusal clause with all high-priority open questions.
- User template uses `{{raw_input}}`, `{{project_name}}`, `{{client}}`, `{{today_date}}` placeholders matching the `generateBrief()` signature in `apps/api/src/ai/index.ts`.

### epic_generation/v1.md — initial version

- Wrote production system prompt enforcing the `domain` enum (must match `EpicSchema`), Fibonacci `storyPoints`, and the blocked-epic pattern for unresolvable ambiguity.
- Added `userStory`, `priority`, `dependencies`, `technicalNotes`, `acceptanceSummary` fields beyond the minimal Zod schema to maximise PM-usable output.
- Added two few-shot examples: (1) 6-epic breakdown for a grooming booking platform, (2) a single blocked epic stub.
- User template uses `{{brief_json}}` placeholder matching `generateEpics()`.

### journey_generation/v1.md — initial version

- Wrote production system prompt enforcing `[Actor]: [action]` step format, coverage requirement across five path types, and minimum/maximum step counts.
- Added `trigger`, `edgeCases`, `failureModes`, `nonFunctional` fields beyond the minimal Zod schema.
- Added two few-shot examples: (1) 13-step booking journey with 4 edge cases and 3 failure modes, (2) 5-step notification journey.
- User template uses `{{epics_json}}` and `{{brief_json}}` placeholders matching `generateJourneys()`.

### task_decomposition/v1.md — initial version

- Wrote production system prompt enforcing GWT AC format, banned words list, 4-16h estimate constraint, split-by-layer heuristic, and idempotency/dependency rules.
- Added `technicalNotes` and `testingNotes` fields beyond the minimal Zod schema.
- Added three few-shot examples: (1) backend Stripe Checkout endpoint (8h), (2) frontend confirmation screen (6h), (3) Stripe webhook integration handler (8h).
- User template uses `{{journey_json}}` and `{{epic_json}}` placeholders matching `generateTasks()`.
- All four prompts have `current: null` in manifest — promotion requires eval suite to pass first.
