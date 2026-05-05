# WBS Builder — Architecture

## Overview

WBS Builder is a two-service web application. A React frontend communicates with a Node/Express backend over a REST API. The backend owns all database access, all AI calls, and all business logic.

```
Browser (React + Vite)
        │  HTTP / fetch (JWT in Authorization header)
        ▼
Node/Express API  ─────────────────────────────────────────┐
        │                                                   │
        ├── MySQL 8 (mysql2/promise pool)                   │
        │   organisations, users, org_members,              │
        │   projects, briefs, epics, journeys,              │
        │   tasks, settings, prompt_configs,                │
        │   prompt_config_history                           │
        │                                                   │
        └── AI module (apps/api/src/ai/index.ts)            │
            Anthropic Claude / OpenAI GPT                   │
            Called synchronously within the request         │
```

There is currently no separate Python AI service, no message queue, no vector store, and no LLM observability layer. These are planned but not yet built (see `docs/todo.md`).

---

## Services

### `apps/web` — React Frontend

| Concern | Choice |
|---|---|
| Build tool | Vite |
| UI framework | React 18 |
| Styling | TailwindCSS |
| Component library | shadcn/ui primitives |
| Server state | TanStack Query (planned; currently store-managed) |
| Client state | Zustand (`useProjectStore`) |
| Routing | React Router v6 |
| HTTP client | `apps/web/src/lib/api.ts` — typed fetch wrapper, JWT auto-injected |

### `apps/api` — Node/Express Backend

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express |
| Language | TypeScript (strict mode, ES modules) |
| Database driver | mysql2/promise (connection pool) |
| Auth | JWT (jsonwebtoken) + bcrypt |
| AI | Internal module `apps/api/src/ai/index.ts` |
| LLM providers | Anthropic Claude, OpenAI GPT (provider selected per-request) |

---

## Database

**Engine:** MySQL 8. All access goes through a single mysql2/promise pool defined in `apps/api/src/db/index.ts`.

### Tables

| Table | Purpose |
|---|---|
| `organisations` | Top-level tenants. Every row of tenant data carries an `org_id`. |
| `users` | Global user accounts (email, bcrypt password hash). |
| `org_members` | Junction table: user ↔ org with an org-level role (`owner`, `admin`, `pm`). |
| `projects` | One client engagement. Belongs to an org. Carries definition JSON (channels, raw input, provider preference). |
| `briefs` | Structured extraction from raw client input. Has `open_questions` and `assumptions` arrays (stored as JSON). |
| `epics` | High-level scope units. Belong to a project. |
| `journeys` | User journeys tied to an epic. Has persona, steps, edge cases. |
| `tasks` | Atomic work units. Map to one ClickUp task each. Strict task template with GWT acceptance criteria. |
| `settings` | Admin-level key/value config (API keys, feature flags). |
| `prompt_configs` | Per-stage, per-project-type prompt templates. Queried by `stage` + `projectType`. |
| `prompt_config_history` | Append-only history of every prompt save. Version number increments per stage/projectType pair. |

### Versioning pattern

Every pipeline entity (`briefs`, `epics`, `journeys`, `tasks`) is append-only versioned:

- Each row has an `is_current` flag and a `version` integer.
- An update inserts a new row with `is_current = 1` and increments `version`.
- The previous row is updated to `is_current = 0`.
- Hard deletes never happen on versioned tables.
- The frontend uses `VersionDropdown` to display history and trigger a restore (POST `.../restore/:v`), which inserts a copy of the target version as a new `is_current` row.

---

## Multi-Tenancy

Every tenant table carries an `org_id` foreign key. The API middleware resolves the calling user's org from the JWT and appends `WHERE org_id = ?` to every query. Users cannot access data across org boundaries.

Org-level roles (`owner`, `admin`, `pm`) are stored in `org_members` and control access to admin routes.

---

## Authentication and RBAC

**Flow:**
1. `POST /auth/login` validates email + bcrypt password against the `users` table.
2. On success, a JWT is issued containing `userId`, `email`, `name`, `role` (system role), and `orgId`.
3. The frontend stores the JWT in `localStorage` under the key `wbs_token`.
4. Every subsequent request includes `Authorization: Bearer <token>`.
5. The `authenticate` middleware on the API verifies and decodes the JWT, attaching the user to `req.user`.

**Roles:**
- System roles: `admin`, `pm` (stored on the `users` table).
- Org roles: `owner`, `admin`, `pm` (stored in `org_members`).
- Admin-only routes (`/admin/*`) are protected by a `requireAdmin` middleware that checks the system role.

---

## AI Module

**Location:** `apps/api/src/ai/index.ts`

**Behaviour:**
- When `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is present in the environment, real LLM calls are made.
- When neither key is present, the module returns deterministic mock responses so the full pipeline can be exercised locally without credentials.
- Provider is selected per-request via a `provider` field on the request body (`"anthropic"` | `"openai"`).
- Prompt templates are loaded from the `prompt_configs` table (keyed by stage and projectType).
- All generation endpoints use structured output (JSON). The module enforces this by including a JSON schema in the LLM request and validating the response.

**Default model mapping:**

| Provider | Generation | Lint / Critic |
|---|---|---|
| Anthropic | Claude Sonnet | Claude Haiku |
| OpenAI | GPT-4o | GPT-4o-mini |

Model strings are defined in one place inside the AI module — never hardcoded in route handlers.

**Synchronous execution:** AI calls currently block the HTTP request until the LLM responds. There is no queue. This is acceptable for MVP but will need to move to BullMQ + WebSocket progress for production (see `docs/todo.md`).

---

## API Routes

All routes are prefixed with nothing (served at `:4000`). Auth routes are public; everything else requires a valid JWT.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Validate credentials, return JWT |

### Projects
| Method | Path | Description |
|---|---|---|
| GET | `/projects` | List all projects for the authenticated org |
| POST | `/projects` | Create a new project |
| GET | `/projects/:id` | Get a single project with all pipeline data |
| PATCH | `/projects/:id` | Update project definition fields |

### Brief
| Method | Path | Description |
|---|---|---|
| GET | `/projects/:id/brief` | Get current brief (with version history) |
| POST | `/projects/:id/brief` | Save a brief |
| POST | `/projects/:id/brief/generate` | Generate brief from raw input via AI |
| PATCH | `/projects/:id/brief` | Partial update of brief fields |
| POST | `/projects/:id/brief/restore/:v` | Restore brief to version `v` |

### Epics
| Method | Path | Description |
|---|---|---|
| GET | `/projects/:id/epics` | List epics (current versions) |
| POST | `/projects/:id/epics` | Save a set of epics |
| POST | `/projects/:id/epics/generate` | Generate epics from brief via AI |
| PATCH | `/projects/:id/epics/:epicKey` | Update a single epic |
| POST | `/projects/:id/epics/:epicKey/restore/:v` | Restore epic to version `v` |

### Journeys
Same pattern as epics, with `/journeys` and `:journeyKey`.

### Tasks
Same pattern as epics, with `/tasks` and `:taskKey`.

### Sync
| Method | Path | Description |
|---|---|---|
| POST | `/projects/:id/sync` | Trigger ClickUp sync (currently returns mock log) |

### Admin — Prompts
| Method | Path | Description |
|---|---|---|
| GET | `/admin/prompts/:stage` | Get prompt config for a stage. Accepts `?projectType=` |
| PUT | `/admin/prompts/:stage` | Save prompt config, append to history |

### Admin — Settings
| Method | Path | Description |
|---|---|---|
| GET | `/admin/settings` | Get all settings (API keys, flags) |
| PUT | `/admin/settings` | Update settings |

### Admin — Users
| Method | Path | Description |
|---|---|---|
| GET | `/admin/users` | List all users in the org |
| POST | `/admin/users` | Create a user |
| PATCH | `/admin/users/:id` | Update user fields |
| DELETE | `/admin/users/:id` | Deactivate a user |
| POST | `/admin/users/:id/reset-password` | Reset a user's password |

---

## Frontend

### Routing

| Path | Component | Access |
|---|---|---|
| `/login` | `LoginPage` | Public |
| `/projects` | `ProjectsPage` | Auth |
| `/projects/new` | `NewProjectPage` (3-step wizard) | Auth |
| `/projects/:id/definition` | `ProjectDefinitionPage` | Auth |
| `/projects/:id/brief` | `BriefPage` | Auth |
| `/projects/:id/epics` | `EpicsPage` | Auth |
| `/projects/:id/journeys` | `JourneysPage` | Auth |
| `/projects/:id/tasks` | `TasksPage` | Auth |
| `/projects/:id/sync` | `SyncPage` | Auth |
| `/admin/settings` | `AdminSettingsPage` (tabs: API Keys, Prompt Config, Users) | Admin |

`ProtectedRoute` wraps all non-login routes. `ProtectedRoute requiredRole="admin"` wraps admin routes.

### State Management

All application state lives in a single Zustand store: `useProjectStore` (`apps/web/src/store/`).

Key state slices:
- **Auth:** `currentUser`, `authError`, `login()`, `logout()`
- **Projects:** `projects`, `activeProjectId`, `loadProjects()`, `createProject()`, `loadProject()`
- **Pipeline:** `brief`, `epics`, `journeys`, `tasks` — each as versioned collections
- **Regen:** `regenState` — tracks which stage is generating and which item IDs were affected
- **Admin:** `promptConfigs`, `settings`, `users`

All store actions that mutate data make real API calls via `apps/web/src/lib/api.ts`. The store holds the result.

### Key Shared Components

| Component | Location | Purpose |
|---|---|---|
| `Sidebar` | `components/Sidebar.tsx` | Context-aware nav. Global project list at `/projects`; pipeline stage nav inside `/projects/:id/*`. Shows user name, role badge, logout. |
| `ChallengeBar` | `components/ChallengeBar.tsx` | Bottom-anchored input for stage-wide AI regeneration with a challenge instruction. Triggers progress animation and diff summary. |
| `VersionDropdown` | `components/VersionDropdown.tsx` | Per-item version history and restore. Only renders when more than one version exists. |
| `DetailPanel` | `components/DetailPanel.tsx` | 48%-width right-side panel (sidecar). Props: `open`, `onClose`, `title`, `children`, `footer`. |
| `PromptEditor` | `components/PromptEditor.tsx` | Conversational AI rewrite textarea. Props: `placeholder`, `onSubmit`, `isProcessing`. Used inside `DetailPanel`. |
| `Badge` | `components/ui/Badge.tsx` | Colour-coded status and role badges. |
| `Button` | `components/ui/Button.tsx` | Standard button with variant and size props. |
| `Card` | `components/ui/Card.tsx` | Container card used across pipeline list views. |

### Data Model (Frontend Types)

All versioned pipeline entities follow this wrapper:

```typescript
interface Version<T> {
  version: number;
  label: string;
  createdAt: string;
  challengeText?: string;
  data: T;
}
```

With history types:
- `BriefWithHistory` — `{ current: Brief, history: Version<Brief>[] }`
- `EpicWithHistory` — per-epic keyed by `epicKey`
- `JourneyWithHistory` — per-journey keyed by `journeyKey`
- `TaskWithHistory` — per-task keyed by `taskKey`

`ProjectDefinition` holds all intake fields: `clientName`, `channel`, `rawInput`, `attachedFiles`, `communicationChannels`, `channelLinks`, `provider`.

---

## Layout Conventions

- `App.tsx` root `<main>` uses `flex flex-col overflow-hidden`.
- Pages with their own scroll (BriefPage, EpicsPage, JourneysPage, TasksPage): `flex flex-col h-full`.
- Pages without own scroll (ProjectsPage, NewProjectPage, SyncPage): `h-full overflow-y-auto`.
- `DetailPanel` is absolutely positioned to the right and overlays the page without shifting layout.

---

## What Is Not Yet Built

See `docs/todo.md` for the complete list. Key gaps at the architecture level:

- No separate Python AI service (AI is a Node module)
- No BullMQ / Redis queue (AI is synchronous)
- No Langfuse tracing
- No pgvector / vector store
- No real ClickUp API integration
- No AC linter (`packages/shared-types/src/ac-linter.ts`)
