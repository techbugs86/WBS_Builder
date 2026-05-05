import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, X } from 'lucide-react';

interface FlashState {
  flash?: string;
  attemptedStage?: string;
}

/**
 * Displays a short-lived banner when a navigation attempt was blocked by
 * StageGuard. Reads the flash text from react-router's `location.state` and
 * auto-dismisses after 6 seconds. Clears the state on dismiss so a refresh
 * does not re-show the message.
 */
export function FlashBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? null) as FlashState | null;
  const flash = state?.flash;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!flash) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      // Clear the flash state so subsequent navigation/refresh doesn't re-render it.
      navigate(location.pathname, { replace: true, state: null });
    }, 6000);
    return () => clearTimeout(timer);
  }, [flash, location.pathname, navigate]);

  function dismiss() {
    setVisible(false);
    navigate(location.pathname, { replace: true, state: null });
  }

  return (
    <AnimatePresence>
      {visible && flash && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2 px-4 py-3 rounded-xl shadow-lg max-w-xl"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning-border)',
            color: 'var(--warning-text)',
          }}
          role="alert"
        >
          <Lock size={14} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed flex-1">{flash}</p>
          <button
            onClick={dismiss}
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
