import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Layers, ArrowRight, Edit2, Sparkles, Loader, Trash2, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { ChallengeBar } from '../components/ChallengeBar';
import { EpicChat } from '../components/EpicChat';
import { EpicChatBar } from '../components/EpicChatBar';
import { VersionDropdown } from '../components/VersionDropdown';
import { DetailPanel } from '../components/DetailPanel';
import { PromptEditor } from '../components/PromptEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { EpicWithHistory, Domain } from '../data/mockData';

const DOMAIN_VARIANT_MAP: Record<Domain, 'domain-auth' | 'domain-billing' | 'domain-search' | 'domain-messaging' | 'domain-profile' | 'domain-admin' | 'domain-notifications'> = {
  auth: 'domain-auth',
  billing: 'domain-billing',
  search: 'domain-search',
  messaging: 'domain-messaging',
  profile: 'domain-profile',
  admin: 'domain-admin',
  notifications: 'domain-notifications',
};

// All domains share the primary accent — label text communicates the domain, not colour.
const DOMAIN_COLOR: Record<Domain, string> = {
  auth: 'var(--accent)',
  billing: 'var(--accent)',
  search: 'var(--accent)',
  messaging: 'var(--accent)',
  profile: 'var(--accent)',
  admin: 'var(--text-dim)',
  notifications: 'var(--accent)',
};

// ─── EpicRow ──────────────────────────────────────────────────────────────────

/**
 * Animated progress card shown during epic generation. Epic gen is a single
 * LLM call with no per-epic streaming on the backend, so we drive the bar
 * with a simulated 0% → 95% climb over ~22s and label phases for context.
 * If polling picks up partial inserts (the backend writes in a tight loop at
 * the end of the LLM call), the `count` prop updates and we surface it.
 */
function EpicGenerationProgress({ count }: { count: number }) {
  const [percent, setPercent] = useState(5);
  useEffect(() => {
    const tick = setInterval(() => {
      setPercent((p) => (p >= 95 ? 95 : p + Math.random() * 6));
    }, 800);
    return () => clearInterval(tick);
  }, []);
  const phase = percent < 30 ? 'Reading the brief' : percent < 70 ? 'Drafting epic candidates' : 'Finalising and ranking';
  return (
    <div
      className="rounded-xl p-4 mb-6 space-y-3"
      style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.25)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Loader size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent-text)' }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {count === 0 ? `${phase}…` : `Generating epics (${count} ready)…`}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              The AI is reading the brief and drafting a prioritised set of epics. New epics appear here when the batch is ready.
            </p>
          </div>
        </div>
        <span
          className="text-base font-mono font-bold shrink-0 tabular-nums"
          style={{ color: 'var(--accent-text)' }}
        >
          {Math.round(percent)}%
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
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/**
 * Split a description into paragraphs.
 *
 * Long descriptions from the AI use `\n\n` between sections (Overview,
 * Capabilities, Integrations, Edge Cases, Success Criteria, Out of Scope).
 * Short legacy descriptions are a single paragraph — handled identically.
 */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Heuristic: descriptions that are clearly the new long-form output get a
 * collapsible preview so the row stays scannable. Older 1-2 sentence
 * descriptions render fully expanded with no toggle (nothing to hide).
 */
const LONG_DESCRIPTION_CHARS = 320;

function EpicRow({
  epicWithHistory,
  index,
  isUpdated,
  onEdit,
  onDelete,
  canDelete,
}: {
  epicWithHistory: EpicWithHistory;
  index: number;
  isUpdated: boolean;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const setEpicStatus = useProjectStore((s) => s.setEpicStatus);
  const restoreEpicVersion = useProjectStore((s) => s.restoreEpicVersion);

  const epic = epicWithHistory.current;
  const versions = epicWithHistory.versions;
  const domainColor = DOMAIN_COLOR[epic.domain];

  const paragraphs = useMemo(() => paragraphsOf(epic.description ?? ''), [epic.description]);
  // "Show full brief" makes sense only when collapsing would actually hide
  // content — i.e. the description is long AND has 2+ paragraph sections.
  // A single long paragraph slices to itself, so the toggle would be a no-op.
  const isLong = (epic.description ?? '').length > LONG_DESCRIPTION_CHARS;
  const hasHiddenContent = isLong && paragraphs.length > 1;
  const [showAll, setShowAll] = useState(false);
  const visibleParagraphs = !hasHiddenContent || showAll ? paragraphs : paragraphs.slice(0, 1);

  return (
    <motion.div
      className="rounded-xl overflow-hidden relative"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-alt) 100%)',
        border: '1px solid var(--border)',
      }}
      whileHover={{ scale: 1.002 }}
    >
      {/* Left domain accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: `linear-gradient(180deg, ${domainColor}80, ${domainColor}20)` }}
      />

      {/* Top row: badges, title, meta, actions */}
      <div className="flex items-center gap-3 pl-5 pr-4 pt-3.5 pb-2">
        {/* Priority rank — the list is ordered by tier (foundation → growth);
            #1 is the highest-priority epic the team should build first. */}
        <div
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center font-mono text-xs font-bold"
          style={{
            background: index === 0
              ? 'linear-gradient(135deg, #7c3aed, #9333ea)'
              : index < 3
                ? 'rgba(124,58,237,0.18)'
                : 'var(--bg-overlay-md)',
            border: index === 0
              ? '1px solid rgba(167,139,250,0.7)'
              : index < 3
                ? '1px solid rgba(124,58,237,0.4)'
                : '1px solid var(--border)',
            color: index === 0
              ? '#fff'
              : index < 3
                ? 'var(--accent-text)'
                : 'var(--text-muted)',
            boxShadow: index === 0
              ? '0 2px 8px -2px rgba(124,58,237,0.55)'
              : 'none',
          }}
          title={`Priority #${index + 1}`}
        >
          {index + 1}
        </div>
        <Badge variant={DOMAIN_VARIANT_MAP[epic.domain]} className="shrink-0">
          {epic.domain}
        </Badge>

        <span
          className="flex-1 text-[15px] font-bold truncate tracking-tight"
          style={{
            backgroundImage: 'linear-gradient(92deg, #ffffff 0%, #e9defe 55%, #c4b5fd 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: '0 0 18px rgba(167,139,250,0.22)',
          }}
          title={epic.title}
        >
          {epic.title}
        </span>

        <div className="text-right shrink-0 mr-2">
          <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>story pts</p>
          <p
            className="text-sm font-bold"
            style={{ color: domainColor, textShadow: `0 0 8px ${domainColor}60` }}
          >
            {epic.storyPoints}
          </p>
        </div>

        <Badge variant={epic.status === 'approved' ? 'approved' : 'pending'} className="shrink-0">
          {epic.status}
        </Badge>

        <VersionDropdown
          versions={versions}
          onRestore={(v) => restoreEpicVersion(epic.id, v)}
          isUpdated={isUpdated}
        />

        {/* Edit icon: opens DetailPanel */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onEdit}
          title="View & edit epic"
          className="shrink-0"
        >
          <Edit2 size={12} />
        </Button>

        {epic.status !== 'approved' ? (
          <Button
            size="sm"
            variant="success"
            onClick={() => setEpicStatus(epic.id, 'approved')}
            className="shrink-0 gap-1"
          >
            <CheckCircle size={11} />
            Approve
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEpicStatus(epic.id, 'pending')}
            className="shrink-0 text-xs"
          >
            Revoke
          </Button>
        )}

        {canDelete && (
          <Button
            size="icon-sm"
            variant="destructive"
            onClick={onDelete}
            title="Delete this epic (also removes its journeys + tasks)"
            className="shrink-0"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>

      {/* Description — always visible. Long descriptions render paragraphs
          with a Show more toggle so the row stays scannable. */}
      {epic.description && (
        <div className="pl-5 pr-4 pb-4">
          <div
            className="rounded-lg px-4 py-3 relative"
            style={{
              background: 'var(--bg-overlay)',
              borderLeft: `2px solid ${domainColor}55`,
            }}
          >
            <AnimatePresence initial={false} mode="sync">
              <motion.div
                key={showAll ? 'expanded' : 'collapsed'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                {visibleParagraphs.map((para, i) => (
                  <p
                    key={i}
                    className="text-[13px] leading-7"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {para}
                  </p>
                ))}
              </motion.div>
            </AnimatePresence>

            {hasHiddenContent && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 flex items-center gap-1 text-[11px] font-medium transition-colors"
                style={{ color: 'var(--accent-text)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--accent-text)')}
              >
                {showAll ? (
                  <>
                    <ChevronUp size={12} />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    Show full brief ({paragraphs.length} section{paragraphs.length !== 1 ? 's' : ''})
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── EpicDetail (shown in DetailPanel) ────────────────────────────────────────

function EpicDetail({ epicWithHistory }: { epicWithHistory: EpicWithHistory }) {
  const setEpicStatus = useProjectStore((s) => s.setEpicStatus);
  const rewriteItem = useProjectStore((s) => s.rewriteItem);
  const epic = epicWithHistory.current;
  const [rewriting, setRewriting] = useState(false);
  const domainColor = DOMAIN_COLOR[epic.domain];

  async function handleRewrite(prompt: string) {
    setRewriting(true);
    try {
      await rewriteItem('epic', epic.id, prompt);
    } finally {
      setRewriting(false);
    }
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={DOMAIN_VARIANT_MAP[epic.domain]}>{epic.domain}</Badge>
          <Badge variant={epic.status === 'approved' ? 'approved' : 'pending'}>{epic.status}</Badge>
        </div>
        <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{epic.title}</h3>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ color: domainColor, background: `${domainColor}18`, border: `1px solid ${domainColor}40` }}
          >
            {epic.storyPoints} story pts
          </span>
        </div>
      </div>

      {/* Description */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Description</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{epic.description}</p>
      </div>

      {/* AI Rewrite */}
      <PromptEditor
        placeholder={`Tell the AI how to update this epic…\ne.g. "Expand scope to include GDPR compliance and data export"`}
        onSubmit={handleRewrite}
        isProcessing={rewriting}
      />

      {/* Approve / Revoke */}
      <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {epic.status !== 'approved' ? (
          <Button
            variant="success"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => setEpicStatus(epic.id, 'approved')}
          >
            <CheckCircle size={12} />
            Approve Epic
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setEpicStatus(epic.id, 'pending')}
          >
            Revoke Approval
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function EpicsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const epicsWithHistory = useProjectStore((s) => s.epics);
  const approveAllEpics = useProjectStore((s) => s.approveAllEpics);
  const deleteAllEpics = useProjectStore((s) => s.deleteAllEpics);
  const deleteEpic = useProjectStore((s) => s.deleteEpic);
  const regenState = useProjectStore((s) => s.regenState);
  const generateEpics = useProjectStore((s) => s.generateEpics);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  const currentUser = useProjectStore((s) => s.currentUser);
  // Used to show a "N messages" badge on the Chat button when the panel is hidden.
  const chatMessageCount = useProjectStore((s) => (projectId ? s.epicChat[projectId]?.length ?? 0 : 0));
  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  // Disables Regenerate / Delete while bulk Approve is in flight.
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  // Approval progress bar visibility — only shown after user clicks "Approve All",
  // and auto-hides 3s after the bar reaches 100% (every item approved).
  const [showApprovalProgress, setShowApprovalProgress] = useState(false);
  // AI-generated 3-4 sentence preview shown on the empty Epics page —
  // mirrors the Brief page rhythm.
  const [previewSummary, setPreviewSummary] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const isEmpty = epicsWithHistory.length === 0;
  useEffect(() => {
    if (!isEmpty || !projectId) return;
    let cancelled = false;
    setPreviewLoading(true);
    api
      .get<{ summary: string }>(`/projects/${projectId}/epics/preview`)
      .then((res) => { if (!cancelled) setPreviewSummary(res.summary); })
      .catch(() => { if (!cancelled) setPreviewSummary(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [isEmpty, projectId]);
  const projectName = useProjectStore((s) => s.definition.name);
  // Per-epic delete dialog. Stores the epic's data so the confirm dialog can
  // show its title + cascade-warning copy.
  const [pendingEpicDelete, setPendingEpicDelete] = useState<{ id: string; title: string } | null>(null);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const selectedEpicWithHistory = epicsWithHistory.find((e) => e.current.id === selectedEpicId) ?? null;

  // Chat sidebar visibility + width — owned by the page so the column
  // wrapper, header "Show chat" button, and resize handle all stay in sync.
  const SIDEBAR_MIN = 300;
  const SIDEBAR_MAX = 720;
  const SIDEBAR_DEFAULT = 380;
  const HIDDEN_KEY = 'wbs_epic_sidebar_hidden';
  const WIDTH_KEY = 'wbs_epic_sidebar_width';
  const [chatHidden, setChatHiddenState] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(WIDTH_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT;
    } catch { return SIDEBAR_DEFAULT; }
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  function setChatHidden(next: boolean) {
    setChatHiddenState(next);
    try { localStorage.setItem(HIDDEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  const onSidebarResizeStart = useCallback((startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    setIsResizingSidebar(true);
    const startX = startEvent.clientX;
    const startWidth = widthRef.current;

    function onMove(e: MouseEvent) {
      // Dragging LEFT widens the panel — subtract delta from startX.
      const delta = startX - e.clientX;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + delta));
      setSidebarWidth(next);
    }
    function onUp() {
      setIsResizingSidebar(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current))); } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const pendingEpicsCount = epicsWithHistory.filter((e) => e.current.status !== 'approved').length;
  const isGeneratingEpics = isGenerating === 'epics';
  const canContinue = !isGeneratingEpics && epicsWithHistory.length > 0 && pendingEpicsCount === 0;

  const epics = epicsWithHistory.map((e) => e.current);
  const approvedCount = epics.filter((e) => e.status === 'approved').length;
  const pendingCount = epics.filter((e) => e.status === 'pending').length;
  const progressPct = epics.length > 0 ? Math.round((approvedCount / epics.length) * 100) : 0;

  // Auto-hide the Approval progress bar 3s after it reaches 100%.
  useEffect(() => {
    if (!showApprovalProgress || progressPct < 100) return;
    const t = setTimeout(() => setShowApprovalProgress(false), 3000);
    return () => clearTimeout(t);
  }, [showApprovalProgress, progressPct]);

  const statCards = [
    { label: 'Total Epics', value: epics.length, color: 'var(--text-primary)', bg: 'var(--bg-overlay)', border: 'var(--border)' },
    { label: 'Approved', value: approvedCount, color: 'var(--success-text)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
    { label: 'Pending',  value: pendingCount,  color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  ];

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-1 min-h-0">
        {/* Main column — scrollable epic list + always-visible Continue footer */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="py-8 px-8 w-full">
            {/* Header */}
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={14} style={{ color: 'var(--accent-text)' }} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-text)' }}>Step 3 — Epics</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Epics</h1>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {approvedCount} of {epics.length} approved
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => projectId && void generateEpics(projectId)}
                    disabled={isGenerating === 'epics'}
                    className="relative inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed group overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)',
                      color: '#fff',
                      boxShadow: '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
                    }}
                    onMouseEnter={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 6px 20px -2px rgba(124,58,237,0.7), inset 0 1px 0 rgba(255,255,255,0.25)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)';
                    }}
                    title={
                      epicsWithHistory.length === 0
                        ? 'Generate epics from the approved brief'
                        : 'Replace ALL current epics with a freshly-generated set'
                    }
                  >
                    {/* Subtle moving shine on hover */}
                    <span
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                        transform: 'translateX(-100%)',
                        animation: isGenerating === 'epics' ? 'none' : undefined,
                      }}
                    />
                    {isGenerating === 'epics' ? (
                      <>
                        <Loader size={13} className="animate-spin relative z-10" />
                        <span className="relative z-10">Generating…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} className="relative z-10" />
                        <span className="relative z-10">
                          {epicsWithHistory.length === 0 ? 'Generate Epics' : 'Regenerate'}
                        </span>
                      </>
                    )}
                  </button>
                  {epicsWithHistory.length > 0 && (
                    <Button
                      variant="success"
                      onClick={async () => {
                        if (pendingEpicsCount === 0) return;
                        setShowApprovalProgress(true);
                        setIsApprovingAll(true);
                        try { await approveAllEpics(); } finally { setIsApprovingAll(false); }
                      }}
                      disabled={isApprovingAll || isGenerating === 'epics' || pendingEpicsCount === 0}
                      className="gap-1.5"
                      title={
                        pendingEpicsCount === 0
                          ? 'All epics are already approved'
                          : isApprovingAll ? 'Approving…' : `Approve all ${pendingEpicsCount} pending epic(s)`
                      }
                    >
                      {isApprovingAll
                        ? <><Loader size={12} className="animate-spin" />Approving…</>
                        : pendingEpicsCount === 0
                          ? <><CheckCircle size={13} />All approved</>
                          : <><CheckCircle size={13} />Approve All ({pendingEpicsCount})</>}
                    </Button>
                  )}
                  {canDelete && epicsWithHistory.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteAll(true)}
                      disabled={isApprovingAll || pendingEpicsCount === 0}
                      className="gap-1.5"
                      title={
                        pendingEpicsCount === 0
                          ? 'All epics are approved — delete is locked to protect your approved work'
                          : isApprovingAll ? 'Disabled while approving all epics' : 'Delete every epic on this project'
                      }
                    >
                      <Trash2 size={12} />
                      Delete All
                    </Button>
                  )}
                  {chatHidden && (
                    <button
                      onClick={() => setChatHidden(false)}
                      className="relative inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all duration-150"
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
                        chatMessageCount > 0
                          ? `Open the AI conversation panel (${chatMessageCount} message${chatMessageCount !== 1 ? 's' : ''})`
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
                      {chatMessageCount > 0 && (
                        <span
                          className="ml-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
                          style={{
                            background: 'rgba(124,58,237,0.35)',
                            border: '1px solid rgba(167,139,250,0.6)',
                            color: '#fff',
                          }}
                        >
                          {chatMessageCount}
                        </span>
                      )}
                      {/* Pulsing notification dot — pulls the eye to the button. */}
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
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {statCards.map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl p-4 text-center"
                  style={{ background: s.bg, border: `1px solid ${s.border}` }}
                >
                  <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Progress — only visible after user clicks "Approve All";
                auto-hides 3s after reaching 100%. */}
            {showApprovalProgress && (
              <div className="mb-7">
                <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>Approval progress</span>
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{progressPct}%</span>
                </div>
                <Progress value={progressPct} />
              </div>
            )}

            {/* Generation progress bar — visible while isGenerating === 'epics'.
                Epic gen is one LLM call (~10-25s) with no per-epic streaming
                on the backend, so the bar fakes phase progress. The count
                tick reflects the polling-based GET /epics fetched every 2s. */}
            {isGenerating === 'epics' && (
              <EpicGenerationProgress count={epicsWithHistory.length} />
            )}

            {/* Epic list */}
            {epicsWithHistory.length === 0 && isGenerating !== 'epics' ? (
              <div className="max-w-2xl mx-auto py-20 text-center">
                <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                  {projectName ? `${projectName} — Epics` : 'Epics'}
                </h2>
                {previewLoading ? (
                  <div className="flex items-center justify-center gap-2 mb-7" style={{ color: 'var(--text-dim)' }}>
                    <Loader size={14} className="animate-spin" />
                    <span className="text-sm">Previewing what the epics will look like…</span>
                  </div>
                ) : (
                  <p
                    className="text-[15px] leading-7 mb-7 text-left"
                    style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}
                  >
                    {previewSummary ?? 'Epics will be generated from the approved brief. Each epic captures a high-level scope unit such as authentication, core features, or admin tooling.'}
                  </p>
                )}
                <p className="text-xs mb-4" style={{ color: 'var(--text-dim)' }}>
                  When you're ready, click below to generate the epics.
                </p>
                <button
                  onClick={() => projectId && void generateEpics(projectId)}
                  disabled={isGenerating === 'epics'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)',
                    color: '#fff',
                    boxShadow: '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
                  }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px -2px rgba(124,58,237,0.7), inset 0 1px 0 rgba(255,255,255,0.25)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)';
                  }}
                >
                  {isGenerating === 'epics' ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {isGenerating === 'epics' ? 'Generating…' : 'Generate Epics'}
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-8">
                {epicsWithHistory.map((epicH, i) => (
                  <EpicRow
                    key={epicH.current.id}
                    epicWithHistory={epicH}
                    index={i}
                    isUpdated={regenState.affectedIds.includes(epicH.current.id)}
                    onEdit={() => setSelectedEpicId(epicH.current.id)}
                    onDelete={() => setPendingEpicDelete({ id: epicH.current.id, title: epicH.current.title })}
                    canDelete={canDelete}
                  />
                ))}
              </div>
            )}

          </div>
          </div>

          {/* Sticky footer — always visible, no need to scroll to reach Continue */}
          <div
            className="shrink-0 px-8 py-4 flex items-center gap-3 backdrop-blur-sm"
            style={{
              borderTop: '1px solid var(--border-subtle)',
              background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
              boxShadow: '0 -6px 16px -10px rgba(0,0,0,0.6)',
            }}
          >
            <div className="flex-1" />
            {isGeneratingEpics && (
              <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--accent-text)' }}>
                <Loader size={11} className="animate-spin" />
                Epics are still being generated — wait for completion.
              </span>
            )}
            {!isGeneratingEpics && !canContinue && epicsWithHistory.length > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                {pendingEpicsCount} epic{pendingEpicsCount !== 1 ? 's' : ''} pending approval
              </span>
            )}
            <Button
              onClick={() => navigate(`/projects/${projectId}/journeys`)}
              disabled={!canContinue}
              className="gap-1.5"
            >
              Continue to Journeys
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>

        {/* Right-side column: conversation history + chat-only input bar.
            Width is user-resizable via the left-edge drag handle, and the
            whole column can be hidden via EpicChat's close button. */}
        {projectId && !chatHidden && (
          <div
            className="shrink-0 h-full flex flex-col relative"
            style={{
              width: sidebarWidth,
              borderLeft: '1px solid var(--border)',
              transition: isResizingSidebar ? 'none' : 'width 0.15s ease',
            }}
          >
            {/* Vertical resize handle on the LEFT edge — drag to grow/shrink the sidebar. */}
            <div
              onMouseDown={onSidebarResizeStart}
              className="absolute top-0 bottom-0 -left-1 w-2 group"
              style={{
                cursor: 'ew-resize',
                zIndex: 5,
                background: isResizingSidebar ? 'rgba(124,58,237,0.18)' : 'transparent',
              }}
              title="Drag to resize the chat panel"
            >
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-12 rounded-full opacity-0 group-hover:opacity-60 transition-opacity"
                style={{ background: 'var(--accent-text)' }}
              />
            </div>

            <EpicChat projectId={projectId} onHide={() => setChatHidden(true)} />
            <EpicChatBar />
          </div>
        )}

        {/* Epic detail panel — overlays the chat when opened */}
        <DetailPanel
          open={!!selectedEpicWithHistory}
          onClose={() => setSelectedEpicId(null)}
          title="Epic Detail"
        >
          {selectedEpicWithHistory && (
            <EpicDetail epicWithHistory={selectedEpicWithHistory} />
          )}
        </DetailPanel>
      </div>

      {/* Full-width regenerate challenge bar at the bottom of the page */}
      <div className="shrink-0">
        <ChallengeBar stage="epics" />
      </div>

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete all epics?"
        message={`This permanently removes all ${epicsWithHistory.length} epic(s) AND any journeys and tasks generated from them (they reference epics, so they would be orphaned). This cannot be undone — you would need to regenerate from the brief.`}
        detail={`${epicsWithHistory.length} epic(s) + all downstream journeys & tasks will be deleted`}
        matchText="DELETE ALL EPICS"
        confirmLabel="Delete all epics"
        variant="destructive"
        onConfirm={async () => {
          await deleteAllEpics();
          setShowDeleteAll(false);
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={pendingEpicDelete !== null}
        title="Delete this epic?"
        message={`"${pendingEpicDelete?.title ?? ''}" and any journeys + tasks under it will be permanently removed. Other epics are unaffected. This cannot be undone.`}
        detail={`Cascading delete: 1 epic + its journeys + its tasks`}
        confirmLabel="Delete epic"
        variant="destructive"
        onConfirm={async () => {
          if (pendingEpicDelete) {
            await deleteEpic(pendingEpicDelete.id);
            setPendingEpicDelete(null);
          }
        }}
        onCancel={() => setPendingEpicDelete(null)}
      />
    </motion.div>
  );
}
