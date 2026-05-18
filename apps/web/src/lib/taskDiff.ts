import type { Task } from '../data/mockData';

export interface TaskChange {
  oldTitle?: string;
  title: string;
  fieldChanges: string[];
}

export interface TaskDiff {
  added: string[];
  removed: string[];
  modified: TaskChange[];
}

function describeFieldChanges(before: Task, after: Task): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: "${before.title}" → "${after.title}"`);
  if (before.estimateHours !== after.estimateHours) {
    out.push(`Estimate: ${before.estimateHours}h → ${after.estimateHours}h`);
  }
  const beforeAcLen = (before.acceptanceCriteria ?? []).length;
  const afterAcLen = (after.acceptanceCriteria ?? []).length;
  if (beforeAcLen !== afterAcLen) {
    out.push(`Acceptance criteria: ${beforeAcLen} → ${afterAcLen}`);
  } else if (JSON.stringify(before.acceptanceCriteria) !== JSON.stringify(after.acceptanceCriteria)) {
    out.push('Acceptance criteria rewritten');
  }
  return out;
}

export function diffTasks(before: Task[], after: Task[]): TaskDiff {
  const beforeById = new Map(before.map((t) => [t.id, t]));
  const afterById = new Map(after.map((t) => [t.id, t]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: TaskChange[] = [];

  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) { added.push(a.title); continue; }
    const fc = describeFieldChanges(b, a);
    if (fc.length > 0) {
      modified.push({ title: a.title, oldTitle: b.title !== a.title ? b.title : undefined, fieldChanges: fc });
    }
  }
  for (const b of before) if (!afterById.has(b.id)) removed.push(b.title);
  return { added, removed, modified };
}

function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

const OPENINGS_REGEN = [
  'Got it — I rebuilt your tasks.',
  "Done. Here's the new task lineup vs. what you had before:",
  "Tasks regenerated. Here's the diff:",
];

const OPENINGS_MODIFY = [
  "Got it — here's what I changed:",
  "Done. Summary of edits:",
  "Updated as requested:",
];

const CLOSERS = [
  'Let me know if you want to adjust estimates, AC, or scope on any task.',
  "Want me to refine acceptance criteria or split a task further?",
  'Happy to refine further — just tell me what to change.',
];

function renderList(items: string[], style: 'numbered' | 'bullet'): string {
  if (items.length === 0) return '';
  return items.map((t, i) => (style === 'numbered' ? `   ${String(i + 1).padStart(2, ' ')}. ${t}` : `    • ${t}`)).join('\n');
}

function sectionHeader(title: string, count: number): string {
  const line = `${title} (${count})`;
  return `${line}\n${'─'.repeat(Math.max(8, line.length))}`;
}

export function summarizeTaskDiff(diff: TaskDiff): string {
  const a = diff.added.length, r = diff.removed.length, m = diff.modified.length;
  if (a === 0 && r === 0 && m === 0) {
    return "The regenerated tasks came back identical to what you already had. Try a more specific instruction (e.g. 'split task WBS-001 into UI and API tasks') and I'll have another go.";
  }
  if (a === 0 && r === 0 && m === 1) {
    const mod = diff.modified[0]!;
    const parts = [`Updated "${mod.title}" as requested.`];
    if (mod.fieldChanges.length > 0) {
      parts.push('', 'CHANGES', '───────', ...mod.fieldChanges.map((c) => `    → ${c}`));
    }
    parts.push('', pickOne(CLOSERS));
    return parts.join('\n');
  }
  const isFullReplace = r > 0 && a > 0 && m === 0;
  const blocks: string[] = [];
  if (isFullReplace) {
    blocks.push(pickOne(OPENINGS_REGEN));
    blocks.push(`${sectionHeader('★ NEW TASKS', a)}\n${renderList(diff.added, 'numbered')}`);
    blocks.push(`${sectionHeader('× RETIRED', r)}\n${renderList(diff.removed, 'bullet')}`);
  } else {
    blocks.push(pickOne(OPENINGS_MODIFY));
    if (a > 0) blocks.push(`${sectionHeader('★ ADDED', a)}\n${renderList(diff.added, 'numbered')}`);
    if (m > 0) {
      const lines = [sectionHeader('~ MODIFIED', m)];
      for (const mod of diff.modified) {
        lines.push(`    • "${mod.title}"`);
        for (const f of mod.fieldChanges) lines.push(`         → ${f}`);
      }
      blocks.push(lines.join('\n'));
    }
    if (r > 0) blocks.push(`${sectionHeader('× RETIRED', r)}\n${renderList(diff.removed, 'bullet')}`);
  }
  blocks.push(pickOne(CLOSERS));
  return blocks.join('\n\n');
}
