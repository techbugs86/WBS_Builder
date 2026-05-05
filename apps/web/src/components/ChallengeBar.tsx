import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, Loader, CheckCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

interface ChallengeBarProps {
  stage: 'brief' | 'epics' | 'journeys' | 'tasks';
}

const STAGE_PLACEHOLDERS: Record<ChallengeBarProps['stage'], string> = {
  brief:    'e.g. "Focus on the mobile-first experience and remove desktop references"',
  epics:    'e.g. "Add a Payment epic covering refunds and chargebacks"',
  journeys: 'e.g. "All journeys should include an error/failure path"',
  tasks:    'e.g. "Every task should assume the team uses Next.js and Tailwind"',
};

const STAGE_LABELS: Record<ChallengeBarProps['stage'], string> = {
  brief:    'brief',
  epics:    'epics',
  journeys: 'journeys',
  tasks:    'tasks',
};

export function ChallengeBar({ stage }: ChallengeBarProps) {
  const [input, setInput] = useState('');
  const [lastInstruction, setLastInstruction] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const challengeAI = useProjectStore((s) => s.challengeAI);
  const clearRegenState = useProjectStore((s) => s.clearRegenState);
  const regenState = useProjectStore((s) => s.regenState);

  const isActiveStage = regenState.stage === stage;
  const isProcessing = isActiveStage && regenState.isProcessing;
  const isDone = isActiveStage && !regenState.isProcessing && regenState.progress === 100 && !!regenState.diffSummary;
  const errorMsg = isActiveStage && !regenState.isProcessing ? regenState.lastError : null;

  useEffect(() => {
    if (isDone) {
      const timer = setTimeout(() => {
        clearRegenState();
        setInput('');
        setLastInstruction('');
        if (textareaRef.current) textareaRef.current.style.height = '34px';
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isDone, clearRegenState]);

  async function handleSubmit() {
    if (!input.trim() || isProcessing) return;
    const text = input.trim();
    setLastInstruction(text);
    try {
      await challengeAI(stage, text);
      // Success — preserve `input` empty so the user can write a new one.
      setInput('');
    } catch {
      // Error already saved to regenState.lastError by the store.
      // Keep the input so the user can edit + retry.
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const phaseLabel =
    regenState.progress < 30 ? 'Reading instruction…'
    : regenState.progress < 70 ? `Regenerating ${STAGE_LABELS[stage]}…`
    : 'Finalising…';

  return (
    <div
      className="px-6 py-4 backdrop-blur-sm"
      style={{ borderTop: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}
    >
      <AnimatePresence mode="wait">

        {/* Processing */}
        {isProcessing ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <div className="flex items-start gap-2">
              <Loader size={13} className="animate-spin shrink-0 mt-0.5" style={{ color: 'var(--accent-text)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium" style={{ color: 'var(--accent-text)' }}>{phaseLabel}</p>
                {lastInstruction && (
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                    "{lastInstruction}"
                  </p>
                )}
              </div>
              <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                {regenState.progress}%
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'var(--accent)' }}
                initial={{ width: 0 }}
                animate={{ width: `${regenState.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>
        ) : isDone ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2"
          >
            <CheckCircle size={13} className="shrink-0" style={{ color: 'var(--success-text)' }} />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium" style={{ color: 'var(--success-text)' }}>
                {regenState.diffSummary}
              </span>
              {lastInstruction && (
                <span className="text-[11px] ml-2" style={{ color: 'var(--text-muted)' }}>
                  — "{lastInstruction}"
                </span>
              )}
            </div>
            <button
              onClick={() => { clearRegenState(); setInput(''); setLastInstruction(''); }}
              className="text-[10px] shrink-0 flex items-center gap-1 transition-colors"
              style={{ color: 'var(--text-dim)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              <RotateCcw size={10} />
              Dismiss
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {/* Error banner — sits above the input row when the last attempt failed.
                The user's prompt text is preserved so they can edit and retry. */}
            <AnimatePresence>
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden mb-2"
                >
                  <div
                    className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
                    style={{
                      background: 'var(--error-bg)',
                      border: '1px solid var(--error-border)',
                      color: 'var(--error-text)',
                    }}
                    role="alert"
                  >
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span className="flex-1 leading-snug">{errorMsg}</span>
                    <button
                      onClick={() => clearRegenState()}
                      className="shrink-0 text-[10px] underline opacity-80 hover:opacity-100"
                      aria-label="Dismiss error"
                    >
                      dismiss
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-start gap-3">
              <div className="flex items-center gap-1.5 mt-2 shrink-0">
                <Sparkles size={13} style={{ color: 'var(--accent-text)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Regenerate with instruction</span>
              </div>
              <div className="flex-1">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={STAGE_PLACEHOLDERS[stage]}
                  className="w-full resize-none px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 leading-relaxed overflow-hidden"
                  style={{
                    background: 'var(--bg-overlay-md)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    minHeight: '34px',
                  }}
                />
              </div>
              <button
                onClick={() => void handleSubmit()}
                disabled={!input.trim()}
                className="shrink-0 mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', color: '#fff' }}
                title="Submit (⌘↵)"
              >
                <ArrowRight size={14} />
              </button>
            </div>
            <p className="text-[10px] mt-1.5 ml-[156px]" style={{ color: 'var(--text-dim)' }}>
              AI will regenerate all {STAGE_LABELS[stage]} based on your instruction · <span className="font-mono">⌘↵</span> to submit
            </p>
          </motion.div>
        )}

      </AnimatePresence>

    </div>
  );
}
