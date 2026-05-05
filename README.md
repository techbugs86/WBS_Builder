# WBS Builder

Internal SaaS platform for converting raw client communications into structured, developer-ready ClickUp tasks through a 4-stage AI pipeline.

```
Raw Input → Brief → Epics → Journeys → Tasks → ClickUp Sync
```

## Quick Start

See [docs/setup.md](docs/setup.md) for full setup instructions.

```bash
# 1. Install dependencies
cd apps/api && npm install
cd ../web && npm install

# 2. Set up database
mysql -u root < apps/api/src/db/schema.sql
mysql -u root wbs_builder < apps/api/src/db/migrate.sql
cd apps/api && npm run build && node --env-file=.env dist/db/seed.js

# 3. Start
cd apps/api && npm run dev      # API on :4000
cd apps/web && npm run dev      # Frontend on :5173
```

**Login:** admin@wbs.io / admin123

## Architecture

- `apps/web` — React 18 + Vite + Zustand + TailwindCSS
- `apps/api` — Node.js + Express + TypeScript + MySQL
- See [docs/architecture.md](docs/architecture.md) for full details

## What's Working

- Auth (JWT, bcrypt, admin/pm roles, multi-tenant orgs)
- Project CRUD with multi-channel communication tracking
- Full AI pipeline: Brief → Epics → Journeys → Tasks (mock when no API key, real when key present)
- Per-item version history with restore across all pipeline stages
- ChallengeBar: stage-wide regeneration with instruction
- Per-item AI rewrite via PromptEditor
- Admin: user management, API key settings, per-project-type prompt configs with version history
- Light/dark theme
- Multi-tenant (org-scoped data isolation)

## What's Pending

See [docs/todo.md](docs/todo.md) for the full list.

Key gaps:
- ClickUp sync (mocked)
- Real AI calls (automatic when `ANTHROPIC_API_KEY` set in `.env`)
- Open questions answering persistence
- Error states and empty states

## Docs

- [Architecture](docs/architecture.md)
- [Setup](docs/setup.md)
- [Todo](docs/todo.md)
- [Task Template Spec](docs/task-template.md)
