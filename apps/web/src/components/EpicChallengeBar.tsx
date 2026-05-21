import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, Loader, CheckCircle, RotateCcw, AlertTriangle, MessageSquare, Wand2 } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

type Mode = 'chat' | 'regenerate';

const REGEN_KEYWORD_PATTERNS: RegExp[] = [
  /\bregenerate\b/i,
  /\bregen\b/i,
  /\bregen(erate)? (all|the) epics?\b/i,
  /\bgenerate (all |the )?(epics?|them)( again)?\b/i,
  /\b(create|build|make) (all |the )?(epics?|them)( again| from scratch)\b/i,
  /\bredo (the |all )?epics?\b/i,
  /\brebuild\b/i,
  /\bstart over\b/i,
  /\bfresh epics?\b/i,
  /\bnew epics? from scratch\b/i,
];

function detectMode(text: string): Mode {
  if (REGEN_KEYWORD_PATTERNS.some((re) => re.test(text))) return 'regenerate';
  return 'chat';
}

/**
 * Dual-mode bar for the Epics page.
 *
 * - **Chat mode** (default): user asks a question or discusses the epics;
 *   reply lands in the chat history but epics are not modified.
 * - **Regenerate mode**: triggered by keywords like "regenerate"/"rebuild";
 *   runs the existing challengeAI flow which calls the LLM, diffs, and
 *   replaces the epic list.
 *
 * The mode is auto-detected from what the user types and shown as a
 * clickable badge so they can override before submitting.
 */
export function EpicChallengeBar() {
  const [input, setInput] = useState('');
  const [lastInstruction, setLastInstruction] = useState('');
  const [manualMode, setManualMode] = useState<Mode | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const challengeAI = useProjectStore((s) => s.challengeAI);
  const chatAboutEpics = useProjectStore((s) => s.chatAboutEpics);
  const clearRegenState = useProjectStore((s) => s.clearRegenState);
  const regenState = useProjectStore((s) => s.regenState);
  const isChatPending = useProjectStore((s) => s.isEpicChatPending);

  const isActiveStage = regenState.stage === 'epics';
  const isRegenInFlight = isActiveStage && regenState.isProcessing;
  const isDone = isActiveStage && !regenState.isProcessing && regenState.progress === 100 && !!regenState.diffSummary;
  const errorMsg = isActiveStage && !regenState.isProcessing ? regenState.lastError : null;
  const isBusy = isRegenInFlight || isChatPending;

  const detectedMode = useMemo(() => detectMode(input), [input]);
  const mode: Mode = manualMode ?? detectedMode;

  useEffect(() => {
    if (isDone) {
      const timer = setTimeout(() => {
        clearRegenState();
        setInput('');
        setLastInstruction('');
        setManualMode(null);
        if (textareaRef.current) textareaRef.current.style.height = '34px';
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isDone, clearRegenState]);

  async function handleSubmit() {
    if (!input.trim() || isBusy) return;
    const text = input.trim();

    if (mode === 'regenerate') {
      setLastInstruction(text);
      try {
        await challengeAI('epics', text);
        setInput('');
        setManualMode(null);
      } catch {
        /* error already in regenState.lastError */
      }
    } else {
      setInput('');
      setManualMode(null);
      await chatAboutEpics(text);
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
    : regenState.progress < 70 ? 'Regenerating epics…'
    : 'Finalising…';

  return (
    <div
      className="px-4 py-3 backdrop-blur-sm relative shrink-0"
      style={{
        borderTop: '1px solid rgba(124,58,237,0.22)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg) 70%, transparent), color-mix(in srgb, var(--bg) 95%, transparent))',
        boxShadow: '0 -10px 30px -16px rgba(0,0,0,0.55), inset 0 1px 0 rgba(124,58,237,0.08)',
      }}
    >
      {/* Top accent strip mirroring the chat panel — reinforces the
          "this is the action surface" boundary. */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.5) 30%, rgba(124,58,237,0.5) 70%, transparent 100%)',
        }}
      />
      <AnimatePresence mode="wait">

        {isRegenInFlight ? (
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
              onClick={() => { clearRegenState(); setInput(''); setLastInstruction(''); setManualMode(null); }}
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
                    >
                      dismiss
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Row 1 — segmented mode toggle + contextual helper chip */}
            <div className="flex items-center gap-3 mb-2.5">
              <div
                className="inline-flex p-0.5 rounded-lg"
                style={{
                  background: 'var(--bg-overlay-md)',
                  border: '1px solid var(--border)',
                }}
                role="tablist"
                aria-label="Submit mode"
              >
                {(['chat', 'regenerate'] as Mode[]).map((m) => {
                  const active = mode === m;
                  const Icon = m === 'chat' ? MessageSquare : Wand2;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setManualMode(m)}
                      role="tab"
                      aria-selected={active}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-150"
                      style={
                        active
                          ? m === 'regenerate'
                            ? {
                                background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                                color: '#fff',
                                boxShadow: '0 1px 6px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                              }
                            : {
                                background: 'linear-gradient(135deg, rgba(124,58,237,0.22), rgba(124,58,237,0.12))',
                                color: 'var(--text-primary)',
                                boxShadow: 'inset 0 0 0 1px rgba(124,58,237,0.4)',
                              }
                          : { color: 'var(--text-muted)' }
                      }
                      title={
                        m === 'regenerate'
                          ? 'Submitting will REBUILD all epics from your instruction.'
                          : 'Submitting will reply in chat — epics stay unchanged.'
                      }
                    >
                      <Icon size={12} />
                      {m === 'chat' ? 'Chat' : 'Regenerate'}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1" />
              {detectedMode !== mode && (
                <button
                  onClick={() => setManualMode(null)}
                  className="text-[10px] flex items-center gap-1 transition-colors"
                  style={{ color: 'var(--text-dim)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-text)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
                  title="Stop overriding the auto-detected mode"
                >
                  <RotateCcw size={9} />
                  Auto-detect
                </button>
              )}
            </div>

            {/* Row 2 — input + send. The whole row is a single visual "input card" with
                a glowing focus state so the bar feels like the primary action surface. */}
            <div
              className="flex items-end gap-2 p-2 rounded-xl transition-all duration-150"
              style={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
              }}
              onFocusCapture={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.55)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15), inset 0 1px 0 rgba(255,255,255,0.02)';
              }}
              onBlurCapture={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
              }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === 'regenerate'
                    ? 'Tell the AI how to rebuild your epics — e.g. "Add a Payments epic for refunds and chargebacks"'
                    : 'Ask anything about the epics, or describe a change… (the bar will switch to Regenerate automatically)'
                }
                disabled={isBusy}
                className="flex-1 resize-none px-3 py-2.5 rounded-lg text-sm focus:outline-none leading-relaxed overflow-y-auto disabled:opacity-60 placeholder-[var(--text-dim)]"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  minHeight: '44px',
                  maxHeight: '200px',
                }}
              />
              <button
                onClick={() => void handleSubmit()}
                disabled={!input.trim() || isBusy}
                className="shrink-0 h-11 px-4 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                  color: '#fff',
                  boxShadow: input.trim() && !isBusy
                    ? '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)'
                    : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 18px -2px rgba(124,58,237,0.65), inset 0 1px 0 rgba(255,255,255,0.22)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = input.trim() && !isBusy
                    ? '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)'
                    : 'none';
                }}
                title={mode === 'regenerate' ? 'Regenerate (⌘↵)' : 'Send message (⌘↵)'}
              >
                {isChatPending ? (
                  <Loader size={14} className="animate-spin" />
                ) : mode === 'regenerate' ? (
                  <Wand2 size={14} />
                ) : (
                  <ArrowRight size={14} />
                )}
                {mode === 'regenerate' ? 'Regenerate' : 'Send'}
              </button>
            </div>

            {/* Row 3 — hint footer */}
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-[10px] flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
                <Sparkles size={9} style={{ color: 'var(--accent-text)' }} />
                {mode === 'regenerate'
                  ? 'AI rebuilds the entire epic list based on your instruction.'
                  : 'AI replies in chat. Surgical edits and "add/remove" requests stay scoped to one epic.'}
              </span>
              <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                <kbd
                  className="font-mono px-1.5 py-0.5 rounded text-[10px]"
                  style={{
                    background: 'var(--bg-overlay-md)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  ⌘↵
                </kbd>
                to submit
              </span>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
