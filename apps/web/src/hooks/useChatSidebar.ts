import { useCallback, useRef, useState } from 'react';
import type { ChatStage } from '../store/useProjectStore';

const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 720;
const SIDEBAR_DEFAULT = 380;

function keys(stage: ChatStage): { hidden: string; width: string } {
  return {
    hidden: `wbs_chat_hidden_${stage}`,
    width: `wbs_chat_width_${stage}`,
  };
}

/**
 * Per-stage chat sidebar state — hidden flag + resizable width. Persists to
 * localStorage under stage-scoped keys so each pipeline page remembers its
 * own preference independently.
 */
export function useChatSidebar(stage: ChatStage) {
  const k = keys(stage);

  const [hidden, setHiddenState] = useState<boolean>(() => {
    try { return localStorage.getItem(k.hidden) === '1'; } catch { return false; }
  });
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(k.width);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT;
    } catch { return SIDEBAR_DEFAULT; }
  });
  const [isResizing, setIsResizing] = useState(false);

  const widthRef = useRef(width);
  widthRef.current = width;

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    try { localStorage.setItem(k.hidden, next ? '1' : '0'); } catch { /* ignore */ }
  }, [k.hidden]);

  const maxHeight = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.6) : SIDEBAR_MAX;
  const effectiveMax = Math.min(SIDEBAR_MAX, maxHeight);

  const onResizeStart = useCallback((startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    setIsResizing(true);
    const startX = startEvent.clientX;
    const startWidth = widthRef.current;

    function onMove(e: MouseEvent) {
      const delta = startX - e.clientX;
      const next = Math.min(effectiveMax, Math.max(SIDEBAR_MIN, startWidth + delta));
      setWidth(next);
    }
    function onUp() {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(k.width, String(Math.round(widthRef.current))); } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [effectiveMax, k.width]);

  return {
    hidden,
    width,
    isResizing,
    show: () => setHidden(false),
    hide: () => setHidden(true),
    onResizeStart,
  };
}
