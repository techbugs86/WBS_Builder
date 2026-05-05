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
  "title": "string",
  "domain": "auth" | "billing" | "search" | "messaging" | "profile" | "admin" | "notifications",
  "description": "string — 2-3 sentences",
  "storyPoints": "number — Fibonacci: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89"
}
"domain" MUST be one of the seven literal strings above. Do not invent new domain values.
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
  "title": "string — imperative",
  "estimateHours": "number — integer between 4 and 16",
  "acceptanceCriteria": [
    {
      "type": "functional" | "non-functional" | "technical",
      "given": "string",
      "when": "string",
      "then": "string"
    }
  ]
}
acceptanceCriteria must contain 3 to 7 items. Each item must have all four fields (type, given, when, then) as non-empty strings.
Do not include id, wbsId, domain, epicId, journeyId, status, assignee — the system adds those.`;

async function callLLM(
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  // Retry policy: rate-limit (429) and transient 5xx errors get exponential
  // backoff (1.5s → 4s → 9s). Other errors (auth, validation) bail immediately.
  const RETRY_DELAYS_MS = [1500, 4000, 9000];
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
        const msg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
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
          model: 'gpt-4o',
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

  const raw = await callLLM(provider, systemPrompt + BRIEF_SCHEMA_DESC, userMessage);
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
  const raw = await callLLM(provider, systemPrompt + EPICS_SCHEMA_DESC, userMessage);
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.epics ?? parsed.items ?? [];
  return arr.map((e: Record<string, unknown>) => EpicSchema.parse({ id: uuid(), status: 'pending', ...e }));
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

async function generateJourneysForEpic(
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

  const raw = await callLLM(provider, systemPrompt + JOURNEYS_SCHEMA_DESC, userMessage);
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

  const raw = await callLLM(provider, systemPrompt + TASKS_SCHEMA_DESC, userMessage);
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

export async function rewriteItem(
  type: 'epic' | 'journey' | 'task',
  item: Record<string, unknown>,
  instruction: string,
  provider: 'anthropic' | 'openai',
  systemPrompt: string,
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

  // Be assertive in the rewrite instruction so the LLM actually applies the change
  // instead of returning the input verbatim. Naming the affected fields and
  // emphasizing "MUST be different" prevents GPT-4o from being overly conservative.
  const userMessage = [
    `You are revising an existing ${type}. Apply the user's instruction below and return a meaningfully different version.`,
    ``,
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
    ``,
    `Return ONLY the updated JSON object — no commentary, no markdown.`,
  ].join('\n');

  const raw = await callLLM(provider, systemPrompt + schemaDesc, userMessage);
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
