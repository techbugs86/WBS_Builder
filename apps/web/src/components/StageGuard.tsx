import { Navigate, useLocation, useParams } from 'react-router-dom';
import { usePipelineStatus } from '../hooks/usePipelineStatus';
import { useProjectStore } from '../store/useProjectStore';
import { STAGE_LABELS, type Stage } from '../lib/pipelineStatus';

interface StageGuardProps {
  stage: Stage;
  children: React.ReactNode;
}

/**
 * Route-level gate for pipeline pages.
 *
 * Renders `children` only when every preceding pipeline stage is approved.
 * If a preceding stage is not approved, redirects to that blocking stage and
 * passes a flash message via location state for FlashBanner to render.
 *
 * Definition and Brief are always allowed (nothing structural gates them).
 */
export function StageGuard({ stage, children }: StageGuardProps) {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const isLoadingProject = useProjectStore((s) => s.isLoadingProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const { canAccess } = usePipelineStatus();

  // While the workspace is still hydrating, do not redirect — the parent
  // ProjectWorkspace component renders a loader so children won't be evaluated
  // against stale data. This guard is the secondary safety net for direct URL
  // entry where data may be loading concurrently with the route render.
  if (isLoadingProject || activeProjectId !== projectId) {
    return <>{children}</>;
  }

  const result = canAccess(stage);
  if (result.allowed || !projectId) {
    return <>{children}</>;
  }

  const blockedBy = result.blockedBy ?? 'brief';
  const flash = `${STAGE_LABELS[stage]} is locked. ${result.reason} Approve ${STAGE_LABELS[blockedBy]} to continue.`;

  return (
    <Navigate
      to={`/projects/${projectId}/${blockedBy}`}
      replace
      state={{ flash, attemptedStage: stage, from: location.pathname }}
    />
  );
}
