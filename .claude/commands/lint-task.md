---
description: Lint a task's acceptance criteria against project quality rules
argument-hint: <path-to-task-json-or-task-id>
---

Run the AC linter against the task at $1.

Checks to perform:

1. Every AC follows Given/When/Then format. Flag any that do not.
2. No banned vague words: "user-friendly", "intuitive", "fast", "responsive" (as quality term, not CSS), "robust", "scalable", "seamless", "elegant".
3. Every AC has a clear measurable outcome. A tester must be able to write a pass/fail assertion.
4. At least 3 AC, at most 7 AC per task.
5. Covers at least one error path and one edge case.
6. No AC references external systems without specifying the expected interaction.
7. Task has estimate between 4 and 16 hours. Flag if outside.
8. Task has at least one test requirement listed.
9. Out-of-scope section is present and non-empty.
10. Non-functional requirements section is present.

Output format:
- PASS / FAIL per rule with the offending text
- Suggested rewrite for any failed rule
- Overall verdict: READY FOR SYNC / NEEDS REVISION
