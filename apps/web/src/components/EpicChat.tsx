import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Bot, User, Trash2, X, MessageSquare } from 'lucide-react';
import { useProjectStore, type EpicChatMessage, type ChatStage } from '../store/useProjectStore';
import { ConfirmDialog } from './ConfirmDialog';

interface EpicChatProps {
  projectId: string;
  /** Hide the entire sidebar — owned by the host page. */
  onHide?: () => void;
  /** Which pipeline stage this chat is scoped to. Defaults to 'epics' for backward compat. */
  stage?: ChatStage;
}

const EMPTY_MESSAGES: readonly EpicChatMessage[] = [];

// Unified header label across every stage — keeps the chat rail visually
// identical on Brief / Definition / Epics / Journeys / Tasks / Sync. The
// per-stage context still lives in the empty-state hint below.
const STAGE_LABEL: Record<ChatStage, string> = {
  epics: 'Conversation',
  journeys: 'Conversation',
  tasks: 'Conversation',
  brief: 'Conversation',
  definition: 'Conversation',
  sync: 'Conversation',
};

const STAGE_EMPTY_HINT: Record<ChatStage, string> = {
  epics: 'Ask questions, request changes, or say "regenerate" to rebuild the list.',
  journeys: 'Ask about personas, edge cases, or say "regenerate" to rebuild all journeys.',
  tasks: 'Ask about estimates, AC, or say "regenerate" to rebuild all tasks.',
  brief: 'Ask about the brief, or say "regenerate" to rewrite the entire brief.',
  definition: 'Ask for help filling the form, sanity-checking inputs, or refining the raw client input.',
  sync: 'Ask why a sync failed, what got pushed, or how to recover from an error.',
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

export function EpicChat({ projectId, onHide, stage = 'epics' }: EpicChatProps) {
  const messages = useProjectStore((s) => {
    const slice =
      stage === 'epics' ? s.epicChat
      : stage === 'journeys' ? s.journeyChat
      : stage === 'tasks' ? s.taskChat
      : stage === 'brief' ? s.briefChat
      : stage === 'definition' ? s.definitionChat
      : s.syncChat;
    return slice[projectId] ?? EMPTY_MESSAGES;
  });
  const clearStageChat = useProjectStore((s) => s.clearStageChat);
  const isPending = useProjectStore((s) =>
    stage === 'epics' ? s.isEpicChatPending
    : stage === 'journeys' ? s.isJourneyChatPending
    : stage === 'tasks' ? s.isTaskChatPending
    : stage === 'brief' ? s.isBriefChatPending
    : stage === 'definition' ? s.isDefinitionChatPending
    : s.isSyncChatPending,
  );
  const isRegenInFlight = useProjectStore((s) => s.regenState.stage === stage && s.regenState.isProcessing);
  const isThinking = isPending || isRegenInFlight;
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message whenever messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col relative w-full"
      style={{ background: 'var(--bg-card)' }}
    >
      {/* Header — clean section title bar, Linear/Slack style. */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 shrink-0"
        style={{
          background: 'var(--bg-overlay-md)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(124,58,237,0.15)',
            border: '1px solid rgba(124,58,237,0.3)',
          }}
        >
          <Sparkles size={12} style={{ color: 'var(--accent-text)' }} />
        </div>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {STAGE_LABEL[stage]}
        </span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{
            background: 'var(--bg-overlay)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          {messages.length}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setConfirmClear(true)}
          disabled={messages.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
            border: '1px solid #ef4444',
            color: '#fff',
            boxShadow: messages.length > 0
              ? '0 2px 8px -1px rgba(239,68,68,0.45), inset 0 1px 0 rgba(255,255,255,0.18)'
              : 'none',
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px -1px rgba(239,68,68,0.6), inset 0 1px 0 rgba(255,255,255,0.25)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = messages.length > 0
              ? '0 2px 8px -1px rgba(239,68,68,0.45), inset 0 1px 0 rgba(255,255,255,0.18)'
              : 'none';
          }}
          title={
            messages.length === 0
              ? 'No messages to clear yet'
              : `Clear all ${messages.length} message${messages.length !== 1 ? 's' : ''} from this conversation`
          }
        >
          <Trash2 size={12} />
          Clear chat
        </button>
        {onHide && (
          <button
            onClick={onHide}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150"
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-overlay)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
            title="Hide chat panel"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 pl-3 pr-2 py-3 space-y-3 overflow-y-auto min-h-0"
      >
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(124,58,237,0.1)',
                border: '1px solid rgba(124,58,237,0.2)',
              }}
            >
              <MessageSquare size={16} style={{ color: 'var(--accent-text)' }} />
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Chat about your {stage}
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {STAGE_EMPTY_HINT[stage]}
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'agent' && (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: 'rgba(124,58,237,0.18)',
                  border: '1px solid rgba(124,58,237,0.35)',
                }}
              >
                <Bot size={11} style={{ color: 'var(--accent-text)' }} />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                m.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'
              }`}
              style={
                m.role === 'user'
                  ? {
                      background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(124,58,237,0.08))',
                      border: '1px solid rgba(124,58,237,0.35)',
                      color: 'var(--text-primary)',
                    }
                  : {
                      background: 'var(--bg-deep)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }
              }
            >
              <p
                className={
                  m.role === 'agent'
                    ? 'text-[12px] leading-[1.6] font-mono'
                    : 'text-[12.5px] leading-relaxed'
                }
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {m.text}
              </p>
              <p className="text-[9px] mt-2 font-mono" style={{ color: 'var(--text-dim)' }}>
                {formatTimestamp(m.timestamp)}
              </p>
            </div>
            {m.role === 'user' && (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: 'var(--bg-overlay-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <User size={11} style={{ color: 'var(--text-secondary)' }} />
              </div>
            )}
          </div>
        ))}

        <AnimatePresence>
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex gap-2.5 justify-start"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: 'rgba(124,58,237,0.18)',
                  border: '1px solid rgba(124,58,237,0.35)',
                }}
              >
                <Bot size={11} style={{ color: 'var(--accent-text)' }} />
              </div>
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5"
                style={{
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border)',
                }}
              >
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--accent-text)' }}
                      animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </span>
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {isRegenInFlight ? 'Regenerating epics…' : 'Thinking…'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear conversation history?"
        message="All chat messages for this project's Epics page will be removed. This does not affect the epics themselves."
        confirmLabel="Clear history"
        cancelLabel="Keep"
        variant="destructive"
        onConfirm={() => {
          clearStageChat(stage, projectId);
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
