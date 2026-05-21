import { v4 as uuid } from 'uuid';
import { execute, query } from '../db/index.js';

/**
 * One row per generate / regenerate call. The summary JSON stores a diff
 * so the chat module can answer "what changed?" without needing access
 * to the old database state.
 */
export type RegenStage = 'brief' | 'epics' | 'journeys' | 'tasks';

export interface RegenDiffSummary {
  added: string[];       // titles that appear in `after` but not `before`
  removed: string[];     // titles that appear in `before` but not `after`
  unchanged: string[];   // titles present in both (description / details may still differ)
  beforeCount: number;
  afterCount: number;
  isFirstGeneration: boolean;
}

export interface RegenEventRow {
  id: string;
  project_id: string;
  stage: RegenStage;
  summary: string;       // JSON-serialized RegenDiffSummary
  instruction: string | null;
  before_count: number;
  after_count: number;
  created_at: string;
}

/**
 * Compute a title-based diff between two snapshots. Title is used as the
 * stable key because regenerate wipes the old set and inserts new rows
 * with fresh epic/journey/task IDs — IDs no longer match across runs.
 *
 * Comparison is case-insensitive and whitespace-normalized so trivial
 * formatting changes don't show up as "removed + re-added".
 */
export function diffTitleSnapshots(before: Array<{ title?: string }>, after: Array<{ title?: string }>): RegenDiffSummary {
  const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const beforeMap = new Map<string, string>();
  for (const item of before) {
    const t = item.title ?? '';
    if (t) beforeMap.set(norm(t), t);
  }
  const afterMap = new Map<string, string>();
  for (const item of after) {
    const t = item.title ?? '';
    if (t) afterMap.set(norm(t), t);
  }
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const [key, original] of afterMap) {
    if (beforeMap.has(key)) unchanged.push(original);
    else added.push(original);
  }
  for (const [key, original] of beforeMap) {
    if (!afterMap.has(key)) removed.push(original);
  }
  return {
    added,
    removed,
    unchanged,
    beforeCount: before.length,
    afterCount: after.length,
    isFirstGeneration: before.length === 0,
  };
}

/**
 * Persist one regen event. Best-effort — generation already succeeded by
 * the time this is called, so a logging-table failure must not turn a
 * successful regen into a 500. Any error here is logged and swallowed.
 */
export async function recordRegenEvent(
  projectId: string,
  stage: RegenStage,
  before: Array<{ title?: string }>,
  after: Array<{ title?: string }>,
  instruction = '',
): Promise<void> {
  try {
    const summary = diffTitleSnapshots(before, after);
    await execute(
      'INSERT INTO regen_events (id, project_id, stage, summary, instruction, before_count, after_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        uuid(),
        projectId,
        stage,
        JSON.stringify(summary),
        instruction || null,
        summary.beforeCount,
        summary.afterCount,
      ],
    );
  } catch (err) {
    console.warn(`[recordRegenEvent] failed to log ${stage} regen for project ${projectId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Fetch the most recent regen event for a project + stage. Returns null
 * when no event exists. Used by chat handlers to inject "what changed
 * last time" context into the system prompt.
 *
 * Stale events (older than 24h) are excluded — at that point the user
 * has had time to settle on the new list and asking "what changed?"
 * almost certainly means a different conversation.
 */
export async function getMostRecentRegenEvent(
  projectId: string,
  stage: RegenStage,
): Promise<{ summary: RegenDiffSummary; instruction: string | null; createdAt: string } | null> {
  try {
    const rows = await query<RegenEventRow>(
      `SELECT * FROM regen_events
       WHERE project_id = ? AND stage = ?
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, stage],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) as RegenDiffSummary : row.summary as RegenDiffSummary;
    return {
      summary,
      instruction: row.instruction,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.warn('[getMostRecentRegenEvent] read failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Render the regen event into a compact text block for injection into a
 * chat system prompt. Skipped sections (empty arrays) are omitted to keep
 * the prompt tight. Returns an empty string when there's nothing to show.
 */
export function formatRegenContextForChat(event: { summary: RegenDiffSummary; instruction: string | null; createdAt: string } | null, stageNoun: string): string {
  if (!event) return '';
  const { summary, instruction, createdAt } = event;
  if (summary.isFirstGeneration) {
    return `RECENT ${stageNoun.toUpperCase()} GENERATION (${createdAt}):
This was the FIRST generation — there is no previous list to compare against.
${stageNoun}s now: ${summary.afterCount}.
${instruction ? `User's regeneration instruction: "${instruction.slice(0, 200)}"` : ''}
If the user asks "what changed?" reply that this is the first generation and there's nothing to compare yet.
`;
  }

  // Format the diff data EXACTLY as the chat reply should look. This way
  // when the user asks "what changed?" the LLM can copy the structure
  // directly without inventing descriptions or marketing fluff.
  const lines: string[] = [
    `RECENT ${stageNoun.toUpperCase()} REGENERATION (${createdAt}):`,
    `When the user asks about the change, reply USING THIS EXACT STRUCTURE — titles only, no per-item descriptions:`,
    ``,
    `${summary.beforeCount} ${stageNoun}s before → ${summary.afterCount} ${stageNoun}s now`,
    `${summary.added.length} added · ${summary.removed.length} removed · ${summary.unchanged.length} unchanged`,
    ``,
  ];
  if (summary.added.length > 0) {
    lines.push(`ADDED (${summary.added.length})`);
    summary.added.slice(0, 30).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }
  if (summary.removed.length > 0) {
    lines.push(`REMOVED (${summary.removed.length})`);
    summary.removed.slice(0, 30).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }
  if (summary.unchanged.length > 0) {
    lines.push(`UNCHANGED (${summary.unchanged.length})`);
    summary.unchanged.slice(0, 30).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }
  if (instruction) {
    lines.push(`(For context — user's regeneration instruction was: "${instruction.slice(0, 200)}". Do NOT include this in the reply unless asked.)`);
  }
  lines.push(`STRICT: when answering "what changed?", reproduce the structure above. Title-only lines. No descriptions. No "—" suffixes. No "consolidated into X" annotations.`);
  return lines.join('\n') + '\n';
}

// ─── Brief-specific diff ─────────────────────────────────────────────────────
// The Brief isn't a list — it's a structured object with multiple sections
// (summary text + inScope/outOfScope arrays + assumptions + open questions).
// We diff each section independently so the chat can say things like "the
// summary was rewritten, 2 assumptions added, 1 open question removed".

export interface BriefDiffSummary {
  summaryChanged: boolean;
  summaryBefore: string;
  summaryAfter: string;
  inScope: { added: string[]; removed: string[]; unchanged: string[] };
  outOfScope: { added: string[]; removed: string[]; unchanged: string[] };
  assumptions: { added: string[]; removed: string[]; unchanged: string[] };
  openQuestions: { added: string[]; removed: string[]; unchanged: string[] };
  isFirstGeneration: boolean;
}

interface BriefSnapshot {
  summary?: string;
  inScope?: string[];
  outOfScope?: string[];
  assumptions?: Array<{ text?: string }>;
  openQuestions?: Array<{ text?: string }>;
}

/** Title-based diff for one section of the brief. Returns three lists. */
function diffStringSection(before: string[], after: string[]): { added: string[]; removed: string[]; unchanged: string[] } {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const beforeMap = new Map<string, string>();
  for (const s of before) if (s) beforeMap.set(norm(s), s);
  const afterMap = new Map<string, string>();
  for (const s of after) if (s) afterMap.set(norm(s), s);
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const [k, v] of afterMap) {
    if (beforeMap.has(k)) unchanged.push(v);
    else added.push(v);
  }
  for (const [k, v] of beforeMap) {
    if (!afterMap.has(k)) removed.push(v);
  }
  return { added, removed, unchanged };
}

export function diffBriefSnapshots(before: BriefSnapshot | null, after: BriefSnapshot): BriefDiffSummary {
  const b = before ?? {};
  const beforeAssumpText = (b.assumptions ?? []).map((a) => a.text ?? '').filter(Boolean);
  const afterAssumpText = (after.assumptions ?? []).map((a) => a.text ?? '').filter(Boolean);
  const beforeQText = (b.openQuestions ?? []).map((q) => q.text ?? '').filter(Boolean);
  const afterQText = (after.openQuestions ?? []).map((q) => q.text ?? '').filter(Boolean);

  const summaryBefore = (b.summary ?? '').trim();
  const summaryAfter = (after.summary ?? '').trim();
  return {
    summaryChanged: summaryBefore !== summaryAfter,
    summaryBefore,
    summaryAfter,
    inScope: diffStringSection(b.inScope ?? [], after.inScope ?? []),
    outOfScope: diffStringSection(b.outOfScope ?? [], after.outOfScope ?? []),
    assumptions: diffStringSection(beforeAssumpText, afterAssumpText),
    openQuestions: diffStringSection(beforeQText, afterQText),
    isFirstGeneration: before == null || Object.keys(b).length === 0,
  };
}

export async function recordBriefRegenEvent(
  projectId: string,
  before: BriefSnapshot | null,
  after: BriefSnapshot,
  instruction = '',
): Promise<void> {
  try {
    const summary = diffBriefSnapshots(before, after);
    const beforeCount = (before?.inScope?.length ?? 0) + (before?.outOfScope?.length ?? 0)
      + (before?.assumptions?.length ?? 0) + (before?.openQuestions?.length ?? 0);
    const afterCount = (after.inScope?.length ?? 0) + (after.outOfScope?.length ?? 0)
      + (after.assumptions?.length ?? 0) + (after.openQuestions?.length ?? 0);
    await execute(
      'INSERT INTO regen_events (id, project_id, stage, summary, instruction, before_count, after_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid(), projectId, 'brief', JSON.stringify(summary), instruction || null, beforeCount, afterCount],
    );
  } catch (err) {
    console.warn(`[recordBriefRegenEvent] failed for project ${projectId}:`, err instanceof Error ? err.message : err);
  }
}

export async function getMostRecentBriefRegenEvent(projectId: string): Promise<{ summary: BriefDiffSummary; instruction: string | null; createdAt: string } | null> {
  try {
    const rows = await query<RegenEventRow>(
      `SELECT * FROM regen_events
       WHERE project_id = ? AND stage = 'brief'
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) as BriefDiffSummary : row.summary as unknown as BriefDiffSummary;
    return { summary, instruction: row.instruction, createdAt: row.created_at };
  } catch (err) {
    console.warn('[getMostRecentBriefRegenEvent] read failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Render the brief diff for chat injection. Compact, section-by-section,
 *  titles-only — same readability rules as the epic/journey/task diff. */
export function formatBriefRegenContextForChat(event: { summary: BriefDiffSummary; instruction: string | null; createdAt: string } | null): string {
  if (!event) return '';
  const { summary, instruction, createdAt } = event;

  if (summary.isFirstGeneration) {
    return `RECENT BRIEF GENERATION (${createdAt}):
This was the FIRST generation of the brief — there is no previous brief to compare against.
If the user asks "what changed?" reply that this is the first version and there's nothing to compare yet.
`;
  }

  const lines: string[] = [
    `BRIEF DIFF DATA (previous version → current, ${createdAt}):`,
    `This is reference data for answering "what changed?" / "what was the previous X?" questions. DO NOT dump the whole block in your reply — pick only what the user asked about.`,
    ``,
    `Counts: Summary ${summary.summaryChanged ? 'rewritten' : 'unchanged'} · in-scope +${summary.inScope.added.length} -${summary.inScope.removed.length} · out-of-scope +${summary.outOfScope.added.length} -${summary.outOfScope.removed.length} · assumptions +${summary.assumptions.added.length} -${summary.assumptions.removed.length} · open-questions +${summary.openQuestions.added.length} -${summary.openQuestions.removed.length}`,
    ``,
  ];

  // Full summary text is INCLUDED — needed for "what was the previous summary?" replies.
  if (summary.summaryBefore) {
    lines.push(`PREVIOUS SUMMARY (verbatim — quote the ENTIRE TEXT below when asked, no "...", no editorial):`);
    lines.push(`"${summary.summaryBefore}"`);
    lines.push('');
  }
  if (summary.summaryAfter && summary.summaryChanged) {
    lines.push(`CURRENT SUMMARY (verbatim — only quote this if the user asked to see current or compare):`);
    lines.push(`"${summary.summaryAfter}"`);
    lines.push('');
  }

  // Section deltas — capped at 5 each so a single section doesn't dominate
  // the prompt context. Indicate "+N more" so the LLM can offer to expand.
  const renderSection = (label: string, sec: { added: string[]; removed: string[] }) => {
    const hasAny = sec.added.length + sec.removed.length > 0;
    if (!hasAny) return;
    lines.push(`${label.toUpperCase()}:`);
    if (sec.added.length > 0) {
      sec.added.slice(0, 5).forEach((t, i) => lines.push(`  + ${i + 1}. ${t}`));
      if (sec.added.length > 5) lines.push(`  + ...${sec.added.length - 5} more added`);
    }
    if (sec.removed.length > 0) {
      sec.removed.slice(0, 5).forEach((t, i) => lines.push(`  - ${i + 1}. ${t}`));
      if (sec.removed.length > 5) lines.push(`  - ...${sec.removed.length - 5} more removed`);
    }
    lines.push('');
  };

  renderSection('In-scope', summary.inScope);
  renderSection('Out-of-scope', summary.outOfScope);
  renderSection('Assumptions', summary.assumptions);
  renderSection('Open questions', summary.openQuestions);

  if (instruction) {
    lines.push(`(Last regen instruction: "${instruction.slice(0, 200)}". Do NOT echo this unless asked.)`);
    lines.push('');
  }
  lines.push(`REMINDER: match reply length to question scope. "What was the previous summary?" → only quote PREVIOUS SUMMARY. "What changed?" → only the counter line. "What's new in scope?" → only the in-scope additions. Never dump the whole diff block by default.`);
  return lines.join('\n') + '\n';
}
