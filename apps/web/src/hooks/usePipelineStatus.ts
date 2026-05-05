import { useProjectStore } from '../store/useProjectStore';
import {
  canAccessStage,
  computePipelineStatus,
  type PipelineSnapshot,
  type Stage,
} from '../lib/pipelineStatus';

export interface PipelineGate {
  snapshot: PipelineSnapshot;
  /** Returns whether `target` is reachable from the current pipeline state. */
  canAccess: (target: Stage) => { allowed: boolean; blockedBy: Stage | null; reason: string };
  /** Convenience: the first stage in pipeline order that is not yet approved. */
  firstBlockedStage: Stage | null;
}

/**
 * Subscribes to the project store and returns a reactive snapshot of
 * approval state for every pipeline stage plus an `canAccess(stage)` helper.
 *
 * If a stage is currently being generated (`isGenerating === '<stage>'`),
 * we override its computed status to "not approved, generation in progress".
 * This prevents the user from navigating PAST a generating stage and getting
 * bounced back when more items appear and need approval.
 */
export function usePipelineStatus(): PipelineGate {
  const brief = useProjectStore((s) => s.brief);
  const epics = useProjectStore((s) => s.epics);
  const journeys = useProjectStore((s) => s.journeys);
  const tasks = useProjectStore((s) => s.tasks);
  const isGenerating = useProjectStore((s) => s.isGenerating);

  const snapshot = computePipelineStatus({ brief, epics, journeys, tasks });

  // Override status of the currently-generating stage so it acts as "blocked"
  // until generation finishes. Without this, partial generation results would
  // leak through and let the user navigate forward prematurely.
  if (isGenerating === 'epics' || isGenerating === 'journeys' || isGenerating === 'tasks') {
    const stage = isGenerating as Stage;
    snapshot.byStage[stage] = {
      approved: false,
      empty: false,
      reason: `${stage.charAt(0).toUpperCase()}${stage.slice(1)} are still being generated. Please wait for the AI to finish before continuing.`,
    };
    if (snapshot.firstBlockedStage === null) {
      snapshot.firstBlockedStage = stage;
    }
  }

  return {
    snapshot,
    canAccess: (target) => canAccessStage(snapshot, target),
    firstBlockedStage: snapshot.firstBlockedStage,
  };
}
