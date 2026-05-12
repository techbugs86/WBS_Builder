import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, CheckCircle, Layers, ArrowRight, Edit2, Sparkles, Loader, Trash2 } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { ChallengeBar } from '../components/ChallengeBar';
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
  const [expanded, setExpanded] = useState(false);
  const setEpicStatus = useProjectStore((s) => s.setEpicStatus);
  const restoreEpicVersion = useProjectStore((s) => s.restoreEpicVersion);

  const epic = epicWithHistory.current;
  const versions = epicWithHistory.versions;
  const domainColor = DOMAIN_COLOR[epic.domain];

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

      <div className="flex items-center gap-3 pl-5 pr-4 py-3.5">
        {/* Chevron: expand inline description only */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 transition-colors"
          style={{ color: 'var(--text-dim)' }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronRight size={15} />
          </motion.div>
        </button>

        <Badge variant={DOMAIN_VARIANT_MAP[epic.domain]} className="shrink-0">
          {epic.domain}
        </Badge>

        <span className="flex-1 text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{epic.title}</span>

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

      {/* Inline expand: description only */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pl-5 pr-4 py-4" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-overlay)' }}>
              <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>{epic.description}</p>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-xs transition-colors hover:text-[var(--accent-text)]"
                style={{ color: 'var(--text-dim)' }}
              >
                <Edit2 size={11} />
                Edit &amp; rewrite with AI
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  // Per-epic delete dialog. Stores the epic's data so the confirm dialog can
  // show its title + cascade-warning copy.
  const [pendingEpicDelete, setPendingEpicDelete] = useState<{ id: string; title: string } | null>(null);
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const selectedEpicWithHistory = epicsWithHistory.find((e) => e.current.id === selectedEpicId) ?? null;

  const pendingEpicsCount = epicsWithHistory.filter((e) => e.current.status !== 'approved').length;
  const isGeneratingEpics = isGenerating === 'epics';
  const canContinue = !isGeneratingEpics && epicsWithHistory.length > 0 && pendingEpicsCount === 0;

  const epics = epicsWithHistory.map((e) => e.current);
  const approvedCount = epics.filter((e) => e.status === 'approved').length;
  const pendingCount = epics.filter((e) => e.status === 'pending').length;
  const progressPct = epics.length > 0 ? Math.round((approvedCount / epics.length) * 100) : 0;

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
        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto pb-4">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => projectId && void generateEpics(projectId)}
                    disabled={isGenerating === 'epics'}
                    className="gap-1.5"
                  >
                    {isGenerating === 'epics' ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {epicsWithHistory.length === 0 ? 'Generate Epics' : 'Regenerate'}
                  </Button>
                  <Button variant="success" onClick={approveAllEpics} className="gap-1.5">
                    <CheckCircle size={13} />
                    Approve All
                  </Button>
                  {canDelete && epicsWithHistory.length > 0 && (
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

            {/* Progress */}
            <div className="mb-7">
              <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                <span>Approval progress</span>
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{progressPct}%</span>
              </div>
              <Progress value={progressPct} />
            </div>

            {/* Epic list */}
            {epicsWithHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                  style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  <Sparkles size={18} style={{ color: 'var(--accent-text)' }} />
                </div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No epics yet</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Generate epics from the approved brief.</p>
                <Button
                  onClick={() => projectId && void generateEpics(projectId)}
                  disabled={isGenerating === 'epics'}
                  className="gap-2"
                >
                  {isGenerating === 'epics' ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Generate Epics
                </Button>
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

            {/* Next */}
            <div className="pt-6 flex items-center gap-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Button
                onClick={() => navigate(`/projects/${projectId}/journeys`)}
                disabled={!canContinue}
                className="gap-1.5"
              >
                Continue to Journeys
                <ArrowRight size={14} />
              </Button>
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
            </div>
          </div>
        </div>

        {/* Epic detail panel */}
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
