import type { Journey } from '../data/mockData';

export interface JourneyChange {
  oldTitle?: string;
  title: string;
  fieldChanges: string[];
}

export interface JourneyDiff {
  added: string[];
  removed: string[];
  modified: JourneyChange[];
}

function describeFieldChanges(before: Journey, after: Journey): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: "${before.title}" → "${after.title}"`);
  if (before.persona !== after.persona) out.push(`Persona: "${before.persona}" → "${after.persona}"`);
  if (before.happyPath !== after.happyPath) out.push('Happy path rewritten');
  const beforeStepsLen = (before.steps ?? []).length;
  const afterStepsLen = (after.steps ?? []).length;
  if (beforeStepsLen !== afterStepsLen) {
    out.push(`Steps: ${beforeStepsLen} → ${afterStepsLen}`);
  } else if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) {
    out.push('Steps rewritten');
  }
  if (before.edgeCasesCount !== after.edgeCasesCount) {
    out.push(`Edge cases: ${before.edgeCasesCount} → ${after.edgeCasesCount}`);
  }
  return out;
}

export function diffJourneys(before: Journey[], after: Journey[]): JourneyDiff {
  const beforeById = new Map(before.map((j) => [j.id, j]));
  const afterById = new Map(after.map((j) => [j.id, j]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: JourneyChange[] = [];

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
  'Got it — I rebuilt your journeys.',
  "Done. Below is the new journey lineup compared to what you had before:",
  "Journeys regenerated. Here's the diff:",
];

const OPENINGS_MODIFY = [
  "Got it — here's what I changed:",
  "Done. Summary of edits:",
  "Updated as requested:",
];

const CLOSERS = [
  'Let me know if you want to adjust persona, scope, or edge cases on any journey.',
  "Want me to expand failure modes or add additional personas?",
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

export function summarizeJourneyDiff(diff: JourneyDiff): string {
  const a = diff.added.length, r = diff.removed.length, m = diff.modified.length;
  if (a === 0 && r === 0 && m === 0) {
    return "The regenerated journeys came back identical to what you already had. Try a more specific instruction (e.g. 'add a failure path for the onboarding journey') and I'll have another go.";
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
    blocks.push(`${sectionHeader('★ NEW JOURNEYS', a)}\n${renderList(diff.added, 'numbered')}`);
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
