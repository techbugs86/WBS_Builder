import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';

interface PromptEditorProps {
  /** Placeholder text shown in the textarea */
  placeholder?: string;
  /**
   * Called with the prompt text when the user submits. May be sync or async.
   * If a Promise is returned, the editor manages its own processing/error state.
   * If `isProcessing` is also passed, it takes precedence.
   */
  onSubmit: (prompt: string) => void | Promise<void>;
  /** External processing flag — overrides internal state if provided. */
  isProcessing?: boolean;
}

/**
 * Conversational prompt area used for per-item rewrites.
 *
 * - Submits via Cmd/Ctrl+Enter or click
 * - Tracks its own processing state if onSubmit returns a Promise
 * - Shows error message inline if onSubmit throws
 * - Shows brief "Applied" success confirmation after success
 * - Preserves the prompt on failure so the user can retry
 * - Clears the prompt only after success
 */
export function PromptEditor({ placeholder, onSubmit, isProcessing }: PromptEditorProps) {
  const [prompt, setPrompt] = useState('');
  const [internalBusy, setInternalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const busy = isProcessing ?? internalBusy;

  async function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    setError(null);
    setShowSuccess(false);
    setInternalBusy(true);

    try {
      const result = onSubmit(trimmed);
      // If onSubmit returned a Promise, await it; otherwise it was sync (already done)
      if (result && typeof (result as Promise<void>).then === 'function') {
        await result;
      }
      // Success — clear the prompt and flash a confirmation
      setPrompt('');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
    } catch (err) {
      // Failure — keep the prompt text so user can retry
      const msg = err instanceof Error ? err.message : 'Rewrite failed. Please try again.';
      setError(msg);
    } finally {
      setInternalBusy(false);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-input)', border: `1px solid ${error ? 'var(--error-border)' : 'rgba(139,92,246,0.2)'}` }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${error ? 'var(--error-border)' : 'rgba(139,92,246,0.12)'}` }}
      >
        <Sparkles size={11} style={{ color: 'var(--accent-text)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-text)' }}>
          Ask AI to rewrite
        </span>

        {/* Inline status badges (right side of header) */}
        <AnimatePresence>
          {showSuccess && (
            <motion.span
              key="success"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.18 }}
              className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-border)' }}
            >
              <CheckCircle2 size={10} />
              Applied
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="p-3">
        <textarea
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
          placeholder={placeholder ?? 'Describe what you want changed…\ne.g. "Focus on mobile users and add error handling for network failures"'}
          rows={3}
          disabled={busy}
          className="w-full text-xs resize-none focus:outline-none placeholder-[var(--text-dim)] leading-relaxed disabled:opacity-50"
          style={{ background: 'transparent', color: 'var(--text-primary)' }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSubmit();
          }}
        />

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className="flex items-start gap-2 mt-2 px-2.5 py-1.5 rounded-md text-[11px]"
                style={{
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-border)',
                  color: 'var(--error-text)',
                }}
                role="alert"
              >
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span className="flex-1 leading-snug">{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
            {busy ? 'Sending to AI…' : '⌘↵ to send'}
          </span>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!prompt.trim() || busy}
            className="gap-1.5 text-xs h-7 px-3"
          >
            <AnimatePresence mode="wait" initial={false}>
              {busy ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <Loader2 size={11} className="animate-spin" />
                  Rewriting…
                </motion.span>
              ) : (
                <motion.span
                  key="send"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <Send size={11} />
                  Rewrite
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </div>
    </div>
  );
}
