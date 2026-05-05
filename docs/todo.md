# WBS Builder — Todo

## High Priority

### Core Functionality Gaps

- [ ] **ChallengeBar → AI prompt injection** — `challengeText` is passed to generate endpoints but the AI module doesn't inject it into prompt templates. Add `{{challenge_text}}` variable to user_prompt_template and pass it through in `apps/api/src/ai/index.ts`.
- [ ] **ClickUp sync** — `POST /projects/:id/sync` returns mock log entries. Real ClickUp API integration needed. See `docs/clickup-mapping.md` (to be written).
- [ ] **ProjectDefinitionPage Save** — Save button renders but calls nothing. Wire to `PATCH /projects/:id` with all definition fields including the `communicationChannels` and `channelLinks` JSON fields.
- [ ] **Open questions answering** — UI exists on BriefPage but `answerQuestion` store action is mocked. Need `POST /projects/:id/brief/questions/:questionId/answer` endpoint and to persist answers to the brief's JSON data.

---

## Medium Priority

### Missing Features

- [ ] **`regenState.affectedIds`** — Never populated. Backend generate endpoints should return the IDs of newly created/updated items so the "Updated" pulse badge on `VersionDropdown` fires correctly.
- [ ] **Cascade regeneration** — When brief is regenerated via ChallengeBar, offer to cascade to epics → journeys → tasks. Currently each stage is fully independent.
- [ ] **Error states** — No user-facing error handling on failed API calls. Generate failures, save failures, and login errors silently fail or show nothing.
- [ ] **Empty states** — Pipeline pages (epics, journeys, tasks) need proper empty state UI when no data exists yet for a project.
- [ ] **`loadProject` → definition fields** — When loading an existing project, `communicationChannels` and `channelLinks` (now stored as JSON in DB) are not parsed back into the store's definition object.
- [ ] **Admin Integrations page** — Page UI exists but ClickUp OAuth / API key connection is not wired to the backend.

---

## Low Priority

### Polish

- [ ] **DB migration automation** — `migrate.sql` must be run manually. Add a startup check or npm script that auto-applies pending migrations.
- [ ] **`wbs_builder_test` migration parity** — Apply `migrate.sql` to the test DB on every migration to keep schema in sync with prod.
- [ ] **Theme persistence** — Light/dark theme toggle state is not persisted across page refresh.
- [ ] **Form validation** — NewProjectPage and ProjectDefinitionPage have minimal validation. Add field-level error messages.
- [ ] **Pagination** — `GET /projects` returns all projects with no pagination. Will degrade at scale.

---

## Architecture Decisions Pending

- [ ] **Python AI service vs Node module** — `CLAUDE.md` specifies a separate FastAPI AI service. Currently AI is a Node module inside the API. Decision: keep the Node module (simpler, fewer moving parts) or split to Python (matches spec, enables Instructor library for structured output enforcement and Langfuse integration).
- [ ] **PostgreSQL vs MySQL** — `CLAUDE.md` specifies Postgres 16 + pgvector. The implementation uses MySQL 8. Migration would unlock vector similarity search for future features (task deduplication, similar project lookup).
- [ ] **Async queue (BullMQ)** — AI generation is currently synchronous and blocks the HTTP request until the LLM responds. For production, generation should be queued via BullMQ + Redis with WebSocket progress updates to the frontend.
- [ ] **Langfuse tracing** — No LLM observability layer exists. Every AI call should be logged with prompt version, tokens used, latency, and cost estimate.
- [ ] **AC linter** — Referenced in `CLAUDE.md` and `docs/task-template.md` but not built. Should live in `packages/shared-types/src/ac-linter.ts`. Every task must pass the linter before it can be synced to ClickUp.
