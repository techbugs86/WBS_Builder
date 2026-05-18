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

RENDERING COMPARISONS AND LISTS:
- DO NOT use tables (no markdown pipes, no Unicode box-drawing grids). The narrow sidebar mangles them and most users find them hard to scan.
- INSTEAD, render comparisons as labeled sections, grouped by the type of change. This is the only format used for diffs / comparisons / "show me X vs Y":

Example for an epic comparison reply:

Here's how the new lineup compares to what you had before:

✓ UNCHANGED (5)
  • User Authentication & Registration
  • QR Code Scanning for Points Accrual
  • Toast POS System Integration
  • User Profile and Points History
  • Rewards Redemption System

★ NEW (1)
  • Loyalty Program Analytics — gathers insights from user engagement and redemption patterns

~ MODIFIED (2)
  • Manager Dashboard — added refund-volume metric and top-earner widget
  • Push Notifications — scope tightened to in-app only

× REMOVED (1)
  • Search (consolidated into Profile)

Rules for this format:
- Use the exact symbols ✓ ★ ~ × in the section headers as shown.
- ALWAYS include the count in parentheses after the section name.
- Skip sections that are empty (don't write "✓ UNCHANGED (0)" — just omit the section entirely).
- Use a bullet (•) with two leading spaces for every item.
- For NEW and MODIFIED items, append a short "—" dash followed by 1 sentence of context. UNCHANGED and REMOVED items can be title-only unless extra context aids the user.
- One blank line between sections.
- Pull previous-state context from the conversation transcript above when the user references "original", "previous", "before". If the transcript doesn't show the previous state, say so honestly and offer to recap the current list instead.
- Keep titles intact — do not truncate.

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

RENDERING COMPARISONS:
- NEVER use tables. Use labeled sections: ✓ UNCHANGED (n), ★ NEW (n), ~ MODIFIED (n), × REMOVED (n). Bullets (•) two-space-indented. Skip empty sections.

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

// ─── Brief / Definition / Sync chat helpers ──────────────────────────────────

export interface SimpleChatResult {
  reply: string;
  regenerate?: string;
}

async function callTextChat(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
  parseRegenerate = false,
): Promise<SimpleChatResult> {
  if (!hasKey(provider)) {
    return { reply: `(${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key not configured.) Set it in Admin → Integrations.` };
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
  if (parseRegenerate) {
    const action = parsed.action as { type?: string; instruction?: string } | undefined;
    if (action && action.type === 'regenerateAll' && typeof action.instruction === 'string' && action.instruction.trim()) {
      return { reply, regenerate: action.instruction.trim() };
    }
  }
  return { reply };
}

/** Chat about the project brief — can trigger a full brief regen. */
export async function chatAboutBrief(
  provider: 'anthropic' | 'openai',
  brief: Brief,
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<SimpleChatResult> {
  const openQ = (brief.openQuestions ?? []).filter((q) => q.status === 'open').slice(0, 8).map((q, i) => `${i + 1}. ${q.text}`).join('\n');
  const assumptionsList = (brief.assumptions ?? []).slice(0, 10).map((a, i) => `${i + 1}. ${a.text}`).join('\n');
  const inScopeList = (brief.inScope ?? []).slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const outScopeList = (brief.outOfScope ?? []).slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n');

  const systemPrompt = `You are a PM assistant helping review the brief for "${brief.title || brief.client}". You can chat OR trigger a full brief regeneration. You NEVER refuse to act.

Respond with valid JSON:
{
  "reply": "string — your conversational response, 1-4 sentences (longer for comparisons or lists). Plain text, no markdown.",
  "action": {
    "type": "none" | "regenerateAll",
    "instruction": "string (required for regenerateAll — self-contained instruction for the brief regenerator)"
  }
}

USE "regenerateAll" when the user asks for:
- "rewrite the brief", "regenerate the brief", "redo the summary", "tighten the scope"
- ANY ask to materially change the brief content.
- The instruction string must be self-contained — the regenerator has no memory of this chat.

USE "none" for:
- Questions about brief content ("what's in scope?", "why is X an assumption?")
- Discussion of open questions, assumptions, scope items.
- Explanations without change.

CRITICAL: "reply" is the ONLY user-visible output. Put any explanations, comparisons, or lists IN THAT FIELD.

For comparisons / multi-item lists: use labeled sections (✓ ★ ~ ×) with bullets. Never use markdown tables.

CURRENT BRIEF:
Title: ${brief.title || '(untitled)'}
Client: ${brief.client || '(unknown)'}

Summary:
${(brief.summary ?? '').slice(0, 800)}

Open questions:
${openQ || '(none)'}

Assumptions:
${assumptionsList || '(none)'}

In scope:
${inScopeList || '(none)'}

Out of scope:
${outScopeList || '(none)'}
`;
  return callTextChat(provider, systemPrompt, userMessage, history, true);
}

/** Chat about the project definition form — no DB mutations. */
export async function chatAboutDefinition(
  provider: 'anthropic' | 'openai',
  project: { name: string; client: string; project_type: string; estimated_budget: string; start_date: string; raw_input: string; contact_person: string },
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<SimpleChatResult> {
  const systemPrompt = `You are a PM assistant helping refine a project setup form. You CANNOT modify the form — you advise only. The user owns their inputs.

Respond with valid JSON:
{ "reply": "string — your conversational response, 1-4 sentences (longer when explaining or summarizing). Plain text, no markdown." }

You can:
- Explain what a field means.
- Suggest improved wording for the Raw Client Input.
- Spot missing context the PM might want to capture.
- Estimate timeline or scope based on what's in the form.
- Recommend communication channels or contact rhythm.

You cannot:
- Edit the form (refer the user to the field directly).
- Promise outcomes — frame everything as a recommendation.

PROJECT DEFINITION:
Name: ${project.name || '(empty)'}
Client: ${project.client || '(empty)'}
Project type: ${project.project_type || '(empty)'}
Estimated budget: ${project.estimated_budget || '(empty)'}
Start date: ${project.start_date || '(empty)'}
Contact person: ${project.contact_person || '(empty)'}

Raw client input (truncated):
${(project.raw_input ?? '').slice(0, 1500)}
`;
  return callTextChat(provider, systemPrompt, userMessage, history, false);
}

/** Chat about ClickUp sync — read-only advisory. */
export async function chatAboutSync(
  provider: 'anthropic' | 'openai',
  syncSummary: { projectName: string; taskCount: number; syncedCount: number; lastSyncedAt: string | null; recentErrors: string[] },
  userMessage: string,
  history: { role: 'user' | 'agent'; text: string }[],
): Promise<SimpleChatResult> {
  const systemPrompt = `You are a PM assistant helping interpret ClickUp sync status. You CANNOT trigger sync from chat — the user uses the Sync button on the page. You advise only.

Respond with valid JSON:
{ "reply": "string — your conversational response, 1-4 sentences. Plain text, no markdown." }

You can:
- Explain what the sync numbers mean.
- Diagnose common errors ("List deleted" → list was removed in ClickUp UI, our mapping is stale; "Folder name taken" → another folder exists with the same project name).
- Recommend next steps ("click Sync to retry", "check Admin → Integrations for your ClickUp API key").
- Summarize what's been pushed vs what's pending.

You cannot:
- Actually run a sync.
- Modify mappings.

SYNC STATE:
Project: ${syncSummary.projectName}
Total tasks: ${syncSummary.taskCount}
Synced to ClickUp: ${syncSummary.syncedCount}
Last sync: ${syncSummary.lastSyncedAt || 'never'}
Recent errors:
${syncSummary.recentErrors.length > 0 ? syncSummary.recentErrors.slice(0, 5).join('\n') : '(none)'}
`;
  return callTextChat(provider, systemPrompt, userMessage, history, false);
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
  return arr.map((e: Record<string, unknown>) => EpicSchema.parse({ id: uuid(), status: 'pending', ...e }));
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
  return arr.map((e: Record<string, unknown>) => EpicSchema.parse({ id: uuid(), status: 'pending', ...e }));
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

  try {
    return EpicSchema.parse({ id: uuid(), status: 'pending', ...(candidate as Record<string, unknown>) });
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
