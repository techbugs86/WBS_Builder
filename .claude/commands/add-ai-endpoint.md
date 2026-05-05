---
description: Add a new AI generation endpoint following the full pipeline conventions
argument-hint: <endpoint-name> <short-description>
---

Add a new LLM generation endpoint to the AI service.

Endpoint: $1
Description: $2

Follow these steps in order. Do not skip any.

1. Read `CLAUDE.md` and `docs/task-template.md` to confirm conventions.
2. Define input and output types in `packages/shared-types/src/ai/` using Zod schemas.
3. Create the prompt file at `prompts/$1/v1.md` with:
   - System prompt
   - User prompt template with placeholders
   - JSON schema for structured output
   - 3 example input/output pairs
4. Update `prompts/manifest.json` to register the new prompt with version 1.
5. Add the FastAPI route at `apps/ai/routes/$1.py` that:
   - Loads the prompt via the prompt loader
   - Uses Instructor for structured output
   - Wraps the call in a Langfuse trace
   - Validates output against the Pydantic model
   - Runs the critic pass if one exists for this endpoint type
6. Add pytest cases at `apps/ai/evals/test_$1.py` with at least 5 scenarios covering happy path, edge case, missing input, ambiguous input, and adversarial input.
7. Add the backend proxy route at `apps/api/src/routes/ai/$1.ts`.
8. Add a WBS event log entry so the UI can show progress.
9. Run `pytest apps/ai/evals/test_$1.py` and `npm test` in the api package. Report results.
10. Do not modify frontend code in this command. Report what the frontend team needs to wire.
