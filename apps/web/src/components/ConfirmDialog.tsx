import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Loader } from 'lucide-react';
import { Button } from './ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional extra detail line (e.g. shows the item name being deleted). */
  detail?: string;
  /** Type the matchText to enable the confirm button. Useful for destructive irreversible ops. */
  matchText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual treatment — `destructive` paints the confirm button red. */
  variant?: 'destructive' | 'default';
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Modal confirmation dialog used for destructive actions (delete project, etc.).
 * Renders nothing when `open` is false. Caller controls open state.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  matchText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  const requiresMatch = Boolean(matchText);
  const matchOk = !requiresMatch || typed === matchText;
  const isDestructive = variant === 'destructive';

  async function handleConfirm() {
    if (!matchOk || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setTyped('');
    }
  }

  function handleCancel() {
    if (busy) return;
    setTyped('');
    onCancel();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={handleCancel}
          />

          {/* Card */}
          <motion.div
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative rounded-xl shadow-2xl max-w-md w-full mx-4"
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${isDestructive ? 'var(--error-border)' : 'var(--border)'}`,
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5">
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: isDestructive ? 'var(--error-bg)' : 'rgba(124,58,237,0.1)',
                    border: `1px solid ${isDestructive ? 'var(--error-border)' : 'rgba(124,58,237,0.2)'}`,
                  }}
                >
                  <AlertTriangle
                    size={16}
                    style={{ color: isDestructive ? 'var(--error-text)' : 'var(--accent-text)' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {title}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {message}
                  </p>
                  {detail && (
                    <p
                      className="text-xs mt-2 px-3 py-2 rounded-md font-mono break-words"
                      style={{
                        background: 'var(--bg-overlay-md)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {detail}
                    </p>
                  )}
                </div>
              </div>

              {requiresMatch && (
                <div className="mb-3">
                  <label
                    className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Type <span className="font-mono" style={{ color: 'var(--error-text)' }}>{matchText}</span> to confirm
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && matchOk) void handleConfirm();
                      if (e.key === 'Escape') handleCancel();
                    }}
                    className="w-full px-3 py-2 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <Button size="sm" variant="ghost" onClick={handleCancel} disabled={busy}>
                  {cancelLabel}
                </Button>
                <Button
                  size="sm"
                  variant={isDestructive ? 'destructive' : 'default'}
                  onClick={() => void handleConfirm()}
                  disabled={!matchOk || busy}
                  className="gap-1.5"
                >
                  {busy ? <Loader size={11} className="animate-spin" /> : null}
                  {confirmLabel}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
