// Pure selectors that compute approval state per pipeline stage.
// Kept side-effect-free so they can be unit-tested and reused outside React.

import type {
  BriefWithHistory,
  EpicWithHistory,
  JourneyWithHistory,
  TaskWithHistory,
} from '../data/mockData';

export type Stage = 'definition' | 'brief' | 'epics' | 'journeys' | 'tasks' | 'sync';

export interface StageStatus {
  /** True when this stage is fully approved. */
  approved: boolean;
  /** True when there is no data yet for this stage (nothing has been generated). */
  empty: boolean;
  /** Human-readable message explaining what is needed. Empty when approved. */
  reason: string;
}

export const STAGE_ORDER: Stage[] = ['definition', 'brief', 'epics', 'journeys', 'tasks', 'sync'];

export const STAGE_LABELS: Record<Stage, string> = {
  definition: 'Definition',
  brief: 'Brief',
  epics: 'Epics',
  journeys: 'Journeys',
  tasks: 'Tasks',
  sync: 'Sync',
};

// ─── Per-stage rules ─────────────────────────────────────────────────────────

export function getBriefStatus(brief: BriefWithHistory): StageStatus {
  const hasContent = Boolean(brief.current.summary) || brief.versions.length > 0;
  if (!hasContent) {
    return { approved: false, empty: true, reason: 'Generate the brief first.' };
  }
  const open = brief.current.openQuestions.filter((q) => q.status === 'open').length;
  if (open > 0) {
    return {
      approved: false,
      empty: false,
      reason: `${open} open question${open !== 1 ? 's' : ''} remaining on the brief.`,
    };
  }
  return { approved: true, empty: false, reason: '' };
}

export function getEpicsStatus(epics: EpicWithHistory[]): StageStatus {
  if (epics.length === 0) {
    return { approved: false, empty: true, reason: 'Generate epics first.' };
  }
  const pending = epics.filter((e) => e.current.status !== 'approved').length;
  if (pending > 0) {
    return {
      approved: false,
      empty: false,
      reason: `${pending} epic${pending !== 1 ? 's' : ''} pending approval.`,
    };
  }
  return { approved: true, empty: false, reason: '' };
}

export function getJourneysStatus(journeys: JourneyWithHistory[]): StageStatus {
  if (journeys.length === 0) {
    return { approved: false, empty: true, reason: 'Generate journeys first.' };
  }
  const pending = journeys.filter((j) => j.current.status !== 'approved').length;
  if (pending > 0) {
    return {
      approved: false,
      empty: false,
      reason: `${pending} journey${pending !== 1 ? 's' : ''} pending approval.`,
    };
  }
  return { approved: true, empty: false, reason: '' };
}

export function getTasksStatus(tasks: TaskWithHistory[]): StageStatus {
  if (tasks.length === 0) {
    return { approved: false, empty: true, reason: 'Generate tasks first.' };
  }
  // 'flagged' tasks are explicitly not ready and block sync until resolved.
  const blocking = tasks.filter(
    (t) => t.current.status === 'pending' || t.current.status === 'flagged',
  ).length;
  if (blocking > 0) {
    return {
      approved: false,
      empty: false,
      reason: `${blocking} task${blocking !== 1 ? 's' : ''} need approval before sync.`,
    };
  }
  return { approved: true, empty: false, reason: '' };
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

export interface PipelineSnapshot {
  byStage: Record<Stage, StageStatus>;
  /** First stage in pipeline order that is not yet approved. null if everything is approved. */
  firstBlockedStage: Stage | null;
}

export function computePipelineStatus(input: {
  brief: BriefWithHistory;
  epics: EpicWithHistory[];
  journeys: JourneyWithHistory[];
  tasks: TaskWithHistory[];
}): PipelineSnapshot {
  // Definition and Brief are always reachable — there is nothing structural before
  // them to gate on. Sync is treated as a terminal action page, not a content stage.
  const byStage: Record<Stage, StageStatus> = {
    definition: { approved: true, empty: false, reason: '' },
    brief: getBriefStatus(input.brief),
    epics: getEpicsStatus(input.epics),
    journeys: getJourneysStatus(input.journeys),
    tasks: getTasksStatus(input.tasks),
    sync: { approved: true, empty: false, reason: '' },
  };

  const firstBlockedStage =
    (['brief', 'epics', 'journeys', 'tasks'] as Stage[]).find((s) => !byStage[s].approved) ?? null;

  return { byStage, firstBlockedStage };
}

/**
 * Decide whether a user is allowed to enter `target` based on the snapshot.
 * Definition and Brief are always allowed (no upstream stage to gate them).
 * Every other stage requires every preceding pipeline stage to be approved.
 */
export function canAccessStage(
  snapshot: PipelineSnapshot,
  target: Stage,
): { allowed: boolean; blockedBy: Stage | null; reason: string } {
  if (target === 'definition' || target === 'brief') {
    return { allowed: true, blockedBy: null, reason: '' };
  }
  const targetIdx = STAGE_ORDER.indexOf(target);
  for (let i = 0; i < targetIdx; i++) {
    const stage = STAGE_ORDER[i]!;
    if (stage === 'definition') continue; // never gates anything
    if (!snapshot.byStage[stage].approved) {
      return {
        allowed: false,
        blockedBy: stage,
        reason: snapshot.byStage[stage].reason,
      };
    }
  }
  return { allowed: true, blockedBy: null, reason: '' };
}
