---
description: Run eval suite for a prompt and compare to baseline
argument-hint: <prompt-name>
---

Run evals for the prompt: $1

1. Load the prompt at `prompts/$1/` — use the version marked `current` in `prompts/manifest.json`.
2. Load the eval dataset at `apps/ai/evals/datasets/$1.jsonl`.
3. Run each case through the prompt. For each:
   - Record output
   - Score against the rubric in `apps/ai/evals/rubrics/$1.md`
   - Record tokens and cost
4. Compare to the last baseline in `apps/ai/evals/baselines/$1.json`.
5. Report:
   - Pass rate per rubric criterion
   - Delta vs. baseline (regressions flagged in red)
   - Token and cost delta
   - Top 3 failure modes with example inputs
6. If pass rate regressed by >5%, do not update the baseline. Report and stop.
7. If pass rate improved, ask before updating the baseline.
