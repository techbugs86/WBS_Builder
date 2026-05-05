# WBS Builder — Setup Guide

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 LTS or later |
| MySQL | 8.0 or later |
| npm | Included with Node 20 |

No other runtimes are required. The AI module is embedded in the API and calls external LLM providers directly — no Python, no separate AI service to run.

---

## 1. Clone and install dependencies

```bash
git clone <repo-url>
cd wbs-builder

# Install API dependencies
cd apps/api && npm install

# Install frontend dependencies
cd ../web && npm install
```

---

## 2. Configure environment variables

Create `apps/api/.env` based on the example below. All fields are required unless marked optional.

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=wbs_builder
JWT_SECRET=your-secret-here
PORT_API=4000
CORS_ORIGIN=http://localhost:5173
ANTHROPIC_API_KEY=   # optional — mock AI is used when absent
OPENAI_API_KEY=      # optional
```

- If neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set, the AI module returns deterministic mock responses. The full pipeline still works — you just get placeholder content.
- `JWT_SECRET` should be a long random string. Use `openssl rand -hex 32` to generate one.
- `CORS_ORIGIN` must match exactly the URL the frontend runs on (no trailing slash).

---

## 3. Set up the database

Run the schema and migration scripts against MySQL. These are safe to run on a fresh install.

```bash
# Create the database and all tables
mysql -u root < apps/api/src/db/schema.sql

# Apply any migrations (column additions, index changes)
mysql -u root wbs_builder < apps/api/src/db/migrate.sql
```

Build the API first so the seed script is available:

```bash
cd apps/api && npm run build
```

Then seed the database with an initial org, admin user, and PM user:

```bash
cd apps/api && node --env-file=.env dist/db/seed.js
```

**Seeded accounts:**

| Email | Password | Role |
|---|---|---|
| admin@wbs.io | admin123 | admin |
| pm@wbs.io | pm123 | pm |

---

## 4. Set up the test database (development only)

The test database is a separate MySQL database (`wbs_builder_test`). It is never used by the production API instance and is safe to truncate at any time.

```bash
# Apply the schema to the test database
mysql -u root wbs_builder_test < apps/api/src/db/migrate.sql

# Seed test-specific fixtures
cd apps/api && npm run seed:test
```

---

## 5. Run the services

### Development (with hot reload)

```bash
# Terminal 1 — API
cd apps/api && npm run dev
# Runs on http://localhost:4000

# Terminal 2 — Frontend
cd apps/web && npm run dev
# Runs on http://localhost:5173
```

### Production build

```bash
# Build and start the API
cd apps/api && npm run build && npm start

# Build the frontend (output goes to apps/web/dist)
cd apps/web && npm run build
```

### Test API instance

Starts an API server that points at `wbs_builder_test` instead of `wbs_builder`. Useful for running integration tests without affecting real data.

```bash
cd apps/api && npm run start:test
```

---

## 6. Verify the setup

1. Open `http://localhost:5173` in a browser.
2. Log in with `admin@wbs.io` / `admin123`.
3. Create a new project via the "New Project" button.
4. Step through the brief → epics → journeys → tasks pipeline.

If `ANTHROPIC_API_KEY` is not set, each "Generate" action returns mock data so you can verify the full UI flow without LLM credits.

---

## Troubleshooting

**MySQL connection refused**
- Confirm MySQL is running: `mysql.server status`
- Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS` in `.env`

**`Unknown database 'wbs_builder'`**
- The schema script creates the database. Re-run: `mysql -u root < apps/api/src/db/schema.sql`

**JWT errors / 401 on every request**
- Ensure `JWT_SECRET` in `.env` matches the value used when the token was issued. Changing it invalidates all existing sessions.

**CORS errors in the browser**
- `CORS_ORIGIN` in `.env` must exactly match the frontend origin including protocol and port (e.g. `http://localhost:5173`).

**AI returns mock data unexpectedly**
- Confirm `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is present in `apps/api/.env` and that the API server was restarted after adding it.
