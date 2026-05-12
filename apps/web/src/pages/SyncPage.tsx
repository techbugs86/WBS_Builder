import { useRef, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RefreshCw, CheckCircle, Info, Loader, AlertTriangle, RotateCcw } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { ScrollArea } from '../components/ui/scroll-area';
import { api } from '../lib/api';
import type { Domain } from '../data/mockData';
import type { SyncLogEntry } from '../store/useProjectStore';

interface SyncStatusResponse {
  syncedTaskKeys: Record<string, { clickupId: string; syncedAt: string }>;
  syncedTaskCount: number;
  lastSyncedAt: string | null;
  log: Array<{ timestamp: string; message: string; type: 'info' | 'success' | 'error' }>;
}

const DOMAIN_VARIANT_MAP: Record<Domain, 'domain-auth' | 'domain-billing' | 'domain-search' | 'domain-messaging' | 'domain-profile' | 'domain-admin' | 'domain-notifications'> = {
  auth: 'domain-auth',
  billing: 'domain-billing',
  search: 'domain-search',
  messaging: 'domain-messaging',
  profile: 'domain-profile',
  admin: 'domain-admin',
  notifications: 'domain-notifications',
};

// Real ClickUp sync status now comes from GET /projects/:id/sync/status,
// keyed by the task's stable task_key (== task.id). See useEffect below.

function SyncLogLine({ entry }: { entry: SyncLogEntry }) {
  const COLOR_MAP = {
    info: 'text-[var(--accent-text)]',
    success: 'text-[var(--success-text)]',
    error: 'text-[var(--error-text)]',
  };

  const ICON_MAP = {
    info: <Info size={11} className="text-[var(--accent-text)] shrink-0 mt-0.5" />,
    success: <CheckCircle size={11} className="text-[var(--success-text)] shrink-0 mt-0.5" />,
    error: <AlertTriangle size={11} className="text-[var(--error-text)] shrink-0 mt-0.5" />,
  };

  const timeStr = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <motion.div
      className="flex items-start gap-2 py-1.5"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
    >
      {ICON_MAP[entry.type]}
      <span className="font-mono text-[10px] shrink-0 mt-0.5" style={{ color: 'var(--text-dim)' }}>{timeStr}</span>
      <span className={`text-xs font-mono ${COLOR_MAP[entry.type]} leading-relaxed`}>{entry.message}</span>
    </motion.div>
  );
}

function ClickUpDot({ status }: { status: string }) {
  const color =
    status === 'synced' ? 'bg-[var(--success)]' :
    status === 'pending' ? 'bg-[var(--warning)]' :
    status === 'skipped' ? 'bg-[var(--text-dim)]' :
    'bg-[var(--border)]';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

export function SyncPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const tasksWithHistory = useProjectStore((s) => s.tasks);
  const definition = useProjectStore((s) => s.definition);
  const syncProgress = useProjectStore((s) => s.syncProgress);
  const syncLog = useProjectStore((s) => s.syncLog);
  const startSync = useProjectStore((s) => s.startSync);
  const resetSync = useProjectStore((s) => s.resetSync);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

  const tasks = tasksWithHistory.map((t) => t.current);
  const logEndRef = useRef<HTMLDivElement>(null);

  const approvedTasks = tasks.filter((t) => t.status === 'approved');
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const flaggedCount = tasks.filter((t) => t.status === 'flagged').length;

  const isSyncing = syncProgress > 0 && syncProgress < 100;
  const hasErrors = syncLog.some((entry) => entry.type === 'error');
  const isDone = syncProgress === 100 && !hasErrors;
  const isFailed = syncProgress === 100 && hasErrors;

  // Per-task sync state from the backend. Used for the task table's "synced"
  // indicators + the "Last synced at" timestamp. The log panel itself is
  // intentionally NOT persisted — it clears on every navigation to this page.
  const [syncedTaskKeys, setSyncedTaskKeys] = useState<Record<string, { clickupId: string; syncedAt: string }>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Loads ONLY the data needed to render the task table's "synced" indicators
  // and the "Last synced at" timestamp. Does NOT load the persisted log —
  // the log panel is intentionally empty when entering the page; users see
  // log content only when they actively run a sync from this session.
  async function loadSyncStatus() {
    if (!projectId) return;
    try {
      const res = await api.get<SyncStatusResponse>(`/projects/${projectId}/sync/status`);
      setSyncedTaskKeys(res.syncedTaskKeys);
      setLastSyncedAt(res.lastSyncedAt);
      // Persisted log intentionally NOT loaded — log starts empty on every visit.
    } catch (err) {
      console.error('[SyncPage] failed to load sync status:', err);
    }
  }

  // Clear any stale live log on every mount so navigating from Tasks → Sync
  // (or anywhere → Sync) always shows an empty log panel.
  useEffect(() => {
    resetSync();
    void loadSyncStatus();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a live sync run completes, refresh the per-task synced indicators
  // and the "Last synced at" timestamp from the DB.
  useEffect(() => {
    if (syncProgress === 100) void loadSyncStatus();
  }, [syncProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the live syncLog is shown — log panel is always empty until the
  // user clicks Sync from this page session.
  const displayedLog: SyncLogEntry[] = syncLog;

  // Real-time per-task sync indicator: parse "✓ Created [WBS-001] ..." or
  // "✓ Updated [WBS-001] ..." lines from the live log so each task row in the
  // table flips to "synced" the moment its log line streams in — instead of
  // waiting for the whole sync to finish + a separate API refresh.
  const liveSyncedWbsIds = useMemo(() => {
    const set = new Set<string>();
    for (const entry of syncLog) {
      if (entry.type !== 'success') continue;
      const m = entry.message.match(/\[(WBS-[A-Za-z0-9_-]+)\]/);
      if (m) set.add(m[1]!);
    }
    return set;
  }, [syncLog]);

  // Live counters derived from persisted mappings + streaming log.
  // Used for the hero stats AND the sync button label/disabled state.
  const syncedApprovedCount = approvedTasks.filter(
    (t) => Boolean(syncedTaskKeys[t.id]) || liveSyncedWbsIds.has(t.wbsId),
  ).length;
  const remainingToSync = Math.max(0, approvedTasks.length - syncedApprovedCount);
  const allDone = approvedTasks.length > 0 && remainingToSync === 0;

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayedLog]);

  function handleSync() {
    if (projectId) void startSync(projectId);
  }

  return (
    <motion.div
      className="py-8 px-8 w-full h-full overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[var(--accent-text)] mb-3">
          <RefreshCw size={14} />
          <span className="text-xs font-semibold uppercase tracking-widest">Step 6 — Sync</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sync to ClickUp</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Push approved tasks to ClickUp. Flagged tasks are skipped.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {definition.provider === 'anthropic' ? 'Claude Sonnet' : 'GPT-4o'}
            </span>
          </div>
        </div>
      </div>

      {/* Hero stats — values come from the component-scope counters above */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-emerald-900/30 bg-emerald-950/10 p-5 text-center">
          <p className="text-3xl font-bold text-[var(--success-text)]">{remainingToSync}</p>
          <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>Ready to sync</p>
        </div>
        <div
          className="rounded-xl p-5 text-center transition-all"
          style={{
            background: allDone ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.06)',
            border: `1px solid ${allDone ? 'rgba(16,185,129,0.55)' : 'rgba(16,185,129,0.25)'}`,
            boxShadow: allDone ? '0 0 24px rgba(16,185,129,0.18)' : 'none',
          }}
        >
          <div className="flex items-center justify-center gap-2">
            {allDone && <CheckCircle size={18} className="text-[var(--success-text)]" />}
            <p className="text-3xl font-bold text-[var(--success-text)]">{syncedApprovedCount}</p>
          </div>
          <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
            {allDone ? 'All synced ✨' : 'Synced'}
          </p>
        </div>
        <div className="rounded-xl border border-amber-900/30 bg-amber-950/10 p-5 text-center">
          <p className="text-3xl font-bold text-[var(--warning-text)]">{pendingCount}</p>
          <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>Pending approval</p>
        </div>
        <div className="rounded-xl border border-red-900/30 bg-red-950/10 p-5 text-center">
          <p className="text-3xl font-bold text-[var(--error-text)]">{flaggedCount}</p>
          <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>Flagged (skipped)</p>
        </div>
      </div>

      {/* Sync button + progress */}
      <div className="rounded-xl p-6 mb-6" style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-4">
          {isDone ? (
            <div className="flex items-center gap-2 px-5 py-2.5 bg-emerald-900/30 text-[var(--success-text)] border border-emerald-800/30 rounded-lg text-sm font-medium">
              <CheckCircle size={15} />
              Sync complete!
            </div>
          ) : isFailed ? (
            <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)' }}>
              <AlertTriangle size={15} />
              Sync failed — see log
            </div>
          ) : (
            <Button
              onClick={handleSync}
              // Disabled when nothing approved yet OR everything is already synced.
              disabled={isSyncing || approvedTasks.length === 0 || remainingToSync === 0}
              size="lg"
              className="gap-2 shrink-0"
            >
              {isSyncing ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  Syncing…
                </>
              ) : remainingToSync === 0 && approvedTasks.length > 0 ? (
                <>
                  <CheckCircle size={15} />
                  All synced
                </>
              ) : (
                <>
                  <RefreshCw size={15} />
                  Sync {remainingToSync} task{remainingToSync !== 1 ? 's' : ''} to ClickUp
                </>
              )}
            </Button>
          )}

          {(isDone || isFailed) && (
            <Button variant="ghost" size="sm" onClick={resetSync} className="gap-1.5">
              <RotateCcw size={13} />
              {isFailed ? 'Try again' : 'Reset'}
            </Button>
          )}

          {(isSyncing || isDone || isFailed) && (
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                <span>Sync progress</span>
                <span className="font-mono">{syncProgress}%</span>
              </div>
              <Progress value={syncProgress} />
            </div>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Task table */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            Task Status
            {tasks.length > 20 && (
              <span className="text-[10px] font-normal normal-case tracking-normal" style={{ color: 'var(--text-dim)' }}>
                ({tasks.length} tasks · scroll for more)
              </span>
            )}
          </h2>
          {/* Cap the visible body at ~20 rows. Header is sticky so it stays
              visible while the user scrolls through long task lists (LawnLink
              has 100+). Scrollbar appears only when content overflows. */}
          <div
            className="rounded-xl overflow-y-auto overflow-x-hidden"
            style={{
              border: '1px solid var(--border)',
              maxHeight: '720px',
            }}
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)', background: 'var(--bg-deep)' }}>WBS</th>
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)', background: 'var(--bg-deep)' }}>Title</th>
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)', background: 'var(--bg-deep)' }}>Domain</th>
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)', background: 'var(--bg-deep)' }}>ClickUp</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  // Real ClickUp sync status: a task is "synced" when there's
                  // a clickup_mappings row for it. Flagged tasks are "skipped"
                  // (sync intentionally excludes them). Otherwise "not synced".
                  // Persisted (from clickup_mappings) OR live (from streaming log) — either flips the row to "synced" immediately.
                  const isSynced = Boolean(syncedTaskKeys[task.id]) || liveSyncedWbsIds.has(task.wbsId);
                  const clickupStatus = isSynced
                    ? 'synced'
                    : task.status === 'flagged'
                    ? 'skipped'
                    : 'not synced';
                  return (
                    <tr
                      key={task.id}
                      className="transition-colors"
                      style={{
                        borderTop: '1px solid var(--border-subtle)',
                        background: task.status === 'flagged' ? 'var(--error-bg)' : 'var(--bg-card)',
                      }}
                    >
                      <td className="px-3 py-2.5 font-mono font-bold text-[var(--accent-text)]">{task.wbsId}</td>
                      <td className="px-3 py-2.5 max-w-[120px] truncate" style={{ color: 'var(--text-secondary)' }}>{task.title}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={DOMAIN_VARIANT_MAP[task.domain]} className="text-[9px] px-1.5 py-0">
                          {task.domain}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <ClickUpDot status={clickupStatus} />
                          <span style={{ color: 'var(--text-muted)' }}>{clickupStatus}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sync log */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Sync Log</h2>
            {lastSyncedAt && syncLog.length === 0 && (
              <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                Last synced {new Date(lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
            <ScrollArea className="h-64">
              <div className="px-4 py-3 space-y-0.5">
                {displayedLog.length === 0 ? (
                  <p className="text-xs py-4 text-center font-mono" style={{ color: 'var(--text-dim)' }}>No sync activity yet.</p>
                ) : (
                  displayedLog.map((entry) => (
                    <SyncLogLine key={entry.id} entry={entry} />
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
