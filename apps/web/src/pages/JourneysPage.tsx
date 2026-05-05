import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Map, User, ArrowRight, AlertCircle, Sparkles, Loader, Trash2 } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ChallengeBar } from '../components/ChallengeBar';
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
}: {
  journeyWithHistory: JourneyWithHistory;
  isSelected: boolean;
  isUpdated: boolean;
  onClick: () => void;
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

export function JourneysPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const epicsWithHistory = useProjectStore((s) => s.epics);
  const journeysWithHistory = useProjectStore((s) => s.journeys);
  const regenState = useProjectStore((s) => s.regenState);
  const generateJourneys = useProjectStore((s) => s.generateJourneys);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

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

  const approveAllJourneys = useProjectStore((s) => s.approveAllJourneys);
  const deleteAllJourneys = useProjectStore((s) => s.deleteAllJourneys);
  const currentUser = useProjectStore((s) => s.currentUser);
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const [showDeleteAll, setShowDeleteAll] = useState(false);
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

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-1 min-h-0">
        {/* Left panel: epic list */}
        <div className="w-52 shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
          <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2 text-[var(--accent-text)] mb-1">
              <Map size={13} />
              <span className="text-[10px] font-semibold uppercase tracking-widest">Step 4</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Journeys</h2>
            </div>
            <Button
              onClick={() => projectId && void generateJourneys(projectId)}
              disabled={isGenerating === 'journeys'}
              size="sm"
              className="w-full gap-1.5"
            >
              {isGenerating === 'journeys' ? (
                <>
                  <Loader size={12} className="animate-spin" />
                  Regenerating…
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  {journeysWithHistory.length === 0 ? 'Generate Journeys' : 'Regenerate All'}
                </>
              )}
            </Button>

            {/* Approve All Journeys — only shown when there's at least one pending */}
            {pendingJourneysCount > 0 && (
              <Button
                onClick={() => void approveAllJourneys()}
                size="sm"
                variant="success"
                className="w-full gap-1.5 mt-2"
              >
                <CheckCircle size={12} />
                Approve All ({pendingJourneysCount})
              </Button>
            )}

            {/* Delete All Journeys — admin/owner only, hidden when there's nothing to delete */}
            {canDelete && journeysWithHistory.length > 0 && (
              <Button
                onClick={() => setShowDeleteAll(true)}
                size="sm"
                variant="destructive"
                className="w-full gap-1.5 mt-2"
              >
                <Trash2 size={12} />
                Delete All ({journeysWithHistory.length})
              </Button>
            )}
          </div>
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
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          {selectedEpic && (
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedEpic.title}</h2>
                <Badge variant={DOMAIN_VARIANT_MAP[selectedEpic.domain]}>{selectedEpic.domain}</Badge>
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {epicJourneysWithHistory.filter((j) => j.current.status === 'approved').length}/{epicJourneysWithHistory.length} approved
              </span>
            </div>
          )}

          <div className="flex-1 p-6">
            {/* Streaming progress banner — visible while regen is in flight, even after first journeys appear */}
            {isGenerating === 'journeys' && journeysWithHistory.length > 0 && (
              <div
                className="flex items-center gap-2 py-2 px-3 mb-3 rounded-md text-xs"
                style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--accent-text)' }}
              >
                <Loader size={12} className="animate-spin" />
                <span>Generating more journeys ({journeysWithHistory.length} so far)…</span>
              </div>
            )}

            {journeysWithHistory.length === 0 && isGenerating === 'journeys' ? (
              // Active full-page loader during the very first stretch of generation
              <div
                className="flex flex-col items-center justify-center py-20 rounded-xl"
                style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}
              >
                <Loader size={28} className="animate-spin mb-4" style={{ color: 'var(--accent-text)' }} />
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Generating journeys…</p>
                <p className="text-xs text-center max-w-md" style={{ color: 'var(--text-muted)' }}>
                  The AI is crafting user journeys for every approved epic. This typically takes 60-90 seconds for larger projects. Journeys will appear here as each epic completes.
                </p>
              </div>
            ) : journeysWithHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                  style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
                >
                  <Sparkles size={22} style={{ color: 'var(--accent-text)' }} />
                </div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No journeys yet</p>
                <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
                  Generate user journeys for every approved epic in one click.
                </p>
                <Button
                  onClick={() => projectId && void generateJourneys(projectId)}
                  disabled={isGenerating === 'journeys'}
                  className="gap-2"
                >
                  {isGenerating === 'journeys' ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Generate Journeys
                </Button>
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
                    />
                  </motion.div>
                ))}
              </div>
            )}

            <div className="pt-6 mt-8 flex items-center gap-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {(() => {
                const pendingJourneys = journeysWithHistory.filter((j) => j.current.status !== 'approved').length;
                const isGenerating_ = isGenerating === 'journeys';
                // Same defensive guard as Tasks page — don't allow continuing
                // while more journeys may still be streaming in from the LLM.
                const canContinue = !isGenerating_ && journeysWithHistory.length > 0 && pendingJourneys === 0;
                return (
                  <>
                    <Button
                      onClick={() => navigate(`/projects/${projectId}/tasks`)}
                      disabled={!canContinue}
                      className="gap-1.5"
                    >
                      Continue to Tasks
                      <ArrowRight size={14} />
                    </Button>
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
                  </>
                );
              })()}
            </div>
          </div>
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
    </motion.div>
  );
}
