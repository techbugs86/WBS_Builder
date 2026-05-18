import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader, AlertTriangle } from 'lucide-react';
import { useProjectStore, type ChatStage } from '../store/useProjectStore';

interface EpicChatBarProps {
  stage?: ChatStage;
}

const STAGE_PLACEHOLDER: Record<ChatStage, string> = {
  epics: 'Chat with the epics… (asks, edits, add/remove)',
  journeys: 'Chat with the journeys… (asks, edits, add/remove)',
  tasks: 'Chat with the tasks… (asks, edits, add/remove)',
  brief: 'Chat with the brief… (ask or say "regenerate")',
  definition: 'Ask for help with the project setup form…',
  sync: 'Ask about the sync state or errors…',
};

/**
 * Chat-only input bar for the Epics page sidebar. Lives directly under the
 * conversation history. Routes everything through `chatAboutEpics()` — the
 * agentic store action handles surgical edits (addOne, removeOne, rewriteOne)
 * and full regens (regenerateAll) automatically based on user intent.
 *
 * For an explicit "rebuild everything with this instruction" action without
 * conversational dispatch, see the full-width ChallengeBar at the bottom of
 * the page.
 */
export function EpicChatBar({ stage = 'epics' }: EpicChatBarProps = {}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chatAction = useProjectStore((s) =>
    stage === 'epics' ? s.chatAboutEpics
    : stage === 'journeys' ? s.chatAboutJourneys
    : stage === 'tasks' ? s.chatAboutTasks
    : stage === 'brief' ? s.chatAboutBrief
    : stage === 'definition' ? s.chatAboutDefinition
    : s.chatAboutSync,
  );
  const isChatPending = useProjectStore((s) =>
    stage === 'epics' ? s.isEpicChatPending
    : stage === 'journeys' ? s.isJourneyChatPending
    : stage === 'tasks' ? s.isTaskChatPending
    : stage === 'brief' ? s.isBriefChatPending
    : stage === 'definition' ? s.isDefinitionChatPending
    : s.isSyncChatPending,
  );
  const isRegenInFlight = useProjectStore((s) => s.regenState.stage === stage && s.regenState.isProcessing);
  const isBusy = isChatPending || isRegenInFlight;
  const regenError = useProjectStore((s) => s.regenState.lastError);

  async function handleSubmit() {
    if (!input.trim() || isBusy) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '40px';
    await chatAction(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div
      className="shrink-0 px-3 py-3 relative"
      style={{
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <AnimatePresence>
        {regenError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden mb-2"
          >
            <div
              className="flex items-start gap-2 px-2.5 py-2 rounded-md text-[11px]"
              style={{
                background: 'var(--error-bg)',
                border: '1px solid var(--error-border)',
                color: 'var(--error-text)',
              }}
              role="alert"
            >
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-snug">{regenError}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="flex items-end gap-2 p-1.5 rounded-xl transition-all duration-150"
        style={{
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.55)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15)';
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={STAGE_PLACEHOLDER[stage]}
          disabled={isBusy}
          className="flex-1 resize-none px-2 py-2 text-xs focus:outline-none leading-relaxed overflow-y-auto disabled:opacity-60 placeholder-[var(--text-dim)]"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            minHeight: '40px',
            maxHeight: '160px',
          }}
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!input.trim() || isBusy}
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
            color: '#fff',
            boxShadow: input.trim() && !isBusy
              ? '0 3px 10px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)'
              : 'none',
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
          title="Send message (⌘↵)"
        >
          {isChatPending ? <Loader size={13} className="animate-spin" /> : <ArrowRight size={13} />}
        </button>
      </div>
      <p className="text-[10px] mt-1.5 px-1 flex items-center justify-between" style={{ color: 'var(--text-dim)' }}>
        <span>AI replies in chat — surgical edits stay scoped.</span>
        <kbd
          className="font-mono px-1 py-0.5 rounded text-[9px]"
          style={{
            background: 'var(--bg-overlay-md)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          ⌘↵
        </kbd>
      </p>
    </div>
  );
}
