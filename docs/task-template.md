# Task Template Specification

This is the canonical shape of every atomic task in the WBS platform. Generators must produce this structure. The AC linter enforces it. ClickUp sync maps from it.

## Required fields

```typescript
{
  wbs_id: string;              // e.g. "WBS-2041"
  title: string;               // "[Module] - Action - Object"
  objective: string;           // One sentence in business terms
  background: string;          // 2-4 lines of context
  epic_id: string;
  journey_id: string;
  stack: "LAMP" | "MERN" | "other";
  technical_scope: {
    stack_details: string;     // e.g. "Node 20, Express 4, Mongoose"
    endpoints?: string[];      // API endpoints to create/modify
    files?: string[];          // Files likely to change
    env_vars?: string[];       // New env vars
    db_changes?: string;       // Schema migrations or "None"
    dependencies_added?: string[];
  };
  acceptance_criteria: {
    id: string;
    given: string;
    when: string;
    then: string;
  }[];                         // 3 to 7 items
  out_of_scope: string[];      // Non-empty
  non_functional: {
    security?: string[];
    performance?: string[];
    logging?: string[];
    error_handling?: string[];
    observability?: string[];
  };
  dependencies: {
    type: "blocks" | "blocked_by" | "related";
    wbs_id: string;
    note?: string;
  }[];
  test_requirements: {
    unit: string;
    integration: string;
    edge_cases: string[];
    qa_steps?: string[];
  };
  estimate_hours: number;      // 4 to 16 ideally
  complexity: "low" | "medium" | "high";
  risk_flags: string[];
  definition_of_done: string[];
  owner_role: string;          // e.g. "backend-dev" (role, not person)
  reviewer_role: string;
  priority: "low" | "medium" | "high" | "urgent";
  _meta: {
    ai_generated: boolean;
    prompt_version?: string;
    confidence: number;        // 0 to 1
    open_questions: string[];
    created_at: string;
    version: number;
  };
}
```

## AC quality rules (enforced by linter)

1. Must follow Given/When/Then structure
2. Must be testable: a QA engineer can write a pass/fail assertion from it
3. No banned words: user-friendly, intuitive, fast, responsive (as quality), robust, scalable, seamless, elegant
4. Must reference concrete inputs, outputs, or state changes
5. At least one AC must cover an error path
6. At least one AC must cover an edge case
7. Between 3 and 7 AC per task
