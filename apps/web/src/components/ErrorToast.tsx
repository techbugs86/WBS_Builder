import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

/**
 * Displays a global error toast when any store action sets `appError`.
 * Auto-dismisses after 7 seconds. Stacks below FlashBanner so both can coexist.
 */
export function ErrorToast() {
  const appError = useProjectStore((s) => s.appError);
  const setAppError = useProjectStore((s) => s.setAppError);

  useEffect(() => {
    if (!appError) return;
    const timer = setTimeout(() => setAppError(null), 7000);
    return () => clearTimeout(timer);
  }, [appError, setAppError]);

  return (
    <AnimatePresence>
      {appError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="absolute top-4 right-4 z-50 flex items-start gap-2 px-4 py-3 rounded-xl shadow-lg max-w-md"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            color: 'var(--error-text)',
          }}
          role="alert"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed flex-1">{appError}</p>
          <button
            onClick={() => setAppError(null)}
            className="shrink-0 transition-opacity opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
