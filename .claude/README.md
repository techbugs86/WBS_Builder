# .claude directory

This directory configures Claude Code's behavior for this project. Commit it to git so the whole team shares the same conventions.

## What's here

### `settings.json`
Permissions file. Tells Claude Code which bash commands are auto-allowed, which require confirmation, and which are denied outright.

Key rules:
- Package installs, tests, linters, git read ops → allowed
- `git push`, adding new dependencies, destructive DB ops → ask first
- Force-push, recursive deletes, reading `.env` files, direct external API calls → denied

Personal overrides go in `.claude/settings.local.json` (gitignored). Do not commit API keys or personal preferences to the shared file.

### `commands/`
Custom slash commands. Type `/` in Claude Code to see the list.

- `/add-ai-endpoint <name> <description>` — scaffold a new LLM generation endpoint end-to-end
- `/lint-task <path>` — run the AC quality linter against a task
- `/sync-clickup <project-id>` — dry-run and execute ClickUp sync with safety gates
- `/run-evals <prompt-name>` — run prompt eval suite with regression detection

Add your own by dropping a `.md` file here with a frontmatter `description` and `argument-hint`.

### `agents/`
Specialized subagents Claude can delegate to. Each has a focused scope and a limited tool set.

- `prompt-engineer` — for prompt work only, will not touch Node or React
- `clickup-integrator` — for sync pipeline work, enforces source-of-truth rules
- `schema-guardian` — for schema changes across TS, Python, and SQL

## When to invoke an agent

Claude Code routes automatically based on the `description` field, but you can also invoke explicitly:

> "Use the prompt-engineer agent to revise the task decomposition prompt"

This keeps context narrow and prevents the main session from accumulating unrelated context.

## When to add a new slash command

Add a command when you find yourself typing the same multi-step instruction twice. Good commands encode a *process*, not just a prompt.

## When to add a new agent

Add an agent when:
- A distinct area of the codebase has its own rules (like ClickUp or prompts)
- You want to limit the tools available for a sensitive task
- You want a narrower context window for focused work

Do not create agents for every file type. Too many agents fragment the project knowledge.
