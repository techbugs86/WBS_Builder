# WBS Builder Platform

## Project purpose

Internal tool for a software agency that converts raw client inputs (Upwork chats, BD notes, call transcripts) into structured, execution-ready ClickUp tasks through a Brief → Epic → Journey → Task pipeline with AI generation and PM human-in-the-loop review at each stage.

The output quality bar: every task that reaches a developer in ClickUp is unambiguous, testable, and scoped tightly enough that a mid-level dev can deliver it without asking clarifying questions.

## Architecture at a glance

Three services, one database, one vector store, one queue.

- **Frontend** — React + TypeScript + Vite. Three surfaces: Intake, WBS tree editor, Sync dashboard.
- **Backend API** — Node.js + Express + TypeScript. REST endpoints for CRUD on projects, briefs, epics, journeys, tasks. Handles auth, versioning, audit log, ClickUp sync orchestration.
- **AI service** — Python + FastAPI. Adapter layer over external LLM providers (Anthropic Claude and OpenAI GPT). Endpoints for brief extraction, epic generation, journey generation, task decomposition, AC linting. All LLM calls go through this service, never from the Node backend or frontend directly. Every endpoint accepts a `provider` param (`"anthropic"` | `"openai"`) — both are valid at runtime.
- **Database** — PostgreSQL 16. JSONB columns for flexible AI output storage.
- **Vector store** — pgvector extension on the same Postgres instance. Kept simple for MVP.
- **Queue** — BullMQ (Redis) for async AI generation jobs.
- **Observability** — Langfuse for LLM call logging, prompt versioning, and cost tracking.

Data flow: Frontend → Backend API → (queue a job) → AI service → LLM → back through the queue → Backend API → Frontend via WebSocket for progress.

## Repository layout

```
/apps
  /web            React frontend
  /api            Node/Express backend
  /ai             Python FastAPI AI service
/packages
  /shared-types   Shared TypeScript types (task schema, epic schema, etc.)
  /prompts        Version-controlled prompt templates (Python + TS readers)
/docs             Specs, ADRs, schemas
/prompts          Prompt library (source of truth)
/.claude
  /commands       Custom slash commands
  /agents         Specialized subagents
```

## Core domain model

The entire platform is built around these entities. Read `docs/schema.md` before modifying any of them.

- **Project** — top-level container. One client engagement.
- **Brief** — structured extraction from raw input. Has `open_questions` and `assumptions` arrays.
- **Epic** — high-level scope unit. Belongs to a project. Tagged by domain (auth, billing, admin, etc.).
- **Journey** — user journey tied to an epic. Has persona, steps, happy path, edge cases, failure modes.
- **Task** — atomic unit. Maps to exactly one ClickUp task. Follows the strict task template in `docs/task-template.md`.
- **TaskDependency** — directed edges between tasks (blocks / blocked-by).
- **Version** — every entity is versioned. Never hard-delete; soft-delete with a new version row.
- **FeedbackEvent** — captures edits, rejections, rework signals post-sync. Feeds prompt improvement.
- **ClickUpMapping** — maps WBS IDs to ClickUp task IDs. Idempotency lives here.

## Non-negotiable rules

These are enforced by linters and CI. Do not propose code that violates them.

1. **Every task must pass the AC linter before it can be synced to ClickUp.** Rules live in `packages/shared-types/src/ac-linter.ts`.
2. **Given/When/Then is the only AC format.** Reject free-form acceptance criteria.
3. **Every task has a `wbs_id` custom field in ClickUp.** This is how sync stays idempotent.
4. **WBS platform is source of truth for structure and AC. ClickUp is source of truth for execution state.** Never let them overlap.
5. **No LLM call bypasses the AI service.** Never add OpenAI/Anthropic SDK imports to the Node backend or React frontend.
6. **Every LLM call is logged to Langfuse with prompt version, input, output, tokens, latency, cost.** No exceptions.
7. **Structured output only.** Every generation endpoint uses JSON schema enforcement (Instructor library on the Python side). Never parse free-form LLM text.
8. **Versioning is append-only.** Updates create new version rows. Old versions are read-only.
9. **No secrets in code or prompts.** All keys via environment variables. `.env.example` lists required variables.
10. **Tasks smaller than 4 hours or larger than 16 hours get flagged.** The generator must warn, not silently emit.

## Tech stack specifics

- **Node**: 20 LTS. Use ES modules (`"type": "module"`).
- **TypeScript**: strict mode, no `any` without a comment justifying it.
- **Python**: 3.11+. Use `uv` for package management, `ruff` for lint+format, `pyright` for typing.
- **Postgres**: 16. Migrations via `node-pg-migrate` on the Node side; Python service is read-mostly and shares the same DB.
- **React**: 18 + Vite. TanStack Query for server state. Zustand for client state. TailwindCSS for styling. shadcn/ui for components.
- **LLM providers**: Both Anthropic Claude and OpenAI GPT are supported via a provider abstraction in the AI service. Default model mapping lives in `apps/ai/config/models.py` — never hardcode model strings elsewhere. Anthropic: Sonnet for generation, Haiku for lint/critic passes. OpenAI: GPT-4o for generation, GPT-4o-mini for lint/critic passes. Provider is selected per-request via a `provider` param.
- **Testing**: Vitest on the Node/React side, pytest on the Python side. Every AI endpoint has an eval suite in `apps/ai/evals/`.

## Coding conventions

- **Functions do one thing.** If a function is over 40 lines, split it.
- **Named exports, not default exports.** Easier to grep.
- **No comments that restate the code.** Comments explain *why*, not *what*.
- **Error handling is explicit.** No bare `try/except` or `try/catch`. Always log or rethrow with context.
- **Types are shared via `packages/shared-types`.** Do not duplicate type definitions between services.
- **Every new API endpoint has a corresponding type in `shared-types` and a test.**
- **Prompt changes require a version bump in `prompts/manifest.json` and a note in `prompts/CHANGELOG.md`.**

## How to work on this codebase

When asked to implement a feature, follow this sequence:

1. Read `docs/` for the relevant spec. If none exists, ask before coding.
2. Read the existing code in the affected service. Match its patterns.
3. If the change touches the task/epic/journey schema, update `packages/shared-types` first.
4. If the change touches a prompt, update it in `prompts/`, bump the version, and run the eval suite.
5. Write the test before the implementation when practical.
6. Run the linter and tests before reporting done.

When asked to add a new LLM capability:

1. Define the input/output schema in `packages/shared-types`.
2. Add the prompt to `prompts/` with a version.
3. Add the FastAPI endpoint in `apps/ai/routes/`.
4. Add an eval in `apps/ai/evals/` with at least 5 test cases.
5. Wire the backend endpoint in `apps/api/`.
6. Add the Langfuse trace.

## What to never do

- Never send raw client chat content to an LLM without first passing it through the brief extractor — client content may contain PII.
- Never hardcode ClickUp IDs, list IDs, or space IDs. Always look them up via the mapping table.
- Never retry LLM calls inside a request handler. Use the queue.
- Never modify a task after sync without creating a new version and re-syncing.
- Never add a dependency without noting the reason in the PR description.

## Where to find things

- Task template spec: `docs/task-template.md`
- Database schema: `docs/schema.md`
- ClickUp field mapping: `docs/clickup-mapping.md`
- Prompt library and versioning: `prompts/README.md`
- ADRs (architecture decisions): `docs/adr/`
- API contracts: `docs/api.md`

## Current status

MVP scope, week-by-week plan in `docs/roadmap.md`. At the time of writing, the project is at the scaffolding stage. Weeks 1–4 focus on getting one real project end-to-end through the pipeline with a single PM as the user.
