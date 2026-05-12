import { motion, AnimatePresence } from 'framer-motion';
import { Loader, Sparkles, AlertTriangle } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from './ui/button';

/**
 * Modal that appears when the user regenerates the brief while downstream
 * stages (epics/journeys/tasks) already exist. Offers to re-run those stages
 * with the same challenge text so they stay aligned with the new brief.
 *
 * Driven entirely by `cascadePrompt` state in the store. Idle when not open.
 */
export function CascadeRegenDialog() {
  const cascadePrompt = useProjectStore((s) => s.cascadePrompt);
  const cascadeRegen = useProjectStore((s) => s.cascadeRegen);
  const dismissCascadePrompt = useProjectStore((s) => s.dismissCascadePrompt);

  const isRunning = cascadePrompt.runningStage !== null;
  const totalCount =
    cascadePrompt.counts.epics + cascadePrompt.counts.journeys + cascadePrompt.counts.tasks;

  return (
    <AnimatePresence>
      {cascadePrompt.open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRunning) dismissCascadePrompt();
          }}
        >
          <motion.div
            className="rounded-xl max-w-md w-full overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="p-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(124,58,237,0.12)' }}
                >
                  <Sparkles size={16} style={{ color: 'var(--accent-text)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Cascade brief changes?
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    The brief was regenerated with your instruction. Downstream stages still
                    reflect the previous brief and may now be out of date.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Will replace
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['epics', 'journeys', 'tasks'] as const).map((stage) => {
                  const count = cascadePrompt.counts[stage];
                  const isActive = cascadePrompt.runningStage === stage;
                  const isDone =
                    isRunning &&
                    cascadePrompt.runningStage !== stage &&
                    ['epics', 'journeys', 'tasks'].indexOf(cascadePrompt.runningStage ?? '') >
                      ['epics', 'journeys', 'tasks'].indexOf(stage);
                  return (
                    <div
                      key={stage}
                      className="rounded-lg px-3 py-2.5 text-center"
                      style={{
                        background: isActive
                          ? 'rgba(124,58,237,0.1)'
                          : isDone
                          ? 'rgba(34,197,94,0.08)'
                          : 'var(--bg-overlay)',
                        border: `1px solid ${
                          isActive
                            ? 'rgba(124,58,237,0.3)'
                            : isDone
                            ? 'rgba(34,197,94,0.25)'
                            : 'var(--border)'
                        }`,
                      }}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        {isActive && <Loader size={11} className="animate-spin" style={{ color: 'var(--accent-text)' }} />}
                        <span
                          className="text-base font-bold"
                          style={{
                            color: isActive
                              ? 'var(--accent-text)'
                              : isDone
                              ? 'var(--success-text)'
                              : 'var(--text-primary)',
                          }}
                        >
                          {count}
                        </span>
                      </div>
                      <p
                        className="text-[10px] uppercase tracking-wider mt-0.5"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {stage}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div
                className="flex items-start gap-2 px-3 py-2 rounded-md text-[11px]"
                style={{
                  background: 'var(--warning-bg)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning-text)',
                }}
              >
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span className="leading-relaxed">
                  All {totalCount} downstream items will be replaced. Existing approvals will reset
                  to pending. ClickUp-synced tasks remain in ClickUp but new mappings will be created.
                </span>
              </div>
            </div>

            <div
              className="px-5 py-4 flex items-center justify-end gap-2"
              style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-overlay)' }}
            >
              <Button variant="ghost" size="sm" onClick={dismissCascadePrompt} disabled={isRunning}>
                Skip
              </Button>
              <Button size="sm" onClick={() => void cascadeRegen()} disabled={isRunning} className="gap-1.5">
                {isRunning ? (
                  <>
                    <Loader size={12} className="animate-spin" />
                    Regenerating {cascadePrompt.runningStage}…
                  </>
                ) : (
                  <>
                    <Sparkles size={12} />
                    Cascade regenerate
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
