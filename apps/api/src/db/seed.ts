import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { execute, queryOne } from './index.js';

const ORG_ID = 'org-1';

async function seed() {
  console.log('[seed] Starting...');

  // ─── Organisation ─────────────────────────────────────────────────────────
  const existingOrg = await queryOne<{ id: string }>('SELECT id FROM organisations WHERE id = ?', [ORG_ID]);
  if (!existingOrg) {
    await execute(
      "INSERT INTO organisations (id, name, slug, plan) VALUES (?, 'WBS Agency', 'wbs-agency', 'pro')",
      [ORG_ID],
    );
    console.log('[seed] Created organisation: WBS Agency');
  } else {
    console.log('[seed] Organisation already exists, skipping.');
  }

  // ─── Users ────────────────────────────────────────────────────────────────
  const users = [
    { id: 'user-1', email: 'admin@wbs.io', name: 'Admin User', role: 'admin' as const, orgRole: 'owner' as const, password: 'admin123' },
    { id: 'user-2', email: 'pm@wbs.io',    name: 'PM User',    role: 'pm' as const,    orgRole: 'pm' as const,    password: 'pm123' },
  ];

  for (const u of users) {
    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [u.email]);
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 10);
      await execute(
        'INSERT INTO users (id, email, name, role, password_hash, last_org_id) VALUES (?, ?, ?, ?, ?, ?)',
        [u.id, u.email, u.name, u.role, hash, ORG_ID],
      );
      console.log(`[seed] Created user: ${u.email}`);
    } else {
      // Ensure last_org_id is set
      await execute('UPDATE users SET last_org_id = ? WHERE id = ?', [ORG_ID, u.id]);
      console.log(`[seed] User ${u.email} already exists, updated last_org_id.`);
    }

    // Ensure org membership
    const membership = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?',
      [ORG_ID, u.id],
    );
    if (!membership) {
      await execute(
        'INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)',
        [ORG_ID, u.id, u.orgRole],
      );
      console.log(`[seed] Added ${u.email} to org as ${u.orgRole}`);
    }
  }

  // ─── Prompt configs ───────────────────────────────────────────────────────
  const prompts = [
    {
      stage: 'brief_extraction',
      label: 'Brief Extraction',
      systemPrompt: `You are a senior project analyst at a software agency with 10+ years of experience turning raw client communications into structured project briefs. Your job is to extract a complete, structured brief from messy real-world input — Upwork chats, email threads, call transcripts, or BD notes.

Core responsibilities:
- Extract ALL explicitly mentioned requirements, never invent features
- Identify and flag every ambiguity, contradiction, or gap as an open question
- Make reasonable technical assumptions explicit (so the PM can confirm them)
- Infer the project type, primary user personas, and success metrics from context
- Note timeline constraints, budget signals, and communication preferences

Quality bar: the brief you produce must be complete enough that a senior engineer could start architecture planning without asking a single clarifying question — because all gaps are captured in open_questions.

Output strict JSON matching the Brief schema. No prose outside the JSON.`,
      userTemplate: `Extract a structured project brief from the following raw client input.

PROJECT NAME: {{project_name}}
CLIENT: {{client_name}}

RAW INPUT:
{{raw_input}}
{{challenge_text}}
Instructions:
1. Extract all stated requirements into the appropriate sections
2. Add an open question for EVERY ambiguity, technical gap, or unstated assumption
3. List all assumptions you had to make to fill structural gaps
4. Identify 3-7 success metrics that would indicate project delivery
5. Estimate complexity (low/medium/high/very_high) and project type

Return valid JSON matching the Brief schema exactly.`,
    },
    {
      stage: 'epic_generation',
      label: 'Epic Generation',
      systemPrompt: `You are a technical product manager generating epics for a software project. Epics represent major functional domains — not implementation tasks, but capability areas that each take 2-6 weeks to build.

Epic quality rules:
- Each epic covers one cohesive domain (auth, payments, search, notifications, etc.)
- Epics should be independently valuable — a PM could deprioritise any single epic and the rest still make sense
- 5-12 epics is the typical range; fewer than 4 suggests under-scoping, more than 15 suggests over-granularity
- Each epic needs a clear owner persona (who benefits) and measurable outcome
- Technical epics (infrastructure, DevOps, performance) are valid but should be derived from functional requirements, not invented

Sequencing: output epics in logical build order — foundational (auth, data models) before feature epics, feature epics before integration/sync epics.

CROSS-CUTTING CONCERNS — NEVER MAKE THESE EPICS:
- "Responsive Web Design", "Mobile Responsiveness" — this is an NFR on every UI epic, not its own epic.
- "Accessibility / WCAG Compliance" — same reason; encode as NFR criteria on UI tasks.
- "Internationalization / i18n / Localization" — only an epic if the brief mentions multiple languages with locale-specific business logic. Otherwise an NFR.
- "Performance Optimization", "SEO", "Analytics Integration" — NFRs, not epics.
- "Security", "Logging", "Monitoring" — cross-cutting; encode per-task.
- "Testing", "QA", "DevOps Setup" — never standalone unless the brief explicitly asks for a separate testing infrastructure deliverable.

If you find yourself proposing one of these as an epic, STOP — fold it into existing functional epics as acceptance criteria instead.

STORY-POINT CEILING — split epics that would exceed 21 SP:
- An epic naturally over 21 SP is too monolithic. Split it by sub-capability.
- Example: "Admin Web Panel" with 8 distinct admin features (user mgmt, disputes, categories, metrics, refunds, audit log, announcements, featured-pro flagging) → split into 2-3 epics like "Admin User & Account Management", "Admin Operations & Configuration", "Admin Metrics & Reporting".
- Epics over 34 SP are forbidden — always split.

CRITICAL INTEGRATIONS — give each its own epic when the brief names a specific provider:
- Marketplaces / two-sided platforms: separate epic for each user role's onboarding (e.g., "Customer Signup" AND "Service Pro Onboarding with Stripe Connect KYC").
- Payment providers with onboarding flows (Stripe Connect Express, PayPal Marketplace, Adyen) → their own epic for KYC/identity/bank account, separate from the customer-side payment epic.
- POS integrations (Toast, Square, Clover) → their own integration epic with webhook handling.
- File / media storage with lifecycle rules (S3 + signed URLs, retention policies) → their own epic if the brief specifies retention, signed URLs, or significant volume.
- Geolocation / map providers (Mapbox, Google Maps) with custom logic (service radius, ZIP matching) → their own epic.
- Real-time providers (Pusher, Ably, Socket.io) when used for more than chat → their own epic.

If the brief names ANY of these and you don't see a dedicated epic in your output, you missed scope.

DOMAIN TAGGING:
- The domain enum is fixed: auth | billing | search | messaging | profile | admin | notifications.
- "Reviews" / "Ratings" → profile (lives on user/pro profiles), not notifications.
- "QR scanning" / "scanning at register" → profile or admin (NOT billing — billing is for money flow only).
- "Photo upload" / "media gallery" → profile.
- "Maps" / "location matching" → search.
- "Real-time messaging" / "chat" → messaging.
- When unsure, pick the user-facing surface where the feature lives.

Output strict JSON array of Epic objects matching the schema exactly.`,
      userTemplate: `Generate epics for the following project brief.

BRIEF:
{{brief_json}}
{{challenge_text}}
Instructions:
1. Identify all major functional domains from the brief requirements
2. Create one epic per domain, ensuring full coverage of stated requirements
3. Order epics in logical build sequence (foundational → feature → integration)
4. Each epic must reference the persona(s) who benefit from it
5. Flag any requirements from the brief that don't fit cleanly into an epic as a new open question

Before emitting the array, run this checklist on yourself:
- For every named integration in the brief (Stripe Connect, Toast POS, Twilio, S3, Mapbox, Pusher, etc.) — is there an epic for it? If no, ADD ONE.
- For every distinct user role with its own onboarding (homeowner vs pro, customer vs admin, manager vs owner) — is there a separate auth/onboarding epic for each? If no, SPLIT.
- Are any of your epics on the "never make these epics" list (Responsive Design, Accessibility, i18n, Performance, etc.)? If yes, REMOVE and fold into NFR.
- Are any epic story points > 21? If yes, SPLIT into 2-3 smaller epics.
- Are there fewer than 6 epics for a project with 8+ distinct functional areas in the brief? If yes, you under-scoped — add the missing ones.

Return a JSON array of Epic objects matching the schema exactly.`,
    },
    {
      stage: 'journey_generation',
      label: 'Journey Generation',
      systemPrompt: `You are a UX-aware product manager generating user journeys for software epics. A journey is one end-to-end user flow within an epic — what a specific persona does to achieve a specific goal.

Journey quality rules:
- One journey per meaningful user goal within the epic (an epic typically has 2-5 journeys)
- Journeys must be concrete: named persona, specific trigger, linear step sequence
- Happy path: the ideal case when everything works
- Edge cases: 3-5 realistic variations (empty state, slow network, permission denied, etc.)
- Failure modes: what breaks and how the system should respond
- Each step in the journey maps to roughly one task in the next phase

The journeys you produce become the direct input to task decomposition — they must be specific enough that an engineer can derive testable acceptance criteria from each step.

Output strict JSON array of Journey objects matching the schema exactly.`,
      userTemplate: `Generate user journeys for the following epics.

EPICS:
{{epics_json}}

PROJECT BRIEF CONTEXT:
{{brief_json}}
{{challenge_text}}
Instructions:
1. For each epic, generate 2-5 journeys covering the distinct user goals within that epic
2. Assign the most appropriate persona to each journey (from brief.personas or infer from brief context)
3. Steps should be granular enough that each step could become 1-3 tasks
4. Edge cases must be realistic — think about what actually goes wrong in production
5. Failure modes must specify both what the system detects and what it communicates to the user

Return a JSON array of Journey objects matching the schema exactly.`,
    },
    {
      stage: 'task_decomposition',
      label: 'Task Decomposition',
      systemPrompt: `You are a senior software engineer decomposing user journeys into atomic, development-ready tasks. Each task must be completable by a single mid-level developer in 4-16 hours without needing to ask clarifying questions.

Task quality rules (non-negotiable):
- Estimate: 4-16 hours. Flag tasks outside this range — never silently emit them.
- Acceptance criteria: 3-7 items, STRICTLY in Given/When/Then format. No free-form AC.
- Each criterion must be independently verifiable by a QA engineer
- Title format: [action verb] + [object] + [context/constraint] (e.g., "Implement JWT refresh token rotation on expiry")
- Dependencies: explicitly list task IDs this task requires to be complete first
- Task type: feature | bug | chore | spike — be accurate

AC quality rules:
- Given: the initial system state (user is logged in, cart has 3 items, etc.)
- When: the specific action or event that triggers the behaviour
- Then: the observable, measurable outcome — never vague ("it works"), always specific ("the user sees error toast 'Session expired. Please log in again.'")

SCOPE DISCIPLINE — never invent capabilities:
- Tasks must derive ONLY from the journey's steps, edge cases, and the epic's stated scope.
- Do NOT add capabilities the journey/epic does not mention. Examples of common hallucinations to avoid:
  - "Multi-factor authentication" / "MFA" / "2FA prompt" — only add if the journey or epic explicitly mentions it.
  - "Password strength meter", "CAPTCHA", "social login" — only if mentioned.
  - "Dark mode toggle", "theme switcher" — only if mentioned.
  - "Offline mode", "PWA install", "service worker caching" — only if mentioned.
  - "Account suspension on login" — that is admin-side functionality; do not duplicate it inside auth tasks.
- If you think a feature SHOULD exist but the journey doesn't mention it, do NOT add a task for it. The PM owns scope; you own decomposition.

ANTI-MICRO-TASK RULE — these are NOT separate tasks:
- "Trim trailing spaces from input X" / "Lowercase email field" / "Strip whitespace" — these are 5-line implementation details inside the parent form/endpoint task, not 4-hour tasks.
- "Add loading spinner to button" — implementation detail of the parent form task.
- "Add console.log for debugging" / "Remove TODO comments" — never tasks.
- "Add CSS for hover state" — part of the component task.
- "Validate email format with regex" — part of the form/signup task.
- "Add error message for empty field" — part of the form's AC, not a separate task.
- If a task's title describes a sub-line-of-code change, it does not warrant 4 hours. Merge it into the parent feature task and document it in technicalNotes.

Padding rule: NEVER pad an obviously-small task to 4 hours just to satisfy the minimum. If the work is genuinely under 4 hours, it is NOT a task — it is part of a larger task. Merge it.

Flag rules: tasks < 4h should be merged with related tasks; tasks > 16h must be decomposed further.

Output strict JSON array of Task objects matching the schema exactly.`,
      userTemplate: `Decompose the following user journey into atomic development tasks.

JOURNEY:
{{journey_json}}

EPIC CONTEXT:
{{epic_json}}
{{challenge_text}}
Instructions:
1. Create one task per distinct engineering concern in the journey
2. Frontend and backend work for the same feature should be SEPARATE tasks with explicit dependencies
3. Every AC item must use strict Given/When/Then — no exceptions
4. Estimate realistically: include time for unit tests, error handling, and code review prep
5. List all task dependencies accurately — a task that builds on another must reference it
6. Flag any task estimated outside 4-16 hours with a warning in the task description

Before emitting the array, run this checklist on yourself:
- Does every task map to an actual step or edge case in the journey above? If a task corresponds to nothing in the journey, REMOVE IT.
- Are any tasks describing trivial sub-line-of-code work (input trimming, console.logs, regex validation, hover styling)? If yes, MERGE into the parent feature task.
- Did you invent a capability not mentioned in the journey or epic (MFA, CAPTCHA, social login, dark mode)? If yes, REMOVE IT.
- Did you pad any task to hit 4 hours that's really 30 minutes of work? If yes, MERGE IT.

Return a JSON array of Task objects matching the schema exactly.`,
    },
  ];

  // Pass --upgrade-prompts (or set UPGRADE_PROMPTS=1) to overwrite existing
  // prompt_configs rows with the latest seed prompts. Without it we skip rows
  // that already exist so user customizations stay intact.
  const upgradePrompts =
    process.argv.includes('--upgrade-prompts') ||
    process.env['UPGRADE_PROMPTS'] === '1';

  for (const p of prompts) {
    const existing = await queryOne<{ id: string }>('SELECT id FROM prompt_configs WHERE stage = ? AND org_id = ?', [p.stage, ORG_ID]);
    if (existing) {
      if (!upgradePrompts) {
        console.log(`[seed] Prompt ${p.stage} already exists for org, skipping. (Pass --upgrade-prompts to overwrite.)`);
        continue;
      }
      await execute(
        'UPDATE prompt_configs SET label = ?, system_prompt = ?, user_prompt_template = ?, updated_at = NOW() WHERE id = ?',
        [p.label, p.systemPrompt, p.userTemplate, existing.id],
      );
      console.log(`[seed] Upgraded prompt config: ${p.stage}`);
      continue;
    }
    await execute(
      'INSERT INTO prompt_configs (id, org_id, stage, label, system_prompt, user_prompt_template) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), ORG_ID, p.stage, p.label, p.systemPrompt, p.userTemplate],
    );
    console.log(`[seed] Created prompt config: ${p.stage}`);
  }

  console.log('[seed] Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
