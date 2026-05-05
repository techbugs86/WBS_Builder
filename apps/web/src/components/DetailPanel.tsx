import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Standard right-side detail panel used across all pipeline pages.
 * Takes 48% of the available row width, slides in from the right.
 */
export function DetailPanel({ open, onClose, title, children, footer }: DetailPanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="shrink-0 flex flex-col h-full"
          style={{ width: '48%', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {title && (
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                {title}
              </span>
            )}
            <button
              onClick={onClose}
              className="ml-auto p-1 rounded transition-colors hover:text-violet-300"
              style={{ color: 'var(--text-dim)' }}
              aria-label="Close panel"
            >
              <X size={14} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>

          {/* Optional footer */}
          {footer && (
            <div className="shrink-0 px-5 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {footer}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
