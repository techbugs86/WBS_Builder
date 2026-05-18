import type { Epic } from '../data/mockData';

export interface EpicChange {
  /** Old title — used when the title itself changed. */
  oldTitle?: string;
  /** Current title. */
  title: string;
  /** Human-readable field-level changes ("Story points: 5 → 8"). */
  fieldChanges: string[];
}

export interface EpicDiff {
  added: string[];               // titles of new epics
  removed: string[];             // titles of epics that no longer exist
  modified: EpicChange[];        // epics whose content changed
}

function describeFieldChanges(before: Epic, after: Epic): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: "${before.title}" → "${after.title}"`);
  if (before.domain !== after.domain) out.push(`Domain: ${before.domain} → ${after.domain}`);
  if (before.storyPoints !== after.storyPoints) out.push(`Story points: ${before.storyPoints} → ${after.storyPoints}`);
  if (before.description !== after.description) {
    const beforeLen = (before.description ?? '').length;
    const afterLen = (after.description ?? '').length;
    out.push(`Description rewritten (${beforeLen} → ${afterLen} chars)`);
  }
  return out;
}

/**
 * Diff two epic arrays by id. Items present in `after` but missing from `before`
 * are added; items removed from `after` are removed; items in both with any
 * field difference are modified.
 */
export function diffEpics(before: Epic[], after: Epic[]): EpicDiff {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: EpicChange[] = [];

  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) {
      added.push(a.title);
      continue;
    }
    const fieldChanges = describeFieldChanges(b, a);
    if (fieldChanges.length > 0) {
      modified.push({
        title: a.title,
        oldTitle: b.title !== a.title ? b.title : undefined,
        fieldChanges,
      });
    }
  }

  for (const b of before) {
    if (!afterById.has(b.id)) removed.push(b.title);
  }

  return { added, removed, modified };
}

/** Pick one element from a list as a tiny dose of variety. */
function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

const OPENINGS_FULL_REGEN = [
  'Got it — I rebuilt your epic list from scratch. Here\'s what changed:',
  "Done. Below is the new lineup compared to what you had before:",
  "All set. Here's a side-by-side of the new epics vs. the previous ones:",
];

const OPENINGS_ADDITIVE = [
  "Got it. Here's what I added:",
  'Done — extended your epic list:',
  "Sure. I appended new epics on top of the existing ones:",
];

const OPENINGS_MODIFY = [
  "Got it — here's what I changed:",
  "Done. Summary of edits:",
  'Updated as requested:',
];

const CLOSERS = [
  'Let me know if anything looks off or you want me to adjust scope.',
  "Want me to tweak the priority, expand a scope, or add anything else?",
  'Happy to refine further — just tell me what to change.',
];

/** Build a numbered or bulleted vertical list. Indented for visual hierarchy. */
function renderList(items: string[], style: 'numbered' | 'bullet'): string {
  if (items.length === 0) return '';
  return items
    .map((t, i) => (style === 'numbered' ? `   ${String(i + 1).padStart(2, ' ')}. ${t}` : `    • ${t}`))
    .join('\n');
}

/** Section header with a divider underline so the eye can break the message into chunks. */
function sectionHeader(title: string, count: number): string {
  const labelLine = `${title} (${count})`;
  const underline = '─'.repeat(Math.max(8, labelLine.length));
  return `${labelLine}\n${underline}`;
}

/**
 * Render a diff as a friendly, GPT-style chat response. Uses clear vertical
 * sections (NEW LINEUP / RETIRED / MODIFIED) so the user can visually
 * differentiate added, removed, and changed epics at a glance.
 */
export function summarizeEpicDiff(diff: EpicDiff): string {
  const addedCount = diff.added.length;
  const removedCount = diff.removed.length;
  const modifiedCount = diff.modified.length;

  if (addedCount === 0 && removedCount === 0 && modifiedCount === 0) {
    return "The regenerated set came back identical to what you already had — nothing actually changed. Try a more specific instruction (e.g. 'split User Auth into separate login and password-reset epics') and I'll have another go.";
  }

  // Single-epic rewrite — keep this one compact since there's only one item.
  if (addedCount === 0 && removedCount === 0 && modifiedCount === 1) {
    const m = diff.modified[0]!;
    const parts: string[] = [];
    parts.push(`Updated "${m.title}" as requested.`);
    if (m.fieldChanges.length > 0) {
      parts.push('');
      parts.push('CHANGES');
      parts.push('───────');
      for (const c of m.fieldChanges) parts.push(`    → ${c}`);
    }
    parts.push('');
    parts.push(pickOne(CLOSERS));
    return parts.join('\n');
  }

  // Full replacement — most common case on plain Regenerate. Render as two
  // distinct labeled blocks so the user can compare new vs. retired side-by-side.
  const isFullReplacement = removedCount > 0 && addedCount > 0 && modifiedCount === 0;

  const blocks: string[] = [];

  if (isFullReplacement) {
    blocks.push(pickOne(OPENINGS_FULL_REGEN));
    blocks.push(`${sectionHeader('★ NEW LINEUP', addedCount)}\n${renderList(diff.added, 'numbered')}`);
    blocks.push(`${sectionHeader('× RETIRED', removedCount)}\n${renderList(diff.removed, 'bullet')}`);
  } else {
    blocks.push(pickOne(addedCount > 0 && modifiedCount === 0 && removedCount === 0 ? OPENINGS_ADDITIVE : OPENINGS_MODIFY));

    if (addedCount > 0) {
      blocks.push(`${sectionHeader('★ ADDED', addedCount)}\n${renderList(diff.added, 'numbered')}`);
    }

    if (modifiedCount > 0) {
      const lines: string[] = [sectionHeader('~ MODIFIED', modifiedCount)];
      for (const m of diff.modified) {
        lines.push(`    • "${m.title}"`);
        for (const f of m.fieldChanges) lines.push(`         → ${f}`);
      }
      blocks.push(lines.join('\n'));
    }

    if (removedCount > 0) {
      blocks.push(`${sectionHeader('× RETIRED', removedCount)}\n${renderList(diff.removed, 'bullet')}`);
    }
  }

  blocks.push(pickOne(CLOSERS));
  return blocks.join('\n\n');
}
