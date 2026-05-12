import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, RotateCcw, Clock } from 'lucide-react';
import type { Version } from '../data/mockData';

interface VersionDropdownProps<T> {
  versions: Version<T>[];
  onRestore: (version: number) => void;
  /** Show a brief "Updated" pulse badge (e.g. after regeneration) */
  isUpdated?: boolean;
}

export function VersionDropdown<T>({ versions, onRestore, isUpdated = false }: VersionDropdownProps<T>) {
  const currentVersion = versions.length > 0 ? versions[versions.length - 1].version : 1;
  const [open, setOpen] = useState(false);
  const [showUpdated, setShowUpdated] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Show "Updated" pulse badge when isUpdated changes to true
  useEffect(() => {
    if (isUpdated) {
      setShowUpdated(true);
      const timer = setTimeout(() => setShowUpdated(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isUpdated]);

  // Close on outside click — covers both the trigger and the portaled menu
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Compute menu position relative to viewport when opening or on scroll/resize.
  // Using a portal escapes any overflow:hidden parent, so the menu can render
  // freely above / below the trigger without being clipped.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    function recalc() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = 320; // matches w-80
      const menuMaxHeight = 320;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // Prefer below; flip above if not enough room
      const spaceBelow = viewportHeight - rect.bottom;
      const placeAbove = spaceBelow < menuMaxHeight && rect.top > spaceBelow;
      const top = placeAbove ? rect.top - menuMaxHeight - 4 : rect.bottom + 4;

      // Right-align with the trigger; clamp to viewport
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      if (left + menuWidth > viewportWidth - 8) left = viewportWidth - menuWidth - 8;

      setMenuPos({ top, left });
    }

    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  }, [open]);

  if (versions.length <= 1) return null;

  function handleRestore(version: number) {
    onRestore(version);
    setOpen(false);
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors hover:bg-violet-950/20"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        <span className="font-mono font-bold text-violet-400">v{currentVersion}</span>
        <ChevronDown size={12} />
      </button>

      {/* "Updated" badge */}
      <AnimatePresence>
        {showUpdated && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="absolute -top-2 -right-2 px-2 py-0.5 bg-violet-600 text-white text-[10px] font-semibold rounded-full pointer-events-none shadow-md"
          >
            Updated
          </motion.span>
        )}
      </AnimatePresence>

      {/* Portal the menu out of the card so overflow:hidden parents don't clip it. */}
      {open && menuPos && createPortal(
        <AnimatePresence>
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="fixed w-80 rounded-xl shadow-2xl overflow-hidden"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 9999,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Version History</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {[...versions].reverse().map((v) => {
                const isCurrent = v.version === currentVersion;
                return (
                  <div
                    key={v.version}
                    className={`px-4 py-3 last:border-0 transition-colors ${isCurrent ? 'bg-violet-950/20' : ''}`}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-sm font-mono font-bold ${isCurrent ? 'text-violet-400' : ''}`}
                            style={!isCurrent ? { color: 'var(--text-primary)' } : {}}
                          >
                            v{v.version}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-semibold bg-violet-900/40 text-violet-300 border border-violet-800/40 rounded px-1.5 py-0.5 uppercase tracking-wider">
                              current
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>{v.label}</p>
                        {v.challengeText && (
                          <p className="text-[11px] mt-1 italic line-clamp-2" style={{ color: 'var(--text-muted)' }}>"{v.challengeText.slice(0, 80)}"</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock size={11} style={{ color: 'var(--text-dim)' }} />
                          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                            {new Date(v.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                      {!isCurrent && (
                        <button
                          onClick={() => handleRestore(v.version)}
                          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-violet-950/30 hover:border-violet-800/40 transition-colors mt-0.5"
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <RotateCcw size={11} />
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
