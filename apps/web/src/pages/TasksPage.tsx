import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  CheckCircle,
  CheckSquare,
  AlertTriangle,
  ArrowRight,
  Search,
  Edit2,
  Loader,
  Sparkles,
  Flag,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ChallengeBar } from '../components/ChallengeBar';
import { VersionDropdown } from '../components/VersionDropdown';
import { DetailPanel } from '../components/DetailPanel';
import { PromptEditor } from '../components/PromptEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MOCK_ASSIGNEES } from '../data/mockData';
import type { TaskWithHistory, TaskStatus, CriterionType, Domain } from '../data/mockData';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAIN_VARIANT_MAP: Record<Domain, 'domain-auth' | 'domain-billing' | 'domain-search' | 'domain-messaging' | 'domain-profile' | 'domain-admin' | 'domain-notifications'> = {
  auth: 'domain-auth',
  billing: 'domain-billing',
  search: 'domain-search',
  messaging: 'domain-messaging',
  profile: 'domain-profile',
  admin: 'domain-admin',
  notifications: 'domain-notifications',
};

const DOMAIN_ACCENT: Record<Domain, string> = {
  auth: 'var(--accent)',
  billing: 'var(--accent)',
  search: 'var(--accent)',
  messaging: 'var(--accent)',
  profile: 'var(--accent)',
  admin: 'var(--text-dim)',
  notifications: 'var(--accent)',
};

const CRITERION_TYPE_CONFIG: Record<CriterionType, { badge: string; color: string; bg: string; border: string }> = {
  functional: {
    badge: 'FR',
    color: 'var(--accent-text)',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.2)',
  },
  'non-functional': {
    badge: 'NFR',
    color: 'var(--warning-text)',
    bg: 'var(--warning-bg)',
    border: 'var(--warning-border)',
  },
  technical: {
    badge: 'TEC',
    color: 'var(--text-secondary)',
    bg: 'var(--bg-overlay-md)',
    border: 'var(--border)',
  },
};

type StatusFilter = 'all' | TaskStatus;

// ─── Sub-components ───────────────────────────────────────────────────────────

function AcBlock({
  type,
  given,
  when,
  then,
}: {
  type: CriterionType;
  given: string;
  when: string;
  then: string;
}) {
  const cfg = CRITERION_TYPE_CONFIG[type];
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${cfg.border}` }}>
      {/* Type badge header */}
      <div
        className="px-3 py-1.5 flex items-center gap-2"
        style={{ background: cfg.bg, borderBottom: `1px solid ${cfg.border}` }}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
        >
          {cfg.badge}
        </span>
        <span className="text-[10px] font-medium" style={{ color: cfg.color }}>
          {type === 'functional' ? 'Functional Requirement' : type === 'non-functional' ? 'Non-Functional Requirement' : 'Technical Constraint'}
        </span>
      </div>
      {/* GWT body */}
      <div className="px-3 py-2.5 space-y-1.5 font-mono text-xs" style={{ background: 'var(--bg-deep)' }}>
        <p>
          <span className="text-[var(--accent-text)] font-semibold">Given </span>
          <span style={{ color: 'var(--text-secondary)' }}>{given}</span>
        </p>
        <p>
          <span className="text-[var(--accent-text)] font-semibold">When </span>
          <span style={{ color: 'var(--text-secondary)' }}>{when}</span>
        </p>
        <p>
          <span className="text-[var(--success-text)] font-semibold">Then </span>
          <span style={{ color: 'var(--text-secondary)' }}>{then}</span>
        </p>
      </div>
    </div>
  );
}

function CriterionSummary({ taskWithHistory }: { taskWithHistory: TaskWithHistory }) {
  const ac = taskWithHistory.current.acceptanceCriteria;
  const counts = {
    functional: ac.filter((c) => c.type === 'functional').length,
    'non-functional': ac.filter((c) => c.type === 'non-functional').length,
    technical: ac.filter((c) => c.type === 'technical').length,
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(Object.entries(counts) as [CriterionType, number][])
        .filter(([, n]) => n > 0)
        .map(([type, n]) => {
          const cfg = CRITERION_TYPE_CONFIG[type];
          return (
            <span
              key={type}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
            >
              {n} {cfg.badge}
            </span>
          );
        })}
    </div>
  );
}

function TaskRow({
  taskWithHistory,
  index,
  isUpdated,
  onEdit,
  onDelete,
  canDelete,
}: {
  taskWithHistory: TaskWithHistory;
  index: number;
  isUpdated: boolean;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const setTaskStatus = useProjectStore((s) => s.setTaskStatus);
  const restoreTaskVersion = useProjectStore((s) => s.restoreTaskVersion);

  const task = taskWithHistory.current;
  const versions = taskWithHistory.versions;

  const isFlagged = task.status === 'flagged';
  const isEstimateFlagged = task.estimateHours < 4 || task.estimateHours > 16;

  return (
    <motion.div
      className="rounded-xl overflow-hidden relative"
      style={isFlagged ? {
        background: 'linear-gradient(135deg, #130a0a, #100808)',
        border: '1px solid var(--error-border)',
      } : {
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-alt) 100%)',
        border: '1px solid var(--border)',
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      whileHover={{ scale: 1.001 }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="w-0.5 h-8 rounded-full shrink-0"
          style={{ backgroundColor: DOMAIN_ACCENT[task.domain] }}
        />

        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 transition-colors hover:text-[var(--text-primary)]"
          style={{ color: 'var(--text-dim)' }}
          aria-label={expanded ? 'Collapse task' : 'Expand task'}
        >
          <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronRight size={14} />
          </motion.div>
        </button>

        <span className="text-xs font-mono font-bold text-[var(--accent-text)] shrink-0 w-16">{task.wbsId}</span>

        <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{task.title}</span>

        {/* AC type summary chips */}
        <div className="shrink-0 hidden sm:block">
          <CriterionSummary taskWithHistory={taskWithHistory} />
        </div>

        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0"
          style={isEstimateFlagged ? {
            background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)',
          } : {
            background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
          }}
        >
          {isEstimateFlagged && <AlertTriangle size={10} />}
          {task.estimateHours}h
        </span>

        <Badge variant={DOMAIN_VARIANT_MAP[task.domain]} className="shrink-0">{task.domain}</Badge>

        <Badge
          variant={task.status === 'approved' ? 'approved' : task.status === 'flagged' ? 'flagged' : 'pending'}
          className="shrink-0"
        >
          {task.status}
        </Badge>

        <VersionDropdown
          versions={versions}
          onRestore={(v) => restoreTaskVersion(task.id, v)}
          isUpdated={isUpdated}
        />

        <div className="flex items-center gap-1.5 shrink-0">
          {task.status === 'pending' && (
            <>
              <Button size="icon-sm" variant="success" onClick={() => setTaskStatus(task.id, 'approved')} title="Approve task">
                <CheckCircle size={12} />
              </Button>
              <Button size="icon-sm" variant="destructive" onClick={() => setTaskStatus(task.id, 'flagged')} title="Flag for review">
                <Flag size={12} />
              </Button>
            </>
          )}
          {task.status === 'flagged' && (
            <Button size="icon-sm" variant="ghost" onClick={() => setTaskStatus(task.id, 'pending')} title="Unflag (move back to pending)">
              <RotateCcw size={12} />
            </Button>
          )}
          {task.status === 'approved' && (
            <Button size="icon-sm" variant="ghost" onClick={() => setTaskStatus(task.id, 'pending')} title="Revoke approval">
              <RotateCcw size={12} />
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={onEdit} title="View & edit task">
            <Edit2 size={12} />
          </Button>
          {canDelete && (
            <Button
              size="icon-sm"
              variant="destructive"
              onClick={onDelete}
              title="Delete this task"
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>

      {/* Inline expand: AC summary only */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-overlay-md)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                Acceptance Criteria
              </p>
              {task.acceptanceCriteria.map((ac, i) => (
                <AcBlock key={i} type={ac.type} given={ac.given} when={ac.when} then={ac.then} />
              ))}
              {task.dependencies.length > 0 && (
                <div className="pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Dependencies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {task.dependencies.map((dep) => (
                      <span key={dep} className="text-xs font-mono bg-violet-900/30 text-[var(--accent-text)] border border-violet-800/30 px-2 py-0.5 rounded-full">
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-xs pt-2 transition-colors hover:text-[var(--accent-text)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <Edit2 size={11} />
                Open detail &amp; rewrite with AI
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TaskDetail({ taskWithHistory }: { taskWithHistory: TaskWithHistory }) {
  const setTaskStatus = useProjectStore((s) => s.setTaskStatus);
  const rewriteItem = useProjectStore((s) => s.rewriteItem);
  const task = taskWithHistory.current;
  const [rewriting, setRewriting] = useState(false);

  const frCount = task.acceptanceCriteria.filter((c) => c.type === 'functional').length;
  const nfrCount = task.acceptanceCriteria.filter((c) => c.type === 'non-functional').length;
  const tecCount = task.acceptanceCriteria.filter((c) => c.type === 'technical').length;

  async function handleRewrite(prompt: string) {
    setRewriting(true);
    try {
      await rewriteItem('task', task.id, prompt);
    } finally {
      setRewriting(false);
    }
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-bold text-[var(--accent-text)]">{task.wbsId}</span>
          <Badge variant={DOMAIN_VARIANT_MAP[task.domain]}>{task.domain}</Badge>
          <Badge variant={task.status === 'approved' ? 'approved' : task.status === 'flagged' ? 'flagged' : 'pending'}>
            {task.status}
          </Badge>
        </div>
        <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{task.title}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
            style={task.estimateHours < 4 || task.estimateHours > 16 ? {
              background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)',
            } : {
              background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
            }}
          >
            {(task.estimateHours < 4 || task.estimateHours > 16) && <AlertTriangle size={10} />}
            {task.estimateHours}h estimate
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Assignee: <span style={{ color: 'var(--text-secondary)' }}>{task.assignee}</span>
          </span>
        </div>
      </div>

      {/* AC composition summary */}
      <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
        <span className="text-[10px] uppercase tracking-wider font-semibold mr-1" style={{ color: 'var(--text-muted)' }}>AC</span>
        {frCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: CRITERION_TYPE_CONFIG.functional.bg, color: CRITERION_TYPE_CONFIG.functional.color, border: `1px solid ${CRITERION_TYPE_CONFIG.functional.border}` }}>
            {frCount} FR
          </span>
        )}
        {nfrCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: CRITERION_TYPE_CONFIG['non-functional'].bg, color: CRITERION_TYPE_CONFIG['non-functional'].color, border: `1px solid ${CRITERION_TYPE_CONFIG['non-functional'].border}` }}>
            {nfrCount} NFR
          </span>
        )}
        {tecCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: CRITERION_TYPE_CONFIG.technical.bg, color: CRITERION_TYPE_CONFIG.technical.color, border: `1px solid ${CRITERION_TYPE_CONFIG.technical.border}` }}>
            {tecCount} TEC
          </span>
        )}
        <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>{task.acceptanceCriteria.length} total criteria</span>
      </div>

      {/* Acceptance Criteria — typed */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
          Acceptance Criteria
        </p>
        <div className="space-y-2">
          {task.acceptanceCriteria.map((ac, i) => (
            <AcBlock key={i} type={ac.type} given={ac.given} when={ac.when} then={ac.then} />
          ))}
        </div>
      </div>

      {/* Dependencies */}
      {task.dependencies.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Dependencies</p>
          <div className="flex flex-wrap gap-1.5">
            {task.dependencies.map((dep) => (
              <span key={dep} className="text-xs font-mono bg-violet-900/30 text-[var(--accent-text)] border border-violet-800/30 px-2 py-0.5 rounded-full">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Rewrite */}
      <PromptEditor
        placeholder={`Tell the AI how to update this task…\ne.g. "Add NFR for 99.9% uptime SLA and a TEC constraint for using Postgres advisory locks"`}
        onSubmit={handleRewrite}
        isProcessing={rewriting}
      />

      {/* Approve / Flag / Revoke — covers all three statuses */}
      <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {task.status === 'approved' ? (
          // Approved → can revoke back to pending
          <Button variant="ghost" size="sm" className="w-full gap-1.5" onClick={() => setTaskStatus(task.id, 'pending')}>
            <RotateCcw size={12} />
            Revoke Approval
          </Button>
        ) : task.status === 'flagged' ? (
          // Flagged → can unflag (back to pending) or approve directly
          <>
            <Button variant="success" size="sm" className="w-full gap-1.5" onClick={() => setTaskStatus(task.id, 'approved')}>
              <CheckCircle size={12} />
              Approve Task
            </Button>
            <Button variant="ghost" size="sm" className="w-full gap-1.5" onClick={() => setTaskStatus(task.id, 'pending')}>
              <RotateCcw size={12} />
              Unflag (move to Pending)
            </Button>
          </>
        ) : (
          // Pending → can approve OR flag for review
          <>
            <Button variant="success" size="sm" className="w-full gap-1.5" onClick={() => setTaskStatus(task.id, 'approved')}>
              <CheckCircle size={12} />
              Approve Task
            </Button>
            <Button variant="destructive" size="sm" className="w-full gap-1.5" onClick={() => setTaskStatus(task.id, 'flagged')}>
              <Flag size={12} />
              Flag for Review
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Flagged', value: 'flagged' },
];

// Average tasks-per-journey across past LawnLink / FreshFork / MediTrack runs
// landed in the 4-6 range. Use 5 as the projected per-journey output to drive
// the progress bar's expected-total denominator.
const TASKS_PER_JOURNEY_ESTIMATE = 5;

export function TasksPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tasksWithHistory = useProjectStore((s) => s.tasks);
  const journeysWithHistory = useProjectStore((s) => s.journeys);
  const regenState = useProjectStore((s) => s.regenState);
  const generateTasks = useProjectStore((s) => s.generateTasks);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  const approveAllTasks = useProjectStore((s) => s.approveAllTasks);
  const deleteAllTasks = useProjectStore((s) => s.deleteAllTasks);
  const deleteTask = useProjectStore((s) => s.deleteTask);
  const setTaskStatus = useProjectStore((s) => s.setTaskStatus);
  const currentUser = useProjectStore((s) => s.currentUser);
  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [pendingTaskDelete, setPendingTaskDelete] = useState<{ id: string; title: string; wbsId: string } | null>(null);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.
  // Task generation is triggered manually via the "Generate Tasks" button —
  // we deliberately do NOT auto-generate on mount.

  const tasks = tasksWithHistory.map((t) => t.current);

  // Progress bar math during task generation. We don't know the exact final
  // task count up front (LLM output varies 3-7 per journey), so we estimate:
  //   expected = journeyCount * 5
  //   percent  = min(currentTaskCount / expected * 100, 95)  while generating
  //   percent  = 100                                         when generation completes
  // Floor at 5% during the warm-up window so the bar isn't visually empty.
  const isTaskGen = isGenerating === 'tasks';
  const estimatedTotal = Math.max(
    journeysWithHistory.length * TASKS_PER_JOURNEY_ESTIMATE,
    1,
  );
  const rawPercent = isTaskGen
    ? Math.min(95, Math.max(5, Math.round((tasksWithHistory.length / estimatedTotal) * 100)))
    : 100;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTaskWithHistory = tasksWithHistory.find((t) => t.current.id === selectedTaskId) ?? null;

  const filtered = tasksWithHistory.filter((tH) => {
    const t = tH.current;
    const statusMatch = statusFilter === 'all' || t.status === statusFilter;
    const assigneeMatch = assigneeFilter === 'All' || t.assignee === assigneeFilter;
    const searchMatch = !search || t.title.toLowerCase().includes(search.toLowerCase()) || t.wbsId.toLowerCase().includes(search.toLowerCase());
    return statusMatch && assigneeMatch && searchMatch;
  });

  const approvedCount = tasks.filter((t) => t.status === 'approved').length;
  const flaggedCount = tasks.filter((t) => t.status === 'flagged').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  // Approve-all toggle — when every non-flagged task is approved, the same
  // button reverts them all back to pending instead.
  const approvableCount = tasks.length - flaggedCount;
  const allApproved = tasks.length > 0 && approvableCount > 0 && approvedCount === approvableCount;

  async function handleApproveAllToggle() {
    if (allApproved) {
      // Revert all approved → pending. Flagged tasks are left alone.
      const approvedTasks = tasks.filter((t) => t.status === 'approved');
      await Promise.allSettled(approvedTasks.map((t) => setTaskStatus(t.id, 'pending')));
    } else {
      await approveAllTasks();
    }
  }

  // Aggregate AC type counts across all tasks
  const allAc = tasks.flatMap((t) => t.acceptanceCriteria);
  const frTotal = allAc.filter((c) => c.type === 'functional').length;
  const nfrTotal = allAc.filter((c) => c.type === 'non-functional').length;
  const tecTotal = allAc.filter((c) => c.type === 'technical').length;

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="py-8 px-8 w-full">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 text-[var(--accent-text)] mb-3">
                <CheckSquare size={14} />
                <span className="text-xs font-semibold uppercase tracking-widest">Step 5 — Tasks</span>
              </div>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Tasks</h1>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {approvedCount} of {tasks.length} approved
                    {flaggedCount > 0 && (
                      <span className="ml-2 text-[var(--error-text)]">· {flaggedCount} flagged</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Approve All / Revert All — toggle based on current state.
                      Flagged tasks are intentionally not bulk-approved (they need fixing first). */}
                  {tasks.length > 0 && (
                    <Button
                      variant={allApproved ? 'ghost' : 'success'}
                      size="sm"
                      onClick={() => void handleApproveAllToggle()}
                      className="gap-1.5"
                    >
                      {allApproved ? (
                        <>
                          <RotateCcw size={12} />
                          Revert All to Pending
                        </>
                      ) : (
                        <>
                          <CheckCircle size={12} />
                          Approve All ({pendingCount})
                          {flaggedCount > 0 && <span className="text-[10px] opacity-70">· skips {flaggedCount} flagged</span>}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => projectId && void generateTasks(projectId)}
                    disabled={isGenerating === 'tasks'}
                    className="gap-1.5"
                  >
                    {isGenerating === 'tasks' ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {tasks.length === 0 ? 'Generate Tasks' : 'Regenerate'}
                  </Button>
                  {canDelete && tasks.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteAll(true)}
                      className="gap-1.5"
                    >
                      <Trash2 size={12} />
                      Delete All
                    </Button>
                  )}
                </div>
              </div>

              {/* AC type summary cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { type: 'functional' as CriterionType, count: frTotal, label: 'Functional criteria' },
                  { type: 'non-functional' as CriterionType, count: nfrTotal, label: 'Non-functional criteria' },
                  { type: 'technical' as CriterionType, count: tecTotal, label: 'Technical constraints' },
                ].map(({ type, count, label }) => {
                  const cfg = CRITERION_TYPE_CONFIG[type];
                  return (
                    <div key={type} className="rounded-xl p-3 flex items-center gap-3" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                      <span className="text-xl font-bold" style={{ color: cfg.color }}>{count}</span>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>{cfg.badge}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer"
                    style={statusFilter === tab.value ? {
                      background: 'rgba(124,58,237,0.15)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.3)',
                    } : { color: 'var(--text-muted)', border: '1px solid transparent' }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <select
                className="px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                {MOCK_ASSIGNEES.map((a) => (
                  <option key={a} value={a} style={{ background: 'var(--bg-card)' }}>
                    {a === 'All' ? 'All Assignees' : a}
                  </option>
                ))}
              </select>

              <div className="relative flex-1 min-w-[160px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500"
                  style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>

              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{filtered.length} tasks</span>
            </div>

            {/* Task list */}
            <div className="space-y-2 mb-8">
              {/* Generation progress bar. Stays visible the entire time
                  isGenerating === 'tasks'. Combines:
                    - phase label (warming up / streaming / finalising)
                    - live task counter (current of estimated total)
                    - animated progress fill with percentage
                  Tasks stream into the list below in real time as each
                  journey's batch finishes on the backend (3s polling). */}
              {isTaskGen && (
                <div
                  className="rounded-xl p-4 mb-4 space-y-3"
                  style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.25)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Loader size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent-text)' }} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {tasksWithHistory.length === 0
                            ? 'Generating tasks…'
                            : rawPercent < 90
                            ? `Generating tasks (${tasksWithHistory.length} of ~${estimatedTotal})…`
                            : `Finalising tasks (${tasksWithHistory.length} so far)…`}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          The AI is decomposing every approved journey into atomic tasks. Tasks appear here as they're created.
                        </p>
                      </div>
                    </div>
                    <span
                      className="text-base font-mono font-bold shrink-0 tabular-nums"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      {rawPercent}%
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: 'rgba(124,58,237,0.15)' }}
                  >
                    <motion.div
                      className="h-full"
                      style={{ background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
                      initial={false}
                      animate={{ width: `${rawPercent}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}

              {filtered.length === 0 && isGenerating !== 'tasks' ? (
                <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {tasksWithHistory.length === 0 ? 'No tasks yet — click Generate Tasks above.' : 'No tasks match the current filters.'}
                </div>
              ) : (
                filtered.map((taskH, i) => (
                  <TaskRow
                    key={taskH.current.id}
                    taskWithHistory={taskH}
                    index={i}
                    isUpdated={regenState.affectedIds.includes(taskH.current.id)}
                    onEdit={() => setSelectedTaskId(taskH.current.id)}
                    onDelete={() => setPendingTaskDelete({
                      id: taskH.current.id,
                      title: taskH.current.title,
                      wbsId: taskH.current.wbsId,
                    })}
                    canDelete={canDelete}
                  />
                ))
              )}
            </div>

            {/* Next */}
            <div className="pt-6 flex items-center gap-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {(() => {
                const pendingTasks = tasksWithHistory.filter(
                  (t) => t.current.status === 'pending' || t.current.status === 'flagged',
                ).length;
                const isGenerating_ = isGenerating === 'tasks';
                // Block continuing while generation is in flight — even if all
                // currently-visible tasks are approved, more may stream in.
                const canContinue = !isGenerating_ && tasksWithHistory.length > 0 && pendingTasks === 0;
                return (
                  <>
                    <Button
                      onClick={() => navigate(`/projects/${projectId}/sync`)}
                      disabled={!canContinue}
                      className="gap-1.5"
                    >
                      Continue to Sync
                      <ArrowRight size={14} />
                    </Button>
                    {isGenerating_ && (
                      <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--accent-text)' }}>
                        <Loader size={11} className="animate-spin" />
                        Tasks are still being generated — wait for completion before continuing.
                      </span>
                    )}
                    {!isGenerating_ && !canContinue && tasksWithHistory.length > 0 && (
                      <span className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                        {pendingTasks} task{pendingTasks !== 1 ? 's' : ''} need approval before sync
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Task detail panel */}
        <DetailPanel
          open={!!selectedTaskWithHistory}
          onClose={() => setSelectedTaskId(null)}
          title="Task Detail"
        >
          {selectedTaskWithHistory && (
            <TaskDetail taskWithHistory={selectedTaskWithHistory} />
          )}
        </DetailPanel>
      </div>

      <div className="shrink-0">
        <ChallengeBar stage="tasks" />
      </div>

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete all tasks?"
        message={`This permanently removes all ${tasks.length} task(s) for this project plus their ClickUp mappings. Epics and journeys are kept. This cannot be undone — you would need to regenerate tasks again.`}
        detail={`${tasks.length} task(s) will be deleted`}
        matchText="DELETE ALL TASKS"
        confirmLabel="Delete all tasks"
        variant="destructive"
        onConfirm={async () => {
          await deleteAllTasks();
          setShowDeleteAll(false);
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={pendingTaskDelete !== null}
        title="Delete this task?"
        message={`${pendingTaskDelete?.wbsId ?? ''} — "${pendingTaskDelete?.title ?? ''}" will be permanently removed (including its ClickUp mapping if synced). Other tasks are unaffected. This cannot be undone.`}
        detail={`1 task will be deleted`}
        confirmLabel="Delete task"
        variant="destructive"
        onConfirm={async () => {
          if (pendingTaskDelete) {
            await deleteTask(pendingTaskDelete.id);
            setPendingTaskDelete(null);
          }
        }}
        onCancel={() => setPendingTaskDelete(null)}
      />
    </motion.div>
  );
}
