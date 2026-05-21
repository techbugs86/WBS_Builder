/**
 * AI Provider Abstraction
 *
 * - If ANTHROPIC_API_KEY / OPENAI_API_KEY is set → calls real LLM
 * - If absent → returns realistic mock data with the exact same shape
 * - All outputs validated via Zod before returning (fail-fast on malformed LLM responses)
 *
 * Provider is selected per-request via the `provider` param ('anthropic' | 'openai').
 */

import { z } from 'zod';
import { v4 as uuid } from 'uuid';

// ─── Output schemas (Zod) ──────────────────────────────────────────────────

const OpenQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(['open', 'answered', 'dismissed']).default('open'),
  answer: z.string().default(''),
});

export const BriefSchema = z.object({
  title: z.string(),
  client: z.string(),
  date: z.string(),
  summary: z.string(),
  openQuestions: z.array(OpenQuestionSchema),
  assumptions: z.array(z.object({ id: z.string(), text: z.string() })),
  inScope: z.array(z.string()),
  outOfScope: z.array(z.string()),
});

// z.coerce.number() — accepts both `34` (number) and `"34"` (string).
// LLMs (especially OpenAI) frequently return numeric fields as strings; this
// keeps the Zod boundary strict while tolerating that inconsistency.

export const EpicSchema = z.object({
  id: z.string(),
  title: z.string(),
  domain: z.enum(['auth', 'billing', 'search', 'messaging', 'profile', 'admin', 'notifications']),
  description: z.string(),
  storyPoints: z.coerce.number(),
  status: z.enum(['pending', 'approved']).default('pending'),
});

// A single QA-ready test case for a journey, in Given/When/Then form.
const TestCaseSchema = z.object({
  name: z.string(),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});

export const JourneySchema = z.object({
  id: z.string(),
  epicId: z.string(),
  persona: z.string(),
  title: z.string(),
  steps: z.array(z.string()),
  happyPath: z.string(),
  // Edge cases as descriptive strings — "what happens when X". Optional with [] default
  // so legacy journeys without this field still validate.
  edgeCases: z.array(z.string()).default([]),
  // Structured QA test cases — derived from happy path + edge cases.
  testCases: z.array(TestCaseSchema).default([]),
  // Count is kept for backwards-compatibility with the existing UI badges.
  edgeCasesCount: z.coerce.number().default(0),
  status: z.enum(['pending', 'approved']).default('pending'),
});

const CriterionSchema = z.object({
  type: z.enum(['functional', 'non-functional', 'technical']),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});

export const TaskSchema = z.object({
  id: z.string(),
  wbsId: z.string(),
  title: z.string(),
  estimateHours: z.coerce.number(),
  domain: z.enum(['auth', 'billing', 'search', 'messaging', 'profile', 'admin', 'notifications']),
  epicId: z.string(),
  journeyId: z.string(),
  acceptanceCriteria: z.array(CriterionSchema).min(3).max(7),
  dependencies: z.array(z.string()).default([]),
  status: z.enum(['pending', 'approved', 'flagged']).default('pending'),
  assignee: z.string().default('Unassigned'),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type Task = z.infer<typeof TaskSchema>;

// ─── Key detection ─────────────────────────────────────────────────────────

function hasAnthropicKey() { return Boolean(process.env['ANTHROPIC_API_KEY']); }
function hasOpenAIKey()    { return Boolean(process.env['OPENAI_API_KEY']); }

function hasKey(provider: 'anthropic' | 'openai') {
  return provider === 'anthropic' ? hasAnthropicKey() : hasOpenAIKey();
}

// ─── Real LLM caller ───────────────────────────────────────────────────────

// ─── Schema descriptions ───────────────────────────────────────────────────
// These get appended to the system prompt so the LLM knows the EXACT field
// names the validator expects. Critical for OpenAI which is more literal than
// Claude when inferring schema from a name like "Brief schema".

const BRIEF_SCHEMA_DESC = `
The output JSON object MUST use exactly these top-level field names (and no others):
{
  "title": "string — project title",
  "client": "string — client name",
  "date": "string — today's date in YYYY-MM-DD format",
  "summary": "string — 2-4 sentence executive summary",
  "openQuestions": [ { "text": "string — the question" } ],
  "assumptions": [ { "text": "string — the assumption" } ],
  "inScope": [ "string — items in scope" ],
  "outOfScope": [ "string — items out of scope" ]
}
All eight fields are required. Do not nest the brief inside another object.
Do not use alternative field names like "projectTitle", "clientName", "executive_summary", etc.`;

const EPICS_SCHEMA_DESC = `
Return a JSON array (or an object with key "epics" containing the array).
Each epic object MUST use exactly these field names:
{
  "title": "string — max 60 characters",
  "domain": "auth" | "billing" | "search" | "messaging" | "profile" | "admin" | "notifications",
  "description": "string — MINIMUM 30 sentences, target 30 to 50 sentences, roughly 3000-5500 characters. A thorough, multi-paragraph mini-brief for this epic.",
  "storyPoints": "number — Fibonacci: 1, 2, 3, 5, 8, 13, 21"
}
"domain" MUST be one of the seven literal strings above. Do not invent new domain values.

EPIC ORDERING — STRICTLY ENFORCED:
The array order IS the priority order. Index 0 is the highest-priority epic the team should build first. Reorder ALL epics by the rubric below before returning. The default tendency to alphabetize, group by domain, or echo the brief's narrative order is WRONG — re-rank explicitly.

Ranking rubric (use Tier 0 → 4, ties broken by which epic unblocks the most other work):

Tier 0 — IDENTITY (place at index 0, ALWAYS):
- Authentication, account creation, user/session/identity model.
- Every other epic eventually filters by user_id; that field does not exist without this epic.
- A developer can demo Auth end-to-end with nothing else built — the reverse is not true. So Auth comes BEFORE Payments, POS, and every other foundation.

Tier 1 — OTHER FOUNDATIONS (place right after Tier 0):
- Payments, billing, checkout, refund/chargeback flows.
- POS / third-party platform integrations that other epics call (e.g. Toast POS, Stripe, payment gateways).
- Core data model, API contracts, or backend infrastructure that other epics directly depend on.
- These unblock downstream features but require user identity from Tier 0 to be meaningful.

Tier 2 — CORE VALUE (place second):
- The primary user-facing capability that defines the product's reason for existing. For a loyalty app this is "earn points + redeem rewards"; for an e-commerce app it's "browse → add to cart → checkout"; for a CRM it's "create + manage contacts".
- These epics deliver the headline value proposition from the brief.

Tier 3 — SUPPORTING (place third):
- Profile management, history views, settings, search/filter — features that improve the core experience but aren't the headline value.
- Admin / manager dashboards that observe or moderate the core flow.

Tier 4 — ENGAGEMENT / GROWTH (place LAST):
- Push notifications, email campaigns, referrals, analytics dashboards, marketing surfaces.
- These add retention/growth on top of an already-working product. They are valuable but should not block the first usable release.

Rules:
- The Authentication / Identity epic (Tier 0) MUST always sit at index 0, ahead of every other epic. No exceptions.
- A Tier 4 epic (notifications, marketing) must NEVER appear above a Tier 0/1/2 epic.
- If two epics are in the same tier, place the one with more downstream dependents first.
- Do NOT sort alphabetically. Do NOT sort by domain field. Do NOT echo the order ideas appeared in the brief.

Description requirements — this is the PRIMARY explanation shown to PMs and developers, and it should read like a senior PM's working notes on the epic. Not a template. Not a spec doc header. A short description (fewer than 30 sentences) is REJECTED. Each description MUST be at least 30 full sentences and cover ALL of the following sections. Use line breaks (\\n\\n) between sections, but keep natural prose inside each section:

1. OVERVIEW (4-6 sentences) — Open with the concrete user problem or business gap this epic addresses. Then describe the capability that closes it. Be specific about who benefits and what changes for them day-to-day.

2. SCOPE — KEY CAPABILITIES (6-10 sentences) — Every sub-capability, screen, workflow, or feature included in THIS epic. Name them explicitly. Explain what each does.

3. USER INTERACTIONS (4-6 sentences) — The primary user actions and flows enabled by this epic. Reference roles/personas where relevant.

4. INTEGRATIONS & DEPENDENCIES (4-6 sentences) — External systems, APIs, third-party services, or other epics this depends on. Note any data exchanges or technical constraints.

5. EDGE CASES & FAILURE MODES (3-5 sentences) — What can go wrong, how the system should handle errors, retries, validation failures, and recovery.

6. SUCCESS CRITERIA (3-5 sentences) — Measurable outcomes that define "done" at the epic level. What metric or behavior proves it works.

7. OUT OF SCOPE NOTES (2-4 sentences) — Adjacent features deliberately excluded from THIS epic to keep scope tight; reference where they live (other epics or future work).

VOICE & PHRASING RULES — strictly enforced:
- DO NOT start the description with "This epic...", "This epic covers...", "This epic defines...", "This epic encompasses...", "This epic implements...", or any "This epic [verb]" pattern. That phrasing is BANNED in the opening sentence.
- DO NOT use the words "this epic" anywhere in the description. Refer to the work by its actual name (e.g., "Rewards redemption", "QR code scanning", "Push notifications") or just describe what happens without a meta-reference.
- Do not narrate ABOUT the epic — describe the product directly. Bad: "This epic covers a QR code scanner." Good: "Customers scan a QR code at the table to record a visit and credit points to their account."
- Write in the voice of a senior PM briefing the engineering team, not in the voice of documentation.
- Vary sentence openings. No more than one sentence in a row should start with the same subject or verb form.
- Plain prose. Line breaks between the sections listed above are allowed, but NO markdown bullets, numbered lists, or headings.
- Reference the actual client / product domain by name — do not write a generic template that could apply to any project. Use real entity names from the brief.
- No marketing fluff ("seamless", "world-class", "robust", "cutting-edge", "best-in-class") — describe what is actually built.
- No filler clauses like "Additionally,", "Furthermore,", "Moreover," at the start of consecutive sentences.
- If you cannot write 30 sentences of substantive, non-repetitive content, the epic is too small — combine it with another or expand the scope. Do not pad with filler.

Good opening sentence examples (for inspiration, not to copy):
- "Customers earn points by scanning the QR code printed on every FreshFork table after they finish a meal."
- "Restaurant managers need a single screen that shows redemption activity, top-earning customers, and refund volume for the day."
- "Auth ties the loyalty app to a customer's phone number so a returning diner doesn't have to recreate their account on a new device."

Do not include id, status — the system adds those.`;

const JOURNEYS_SCHEMA_DESC = `
Return a JSON array (or an object with key "journeys" containing the array).
Each journey object MUST use exactly these field names:
{
  "epicId": "string — must match an id field from the epics input",
  "persona": "string — specific role, e.g. 'New customer (first-time visitor)'",
  "title": "string — [Persona] [specific goal in present tense]",
  "steps": [ "string — '[Actor]: [specific action or system response]'" ],
  "happyPath": "string — 1-2 sentence successful outcome",
  "edgeCases": [
    "string — describes ONE specific condition + what happens. Example: 'Customer's card is declined → system shows inline error and keeps cart intact'"
  ],
  "testCases": [
    {
      "name": "string — short title for this scenario, e.g. 'Successful checkout with existing account'",
      "given": "string — concrete precondition (authenticated/unauth user, specific data state)",
      "when": "string — the specific action the user takes",
      "then": "string — the concrete observable outcome (HTTP code, UI state, error text, etc.)"
    }
  ],
  "edgeCasesCount": "number — count of edgeCases array"
}

Rules for arrays:
- "edgeCases" must contain 3-6 entries. Each must name the condition AND what the system does.
- "testCases" must contain 4-8 entries: 1 happy path + remaining covering edge cases and failure modes.
- "testCases" entries MUST follow Given/When/Then format with all three fields non-empty.
Do not include id, status — the system adds those.`;

const TASKS_SCHEMA_DESC = `
Return a JSON array (or an object with key "tasks" containing the array).
Each task object MUST use exactly these field names:
{
  "title": "string — imperative, max 80 characters",
  "estimateHours": "number — integer between 4 and 16",
  "acceptanceCriteria": [
    {
      "type": "functional" | "non-functional" | "technical",
      "given": "string — max 120 characters",
      "when": "string — max 120 characters",
      "then": "string — max 150 characters"
    }
  ]
}
acceptanceCriteria must contain 3 to 5 items (NOT more — pick the most important AC, don't pad).
Each item must have all four fields (type, given, when, then) as non-empty strings.
Keep AC text concise — one sentence per field, no compound clauses.
Do not include id, wbsId, domain, epicId, journeyId, status, assignee — the system adds those.`;

// Stage → model mapping. The brief is the foundational artifact — every
// downstream stage builds on it, so we keep gpt-4o (or claude-sonnet) for
// quality. Epics/journeys/tasks are structured-JSON workloads where the cheap
// models perform near-identically and save ~95% on credit.
//
// Override per-stage via env: AI_MODEL_BRIEF_OPENAI=gpt-4o-mini, etc.
type Stage = 'brief' | 'epics' | 'journeys' | 'tasks' | 'rewrite';

function modelFor(stage: Stage, provider: 'anthropic' | 'openai'): string {
  const envKey = `AI_MODEL_${stage.toUpperCase()}_${provider.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;

  if (provider === 'openai') {
    return stage === 'brief' ? 'gpt-4o' : 'gpt-4o-mini';
  }
  // Anthropic: Sonnet for brief, Haiku for the high-volume stages.
  return stage === 'brief' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
}

async function callLLM(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
  stage: Stage = 'brief',
): Promise<string> {
  // Retry policy: rate-limit (429) and transient 5xx errors get exponential
  // backoff (1.5s → 4s → 9s). Other errors (auth, validation) bail immediately.
  const RETRY_DELAYS_MS = [1500, 4000, 9000];
  const model = modelFor(stage, provider);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
        const msg = await client.messages.create({
          model,
          max_tokens: 16384,
          system: systemPrompt + '\n\nRespond ONLY with valid JSON. No markdown, no explanation.',
          messages: [{ role: 'user', content: userMessage }],
        });
        const block = msg.content[0];
        if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
        return block.text;
      } else {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
        const completion = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt + '\n\nRespond ONLY with valid JSON.' },
            { role: 'user', content: userMessage },
          ],
        });
        return completion.choices[0]?.message?.content ?? '{}';
      }
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;
      const isServerErr = typeof status === 'number' && status >= 500 && status < 600;
      // Distinguish "you've exceeded your monthly/dollar quota" from "you're
      // sending too fast." Both are 429 but the first is hopeless to retry.
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaExceeded = isRateLimit && /exceeded your current quota|insufficient_quota|billing/i.test(msg);

      if (isQuotaExceeded) {
        throw new Error(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} quota exceeded. Top up your account or switch provider in project settings.`);
      }

      if ((isRateLimit || isServerErr) && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt]!;
        console.warn(`[callLLM] ${provider} ${status} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Free-form chat completion (NOT structured JSON). Used by the Epics chat
 * feature so a PM can ask questions or discuss the epics conversationally
 * without triggering a regen.
 *
 * Same retry policy as callLLM. Returns plain text — never tries to coerce
 * the response to JSON.
 */
async function callLLMText(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
  stage: Stage = 'rewrite',
): Promise<string> {
  const RETRY_DELAYS_MS = [1500, 4000, 9000];
  const model = modelFor(stage, provider);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
        const msg = await client.messages.create({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });
        const block = msg.content[0];
        if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
        return block.text;
      } else {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 1024,
        });
        return completion.choices[0]?.message?.content ?? '';
      }
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;
      const isServerErr = typeof status === 'number' && status >= 500 && status < 600;
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaExceeded = isRateLimit && /exceeded your current quota|insufficient_quota|billing/i.test(msg);
      if (isQuotaExceeded) {
        throw new Error(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} quota exceeded. Top up your account or switch provider in project settings.`);
      }
      if ((isRateLimit || isServerErr) && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface EpicChatResult {
  /** Conversational reply shown to the user immediately. */
  reply: string;
  /** Full-list rebuild via the regenerate flow. */
  regenerate?: string;
  /** Targeted single-epic rewrite. epicIndex is 1-based vs the list shown to the model. */
  rewriteOne?: { epicIndex: number; instruction: string };
  /** Append a brand new epic, leaving existing ones untouched. */
  addOne?: { instruction: string };
  /** Delete a specific epic by 1-based index, leaving the rest untouched. */
  removeOne?: { epicIndex: number };
}

/**
 * Agentic chat about a project's epics. The model can either:
 *   1. Answer a pure question — returns only `reply`.
 *   2. Acknowledge a change request — returns both `reply` (the confirmation)
 *      AND `regenerate` (the instruction the caller should feed to the
 *      regenerator). The agent NEVER refuses a change request; it either
 *      asks one short clarifying question or acts.
 */
export async function chatAboutEpics(
  provider: 'anthropic' | 'openai',
  brief: Brief,
  epics: Epic[],
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  regenContext = '',
): Promise<EpicChatResult> {
  if (!hasKey(provider)) {
    return {
      reply: `(${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key not configured.) I'd normally answer here, but the API key for this provider is missing — set it in Admin → Integrations and try again.`,
    };
  }

  const epicsCompact = epics
    .map(
      (e, i) =>
        `${i + 1}. [${e.domain}] ${e.title} (${e.storyPoints} pts) — ${(e.description ?? '').slice(0, 200)}${(e.description ?? '').length > 200 ? '…' : ''}`,
    )
    .join('\n');

  const transcript = history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n\n');

  const systemPrompt = `You are a product-management assistant helping a PM review the epics for "${brief.title || brief.client}". You are AGENTIC with FIVE possible actions. You NEVER refuse to act.

You MUST respond with valid JSON in this exact shape:
{
  "reply": "string — your COMPLETE response shown to the user. Includes any tables, lists, or comparisons IN THIS FIELD. There is no separate place for them. Typically 1-4 sentences for chat answers, but longer when the user asks for a table, comparison, or detailed list. Plain text with newlines allowed; NO markdown headings/bullets except inside ASCII tables.",
  "action": {
    "type": "none" | "rewriteOne" | "addOne" | "removeOne" | "regenerateAll",
    "epicIndex": number (1-based, REQUIRED for rewriteOne and removeOne, matching CURRENT EPICS below),
    "instruction": "string (REQUIRED for rewriteOne, addOne, regenerateAll — describe the change in self-contained detail)"
  }
}

CRITICAL RULE — reply is the ONLY place output goes:
- The user sees ONLY the "reply" field. There is no "below", no "above", no "next message" — just this one reply.
- If you say "here is the table:" or "see below" or "see the table", the table MUST appear immediately after that sentence inside the SAME reply string. Anything you don't put in reply is invisible.
- NEVER end the reply with "[table follows]" or "[list below]" or any placeholder. Put the actual content there.

CHOOSE THE NARROWEST ACTION THAT FITS. Prefer surgical actions (rewriteOne, addOne, removeOne) over regenerateAll. Only fall back to regenerateAll when the change genuinely affects multiple epics at once.

action.type = "rewriteOne" — change ONE existing epic in place:
- "make User Profile more relatable"  → rewriteOne, epicIndex = User Profile's 1-based index
- "expand the auth epic's scope to include OAuth"  → rewriteOne for auth
- "rewrite Push Notifications with two concrete example messages"  → rewriteOne for notifications
- "the QR scanning description is too generic"  → rewriteOne for QR
- The user names ONE epic and asks to change it.

action.type = "addOne" — append ONE brand new epic, leaving the rest untouched:
- "add a new epic for Loyalty Program Analytics"  → addOne (PRESERVES the existing 7)
- "add a Payments epic for refunds and chargebacks"  → addOne
- "we also need a Notifications epic that handles SMS"  → addOne
- ANY "add", "include", "introduce", "create a new" request where the user is NOT also removing or restructuring.

action.type = "removeOne" — delete ONE existing epic, leaving the rest untouched:
- "remove the Search epic"  → removeOne, epicIndex = Search's 1-based index
- "drop User Profile, we'll handle it later"  → removeOne
- "we don't need the admin dashboard"  → removeOne
- No instruction field needed.

action.type = "regenerateAll" — full rebuild. Use ONLY when no narrower action fits:
- "rebuild the epics from scratch"
- "start over"
- "make ALL epics more concrete"  (touches every epic)
- "merge X and Y into one"  (replaces two with one — restructure)
- "split X into two epics"  (replaces one with two — restructure)
- "reprioritize so X comes before Y"  (changes ordering across the list — though the system also auto-priority-sorts after, so prefer doing this via the priority rubric on the next regen rather than a dedicated regen if the only change is order)

action.type = "none" — pure question, no change:
- "what does Auth cover?"
- "why is QR Scanning ranked higher than Profile?"
- "how do these epics relate to the brief?"

WRITING action.instruction:
- Self-contained — the downstream tool has NO conversation memory.
- Captures the user's intent plus any context you inferred.
- For rewriteOne example: "Rewrite the User Profile Management epic description with relatable, customer-facing language. Use concrete day-to-day scenarios — a diner checking their points balance after a meal, updating their phone number, viewing past rewards."
- For addOne example: "Add a new Loyalty Program Analytics epic that focuses on gathering insights from user engagement and redemption patterns — track top-earning customers, redemption rates by reward tier, churn signals, and segment-level retention. Tag it under the 'admin' domain since it's an internal reporting capability."
- For regenerateAll example: "Rebuild the epics with a new Payments epic covering refunds, chargebacks, and dispute handling. Keep auth, profile, and POS integration intact."

WRITING reply:
- For "none": 2-4 sentence direct answer referencing real epic titles.
- For action turns: short confirmation naming the target. "Got it — adding a Loyalty Program Analytics epic without touching the existing seven."
- NEVER say "I can't" or "I cannot make changes" — you CAN, by picking the right action.
- Tone: friendly, professional, no marketing fluff.
- Never invent epics not in the list when discussing or removing. For addOne, the new epic is fine.

RENDERING COMPARISONS AND DIFFS ("what changed?", "compare to before", etc.):

This output is read in a NARROW chat panel (~360px wide). Every extra word hurts readability. Stick to this exact compact format — TITLES ONLY, NUMBERED LISTS, NO PER-ITEM DESCRIPTIONS:

EXACT FORMAT (copy this template):

5 epics before → 6 epics now
1 added · 0 removed · 5 unchanged

ADDED (1)
1. Loyalty Program Analytics

UNCHANGED (5)
1. User Authentication & Registration
2. QR Code Scanning for Points Accrual
3. Toast POS System Integration
4. User Profile and Points History
5. Rewards Redemption System

RULES — follow strictly:
- Plain UPPERCASE word headers: ADDED, REMOVED, UNCHANGED. No symbols, no emoji, no markdown.
- Each item is EXACTLY ONE LINE — just the title. NO em-dash, NO description, NO "consolidated into X", NO marketing sentence. Title-only. Always.
- Numbered (1., 2., 3.) within each section so the user can reference items in follow-up.
- Skip empty sections entirely (no "REMOVED (0)").
- Top summary line gives counts. Second line gives the deltas separated by " · ".
- Section order: ADDED first, then REMOVED, then UNCHANGED last.
- One blank line between sections, no extra preamble like "Here's how the new lineup compares…". Go straight to the summary line.
- Keep titles intact — do not truncate.

If the user explicitly asks "why was X removed?" or "what's special about Y?", answer that ONE question in a follow-up turn with normal prose — do NOT pad every diff item with reasoning by default.

${regenContext}${GENERAL_CONVERSATION_POLICY}
PROJECT BRIEF SUMMARY:
${(brief.summary ?? '').slice(0, 600)}

CURRENT EPICS (priority-ordered, 1 is highest — use these 1-based indices for epicIndex):
${epicsCompact || '(no epics yet)'}
`;

  const userBlock = transcript
    ? `Recent conversation:\n${transcript}\n\nUser's new message: ${userMessage}`
    : userMessage;

  // Use the JSON-enforcing callLLM so OpenAI is forced into structured output.
  const raw = await callLLM(provider, systemPrompt, userBlock, 'rewrite');
  let parsed: { reply?: unknown; action?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]) as typeof parsed; } catch { /* fall through */ }
    }
  }

  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : "(I didn't get a clear response — try rephrasing.)";

  const action = parsed.action as { type?: string; epicIndex?: number; instruction?: string } | undefined;
  if (action && typeof action === 'object') {
    const validIndex = typeof action.epicIndex === 'number' && action.epicIndex >= 1 && action.epicIndex <= epics.length;
    const validInstruction = typeof action.instruction === 'string' && action.instruction.trim().length > 0;

    if (action.type === 'rewriteOne' && validIndex && validInstruction) {
      return {
        reply,
        rewriteOne: { epicIndex: action.epicIndex!, instruction: action.instruction!.trim() },
      };
    }
    if (action.type === 'addOne' && validInstruction) {
      return { reply, addOne: { instruction: action.instruction!.trim() } };
    }
    if (action.type === 'removeOne' && validIndex) {
      return { reply, removeOne: { epicIndex: action.epicIndex! } };
    }
    if (action.type === 'regenerateAll' && validInstruction) {
      return { reply, regenerate: action.instruction!.trim() };
    }
  }

  return { reply };
}

// ─── Journey + Task chat / generation helpers ─────────────────────────────────
// Mirror the chatAboutEpics + generateOneEpic pattern so the Journeys and
// Tasks pages can offer the same 5-action agentic chat (none / rewriteOne /
// addOne / removeOne / regenerateAll).

export interface JourneyChatResult {
  reply: string;
  regenerate?: string;
  rewriteOne?: { itemIndex: number; instruction: string };
  addOne?: { instruction: string };
  removeOne?: { itemIndex: number };
}

export interface TaskChatResult {
  reply: string;
  regenerate?: string;
  rewriteOne?: { itemIndex: number; instruction: string };
  addOne?: { instruction: string };
  removeOne?: { itemIndex: number };
}

function genericChatSystemPrompt(
  stageLabel: string,
  itemNoun: string,
  brief: Brief,
  itemsCompact: string,
  extraContext = '',
  regenContext = '',
): string {
  return `You are a product-management assistant helping a PM review the ${stageLabel} for "${brief.title || brief.client}". You are AGENTIC with FIVE possible actions. You NEVER refuse to act.

You MUST respond with valid JSON in this exact shape:
{
  "reply": "string — your COMPLETE response shown to the user. Includes any lists, comparisons, or context IN THIS FIELD. 1-4 sentences for chat answers, longer for comparisons. Plain text with newlines allowed; NO markdown.",
  "action": {
    "type": "none" | "rewriteOne" | "addOne" | "removeOne" | "regenerateAll",
    "itemIndex": number (1-based, REQUIRED for rewriteOne and removeOne, matching CURRENT ${stageLabel.toUpperCase()} below),
    "instruction": "string (REQUIRED for rewriteOne, addOne, regenerateAll — self-contained description of the change)"
  }
}

CRITICAL: "reply" is the ONLY place output goes. If you say "see below", the content MUST appear in the SAME reply string. Never reference a separate message.

CHOOSE THE NARROWEST ACTION THAT FITS. Prefer rewriteOne / addOne / removeOne over regenerateAll. Only use regenerateAll for genuine list-level rebuilds.

rewriteOne — change ONE specific named ${itemNoun}:
- "make ${itemNoun} #3 cover X" / "rewrite the auth ${itemNoun} with Y focus" / "expand scope on the X ${itemNoun}"

addOne — append a brand-new ${itemNoun}, others untouched:
- "add a ${itemNoun} for X" / "include a Y scenario" / "introduce a Z"

removeOne — delete one specific ${itemNoun}, others untouched:
- "remove the X ${itemNoun}" / "drop ${itemNoun} #3"

regenerateAll — full rebuild:
- "rebuild all ${itemNoun}s", "start over", "make ALL more X", merge/split affecting many items

none — pure questions or discussion about the current ${itemNoun}s.

WRITING action.instruction: self-contained, captures user intent + context. The downstream tool has no memory of this chat.

WRITING reply:
- For "none": 2-4 sentences referencing real ${itemNoun} titles.
- For action turns: short confirmation naming the target.
- NEVER say "I can't" — you CAN, by picking the right action.

RENDERING COMPARISONS AND DIFFS ("what changed?", "compare to before"):
- Output is read in a NARROW chat panel. Compact numbered lists only — NO tables, NO emoji, NO per-item descriptions.
- EXACT format (copy template):

5 ${itemNoun}s before → 6 ${itemNoun}s now
1 added · 0 removed · 5 unchanged

ADDED (1)
1. <title only>

UNCHANGED (5)
1. <title only>
2. <title only>
...

RULES:
- Plain UPPERCASE headers: ADDED, REMOVED, UNCHANGED. No symbols, no emoji.
- ONE LINE per item — title only. Never append " — <description>" or " (consolidated into X)".
- Numbered within each section. Skip empty sections.
- Section order: ADDED, REMOVED, UNCHANGED.
- No preamble like "Here's how the lineup compares" — go straight to the summary line.

${regenContext}${GENERAL_CONVERSATION_POLICY}
PROJECT BRIEF SUMMARY:
${(brief.summary ?? '').slice(0, 500)}

${extraContext}

CURRENT ${stageLabel.toUpperCase()} (1-based indices):
${itemsCompact || `(no ${itemNoun}s yet)`}
`;
}

function parseChatResult(raw: string, listLength: number): {
  reply: string;
  regenerate?: string;
  rewriteOne?: { itemIndex: number; instruction: string };
  addOne?: { instruction: string };
  removeOne?: { itemIndex: number };
} {
  let parsed: { reply?: unknown; action?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { parsed = JSON.parse(match[0]) as typeof parsed; } catch { /* fall through */ } }
  }
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : "(I didn't get a clear response — try rephrasing.)";
  const action = parsed.action as { type?: string; itemIndex?: number; instruction?: string } | undefined;
  if (action && typeof action === 'object') {
    const validIndex = typeof action.itemIndex === 'number' && action.itemIndex >= 1 && action.itemIndex <= listLength;
    const validInstruction = typeof action.instruction === 'string' && action.instruction.trim().length > 0;
    if (action.type === 'rewriteOne' && validIndex && validInstruction) {
      return { reply, rewriteOne: { itemIndex: action.itemIndex!, instruction: action.instruction!.trim() } };
    }
    if (action.type === 'addOne' && validInstruction) {
      return { reply, addOne: { instruction: action.instruction!.trim() } };
    }
    if (action.type === 'removeOne' && validIndex) {
      return { reply, removeOne: { itemIndex: action.itemIndex! } };
    }
    if (action.type === 'regenerateAll' && validInstruction) {
      return { reply, regenerate: action.instruction!.trim() };
    }
  }
  return { reply };
}

export async function chatAboutJourneys(
  provider: 'anthropic' | 'openai',
  brief: Brief,
  epics: Epic[],
  journeys: Journey[],
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  regenContext = '',
): Promise<JourneyChatResult> {
  if (!hasKey(provider)) {
    return { reply: `(${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key not configured.) Set it in Admin → Integrations and try again.` };
  }
  const epicTitles = epics.map((e, i) => `${i + 1}. ${e.title}`).join('\n');
  const journeysCompact = journeys.map((j, i) => `${i + 1}. [${j.persona}] ${j.title} — ${(j.happyPath ?? '').slice(0, 120)}`).join('\n');
  const systemPrompt = genericChatSystemPrompt(
    'journeys',
    'journey',
    brief,
    journeysCompact,
    `RELATED EPICS (for context — do not modify):\n${epicTitles || '(no epics)'}`,
    regenContext,
  );
  const transcript = history.slice(-8).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
  const userBlock = transcript ? `Recent conversation:\n${transcript}\n\nUser's new message: ${userMessage}` : userMessage;
  const raw = await callLLM(provider, systemPrompt, userBlock, 'rewrite');
  return parseChatResult(raw, journeys.length);
}

export async function chatAboutTasks(
  provider: 'anthropic' | 'openai',
  brief: Brief,
  epics: Epic[],
  journeys: Journey[],
  tasks: Record<string, unknown>[],
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  regenContext = '',
): Promise<TaskChatResult> {
  if (!hasKey(provider)) {
    return { reply: `(${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key not configured.) Set it in Admin → Integrations and try again.` };
  }
  const tasksCompact = tasks
    .map((t, i) => `${i + 1}. ${(t['title'] as string) ?? '(untitled)'} — ${t['estimateHours'] ?? '?'}h, ${((t['acceptanceCriteria'] as unknown[]) ?? []).length} AC`)
    .join('\n');
  const journeyContext = journeys.slice(0, 8).map((j, i) => `${i + 1}. ${j.title}`).join('\n');
  const systemPrompt = genericChatSystemPrompt(
    'tasks',
    'task',
    brief,
    tasksCompact,
    `RELATED JOURNEYS (top 8 for context):\n${journeyContext || '(no journeys)'}\n\nTasks have a "wbs_id" custom field for ClickUp sync. Acceptance criteria must follow Given/When/Then format with type ∈ {functional, non-functional, technical}.`,
    regenContext,
  );
  const transcript = history.slice(-8).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
  const userBlock = transcript ? `Recent conversation:\n${transcript}\n\nUser's new message: ${userMessage}` : userMessage;
  const raw = await callLLM(provider, systemPrompt, userBlock, 'rewrite');
  return parseChatResult(raw, tasks.length);
}

/** Generate exactly ONE new journey to append. */
export async function generateOneJourney(
  brief: Brief,
  epics: Epic[],
  existingJourneys: Journey[],
  provider: 'anthropic' | 'openai',
  instruction: string,
): Promise<Journey> {
  if (!hasKey(provider)) {
    const epicId = epics[0]?.id ?? uuid();
    return {
      id: uuid(),
      epicId,
      persona: 'End user',
      title: instruction.slice(0, 60) || 'New journey',
      steps: ['User initiates action', 'System validates', 'System processes', 'User sees confirmation'],
      happyPath: `Placeholder happy path from instruction: "${instruction}"`,
      edgeCases: ['Network failure → retry with backoff', 'Invalid input → inline error', 'Auth lapse → re-prompt'],
      testCases: [
        { name: 'Happy path', given: 'authenticated user', when: 'they complete the flow', then: 'success state is shown' },
      ],
      edgeCasesCount: 3,
      status: 'pending',
    };
  }
  const existingSummary = existingJourneys.map((j, i) => `${i + 1}. [${j.persona}] ${j.title}`).join('\n');
  const epicsSummary = epics.map((e, i) => `${i + 1}. ${e.title} (id=${e.id})`).join('\n');
  const singleDesc = JOURNEYS_SCHEMA_DESC.replace(
    'Return a JSON array (or an object with key "journeys" containing the array).',
    'Return a single JSON object (not an array). The object IS the journey.',
  );
  const sysPrompt = `${singleDesc}

You are appending ONE new journey to an existing list. Do NOT duplicate existing journeys — find a gap (a new persona, an edge case flow, a failure mode) and fill it.

EXISTING JOURNEYS (do not duplicate):
${existingSummary || '(none yet)'}

AVAILABLE EPICS (pick the most relevant id for epicId):
${epicsSummary || '(no epics)'}

BRIEF SUMMARY:
${(brief.summary ?? '').slice(0, 500)}`;
  const userMessage = `Generate exactly ONE new journey matching this instruction: "${instruction}"\n\nReturn a single JSON object.`;
  const raw = await callLLM(provider, sysPrompt, userMessage, 'journeys');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (err) {
    console.error('[generateOneJourney] JSON parse failed:', raw.slice(0, 500));
    throw new Error('AI returned non-JSON when generating the new journey. Try a more specific instruction.');
  }
  let candidate: unknown = parsed;
  if (Array.isArray(parsed)) candidate = parsed[0];
  else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj['journey']) candidate = obj['journey'];
    else if (obj['item']) candidate = obj['item'];
    else if (Array.isArray(obj['journeys']) && obj['journeys'].length > 0) candidate = (obj['journeys'] as unknown[])[0];
  }
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('AI returned an unexpected shape when generating the new journey.');
  }
  try {
    return JourneySchema.parse({ id: uuid(), status: 'pending', ...(candidate as Record<string, unknown>) });
  } catch (err) {
    console.error('[generateOneJourney] Zod validation failed:', err);
    throw new Error('AI produced a journey with missing or invalid fields. Try a more specific instruction.');
  }
}

/**
 * Lightweight project preview — reads raw client input and returns a short
 * 5-8 line description of what the project IS, what its PURPOSE is, and what
 * it WILL DO. Used on the empty Brief page so the PM sees a real project
 * description before they fire the full brief extraction.
 *
 * Far cheaper than generateBrief (no questions, assumptions, scope arrays —
 * just one prose paragraph).
 */
export async function previewProject(
  provider: 'anthropic' | 'openai',
  projectName: string,
  client: string,
  rawInput: string,
): Promise<string> {
  if (!hasKey(provider)) {
    return `${projectName} is a project for ${client || 'the client'}. Configure an AI provider in Admin → Integrations to see an AI-generated description here.`;
  }
  const trimmed = (rawInput ?? '').trim();
  if (!trimmed) {
    return 'No raw client input yet — add it on the Definition page to see a project description here.';
  }

  const systemPrompt = `You read raw client input and write a VERY SHORT project description for an internal PM dashboard.

Rules (strict — violations are rejected):
- Output PLAIN PROSE only. No bullet points, no headings, no markdown.
- EXACTLY 3 to 4 sentences. Not 5. Not 6. Three or four, that's it.
- Each sentence MAX 22 words. Total output MAX 65 words.
- Write in THIRD PERSON, neutral PM voice. NEVER use "we", "us", "I", "you", or the client's first-person voice.
- Cover only: (1) what the project is, (2) its purpose, (3) what it will do. ONE sentence each is enough; merge if natural.
- Reference the client by name once where natural; do not repeat the client name in multiple sentences.
- DO NOT mention budget, money, dollar amounts, or pricing.
- DO NOT mention specific launch dates, deadlines, or timelines.
- DO NOT list every feature — pick only the 2-3 most important capabilities.
- DO NOT mention "the brief", "AI", "this tool", or the PM platform itself.
- DO NOT use marketing fluff ("seamless", "robust", "stable foundation", "modern", "user-friendly").
- DO NOT wrap your output in quotes or code fences.

Respond ONLY with the description text. No JSON, no prefix, no explanation.`;

  const userMessage = `Project name: ${projectName}\nClient: ${client || '(unspecified)'}\n\nRaw client input:\n${trimmed}\n\nWrite the 5-8 sentence project description now.`;

  // Server-side safety net — even if the model ignores the "3-4 sentence" rule,
  // we hard-cap the output to the first 4 sentences so the empty-state stays
  // tight and consistent on every render.
  function trimToFourSentences(text: string): string {
    const trimmed = text.trim().replace(/^["'`]+|["'`]+$/g, '');
    // Match up to the first 4 sentence-terminators (. ! ? followed by space or end).
    const match = trimmed.match(/^(?:[^.!?]+[.!?](?:\s+|$)){1,4}/);
    return (match ? match[0] : trimmed).trim();
  }

  try {
    let raw: string;
    if (provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const c = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
      const msg = await c.messages.create({
        model: modelFor('rewrite', provider),
        max_tokens: 250,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const block = msg.content[0];
      if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
      raw = block.text;
    } else {
      const { default: OpenAI } = await import('openai');
      const c = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
      const completion = await c.chat.completions.create({
        model: modelFor('rewrite', provider),
        max_tokens: 250,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? '';
    }
    return trimToFourSentences(raw);
  } catch (err) {
    console.error('[previewProject] failed:', err);
    return `${projectName} — project description preview unavailable. Click Generate Brief to extract the full structured brief instead.`;
  }
}

/**
 * Stage-preview helper — same prompt shape as previewProject but tailored to
 * each pipeline stage. Returns a 3-4 sentence neutral PM-voice description of
 * what the upcoming stage will produce, for use on the empty-state of each
 * stage page (Epics / Journeys / Tasks / Sync).
 */
export async function previewStage(
  provider: 'anthropic' | 'openai',
  stage: 'epics' | 'journeys' | 'tasks' | 'sync',
  context: {
    projectName: string;
    client: string;
    brief: Brief | null;
    epicCount?: number;
    journeyCount?: number;
    taskCount?: number;
  },
): Promise<string> {
  if (!hasKey(provider)) {
    return defaultStageFallback(stage, context.projectName);
  }

  const briefSummary = (context.brief?.summary ?? '').slice(0, 600);
  const inScope = (context.brief?.inScope ?? []).slice(0, 8).join('; ');

  const stageGuidance: Record<typeof stage, string> = {
    epics: 'You are previewing the EPIC list that will be generated. Describe what kinds of epics the team will see — high-level scope units like authentication, core feature areas, integrations, admin tooling. Mention 2-3 likely epic themes drawn from the brief.',
    journeys: 'You are previewing the JOURNEY list that will be generated. Describe what user journeys the team will see — a journey is a persona-tagged end-to-end flow with steps and edge cases. Mention 2-3 likely personas or flows drawn from the brief.',
    tasks: 'You are previewing the TASK list that will be generated. Describe what kinds of atomic tasks the team will see — each task is a 4-16 hour unit of work with acceptance criteria, ready to push to ClickUp. Mention the likely categories without listing specific tasks.',
    sync: 'You are previewing the ClickUp SYNC operation. Describe what will happen when the user clicks Start Sync — approved tasks get pushed to ClickUp with a wbs_id custom field, and the mapping table tracks idempotency. Mention 1-2 things the user should expect to see.',
  };

  const systemPrompt = `You write a VERY SHORT preview paragraph for an internal PM dashboard.

${stageGuidance[stage]}

Rules (strict — violations are rejected):
- Output PLAIN PROSE only. No bullet points, no headings, no markdown.
- EXACTLY 3 to 4 sentences. Not 5. Not 6.
- Each sentence MAX 22 words. Total output MAX 65 words.
- Write in THIRD PERSON, neutral PM voice. NEVER use "we", "us", "I", "you".
- DO NOT mention budget, money, dollar amounts, launch dates, or timelines.
- DO NOT use marketing fluff ("seamless", "robust", "modern", "user-friendly", "stable foundation").
- DO NOT mention "the brief", "AI", or the PM platform itself.
- DO NOT wrap your output in quotes or code fences.

Respond ONLY with the description text.`;

  const userMessage = `Project: ${context.projectName}\nClient: ${context.client || '(unspecified)'}\nBrief summary: ${briefSummary || '(brief not generated yet)'}\nIn-scope items: ${inScope || '(none captured)'}\n\nWrite the 3-4 sentence preview for the ${stage} stage now.`;

  function trimToFourSentences(text: string): string {
    const t = text.trim().replace(/^["'`]+|["'`]+$/g, '');
    const m = t.match(/^(?:[^.!?]+[.!?](?:\s+|$)){1,4}/);
    return (m ? m[0] : t).trim();
  }

  try {
    let raw: string;
    if (provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const c = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
      const msg = await c.messages.create({
        model: modelFor('rewrite', provider),
        max_tokens: 250,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const block = msg.content[0];
      if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');
      raw = block.text;
    } else {
      const { default: OpenAI } = await import('openai');
      const c = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
      const completion = await c.chat.completions.create({
        model: modelFor('rewrite', provider),
        max_tokens: 250,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? '';
    }
    return trimToFourSentences(raw);
  } catch (err) {
    console.error(`[previewStage:${stage}] failed:`, err);
    return defaultStageFallback(stage, context.projectName);
  }
}

function defaultStageFallback(stage: 'epics' | 'journeys' | 'tasks' | 'sync', projectName: string): string {
  switch (stage) {
    case 'epics':    return `${projectName} epics will be generated from the approved brief. Each epic captures a high-level scope unit such as authentication, core features, or admin tooling.`;
    case 'journeys': return `${projectName} journeys will be generated for every approved epic. Each journey is a persona-tagged flow with steps, edge cases, and test scenarios.`;
    case 'tasks':    return `${projectName} tasks will be generated from every approved journey. Each task is a 4-16 hour atomic unit with Given/When/Then acceptance criteria.`;
    case 'sync':     return `Approved tasks will be pushed to ClickUp. Each task gets a wbs_id custom field so future syncs stay idempotent.`;
  }
}

/**
 * Shared "conversation vs. action" policy injected into every page's chat
 * system prompt. The intent:
 *  - The assistant ALWAYS answers general questions naturally — methodology,
 *    terminology, recommendations, even tangential / off-topic chat.
 *  - SCOPE LOCK applies only to mutating ACTIONS, not to conversation. If the
 *    user asks the assistant to *perform* something that doesn't belong to
 *    this page, it sets action.type = "none" and replies with a brief
 *    redirect to the correct page.
 *
 * Place this block AFTER the action-type catalogue in each page's system
 * prompt so the LLM has already seen its action vocabulary.
 */
const GENERAL_CONVERSATION_POLICY = `GENERAL CONVERSATION POLICY:

You are also a helpful conversational assistant. ANSWER ANY GENERAL QUESTION naturally — methodology (agile, WBS, brief extraction), tool questions (ClickUp, Postgres), terminology (what is an epic vs a journey vs a task), recommendations, advice, even small talk. Be friendly, concise, and direct. 1-4 sentences unless the user explicitly asks for detail.

You may always:
- Explain concepts ("What's the difference between in-scope and out-of-scope?")
- Recommend approaches ("How should I structure this assumption?")
- Comment on what's currently shown on this page
- Compare or summarize content on this page

OFF-PAGE ACTION REQUESTS — REDIRECT, don't refuse:
When the user asks you to PERFORM something that doesn't belong to this page, set "action": { "type": "none" } and write a friendly redirect in the reply. Name the correct page.

Examples (apply the spirit, not the wording):
- On Brief page, "generate epics" → none + "Generating epics happens on the Epics page (Step 3). Once you're done reviewing the brief, head there and the chat can drive the generation."
- On Definition page, "rewrite the brief summary" → none + "The brief lives on Step 2 (Project Brief). Open that page and the chat there can rewrite the summary for you."
- On Sync page, "remove a task" → none + "Tasks are edited on the Tasks page (Step 5). I can't change task content from the Sync chat — head there to make edits, then come back to sync."
- On Epics page, "answer open question 2" → none + "Open questions live on the Brief (Step 2). The chat there can mark questions answered."
- On Journeys page, "regenerate the brief" → none + "Brief regeneration is on Step 2. The chat there can rebuild it from your raw input + attachments."
- On Tasks page, "add an assumption" → none + "Assumptions live on the Brief. Open Step 2 and the chat there can add it."

If the user asks a GENERAL/INFORMATIONAL question that touches another page's content (e.g. on the Sync page asking "how many epics do we have?"), you can ANSWER it (the data isn't fully visible to you, but give your best read from context) — what you can't do is mutate other pages' data from here.

Off-topic / non-WBS questions (e.g. "what's a good name for a dog?"): answer briefly and pleasantly. You're not locked to project topics.

`;

// ─── Brief / Definition / Sync chat helpers ──────────────────────────────────

/**
 * Discriminated union of actions the Brief-page chat can request.
 * The LLM picks ONE of these based on the user's message; the route handler
 * dispatches each to the matching DB mutation. `none` is the default —
 * the assistant chats without changing anything.
 */
export type BriefAction =
  | { type: 'none' }
  | { type: 'regenerateAll'; instruction: string }
  | { type: 'addAssumption'; text: string }
  | { type: 'removeAssumption'; index: number }
  | { type: 'rewriteAssumption'; index: number; text: string }
  | { type: 'addOpenQuestion'; text: string }
  | { type: 'removeOpenQuestion'; index: number }
  | { type: 'answerOpenQuestion'; index: number; answer: string }
  | { type: 'addScopeItem'; text: string; kind: 'in' | 'out' }
  | { type: 'removeScopeItem'; index: number; kind: 'in' | 'out' }
  | { type: 'rewriteSummary'; text: string };

export type DefinitionFieldKey =
  | 'name'
  | 'client'
  | 'projectType'
  | 'estimatedBudget'
  | 'startDate'
  | 'contactPerson'
  | 'rawInput';

export type DefinitionAction =
  | { type: 'none' }
  | { type: 'updateField'; field: DefinitionFieldKey; value: string };

export type SyncAction =
  | { type: 'none' }
  | { type: 'triggerSync' }
  | { type: 'resetSync' };

export interface BriefChatResult { reply: string; action: BriefAction; }
export interface DefinitionChatResult { reply: string; action: DefinitionAction; }
export interface SyncChatResult { reply: string; action: SyncAction; }

/** Legacy shape — kept for callers that haven't migrated to the rich action union. */
export interface SimpleChatResult {
  reply: string;
  regenerate?: string;
}

/**
 * Shared chat invocation. Parses the LLM's `reply` + raw `action` object and
 * hands the action back as a plain object — the caller is responsible for
 * validating/casting it into its page-scoped action union.
 */
async function callRichTextChat(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<{ reply: string; rawAction: Record<string, unknown> }> {
  if (!hasKey(provider)) {
    return {
      reply: `(${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key not configured.) Set it in Admin → Integrations.`,
      rawAction: { type: 'none' },
    };
  }
  const transcript = history.slice(-8).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
  const userBlock = transcript ? `Recent conversation:\n${transcript}\n\nUser's new message: ${userMessage}` : userMessage;
  const raw = await callLLM(provider, systemPrompt, userBlock, 'rewrite');
  let parsed: { reply?: unknown; action?: unknown } = {};
  try { parsed = JSON.parse(raw) as typeof parsed; }
  catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { parsed = JSON.parse(match[0]) as typeof parsed; } catch { /* fall through */ } }
  }
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : "(I didn't get a clear response — try rephrasing.)";
  const rawAction = (parsed.action && typeof parsed.action === 'object')
    ? parsed.action as Record<string, unknown>
    : { type: 'none' };
  return { reply, rawAction };
}

/**
 * Legacy thin wrapper kept so we don't break callers that still expect
 * `{ reply, regenerate? }`. Internally it now uses callRichTextChat.
 */
async function callTextChat(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  parseRegenerate = false,
): Promise<SimpleChatResult> {
  const { reply, rawAction } = await callRichTextChat(provider, systemPrompt, userMessage, history);
  if (parseRegenerate) {
    if (rawAction['type'] === 'regenerateAll' && typeof rawAction['instruction'] === 'string' && (rawAction['instruction'] as string).trim()) {
      return { reply, regenerate: (rawAction['instruction'] as string).trim() };
    }
  }
  return { reply };
}

/** Chat about the project brief — answers questions OR executes one of 10
 *  scoped actions (regenerate, edit assumptions/questions/scope, rewrite
 *  summary). Strictly scoped to the Brief page — cannot affect Epics, Tasks,
 *  or any other entity. */
export async function chatAboutBrief(
  provider: 'anthropic' | 'openai',
  brief: Brief,
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  regenContext = '',
): Promise<BriefChatResult> {
  const openQ = (brief.openQuestions ?? []).filter((q) => q.status === 'open').slice(0, 8).map((q, i) => `${i + 1}. ${q.text}`).join('\n');
  const assumptionsList = (brief.assumptions ?? []).slice(0, 10).map((a, i) => `${i + 1}. ${a.text}`).join('\n');
  const inScopeList = (brief.inScope ?? []).slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const outScopeList = (brief.outOfScope ?? []).slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n');

  const systemPrompt = `You are a PM assistant helping review the brief for "${brief.title || brief.client}". You can chat OR perform ONE scoped action on the brief. You NEVER refuse to act.

SCOPE LOCK — BRIEF PAGE ONLY: every action you take MUST stay inside the brief (summary, assumptions, open questions, scope items). Never propose changes to epics, journeys, tasks, or project setup fields — those belong to other pages.

Respond with valid JSON of the shape:
{
  "reply": "string — your conversational response, 1-4 sentences. Plain text, no markdown.",
  "action": { "type": "none" | "regenerateAll" | "addAssumption" | "removeAssumption" | "rewriteAssumption" | "addOpenQuestion" | "removeOpenQuestion" | "answerOpenQuestion" | "addScopeItem" | "removeScopeItem" | "rewriteSummary", ...action-specific fields below }
}

ACTION SHAPES (use exactly the fields named):
- { "type": "none" }                                         → just chat, no DB change
- { "type": "regenerateAll", "instruction": "..." }          → full brief regen with the given guidance
- { "type": "addAssumption", "text": "..." }                 → append a new assumption
- { "type": "removeAssumption", "index": <1-based> }         → delete assumption at that index
- { "type": "rewriteAssumption", "index": <1-based>, "text": "..." } → replace assumption text
- { "type": "addOpenQuestion", "text": "..." }               → append a new OPEN question
- { "type": "removeOpenQuestion", "index": <1-based> }       → delete an open question (index in the OPEN list shown below)
- { "type": "answerOpenQuestion", "index": <1-based>, "answer": "..." } → mark question answered with text
- { "type": "addScopeItem", "text": "...", "kind": "in" | "out" } → append an in-scope or out-of-scope item
- { "type": "removeScopeItem", "index": <1-based>, "kind": "in" | "out" } → delete a scope item
- { "type": "rewriteSummary", "text": "..." }                → replace the brief summary verbatim

PICKING THE RIGHT ACTION:
- "Rewrite the brief" / "redo it" / broad rewrite → regenerateAll
- "Tighten / rewrite the summary" → rewriteSummary
- "Add assumption X" → addAssumption with text=X
- "Remove assumption 2" / "drop the third assumption" → removeAssumption with the 1-based index
- "Rewrite assumption 1 to say Y" → rewriteAssumption
- "Add open question X" → addOpenQuestion
- "Mark question 2 answered: Z" / "answer 2: we'll use Postgres" → answerOpenQuestion
- "Remove the open question about X" → removeOpenQuestion (figure out the index from the list)
- "Add X to in scope" → addScopeItem kind:"in"
- "Move X out of scope" / "X is out of scope" → addScopeItem kind:"out"  (the user is adding to out-of-scope, not removing)
- "Remove X from scope" → removeScopeItem kind:"in" (if X is currently in-scope)
- Pure question / discussion → none

CRITICAL: "reply" is the ONLY user-visible text. The action runs silently — describe what you did in the reply.

RENDERING REGEN DIFFS — MATCH REPLY LENGTH TO QUESTION SCOPE:

The user reads this in a narrow chat panel. NEVER dump the entire diff unless the user explicitly asks for "everything" / "all of it" / "the full diff". Pick the SHORTEST reply that answers the question.

ABSOLUTE RULES when quoting prior content:
- NEVER truncate with "..." or "…". Quote the FULL TEXT verbatim from the data block.
- NEVER add evaluative commentary like "the new version is more focused" or "this is clearer". Just show what was asked for.
- NEVER include the current/after version unless the user explicitly asked to compare.

PATTERNS:

(1) "What was the previous summary?" / "show the v(N-1) summary" / "what was it before?"
    → Reply with ONLY the verbatim previous summary. Two lines:
      Previous summary (v12):
      "<the FULL previous summary text, verbatim, no truncation, no ellipsis>"

(2) "What changed in the summary?" / "compare the summary"
    → Two blocks, each FULL VERBATIM text, no editorial:
      Before:
      "<full previous summary>"

      After:
      "<full current summary>"

(3) "What's new in scope?" / "what assumptions did it add?" / etc.
    → Only the Added list for that ONE section. Up to 5 items + "+N more".

(4) "What was removed?"
    → Only the Removed lines across sections.

(5) "What changed?" / "compare before vs now" (BROAD question — no specific target)
    → Single-line counter, no item lists. Offer drill-down:
      Brief regenerated. Summary rewritten · 10 in-scope added · 6 assumptions added · 6 open questions added · 4 out-of-scope added. (Ask me about a specific section for details.)

(6) "Show me everything that changed" / "complete diff" / "all the changes in detail"
    → Then and ONLY then show the full structured per-section view.

When you DO show structured sections (case 6 only): plain UPPERCASE headers (IN-SCOPE, ASSUMPTIONS, etc.), numbered items, title-text only — never append "—" + a description. Cap at 5 items per section + "+N more".

${regenContext}${GENERAL_CONVERSATION_POLICY}
CURRENT BRIEF:
Title: ${brief.title || '(untitled)'}
Client: ${brief.client || '(unknown)'}

Summary:
${(brief.summary ?? '').slice(0, 800)}

Open questions (only OPEN ones — indices below):
${openQ || '(none)'}

Assumptions (indices below):
${assumptionsList || '(none)'}

In scope (indices below):
${inScopeList || '(none)'}

Out of scope (indices below):
${outScopeList || '(none)'}
`;

  const { reply, rawAction } = await callRichTextChat(provider, systemPrompt, userMessage, history);
  const action = validateBriefAction(rawAction);
  return { reply, action };
}

/** Coerces the LLM-returned `action` object into the BriefAction union or
 *  falls back to `{ type: 'none' }` when it doesn't match a known shape. */
function validateBriefAction(raw: Record<string, unknown>): BriefAction {
  const type = raw['type'];
  const text = typeof raw['text'] === 'string' ? (raw['text'] as string).trim() : '';
  const answer = typeof raw['answer'] === 'string' ? (raw['answer'] as string).trim() : '';
  const instruction = typeof raw['instruction'] === 'string' ? (raw['instruction'] as string).trim() : '';
  const index = typeof raw['index'] === 'number' ? (raw['index'] as number) : Number(raw['index']);
  const kind = raw['kind'] === 'out' ? 'out' : raw['kind'] === 'in' ? 'in' : null;

  switch (type) {
    case 'regenerateAll':
      return instruction ? { type: 'regenerateAll', instruction } : { type: 'none' };
    case 'addAssumption':
      return text ? { type: 'addAssumption', text } : { type: 'none' };
    case 'removeAssumption':
      return Number.isFinite(index) && index > 0 ? { type: 'removeAssumption', index } : { type: 'none' };
    case 'rewriteAssumption':
      return Number.isFinite(index) && index > 0 && text ? { type: 'rewriteAssumption', index, text } : { type: 'none' };
    case 'addOpenQuestion':
      return text ? { type: 'addOpenQuestion', text } : { type: 'none' };
    case 'removeOpenQuestion':
      return Number.isFinite(index) && index > 0 ? { type: 'removeOpenQuestion', index } : { type: 'none' };
    case 'answerOpenQuestion':
      return Number.isFinite(index) && index > 0 && answer ? { type: 'answerOpenQuestion', index, answer } : { type: 'none' };
    case 'addScopeItem':
      return text && kind ? { type: 'addScopeItem', text, kind } : { type: 'none' };
    case 'removeScopeItem':
      return Number.isFinite(index) && index > 0 && kind ? { type: 'removeScopeItem', index, kind } : { type: 'none' };
    case 'rewriteSummary':
      return text ? { type: 'rewriteSummary', text } : { type: 'none' };
    default:
      return { type: 'none' };
  }
}

/** Chat about the project definition form. Can answer questions OR update
 *  exactly ONE field on the project row (name / client / projectType /
 *  estimatedBudget / startDate / contactPerson / rawInput). Strictly scoped
 *  to the Definition page — cannot touch brief, epics, or downstream stages. */
export async function chatAboutDefinition(
  provider: 'anthropic' | 'openai',
  project: { name: string; client: string; project_type: string; estimated_budget: string; start_date: string; raw_input: string; contact_person: string },
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<DefinitionChatResult> {
  const systemPrompt = `You are a PM assistant for the project setup form. You can chat OR update exactly ONE field on the form. You NEVER refuse to act.

SCOPE LOCK — DEFINITION PAGE ONLY: any update you make MUST be one of the allowed fields below. Never touch brief / epics / journeys / tasks / sync — those belong to other pages.

Respond with valid JSON of the shape:
{
  "reply": "string — your conversational response, 1-4 sentences. Plain text, no markdown.",
  "action": { "type": "none" | "updateField", "field": "<one of: name, client, projectType, estimatedBudget, startDate, contactPerson, rawInput>", "value": "string" }
}

ALLOWED FIELD VALUES:
- name: free text (project name)
- client: free text (client / company name)
- projectType: ONE of "web_app" | "mobile" | "api" | "automation" | "general"
- estimatedBudget: free text (e.g. "$50,000", "USD 25k")
- startDate: ISO date string YYYY-MM-DD
- contactPerson: free text (person's name)
- rawInput: free text (the original client/BD notes; replaces the entire textarea)

PICKING THE RIGHT ACTION:
- "Change the project name to FreshFork" → updateField field:"name" value:"FreshFork"
- "Set client to Acme Corp" → updateField field:"client" value:"Acme Corp"
- "Set the budget to 50k" → updateField field:"estimatedBudget" value:"$50,000"
- "Start date: 2026-06-01" → updateField field:"startDate" value:"2026-06-01"
- "Contact is Sarah Johnson" → updateField field:"contactPerson" value:"Sarah Johnson"
- "Change project type to mobile" → updateField field:"projectType" value:"mobile"
- "Replace the raw input with this paragraph: ..." → updateField field:"rawInput" value:"..."
- Pure question / advice (e.g. "what does projectType=automation mean?") → none

CRITICAL: "reply" is the ONLY user-visible text. After an update succeeds, briefly confirm what you changed.

${GENERAL_CONVERSATION_POLICY}
CURRENT PROJECT SETUP:
Name: ${project.name || '(empty)'}
Client: ${project.client || '(empty)'}
Project type: ${project.project_type || '(empty)'}
Estimated budget: ${project.estimated_budget || '(empty)'}
Start date: ${project.start_date || '(empty)'}
Contact person: ${project.contact_person || '(empty)'}

Raw client input (truncated):
${(project.raw_input ?? '').slice(0, 1500)}
`;
  const { reply, rawAction } = await callRichTextChat(provider, systemPrompt, userMessage, history);
  const action = validateDefinitionAction(rawAction);
  return { reply, action };
}

const ALLOWED_DEFINITION_FIELDS: ReadonlySet<DefinitionFieldKey> = new Set([
  'name', 'client', 'projectType', 'estimatedBudget', 'startDate', 'contactPerson', 'rawInput',
]);

const ALLOWED_PROJECT_TYPES = new Set(['web_app', 'mobile', 'api', 'automation', 'general']);

function validateDefinitionAction(raw: Record<string, unknown>): DefinitionAction {
  if (raw['type'] !== 'updateField') return { type: 'none' };
  const field = raw['field'];
  const value = raw['value'];
  if (typeof field !== 'string' || typeof value !== 'string') return { type: 'none' };
  if (!ALLOWED_DEFINITION_FIELDS.has(field as DefinitionFieldKey)) return { type: 'none' };
  const trimmed = value.trim();
  if (!trimmed) return { type: 'none' };
  // Extra guard: projectType must be one of the enum values; otherwise the
  // patch would either be silently ignored or 400 from validation.
  if (field === 'projectType' && !ALLOWED_PROJECT_TYPES.has(trimmed)) return { type: 'none' };
  return { type: 'updateField', field: field as DefinitionFieldKey, value: trimmed };
}

/** Chat about ClickUp sync. Can answer questions OR trigger a sync /
 *  reset the local sync state. Strictly scoped to the Sync page — no
 *  brief / epic / task mutations possible from here. */
export async function chatAboutSync(
  provider: 'anthropic' | 'openai',
  syncSummary: { projectName: string; taskCount: number; syncedCount: number; lastSyncedAt: string | null; recentErrors: string[] },
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<SyncChatResult> {
  const systemPrompt = `You are a PM assistant on the ClickUp sync page. You can chat OR perform ONE scoped sync action. You NEVER refuse to act.

SCOPE LOCK — SYNC PAGE ONLY: you can only trigger a sync or reset the local sync log. Never propose changes to brief / epics / journeys / tasks — those belong to other pages.

Respond with valid JSON of the shape:
{
  "reply": "string — your conversational response, 1-4 sentences. Plain text, no markdown.",
  "action": { "type": "none" | "triggerSync" | "resetSync" }
}

ACTION SHAPES:
- { "type": "none" }         → just chat, no side effect
- { "type": "triggerSync" }  → start pushing approved tasks to ClickUp now
- { "type": "resetSync" }    → clear the local sync log + progress (does NOT undo what's already in ClickUp)

PICKING THE RIGHT ACTION:
- "Sync now" / "push to ClickUp" / "start the sync" / "send the tasks" → triggerSync
- "Reset the sync log" / "clear the log so I can retry" / "wipe the sync state" → resetSync
- Questions ("why did this fail?", "what's pending?") / explanations → none

CRITICAL: "reply" is the ONLY user-visible text. The action runs after — describe what you did or are about to do in the reply.

${GENERAL_CONVERSATION_POLICY}
SYNC STATE:
Project: ${syncSummary.projectName}
Total tasks: ${syncSummary.taskCount}
Synced to ClickUp: ${syncSummary.syncedCount}
Last sync: ${syncSummary.lastSyncedAt || 'never'}
Recent errors:
${syncSummary.recentErrors.length > 0 ? syncSummary.recentErrors.slice(0, 5).join('\n') : '(none)'}
`;
  const { reply, rawAction } = await callRichTextChat(provider, systemPrompt, userMessage, history);
  const action = validateSyncAction(rawAction);
  return { reply, action };
}

function validateSyncAction(raw: Record<string, unknown>): SyncAction {
  const type = raw['type'];
  if (type === 'triggerSync') return { type: 'triggerSync' };
  if (type === 'resetSync') return { type: 'resetSync' };
  return { type: 'none' };
}

/** Generate exactly ONE new task to append. */
export async function generateOneTask(
  brief: Brief,
  epics: Epic[],
  journeys: Journey[],
  existingTasks: Record<string, unknown>[],
  provider: 'anthropic' | 'openai',
  instruction: string,
): Promise<Record<string, unknown>> {
  if (!hasKey(provider)) {
    return {
      id: uuid(),
      title: instruction.slice(0, 80) || 'New task',
      estimateHours: 8,
      acceptanceCriteria: [
        { type: 'functional', given: 'a precondition', when: 'an action occurs', then: 'the expected outcome happens' },
        { type: 'functional', given: 'invalid input', when: 'the user submits', then: 'a clear error appears' },
        { type: 'technical', given: 'the test environment', when: 'unit tests run', then: 'they cover the new behaviour' },
      ],
      status: 'pending',
    };
  }
  const existingSummary = existingTasks.map((t, i) => `${i + 1}. ${(t['title'] as string) ?? '(untitled)'}`).join('\n');
  const journeyIds = journeys.map((j, i) => `${i + 1}. ${j.title} (id=${j.id})`).join('\n');
  const singleDesc = TASKS_SCHEMA_DESC.replace(
    'Return a JSON array (or an object with key "tasks" containing the array).',
    'Return a single JSON object (not an array). The object IS the task.',
  );
  const sysPrompt = `${singleDesc}

You are appending ONE new task to an existing list. Do NOT duplicate — find a gap and fill it.

EXISTING TASKS (do not duplicate):
${existingSummary || '(none yet)'}

AVAILABLE JOURNEYS (pick the relevant journeyId if needed):
${journeyIds || '(no journeys)'}

BRIEF SUMMARY:
${(brief.summary ?? '').slice(0, 400)}`;
  const userMessage = `Generate exactly ONE new task matching this instruction: "${instruction}"\n\nReturn a single JSON object with title, estimateHours, and acceptanceCriteria (3-5 items in Given/When/Then format).`;
  const raw = await callLLM(provider, sysPrompt, userMessage, 'tasks');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error('AI returned non-JSON when generating the new task.');
  }
  let candidate: unknown = parsed;
  if (Array.isArray(parsed)) candidate = parsed[0];
  else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj['task']) candidate = obj['task'];
    else if (obj['item']) candidate = obj['item'];
    else if (Array.isArray(obj['tasks']) && obj['tasks'].length > 0) candidate = (obj['tasks'] as unknown[])[0];
  }
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('AI returned an unexpected shape when generating the new task.');
  }
  const obj = candidate as Record<string, unknown>;
  return { id: uuid(), status: 'pending', ...obj };
}

// ─── Mock data generators ──────────────────────────────────────────────────

function mockBrief(projectName: string, client: string): Brief {
  return {
    title: `${projectName} — Project Brief`,
    client,
    date: new Date().toISOString().split('T')[0]!,
    summary: `${client} is looking to build ${projectName}. The platform should enable users to perform core operations efficiently, with a focus on reliability and user experience. The MVP will be delivered in phases with the first release targeting core functionality.`,
    openQuestions: [
      { id: uuid(), text: 'What is the expected number of concurrent users at launch?', status: 'open', answer: '' },
      { id: uuid(), text: 'Are there existing systems that need integration?', status: 'open', answer: '' },
      { id: uuid(), text: 'What is the preferred technology stack?', status: 'open', answer: '' },
    ],
    assumptions: [
      { id: uuid(), text: 'The client will provide access to existing brand assets and design guidelines.' },
      { id: uuid(), text: 'A staging environment will be set up by the client before UAT.' },
      { id: uuid(), text: 'Third-party API costs are covered by the client.' },
    ],
    inScope: [
      'User authentication and role-based access control',
      'Core CRUD operations for primary entities',
      'Responsive web interface',
      'Email notification system',
      'Admin dashboard for content management',
    ],
    outOfScope: [
      'Native mobile applications',
      'Multi-language support (Phase 2)',
      'Advanced analytics and reporting',
      'Legacy system data migration',
    ],
  };
}

function mockEpics(brief: Brief): Epic[] {
  return [
    {
      id: uuid(),
      title: 'Authentication & User Management',
      domain: 'auth',
      description: `Covers user registration, login (email/password + OAuth), email verification, password reset, and session management for ${brief.client}.`,
      storyPoints: 34,
      status: 'pending',
    },
    {
      id: uuid(),
      title: 'Core Feature Development',
      domain: 'profile',
      description: 'Implementation of the primary business logic and data management features defined in the brief.',
      storyPoints: 55,
      status: 'pending',
    },
    {
      id: uuid(),
      title: 'Notifications & Communications',
      domain: 'notifications',
      description: 'Email notifications, in-app alerts, and real-time updates for key user actions.',
      storyPoints: 21,
      status: 'pending',
    },
    {
      id: uuid(),
      title: 'Admin Dashboard',
      domain: 'admin',
      description: 'Internal administration interface for managing users, content, and system configuration.',
      storyPoints: 28,
      status: 'pending',
    },
  ];
}

function mockJourneys(epics: Epic[]): Journey[] {
  return epics.flatMap((epic) => [
    {
      id: uuid(),
      epicId: epic.id,
      persona: 'End User',
      title: `Complete core ${epic.title.toLowerCase()} flow`,
      steps: [
        'User lands on the feature page',
        'User initiates the primary action',
        'System validates inputs',
        'System processes the request',
        'User receives confirmation feedback',
      ],
      happyPath: `User successfully completes the ${epic.title.toLowerCase()} workflow end-to-end with confirmation displayed.`,
      edgeCases: [
        'User submits the form with missing required fields → system shows inline validation errors and prevents submission',
        'Network drops mid-request → system retries once, then shows a toast asking the user to try again',
        'User refreshes the page mid-flow → system restores the partially-entered state from local storage',
      ],
      testCases: [
        { name: 'Happy path completes successfully', given: 'authenticated user with all required data', when: 'they submit the form', then: 'the system creates the record and shows a success confirmation' },
        { name: 'Validation prevents bad submission', given: 'authenticated user', when: 'they submit with empty required fields', then: 'the system shows inline error per missing field and does not call the API' },
        { name: 'Network failure shows retry message', given: 'authenticated user mid-submission', when: 'the API request times out', then: 'the system shows a toast "Could not reach server — please try again" with a Retry button' },
      ],
      edgeCasesCount: 3,
      status: 'pending',
    },
  ]);
}

function mockTasks(journey: Journey, epic: Epic, startIndex: number): Task[] {
  const wbsPrefix = `WBS-${String(startIndex + 1).padStart(3, '0')}`;
  return [
    {
      id: uuid(),
      wbsId: wbsPrefix,
      title: `[${epic.domain.toUpperCase()}] Implement ${journey.title} — Backend API`,
      estimateHours: 8,
      domain: epic.domain,
      epicId: epic.id,
      journeyId: journey.id,
      acceptanceCriteria: [
        {
          type: 'functional',
          given: 'a user with valid credentials',
          when: 'they submit the form with valid data',
          then: 'the system creates the record and returns HTTP 201 with the new entity',
        },
        {
          type: 'functional',
          given: 'a user with valid credentials',
          when: 'they submit with missing required fields',
          then: 'the system returns HTTP 400 with a descriptive error message per field',
        },
        {
          type: 'non-functional',
          given: 'the system is under normal load',
          when: 'any API endpoint is called',
          then: 'the response is returned in under 300ms at p99',
        },
        {
          type: 'technical',
          given: 'the feature is deployed',
          when: 'integration tests run',
          then: 'all tests pass and code coverage for this module is ≥ 80%',
        },
      ],
      dependencies: [],
      status: 'pending',
      assignee: 'Unassigned',
    },
  ];
}

// ─── Public API ────────────────────────────────────────────────────────────

function applyChallenge(template: string, challengeText: string): string {
  const trimmed = challengeText.trim();
  const block = trimmed
    ? `\n\n[PM CHALLENGE INSTRUCTION — apply with priority]\n${trimmed}\n`
    : '';
  if (trimmed) {
    console.log('[ai:applyChallenge] injecting challenge text:', trimmed);
  }
  if (template.includes('{{challenge_text}}')) {
    return template.replace('{{challenge_text}}', block);
  }
  // Backwards-compat: prompts saved before {{challenge_text}} support — prepend the block
  return trimmed ? `${block}\n${template}` : template;
}

export async function generateBrief(
  rawInput: string,
  projectName: string,
  client: string,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userTemplate: string,
  challengeText = '',
): Promise<Brief> {
  if (!hasKey(provider)) {
    return mockBrief(projectName, client);
  }

  const userMessage = applyChallenge(userTemplate, challengeText)
    .replace('{{raw_input}}', rawInput)
    .replace('{{project_name}}', projectName)
    .replace('{{client_name}}', client)
    .replace('{{client}}', client);

  const raw = await callLLM(provider, systemPrompt + BRIEF_SCHEMA_DESC, userMessage, 'brief');
  const parsed = JSON.parse(raw);

  // Some LLMs nest the result under a key like "brief" — unwrap if needed.
  const briefData = (parsed && typeof parsed === 'object' && 'brief' in parsed && typeof parsed.brief === 'object')
    ? parsed.brief : parsed;

  // Ensure IDs are present on sub-objects
  if (briefData.openQuestions) {
    briefData.openQuestions = briefData.openQuestions.map((q: Record<string, unknown>) => ({ id: uuid(), status: 'open', answer: '', ...q }));
  }
  if (briefData.assumptions) {
    briefData.assumptions = briefData.assumptions.map((a: Record<string, unknown>) => ({ id: uuid(), ...a }));
  }

  // Fill in obvious defaults if missing (date is usually safe to default).
  if (!briefData.date) briefData.date = new Date().toISOString().split('T')[0];
  if (!briefData.title) briefData.title = projectName;
  if (!briefData.client) briefData.client = client;

  return BriefSchema.parse(briefData);
}

export async function generateEpics(
  brief: Brief,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userTemplate: string,
  challengeText = '',
): Promise<Epic[]> {
  if (!hasKey(provider)) {
    return mockEpics(brief);
  }

  const userMessage = applyChallenge(userTemplate, challengeText)
    .replace('{{brief_json}}', JSON.stringify(brief, null, 2));
  const raw = await callLLM(provider, systemPrompt + EPICS_SCHEMA_DESC, userMessage, 'epics');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.epics ?? parsed.items ?? [];
  // Per-epic validation (see generateEpicsForTier for rationale — one bad
  // epic must not kill the whole batch).
  const out: Epic[] = [];
  for (const rawEpic of arr) {
    if (!rawEpic || typeof rawEpic !== 'object') continue;
    const e = rawEpic as Record<string, unknown>;
    const result = EpicSchema.safeParse({
      id: uuid(),
      status: 'pending',
      ...e,
      domain: coerceEpicDomain(e['domain']),
      description: typeof e['description'] === 'string' ? e['description'] : '',
      storyPoints: e['storyPoints'] ?? 5,
    });
    if (result.success) out.push(result.data);
    else console.warn('[generateEpics] dropped one epic:', result.error.issues.slice(0, 3).map((iss) => `${iss.path.join('.')}: ${iss.message}`));
  }
  return out;
}

/**
 * Generate one TIER of epics in a single LLM call. Used by the streaming
 * generation route: 3 sequential calls (foundation → core → supporting/growth)
 * means epics land in the DB tier-by-tier so the frontend polling sees them
 * appear progressively — same UX as journey/task generation.
 */
export async function generateEpicsForTier(
  brief: Brief,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  challengeText: string,
  tier: 'foundation' | 'core_value' | 'supporting_growth',
  existing: Epic[],
): Promise<Epic[]> {
  if (!hasKey(provider)) {
    return [];
  }
  const tierGuidance: Record<typeof tier, string> = {
    foundation: 'Produce 2 to 3 FOUNDATION epics: authentication / account identity (always at index 0), plus critical third-party integrations the product depends on (payments, POS, core data model). These unblock every downstream epic.',
    core_value: 'Produce 3 to 4 CORE VALUE epics: the headline product capabilities defined in the brief — what the user actually came here to do. Skip auth, payments, integrations (already covered).',
    supporting_growth: 'Produce 2 to 3 SUPPORTING + GROWTH epics: admin dashboards, settings, history, reporting (supporting), plus notifications / marketing / analytics (growth). These come after the core product works.',
  };

  const existingList = existing.length > 0
    ? existing.map((e, i) => `${i + 1}. [${e.domain}] ${e.title} — ${(e.description ?? '').slice(0, 120)}`).join('\n')
    : '(none yet)';

  const tierPrompt = `${systemPrompt}${EPICS_SCHEMA_DESC}

YOU ARE GENERATING ONE TIER OF EPICS — A SUBSET of the full list, NOT all of them.

${tierGuidance[tier]}

EXISTING EPICS already generated for this project — do NOT duplicate or repeat their scope:
${existingList}

Return ONLY the new epics for this tier as a JSON array (or object with key "epics"). Stick to the per-epic description rules (30+ sentences, structured sections). Apply the same priority rubric within this tier.`;

  const userMessage = applyChallenge(`Brief:\n{{brief_json}}\n\nChallenge instruction: ${challengeText || '(none)'}`, challengeText)
    .replace('{{brief_json}}', JSON.stringify(brief, null, 2));

  const raw = await callLLM(provider, tierPrompt, userMessage, 'epics');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.epics ?? parsed.items ?? [];

  // Validate each epic INDIVIDUALLY. The earlier code used a strict .parse()
  // inside .map(), which meant a single bad epic (e.g. domain="engineering"
  // when the schema only allows 7 enum values) threw and killed the entire
  // tier — that's why a regen would sometimes return 3, 6, or 9 epics
  // instead of all 8 (one tier failed = -3; two failed = -6).
  //
  // We now:
  //   1. Pre-coerce shape (default id, status, salvage invalid domain).
  //   2. safeParse per-epic; on failure, log the issue and skip ONLY that one.
  // Result: a single LLM hiccup in one tier costs you ONE epic, not THREE.
  const validated: Epic[] = [];
  for (const rawEpic of arr) {
    if (!rawEpic || typeof rawEpic !== 'object') continue;
    const e = rawEpic as Record<string, unknown>;
    const result = EpicSchema.safeParse({
      id: uuid(),
      status: 'pending',
      ...e,
      // Salvage an unknown domain (very common LLM failure) by mapping it
      // to 'profile' (the most-generic catch-all). The PM can re-tag via
      // chat/edit if needed; better than losing the epic entirely.
      domain: coerceEpicDomain(e['domain']),
      // Description sometimes comes back as null when the LLM truncates —
      // give it an empty string so the schema doesn't reject it.
      description: typeof e['description'] === 'string' ? e['description'] : '',
      // storyPoints is z.coerce.number() so string is fine, but null isn't.
      storyPoints: e['storyPoints'] ?? 5,
    });
    if (result.success) {
      validated.push(result.data);
    } else {
      console.warn(`[generateEpicsForTier] tier=${tier} dropped one epic — validation failed:`, {
        title: e['title'],
        domain: e['domain'],
        issues: result.error.issues.slice(0, 3).map((iss) => `${iss.path.join('.')}: ${iss.message}`),
      });
    }
  }
  return validated;
}

/** Maps an LLM-returned domain value onto one of the 7 valid enum entries.
 *  Falls back to 'profile' (the most generic catch-all) when nothing matches. */
function coerceEpicDomain(raw: unknown): 'auth' | 'billing' | 'search' | 'messaging' | 'profile' | 'admin' | 'notifications' {
  if (typeof raw !== 'string') return 'profile';
  const v = raw.toLowerCase().trim();
  const allowed = ['auth', 'billing', 'search', 'messaging', 'profile', 'admin', 'notifications'] as const;
  if ((allowed as readonly string[]).includes(v)) return v as (typeof allowed)[number];
  // Common aliases the LLM produces — map to the closest valid bucket.
  if (/^(authent|identity|account|user|login|signup|signin|oauth|sso)/.test(v)) return 'auth';
  if (/^(pay|bill|invoic|checkout|subscript|stripe|paypal|transact)/.test(v)) return 'billing';
  if (/^(search|discover|catalog|browse|filter)/.test(v)) return 'search';
  if (/^(chat|messag|comment|inbox|conversation)/.test(v)) return 'messaging';
  if (/^(notif|push|sms|email|alert)/.test(v)) return 'notifications';
  if (/^(admin|dashboard|manag|moderation|setting|reporting|audit)/.test(v)) return 'admin';
  return 'profile';
}

/**
 * Generate exactly ONE new epic to append to an existing list. Used by the
 * agentic chat when the user says "add a new epic for X" — preserves the
 * other epics untouched.
 */
export async function generateOneEpic(
  brief: Brief,
  existingEpics: Epic[],
  provider: 'anthropic' | 'openai',
  instruction: string,
): Promise<Epic> {
  if (!hasKey(provider)) {
    // Mock fallback: synthesize a plausible epic so dev mode still works.
    return {
      id: uuid(),
      title: instruction.slice(0, 60) || 'New Epic',
      domain: 'profile',
      description: `Placeholder epic generated from instruction: "${instruction}". Configure an AI provider in Admin → Integrations to get a real description.`,
      storyPoints: 5,
      status: 'pending',
    };
  }

  const existingSummary = existingEpics
    .map((e, i) => `${i + 1}. [${e.domain}] ${e.title} (${e.storyPoints} pts)`)
    .join('\n');

  const singleEpicSchemaDesc = EPICS_SCHEMA_DESC.replace(
    'Return a JSON array (or an object with key "epics" containing the array).',
    'Return a single JSON object (not an array). The object IS the epic.',
  );

  const sysPrompt = `${singleEpicSchemaDesc}

You are adding ONE new epic to an existing list. Do NOT duplicate or overlap with the existing epics — pick a focus that fills a gap.

EXISTING EPICS (do not duplicate these):
${existingSummary || '(no existing epics yet)'}

PROJECT BRIEF SUMMARY:
${(brief.summary ?? '').slice(0, 600)}`;

  const userMessage = `Generate exactly ONE new epic matching this instruction: "${instruction}"\n\nReturn a single JSON object with title, domain, description (30+ sentences per the schema rules), and storyPoints.`;

  const raw = await callLLM(provider, sysPrompt, userMessage, 'epics');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[generateOneEpic] JSON parse failed. Raw response:', raw.slice(0, 500));
    throw new Error('AI returned non-JSON when generating the new epic. Try a more specific instruction.');
  }

  // The model may wrap the single epic in any of several shapes. Try them all:
  //   { title, domain, ... }         → bare object
  //   { epic: { ... } }              → singular wrapper
  //   { item: { ... } }              → alternate wrapper
  //   { epics: [{ ... }] }           → array-form wrapper (most common drift)
  //   [{ ... }]                      → bare array
  let candidate: unknown = parsed;
  if (Array.isArray(parsed)) {
    candidate = parsed[0];
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj['epic']) candidate = obj['epic'];
    else if (obj['item']) candidate = obj['item'];
    else if (Array.isArray(obj['epics']) && obj['epics'].length > 0) candidate = (obj['epics'] as unknown[])[0];
  }

  if (!candidate || typeof candidate !== 'object') {
    console.error('[generateOneEpic] Could not locate epic object in response. Raw:', raw.slice(0, 500));
    throw new Error('AI returned an unexpected shape when generating the new epic. Try rephrasing.');
  }

  // Salvage common LLM failure modes (invalid domain, null description) the
  // same way generateEpicsForTier does, so chat "add a new epic" succeeds
  // even when the model picks an out-of-enum domain.
  const c = candidate as Record<string, unknown>;
  try {
    return EpicSchema.parse({
      id: uuid(),
      status: 'pending',
      ...c,
      domain: coerceEpicDomain(c['domain']),
      description: typeof c['description'] === 'string' ? c['description'] : '',
      storyPoints: c['storyPoints'] ?? 5,
    });
  } catch (err) {
    console.error('[generateOneEpic] Zod validation failed. Candidate:', JSON.stringify(candidate).slice(0, 500), 'Error:', err);
    throw new Error('AI produced an epic with missing or invalid fields. Try a more specific instruction.');
  }
}

export async function generateJourneys(
  epics: Epic[],
  brief: Brief,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userTemplate: string,
  challengeText = '',
): Promise<Journey[]> {
  if (!hasKey(provider)) {
    return mockJourneys(epics);
  }

  // Generate journeys per-epic instead of all in one call. Single-call generation
  // hits LLM output token limits when there are many epics (10+) and silently
  // truncates — so some epics end up with 0 journeys. One call per epic is
  // slower but guarantees every epic gets coverage.
  const allJourneys: Journey[] = [];

  // Run with limited concurrency to keep latency reasonable while staying
  // under provider rate limits. 3 concurrent calls is a sweet spot.
  const CONCURRENCY = 3;
  for (let i = 0; i < epics.length; i += CONCURRENCY) {
    const batch = epics.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((epic) => generateJourneysForEpic(epic, brief, provider, systemPrompt, userTemplate, challengeText)),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === 'fulfilled') {
        allJourneys.push(...r.value);
      } else {
        console.warn(`[generateJourneys] epic "${batch[j]!.title}" failed:`, r.reason);
      }
    }
  }

  return allJourneys;
}

export async function generateJourneysForEpic(
  epic: Epic,
  brief: Brief,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userTemplate: string,
  challengeText: string,
): Promise<Journey[]> {
  // For per-epic generation we replace the placeholders with this single epic
  // wrapped in an array so the existing prompt template still works, plus a
  // strong directive ensuring the LLM produces journeys for THIS epic.
  const focusedDirective = `\n\nIMPORTANT: Generate 1-3 journeys ONLY for the epic with id="${epic.id}" and title="${epic.title}". Every journey's epicId field MUST be exactly "${epic.id}". Do not generate journeys for any other epic.`;

  const userMessage = applyChallenge(userTemplate, challengeText)
    .replace('{{epics_json}}', JSON.stringify([epic], null, 2))
    .replace('{{brief_json}}', JSON.stringify(brief, null, 2)) + focusedDirective;

  const raw = await callLLM(provider, systemPrompt + JOURNEYS_SCHEMA_DESC, userMessage, 'journeys');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.journeys ?? parsed.items ?? [];
  return arr.map((j: Record<string, unknown>) =>
    JourneySchema.parse({
      id: uuid(),
      status: 'pending',
      edgeCasesCount: 2,
      // Force-correct the epicId in case the LLM hallucinates a different value
      ...j,
      epicId: epic.id,
    }),
  );
}

export async function generateTasks(
  journey: Journey,
  epic: Epic,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userTemplate: string,
  startIndex = 0,
  challengeText = '',
): Promise<Task[]> {
  if (!hasKey(provider)) {
    return mockTasks(journey, epic, startIndex);
  }

  const userMessage = applyChallenge(userTemplate, challengeText)
    .replace('{{journey_json}}', JSON.stringify(journey, null, 2))
    .replace('{{epic_json}}', JSON.stringify(epic, null, 2));

  const raw = await callLLM(provider, systemPrompt + TASKS_SCHEMA_DESC, userMessage, 'tasks');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.tasks ?? parsed.items ?? [];

  // Tolerant per-task parsing. The LLM occasionally returns tasks with fewer
  // than 3 acceptance criteria (violating .min(3)). Previously this threw,
  // killing every task for the journey. Now we:
  //   1. Pad the AC array up to 3 with sensible defaults if the LLM was lazy
  //   2. safeParse each task and silently drop the unsalvageable ones
  // The journey still produces tasks instead of zero.
  const validTasks: Task[] = [];
  arr.forEach((t: Record<string, unknown>, i: number) => {
    const padded = padAcceptanceCriteria(t, epic);
    const result = TaskSchema.safeParse({
      id: uuid(),
      wbsId: `WBS-${String(startIndex + i + 1).padStart(3, '0')}`,
      status: 'pending',
      dependencies: [],
      assignee: 'Unassigned',
      domain: epic.domain,
      epicId: epic.id,
      journeyId: journey.id,
      ...padded,
    });
    if (result.success) {
      validTasks.push(result.data);
    } else {
      console.warn(
        `[generateTasks] dropping malformed task #${i} in journey "${journey.title}":`,
        result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
      );
    }
  });
  return validTasks;
}

// Pad acceptanceCriteria to at least 3 entries when the LLM returns fewer.
// Better to keep the task with a stamped placeholder AC than drop the whole
// task — the PM can edit/rewrite to fill in real criteria.
function padAcceptanceCriteria(t: Record<string, unknown>, epic: Epic): Record<string, unknown> {
  const ac = Array.isArray(t['acceptanceCriteria']) ? (t['acceptanceCriteria'] as unknown[]) : [];
  if (ac.length >= 3) return t;

  const padding = [
    { type: 'functional', given: 'a valid request to this endpoint', when: 'the operation succeeds', then: 'the system returns a 2xx response with the expected payload' },
    { type: 'functional', given: 'an invalid or malformed request', when: 'the operation is rejected', then: 'the system returns a 4xx response with a clear error message' },
    { type: 'non-functional', given: `the ${epic.domain} feature is deployed`, when: 'the endpoint is called under normal load', then: 'p99 response time stays under 500ms' },
  ];
  const padded = [...ac];
  while (padded.length < 3) {
    padded.push(padding[padded.length] ?? padding[0]);
  }
  return { ...t, acceptanceCriteria: padded };
}

/**
 * Page-level context used to keep a rewrite "in scope" for its entity type:
 *  - brief    : top-level project brief (always optional; used for all three types)
 *  - parent   : the parent entity (parent epic for journeys, parent journey for tasks)
 *  - grandparent: only for tasks (parent epic of the parent journey)
 *  - siblings : other items at the same level (titles + one-line summary) so the
 *               rewrite stays consistent with the rest of the page and doesn't
 *               duplicate or contradict its peers
 *
 * Without this context the LLM tends to drift across abstraction layers — e.g.
 * task rewrites pulling in epic-level strategy, or epic rewrites listing
 * specific tasks. The context block + scope rules below keep it pinned to the
 * right page.
 */
export interface RewriteContext {
  brief?: { summary?: string; scope?: string[]; outOfScope?: string[] } | null;
  parent?: { title?: string; description?: string } | null;
  grandparent?: { title?: string; description?: string } | null;
  siblings?: Array<{ title?: string; summary?: string }>;
}

const SCOPE_RULES: Record<'epic' | 'journey' | 'task', string> = {
  epic: [
    `SCOPE LOCK — EPIC LEVEL ONLY:`,
    `• An epic describes a high-level scope unit (e.g. Authentication, Billing, Admin). Stay at strategy / outcome level.`,
    `• Do NOT include specific tasks, code-level implementation steps, file names, or Given/When/Then acceptance criteria — those belong on the Tasks page.`,
    `• Do NOT include user-flow step lists (e.g. "User clicks X, then Y") — those belong on the Journeys page.`,
    `• Refer to siblings for tone/granularity consistency; do not duplicate what another epic already covers.`,
  ].join('\n'),
  journey: [
    `SCOPE LOCK — JOURNEY LEVEL ONLY:`,
    `• A journey describes one persona walking through one outcome inside the parent epic. Stay at user-flow level.`,
    `• Do NOT widen scope to other epics or rename the parent epic.`,
    `• Do NOT drop to task-level detail — no Given/When/Then, no code, no estimate-in-hours.`,
    `• Steps describe what the USER does, not how the engineer builds it.`,
    `• Stay consistent with the parent epic's intent and with sibling journeys (don't contradict / don't duplicate).`,
  ].join('\n'),
  task: [
    `SCOPE LOCK — TASK LEVEL ONLY:`,
    `• A task is an atomic, testable unit a single mid-level dev can deliver in 4–16 hours. Stay at implementation level.`,
    `• Do NOT broaden the task into multiple deliverables or change which journey/epic it belongs to.`,
    `• Acceptance criteria MUST be Given/When/Then. Free-form prose ACs are not allowed.`,
    `• Stay consistent with the parent journey's happy path and with sibling tasks (no overlap, no contradiction).`,
    `• If the instruction would push the estimate outside 4–16h, split conceptually but still return ONE task — flag the issue in the description.`,
  ].join('\n'),
};

function formatRewriteContext(type: 'epic' | 'journey' | 'task', ctx?: RewriteContext): string {
  if (!ctx) return '';
  const lines: string[] = [];

  if (ctx.brief) {
    const b = ctx.brief;
    const briefBits: string[] = [];
    if (b.summary) briefBits.push(`summary: ${b.summary.slice(0, 600)}`);
    if (b.scope?.length) briefBits.push(`in-scope: ${b.scope.slice(0, 8).join('; ')}`);
    if (b.outOfScope?.length) briefBits.push(`out-of-scope: ${b.outOfScope.slice(0, 6).join('; ')}`);
    if (briefBits.length > 0) {
      lines.push(`PROJECT BRIEF (do not contradict):`);
      for (const bit of briefBits) lines.push(`  - ${bit}`);
      lines.push('');
    }
  }

  if (ctx.grandparent && type === 'task') {
    lines.push(`PARENT EPIC: ${ctx.grandparent.title ?? '(untitled)'}`);
    if (ctx.grandparent.description) lines.push(`  ${ctx.grandparent.description.slice(0, 400)}`);
    lines.push('');
  }

  if (ctx.parent) {
    const parentLabel = type === 'task' ? 'PARENT JOURNEY' : type === 'journey' ? 'PARENT EPIC' : '';
    if (parentLabel) {
      lines.push(`${parentLabel}: ${ctx.parent.title ?? '(untitled)'}`);
      if (ctx.parent.description) lines.push(`  ${ctx.parent.description.slice(0, 500)}`);
      lines.push('');
    }
  }

  if (ctx.siblings && ctx.siblings.length > 0) {
    const siblingLabel = type === 'epic' ? 'OTHER EPICS ON THIS PAGE' : type === 'journey' ? 'SIBLING JOURNEYS (same parent epic)' : 'SIBLING TASKS (same parent journey)';
    lines.push(`${siblingLabel} — keep consistency, no duplication:`);
    for (const s of ctx.siblings.slice(0, 12)) {
      const title = s.title ?? '(untitled)';
      const summary = s.summary ? ` — ${s.summary.slice(0, 120)}` : '';
      lines.push(`  • ${title}${summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function rewriteItem(
  type: 'epic' | 'journey' | 'task',
  item: Record<string, unknown>,
  instruction: string,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  context?: RewriteContext,
): Promise<Record<string, unknown>> {
  if (!hasKey(provider)) {
    return {
      ...item,
      description: `[Rewritten per: "${instruction.slice(0, 60)}"] ${item['description'] ?? ''}`,
      title: item['title'],
    };
  }

  // Pick the schema description that matches the item type so OpenAI knows
  // the exact field names to preserve (Claude infers; OpenAI is literal).
  const schemaDesc = type === 'epic' ? EPICS_SCHEMA_DESC.replace('Return a JSON array (or an object with key "epics" containing the array).\n', 'Return a single JSON object (not an array).\n')
    : type === 'journey' ? JOURNEYS_SCHEMA_DESC.replace('Return a JSON array (or an object with key "journeys" containing the array).\n', 'Return a single JSON object (not an array).\n')
    : TASKS_SCHEMA_DESC.replace('Return a JSON array (or an object with key "tasks" containing the array).\n', 'Return a single JSON object (not an array).\n');

  const contextBlock = formatRewriteContext(type, context);

  // Be assertive in the rewrite instruction so the LLM actually applies the change
  // instead of returning the input verbatim. Naming the affected fields and
  // emphasizing "MUST be different" prevents GPT-4o from being overly conservative.
  const userMessage = [
    `You are revising an existing ${type}. Apply the user's instruction below and return a meaningfully different version.`,
    ``,
    SCOPE_RULES[type],
    ``,
    ...(contextBlock ? [`PAGE CONTEXT (for awareness; do NOT copy into the output unless the instruction asks):`, contextBlock] : []),
    `USER INSTRUCTION:`,
    `"""${instruction}"""`,
    ``,
    `CURRENT ${type.toUpperCase()} JSON:`,
    JSON.stringify(item, null, 2),
    ``,
    `RULES:`,
    `1. The output MUST be different from the input — apply the instruction.`,
    `2. Keep the same JSON field names. Do not nest under another key like "${type}" or "item".`,
    `3. Preserve fields the instruction does not touch (other text fields can stay).`,
    `4. The output ${type === 'task' ? 'acceptanceCriteria array' : type === 'journey' ? 'steps array' : 'description and storyPoints'} should reflect the instruction directly.`,
    `5. If the instruction asks to add/expand content, the output should have more detail than the input.`,
    `6. If the instruction asks to remove/simplify, the output should be shorter than the input.`,
    `7. Stay strictly within the SCOPE LOCK above — do not drift to another entity level.`,
    ``,
    `Return ONLY the updated JSON object — no commentary, no markdown.`,
  ].join('\n');

  const raw = await callLLM(provider, systemPrompt + schemaDesc, userMessage, 'rewrite');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // If LLM gave invalid JSON, fall back to original item with a stamped change
    return { ...item, _rewriteError: 'Invalid LLM JSON; original kept' };
  }

  // Some LLMs nest the response under a top-level key matching the type
  if (parsed && typeof parsed === 'object') {
    const nested = parsed[type] ?? (parsed as { item?: unknown }).item;
    if (nested && typeof nested === 'object') {
      parsed = nested as Record<string, unknown>;
    }
  }

  // Merge: apply LLM content on top, then FORCE-RESTORE immutable identity
  // fields. Without this last step, the LLM's id/wbsId/etc. (which we asked
  // it NOT to include but which it sometimes does anyway) would override the
  // real ones — breaking the frontend's `tasks.find(t => t.id === itemId)`
  // lookup so the UI silently fails to refresh after rewrite.
  const merged: Record<string, unknown> = { ...item, ...parsed };

  // Identity / system-managed fields per type that must never be changed by the LLM:
  const lockedFields: Record<typeof type, string[]> = {
    epic:    ['id', 'status'],
    journey: ['id', 'epicId', 'status'],
    task:    ['id', 'wbsId', 'domain', 'epicId', 'journeyId', 'status', 'assignee'],
  };
  for (const k of lockedFields[type]) {
    if (item[k] !== undefined) merged[k] = item[k];
  }

  try {
    if (type === 'epic') return EpicSchema.parse(merged) as unknown as Record<string, unknown>;
    if (type === 'journey') return JourneySchema.parse(merged) as unknown as Record<string, unknown>;
    if (type === 'task') return TaskSchema.parse(merged) as unknown as Record<string, unknown>;
  } catch (err) {
    console.warn(`[rewriteItem] ${type} schema validation failed:`, err instanceof Error ? err.message : err);
  }
  return merged;
}
