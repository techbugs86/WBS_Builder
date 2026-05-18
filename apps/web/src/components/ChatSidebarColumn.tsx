import { motion } from 'framer-motion';
import { MessageSquare } from 'lucide-react';
import { EpicChat } from './EpicChat';
import { EpicChatBar } from './EpicChatBar';
import type { ChatStage } from '../store/useProjectStore';

interface ChatSidebarColumnProps {
  projectId: string | undefined;
  stage: ChatStage;
  hidden: boolean;
  width: number;
  isResizing: boolean;
  onHide: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * Right-side chat rail — Chat panel above, ChatBar input below. The hidden /
 * resize state is owned by the host page via `useChatSidebar` so each page
 * can render a "Show chat" button in its own header when the rail is hidden.
 *
 * Returns null when hidden; the host page must render its own "Show chat"
 * button (see ShowChatButton) so the user can re-open the rail.
 */
export function ChatSidebarColumn({
  projectId,
  stage,
  hidden,
  width,
  isResizing,
  onHide,
  onResizeStart,
}: ChatSidebarColumnProps) {
  if (!projectId || hidden) return null;

  return (
    <div
      className="shrink-0 h-full flex flex-col relative"
      style={{
        width,
        borderLeft: '1px solid var(--border)',
        transition: isResizing ? 'none' : 'width 0.15s ease',
      }}
    >
      {/* Left-edge horizontal drag handle */}
      <div
        onMouseDown={onResizeStart}
        className="absolute top-0 bottom-0 -left-1 w-2 group"
        style={{
          cursor: 'ew-resize',
          zIndex: 5,
          background: isResizing ? 'rgba(124,58,237,0.18)' : 'transparent',
        }}
        title="Drag to resize the chat panel"
      >
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-12 rounded-full opacity-0 group-hover:opacity-60 transition-opacity"
          style={{ background: 'var(--accent-text)' }}
        />
      </div>

      <EpicChat projectId={projectId} stage={stage} onHide={onHide} />
      <EpicChatBar stage={stage} />
    </div>
  );
}

interface ShowChatButtonProps {
  hidden: boolean;
  onShow: () => void;
  /** Optional message-count hint to render in the badge. */
  count?: number;
}

/**
 * Header-bar button that appears only when the chat sidebar is hidden.
 * Violet gradient pill with animated wagging icon + pulsing notification dot.
 * Matches the Epics-page "Chat" button exactly.
 */
export function ShowChatButton({ hidden, onShow, count }: ShowChatButtonProps) {
  if (!hidden) return null;
  return (
    <button
      onClick={onShow}
      className="relative inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150"
      style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(124,58,237,0.08))',
        border: '1px solid rgba(124,58,237,0.5)',
        color: 'var(--text-primary)',
        boxShadow: '0 2px 8px -2px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(124,58,237,0.32), rgba(124,58,237,0.14))';
        e.currentTarget.style.borderColor = 'rgba(167,139,250,0.75)';
        e.currentTarget.style.boxShadow = '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(124,58,237,0.08))';
        e.currentTarget.style.borderColor = 'rgba(124,58,237,0.5)';
        e.currentTarget.style.boxShadow = '0 2px 8px -2px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.08)';
      }}
      title={
        typeof count === 'number' && count > 0
          ? `Open the AI conversation panel (${count} message${count !== 1 ? 's' : ''})`
          : 'Open the AI conversation panel'
      }
    >
      <motion.span
        animate={{ rotate: [0, -8, 8, -4, 4, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
        className="inline-flex"
      >
        <MessageSquare size={13} style={{ color: 'var(--accent-text)' }} />
      </motion.span>
      Chat
      {typeof count === 'number' && count > 0 && (
        <span
          className="ml-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
          style={{
            background: 'rgba(124,58,237,0.35)',
            border: '1px solid rgba(167,139,250,0.6)',
            color: '#fff',
          }}
        >
          {count}
        </span>
      )}
      {/* Pulsing notification dot — pulls the eye to the button */}
      <motion.span
        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
        style={{
          background: '#a78bfa',
          boxShadow: '0 0 0 2px var(--bg), 0 0 10px rgba(167,139,250,0.8)',
        }}
        animate={{ scale: [1, 1.35, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </button>
  );
}
