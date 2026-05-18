import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Map, User, ArrowRight, AlertCircle, Sparkles, Loader, Trash2 } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { ChallengeBar } from '../components/ChallengeBar';
import { ChatSidebarColumn, ShowChatButton } from '../components/ChatSidebarColumn';
import { useChatSidebar } from '../hooks/useChatSidebar';
import { VersionDropdown } from '../components/VersionDropdown';
import { DetailPanel } from '../components/DetailPanel';
import { PromptEditor } from '../components/PromptEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { JourneyWithHistory, Domain } from '../data/mockData';

const DOMAIN_VARIANT_MAP: Record<Domain, 'domain-auth' | 'domain-billing' | 'domain-search' | 'domain-messaging' | 'domain-profile' | 'domain-admin' | 'domain-notifications'> = {
  auth: 'domain-auth',
  billing: 'domain-billing',
  search: 'domain-search',
  messaging: 'domain-messaging',
  profile: 'domain-profile',
  admin: 'domain-admin',
  notifications: 'domain-notifications',
};

function JourneyCard({
  journeyWithHistory,
  isSelected,
  isUpdated,
  onClick,
  onDelete,
  canDelete,
}: {
  journeyWithHistory: JourneyWithHistory;
  isSelected: boolean;
  isUpdated: boolean;
  onClick: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const journey = journeyWithHistory.current;
  const versions = journeyWithHistory.versions;
  const restoreJourneyVersion = useProjectStore((s) => s.restoreJourneyVersion);
  return (
    <motion.div
      className="w-full text-left rounded-xl p-4 transition-all duration-150 relative overflow-hidden"
      style={isSelected ? {
        background: 'linear-gradient(135deg, #13102a, #100e22)',
        border: '1px solid rgba(139,92,246,0.35)',
        boxShadow: '0 0 20px rgba(139,92,246,0.08)',
      } : {
        background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))',
        border: '1px solid var(--border)',
      }}
      whileHover={{ scale: 1.002 }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <Badge variant={journey.status === 'approved' ? 'approved' : 'pending'}>
          {journey.status}
        </Badge>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{journey.edgeCasesCount} edge cases</span>
          <VersionDropdown
            versions={versions}
            onRestore={(v) => restoreJourneyVersion(journey.id, v)}
            isUpdated={isUpdated}
          />
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded transition-colors hover:bg-red-900/30"
              style={{ color: 'var(--error-text)' }}
              title="Delete this journey (also removes its tasks)"
              aria-label="Delete journey"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <button onClick={onClick} className="w-full text-left">
        <h3 className="text-sm font-medium leading-snug mb-1.5" style={{ color: 'var(--text-primary)' }}>{journey.title}</h3>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <User size={11} />
          <span>{journey.persona}</span>
        </div>
      </button>
    </motion.div>
  );
}

function JourneyDetail({
  journeyWithHistory,
}: {
  journeyWithHistory: JourneyWithHistory;
}) {
  const setJourneyStatus = useProjectStore((s) => s.setJourneyStatus);
  const rewriteItem = useProjectStore((s) => s.rewriteItem);
  const journey = journeyWithHistory.current;
  const [rewriting, setRewriting] = useState(false);

  async function handleRewrite(prompt: string) {
    setRewriting(true);
    try {
      await rewriteItem('journey', journey.id, prompt);
    } finally {
      setRewriting(false);
    }
  }

  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider mb-1.5';
  const labelStyle = { color: 'var(--text-muted)' };

  return (
    <div className="p-5 space-y-5">
      {/* Title + status */}
      <div>
        <Badge variant={journey.status === 'approved' ? 'approved' : 'pending'} className="mb-2">
          {journey.status}
        </Badge>
        <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{journey.title}</h3>
      </div>

      {/* Persona */}
      <div>
        <p className={labelCls} style={labelStyle}>Persona</p>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <User size={11} style={{ color: 'var(--text-muted)' }} />
          <span>{journey.persona}</span>
        </div>
      </div>

      {/* Steps */}
      <div>
        <p className={labelCls} style={labelStyle}>Steps</p>
        <ol className="space-y-2">
          {journey.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="shrink-0 w-5 h-5 rounded-full bg-violet-900/40 border border-violet-800/40 text-[var(--accent-text)] flex items-center justify-center text-[10px] font-bold mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Happy Path */}
      <div className="rounded-xl p-4" style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
        <p className="text-[10px] font-semibold text-[var(--success-text)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <ArrowRight size={10} />
          Happy Path
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{journey.happyPath}</p>
      </div>

      {/* Edge Cases — show actual list if available, otherwise fallback to count badge */}
      <div className="rounded-xl p-4" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
        <p className="text-[10px] font-semibold text-[var(--warning-text)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <AlertCircle size={10} />
          Edge Cases
          <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--warning-text)' }}>
            {(journey.edgeCases?.length ?? journey.edgeCasesCount ?? 0)} identified
          </span>
        </p>
        {journey.edgeCases && journey.edgeCases.length > 0 ? (
          <ul className="space-y-1.5">
            {journey.edgeCases.map((ec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <span className="shrink-0 mt-0.5 text-[var(--warning-text)]">•</span>
                <span>{ec}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
            No edge case details on this version. Click "Regenerate" or use the rewrite below to ask the AI to populate them.
          </p>
        )}
      </div>

      {/* Test Cases — QA scenarios in Given/When/Then form */}
      {journey.testCases && journey.testCases.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.25)' }}>
          <p className="text-[10px] font-semibold text-[var(--accent-text)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CheckCircle size={10} />
            Test Cases
            <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--accent-text)' }}>
              {journey.testCases.length} scenario{journey.testCases.length !== 1 ? 's' : ''}
            </span>
          </p>
          <ol className="space-y-3">
            {journey.testCases.map((tc, i) => (
              <li
                key={i}
                className="rounded-md p-3"
                style={{ background: 'var(--bg-overlay)', border: '1px solid rgba(139,92,246,0.15)' }}
              >
                <div className="flex items-start gap-2 mb-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-violet-900/40 border border-violet-800/40 text-[var(--accent-text)] flex items-center justify-center text-[10px] font-bold">
                    {i + 1}
                  </span>
                  <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {tc.name}
                  </p>
                </div>
                <div className="ml-7 space-y-1 text-xs leading-relaxed">
                  <p style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-mono font-bold text-[var(--accent-text)] mr-1.5">Given</span>
                    {tc.given}
                  </p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-mono font-bold text-[var(--accent-text)] mr-1.5">When</span>
                    {tc.when}
                  </p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-mono font-bold text-[var(--accent-text)] mr-1.5">Then</span>
                    {tc.then}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Prompt-based rewrite */}
      <PromptEditor
        placeholder={`Tell the AI how to update this journey…\ne.g. "Add error handling for network timeouts and focus on mobile users"`}
        onSubmit={handleRewrite}
        isProcessing={rewriting}
      />

      {/* Approve / Revoke */}
      <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {journey.status !== 'approved' ? (
          <Button
            variant="success"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => setJourneyStatus(journey.id, 'approved')}
          >
            <CheckCircle size={12} />
            Approve Journey
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setJourneyStatus(journey.id, 'pending')}
          >
            Revoke Approval
          </Button>
        )}
      </div>
    </div>
  );
}

// Average journeys-per-epic across past LawnLink / FreshFork / MediTrack runs
// landed in the 1.6-2.5 range. Use 2.5 as the projected per-epic output to
// drive the progress bar's expected-total denominator.
const JOURNEYS_PER_EPIC_ESTIMATE = 2.5;

export function JourneysPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const epicsWithHistory = useProjectStore((s) => s.epics);
  const journeysWithHistory = useProjectStore((s) => s.journeys);
  const regenState = useProjectStore((s) => s.regenState);
  const generateJourneys = useProjectStore((s) => s.generateJourneys);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

  // Progress bar math during journey generation. Mirror the TasksPage approach:
  //   expected = epicCount * 2.5 (rounded up)
  //   percent  = clamp(currentJourneyCount / expected * 100, 5, 95) while running
  //   percent  = 100                                                when done
  const isJourneyGen = isGenerating === 'journeys';
  const journeyEstimatedTotal = Math.max(
    Math.ceil(epicsWithHistory.length * JOURNEYS_PER_EPIC_ESTIMATE),
    1,
  );
  const journeyRawPercent = isJourneyGen
    ? Math.min(95, Math.max(5, Math.round((journeysWithHistory.length / journeyEstimatedTotal) * 100)))
    : 100;

  const allEpics = epicsWithHistory.map((e) => e.current);
  // Only show epics that have at least one journey — keeps the left panel
  // focused on actionable items. Epics with 0 journeys are hidden until a
  // regen produces journeys for them.
  const epics = allEpics.filter((e) => journeysWithHistory.some((j) => j.current.epicId === e.id));
  const hiddenEpicCount = allEpics.length - epics.length;

  const [selectedEpicId, setSelectedEpicId] = useState<string>(epics[0]?.id ?? '');
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);

  // If the previously-selected epic now has zero journeys (e.g. after regen),
  // jump to the first epic that does.
  useEffect(() => {
    if (epics.length > 0 && !epics.some((e) => e.id === selectedEpicId)) {
      setSelectedEpicId(epics[0]!.id);
    }
  }, [epics, selectedEpicId]);

  // While journeys are streaming in, if the currently selected epic still has
  // 0 journeys but another epic has some, jump to whichever epic has the most.
  // This makes generation feel alive — the user sees journeys appear in the
  // middle column instead of staring at "No journeys for this epic yet" while
  // the global counter ticks up.
  useEffect(() => {
    if (!isGenerating || isGenerating !== 'journeys') return;
    if (journeysWithHistory.length === 0) return;

    const currentCount = journeysWithHistory.filter((j) => j.current.epicId === selectedEpicId).length;
    if (currentCount > 0) return;

    let bestEpicId = '';
    let bestCount = 0;
    for (const epic of epics) {
      const c = journeysWithHistory.filter((j) => j.current.epicId === epic.id).length;
      if (c > bestCount) { bestCount = c; bestEpicId = epic.id; }
    }
    if (bestEpicId) setSelectedEpicId(bestEpicId);
  }, [isGenerating, journeysWithHistory, selectedEpicId, epics]);

  const approveAllJourneys = useProjectStore((s) => s.approveAllJourneys);
  const deleteAllJourneys = useProjectStore((s) => s.deleteAllJourneys);
  const deleteJourney = useProjectStore((s) => s.deleteJourney);
  const currentUser = useProjectStore((s) => s.currentUser);
  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [pendingJourneyDelete, setPendingJourneyDelete] = useState<{ id: string; title: string } | null>(null);
  // Disables Regenerate / Delete while the bulk Approve action is in flight,
  // so the user can't trigger a destructive op against state we're still updating.
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  // Approval progress bar visibility — only shown after user clicks "Approve All",
  // and auto-hides 3s after the bar reaches 100% (every journey approved).
  const [showApprovalProgress, setShowApprovalProgress] = useState(false);
  // AI-generated 3-4 sentence preview for the empty Journeys page —
  // mirrors the same pattern as the Brief and Epics empty states.
  const [previewSummary, setPreviewSummary] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const isJourneysEmpty = journeysWithHistory.length === 0;
  useEffect(() => {
    if (!isJourneysEmpty || !projectId) return;
    let cancelled = false;
    setPreviewLoading(true);
    api
      .get<{ summary: string }>(`/projects/${projectId}/journeys/preview`)
      .then((res) => { if (!cancelled) setPreviewSummary(res.summary); })
      .catch(() => { if (!cancelled) setPreviewSummary(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [isJourneysEmpty, projectId]);
  const projectName = useProjectStore((s) => s.definition.name);
  const chatSidebar = useChatSidebar('journeys');
  const chatMessageCount = useProjectStore((s) => (projectId ? s.journeyChat[projectId]?.length ?? 0 : 0));
  const pendingJourneysCount = journeysWithHistory.filter((j) => j.current.status !== 'approved').length;

  const selectedEpic = allEpics.find((e) => e.id === selectedEpicId);
  const epicJourneysWithHistory = journeysWithHistory.filter((j) => j.current.epicId === selectedEpicId);
  const selectedJourneyWithHistory = journeysWithHistory.find((j) => j.current.id === selectedJourneyId);

  function handleSelectEpic(id: string) {
    setSelectedEpicId(id);
    setSelectedJourneyId(null);
  }

  // Auto-open the first affected journey after a challenge completes
  useEffect(() => {
    if (
      regenState.stage === 'journeys' &&
      !regenState.isProcessing &&
      regenState.progress === 100 &&
      regenState.affectedIds.length > 0
    ) {
      const firstAffected = journeysWithHistory.find((j) =>
        regenState.affectedIds.includes(j.current.id)
      );
      if (firstAffected) {
        setSelectedEpicId(firstAffected.current.epicId);
        setSelectedJourneyId(firstAffected.current.id);
      }
    }
  }, [regenState.stage, regenState.isProcessing, regenState.progress, regenState.affectedIds, journeysWithHistory]);

  // Regenerate is ALWAYS available except while a regen is actually in
  // flight — even on "all approved" lists the user may want a fresh draft.
  const journeysRegenDisabled = isGenerating === 'journeys';
  const journeysRegenTitle = journeysWithHistory.length === 0
    ? 'Generate journeys from the approved epics'
    : 'Replace ALL current journeys with a freshly-generated set';

  // Page-level stats (same rhythm as Epics page).
  const journeyApprovedCount = journeysWithHistory.filter((j) => j.current.status === 'approved').length;
  const journeyPendingCount = journeysWithHistory.length - journeyApprovedCount;
  const journeyProgressPct = journeysWithHistory.length > 0
    ? Math.round((journeyApprovedCount / journeysWithHistory.length) * 100)
    : 0;
  const journeyStatCards = [
    { label: 'Total Journeys', value: journeysWithHistory.length, color: 'var(--text-primary)', bg: 'var(--bg-overlay)', border: 'var(--border)' },
    { label: 'Approved', value: journeyApprovedCount, color: 'var(--success-text)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
    { label: 'Pending', value: journeyPendingCount, color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  ];

  // Auto-hide the Approval progress bar 3s after it reaches 100%.
  useEffect(() => {
    if (!showApprovalProgress || journeyProgressPct < 100) return;
    const t = setTimeout(() => setShowApprovalProgress(false), 3000);
    return () => clearTimeout(t);
  }, [showApprovalProgress, journeyProgressPct]);

  return (
    // Outer horizontal flex — main content column on the left, full-height
    // chat rail on the right. This keeps the chat panel running top-to-bottom
    // of the page (same rhythm as EpicsPage / TasksPage) instead of being
    // squeezed below the header + stats inside an inner flex row.
    <div className="flex h-full w-full">
    <motion.div
      className="flex-1 min-w-0 flex flex-col h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Top header — matches Epics + Tasks pages: title block on the left,
          action buttons (Regenerate → Approve All → Delete All → Chat) on the right.
          `items-start` so the buttons sit inline with the "Journeys" h1, matching
          the Epics + Tasks rhythm exactly. */}
      <div className="py-8 px-8 shrink-0">
        <div className="flex items-center gap-2 mb-3 text-[var(--accent-text)]">
          <Map size={14} />
          <span className="text-xs font-semibold uppercase tracking-widest">Step 4 — Journeys</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Journeys</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {journeysWithHistory.filter((j) => j.current.status === 'approved').length} of {journeysWithHistory.length} approved
            </p>
          </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Regenerate */}
          <button
            onClick={() => projectId && void generateJourneys(projectId)}
            disabled={journeysRegenDisabled}
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
            title={journeysRegenTitle}
          >
            {isGenerating === 'journeys' ? (
              <>
                <Loader size={13} className="animate-spin" />
                <span>Generating…</span>
              </>
            ) : (
              <>
                <Sparkles size={13} />
                <span>{journeysWithHistory.length === 0 ? 'Generate Journeys' : 'Regenerate'}</span>
              </>
            )}
          </button>
          {/* Approve All */}
          {journeysWithHistory.length > 0 && (
            <Button
              onClick={async () => {
                if (pendingJourneysCount === 0) return;
                setShowApprovalProgress(true);
                setIsApprovingAll(true);
                try { await approveAllJourneys(); } finally { setIsApprovingAll(false); }
              }}
              disabled={isApprovingAll || isGenerating === 'journeys' || pendingJourneysCount === 0}
              variant="success"
              size="sm"
              className="gap-1.5"
              title={
                pendingJourneysCount === 0
                  ? 'All journeys are already approved'
                  : isApprovingAll ? 'Approving…' : `Approve all ${pendingJourneysCount} pending journey(s)`
              }
            >
              {isApprovingAll
                ? <><Loader size={12} className="animate-spin" />Approving…</>
                : pendingJourneysCount === 0
                  ? <><CheckCircle size={12} />All approved</>
                  : <><CheckCircle size={12} />Approve All ({pendingJourneysCount})</>}
            </Button>
          )}
          {/* Delete All */}
          {canDelete && journeysWithHistory.length > 0 && (
            <Button
              onClick={() => setShowDeleteAll(true)}
              disabled={isApprovingAll || pendingJourneysCount === 0}
              variant="destructive"
              size="sm"
              className="gap-1.5"
              title={
                pendingJourneysCount === 0
                  ? 'All journeys are approved — delete is locked to protect your approved work'
                  : isApprovingAll ? 'Disabled while approving all journeys' : 'Delete every journey on this project'
              }
            >
              <Trash2 size={12} />
              Delete All ({journeysWithHistory.length})
            </Button>
          )}
          {/* Chat (when sidebar hidden) */}
          <ShowChatButton hidden={chatSidebar.hidden} onShow={chatSidebar.show} count={chatMessageCount} />
        </div>
        </div>
      </div>

      {/* Stats + approval progress — always rendered (with 0/0/0 when empty)
          to keep the page rhythm identical to Epics & Tasks. */}
      <div className="px-8 pb-6 shrink-0">
        <div className="grid grid-cols-3 gap-3 mb-5">
          {journeyStatCards.map((s) => (
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
        {showApprovalProgress && (
          <div>
            <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              <span>Approval progress</span>
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{journeyProgressPct}%</span>
            </div>
            <Progress value={journeyProgressPct} />
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left panel: epic list */}
        <div className="w-52 shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
          <div className="px-3 py-3 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>Epics</p>
              {hiddenEpicCount > 0 && (
                <span
                  className="text-[9px]"
                  style={{ color: 'var(--text-dim)' }}
                  title={`${hiddenEpicCount} epic${hiddenEpicCount !== 1 ? 's' : ''} have no journeys yet — click Regenerate All to generate them.`}
                >
                  {hiddenEpicCount} hidden
                </span>
              )}
            </div>
            <ul className="space-y-0.5">
              {epicsWithHistory
                .filter((epicH) => journeysWithHistory.some((j) => j.current.epicId === epicH.current.id))
                .map((epicH) => {
                const epic = epicH.current;
                const count = journeysWithHistory.filter((j) => j.current.epicId === epic.id).length;
                const isActive = selectedEpicId === epic.id;
                return (
                  <li key={epic.id}>
                    <button
                      onClick={() => handleSelectEpic(epic.id)}
                      className="w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all duration-150 cursor-pointer"
                      style={isActive ? {
                        background: 'rgba(124,58,237,0.12)',
                        border: '1px solid rgba(124,58,237,0.25)',
                        color: 'var(--text-primary)',
                      } : {
                        color: 'var(--text-muted)',
                        border: '1px solid transparent',
                      }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-medium truncate leading-snug">{epic.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant={DOMAIN_VARIANT_MAP[epic.domain]} className="text-[9px] px-1.5 py-0">
                          {epic.domain}
                        </Badge>
                        <span className="text-[10px]" style={{ color: isActive ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                          {count} journey{count !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Center panel: journey cards */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {selectedEpic && (
            <div className="px-6 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedEpic.title}</h2>
                <Badge variant={DOMAIN_VARIANT_MAP[selectedEpic.domain]}>{selectedEpic.domain}</Badge>
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {epicJourneysWithHistory.filter((j) => j.current.status === 'approved').length}/{epicJourneysWithHistory.length} approved
              </span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            {/* Generation progress card — same UX as TasksPage. Shows the live
                count vs estimated total + animated bar + percentage. Stays
                visible the entire time isGenerating === 'journeys'. */}
            {isJourneyGen && (
              <div
                className="rounded-xl p-4 mb-4 space-y-3"
                style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.25)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Loader size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent-text)' }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {journeysWithHistory.length === 0
                          ? 'Generating journeys…'
                          : journeyRawPercent < 90
                          ? `Generating journeys (${journeysWithHistory.length} of ~${journeyEstimatedTotal})…`
                          : `Finalising journeys (${journeysWithHistory.length} so far)…`}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        The AI is crafting user journeys for every approved epic. Journeys appear here as each epic completes.
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-base font-mono font-bold shrink-0 tabular-nums"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    {journeyRawPercent}%
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
                    animate={{ width: `${journeyRawPercent}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}

            {journeysWithHistory.length === 0 && isGenerating === 'journeys' ? null : journeysWithHistory.length === 0 ? (
              <div className="max-w-2xl mx-auto py-20 text-center">
                <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                  {projectName ? `${projectName} — Journeys` : 'Journeys'}
                </h2>
                {previewLoading ? (
                  <div className="flex items-center justify-center gap-2 mb-7" style={{ color: 'var(--text-dim)' }}>
                    <Loader size={14} className="animate-spin" />
                    <span className="text-sm">Previewing what the journeys will look like…</span>
                  </div>
                ) : (
                  <p
                    className="text-[15px] leading-7 mb-7 text-left"
                    style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}
                  >
                    {previewSummary ?? 'Journeys will be generated for every approved epic. Each journey is a persona-tagged end-to-end flow with steps, edge cases, and test scenarios.'}
                  </p>
                )}
                <p className="text-xs mb-4" style={{ color: 'var(--text-dim)' }}>
                  When you're ready, click below to generate the journeys.
                </p>
                <button
                  onClick={() => projectId && void generateJourneys(projectId)}
                  disabled={isGenerating === 'journeys'}
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
                  {isGenerating === 'journeys' ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {isGenerating === 'journeys' ? 'Generating…' : 'Generate Journeys'}
                </button>
              </div>
            ) : epicJourneysWithHistory.length === 0 ? (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>No journeys for this epic yet.</div>
            ) : (
              <div className="space-y-3">
                {epicJourneysWithHistory.map((jH, i) => (
                  <motion.div
                    key={jH.current.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.05 }}
                  >
                    <JourneyCard
                      journeyWithHistory={jH}
                      isSelected={selectedJourneyId === jH.current.id}
                      isUpdated={regenState.affectedIds.includes(jH.current.id)}
                      onClick={() => setSelectedJourneyId(selectedJourneyId === jH.current.id ? null : jH.current.id)}
                      onDelete={() => setPendingJourneyDelete({ id: jH.current.id, title: jH.current.title })}
                      canDelete={canDelete}
                    />
                  </motion.div>
                ))}
              </div>
            )}

          </div>

          {/* Sticky footer — Continue to Tasks always visible regardless of scroll */}
          {(() => {
            const pendingJourneys = journeysWithHistory.filter((j) => j.current.status !== 'approved').length;
            const isGenerating_ = isGenerating === 'journeys';
            const canContinue = !isGenerating_ && journeysWithHistory.length > 0 && pendingJourneys === 0;
            return (
              <div
                className="shrink-0 px-8 py-4 flex items-center gap-3 backdrop-blur-sm"
                style={{
                  borderTop: '1px solid var(--border-subtle)',
                  background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
                  boxShadow: '0 -6px 16px -10px rgba(0,0,0,0.6)',
                }}
              >
                <div className="flex-1" />
                {isGenerating_ && (
                  <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--accent-text)' }}>
                    <Loader size={11} className="animate-spin" />
                    Journeys are still being generated — wait for completion.
                  </span>
                )}
                {!isGenerating_ && !canContinue && journeysWithHistory.length > 0 && (
                  <span className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                    {pendingJourneys} journey{pendingJourneys !== 1 ? 's' : ''} pending approval
                  </span>
                )}
                <Button
                  onClick={() => navigate(`/projects/${projectId}/tasks`)}
                  disabled={!canContinue}
                  className="gap-1.5"
                >
                  Continue to Tasks
                  <ArrowRight size={14} />
                </Button>
              </div>
            );
          })()}
        </div>

        {/* Detail panel — standard 48% sidecar */}
        <DetailPanel
          open={!!selectedJourneyWithHistory}
          onClose={() => setSelectedJourneyId(null)}
          title="Journey Detail"
        >
          {selectedJourneyWithHistory && (
            <JourneyDetail journeyWithHistory={selectedJourneyWithHistory} />
          )}
        </DetailPanel>
      </div>

      {/* Challenge bar */}
      <div className="shrink-0">
        <ChallengeBar stage="journeys" />
      </div>

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete all journeys?"
        message={`This permanently removes all ${journeysWithHistory.length} journey(s) AND any tasks generated from them (tasks reference journeys, so they would be orphaned). Epics are kept. This cannot be undone.`}
        detail={`${journeysWithHistory.length} journey(s) + their downstream tasks will be deleted`}
        matchText="DELETE ALL JOURNEYS"
        confirmLabel="Delete all journeys"
        variant="destructive"
        onConfirm={async () => {
          await deleteAllJourneys();
          setShowDeleteAll(false);
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={pendingJourneyDelete !== null}
        title="Delete this journey?"
        message={`"${pendingJourneyDelete?.title ?? ''}" and any tasks under it will be permanently removed. Other journeys are unaffected. This cannot be undone.`}
        detail={`Cascading delete: 1 journey + its tasks`}
        confirmLabel="Delete journey"
        variant="destructive"
        onConfirm={async () => {
          if (pendingJourneyDelete) {
            await deleteJourney(pendingJourneyDelete.id);
            setPendingJourneyDelete(null);
          }
        }}
        onCancel={() => setPendingJourneyDelete(null)}
      />
    </motion.div>

      {/* Right-side chat rail — sibling of motion.div so it runs the full
          page height (top-to-bottom), matching the EpicsPage rhythm. */}
      <ChatSidebarColumn
        projectId={projectId}
        stage="journeys"
        hidden={chatSidebar.hidden}
        width={chatSidebar.width}
        isResizing={chatSidebar.isResizing}
        onHide={chatSidebar.hide}
        onResizeStart={chatSidebar.onResizeStart}
      />
    </div>
  );
}
