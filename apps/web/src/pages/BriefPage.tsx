import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle,
  ClipboardList,
  XCircle,
  MessageSquare,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RotateCcw,
  Loader,
  Sparkles,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ChallengeBar } from '../components/ChallengeBar';
import { VersionDropdown } from '../components/VersionDropdown';
import type { OpenQuestion } from '../data/mockData';

function QuestionCard({ q }: { q: OpenQuestion }) {
  const answerQuestion = useProjectStore((s) => s.answerQuestion);
  const setQuestionStatus = useProjectStore((s) => s.setQuestionStatus);
  const [draft, setDraft] = useState(q.answer);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  function handleSubmitAnswer() {
    if (!draft.trim()) return;
    answerQuestion(q.id, draft.trim());
    setIsAnswering(false);
  }

  function handleDismiss() {
    setQuestionStatus(q.id, 'dismissed');
    setIsAnswering(false);
  }

  function handleReopen() {
    setQuestionStatus(q.id, 'open');
    setDraft('');
    setIsAnswering(false);
  }

  if (q.status === 'dismissed') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 opacity-40" style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', border: '1px solid var(--border)' }}>
          <X size={12} className="shrink-0" style={{ color: 'var(--text-dim)' }} />
          <p className="text-xs flex-1 line-through truncate" style={{ color: 'var(--text-dim)' }}>{q.text}</p>
          <button
            onClick={handleReopen}
            className="shrink-0 transition-colors text-[10px] flex items-center gap-1 hover:text-[var(--accent-text)]"
            style={{ color: 'var(--text-dim)' }}
          >
            <RotateCcw size={10} />
            Reopen
          </button>
        </div>
      </motion.div>
    );
  }

  if (q.status === 'answered') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
        <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] overflow-hidden">
          <button
            className="w-full flex items-start gap-3 px-4 py-3 text-left group"
            onClick={() => setIsExpanded((v) => !v)}
          >
            <Check size={13} className="text-[var(--success-text)] shrink-0 mt-0.5" />
            <p className="text-sm flex-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{q.text}</p>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-[var(--success-text)] font-medium">Answered</span>
              {isExpanded ? (
                <ChevronUp size={12} style={{ color: 'var(--text-dim)' }} />
              ) : (
                <ChevronDown size={12} style={{ color: 'var(--text-dim)' }} />
              )}
            </div>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 pt-0 border-t border-[var(--success-border)]">
                  <p className="text-[10px] text-[var(--success-text)] font-semibold uppercase tracking-wider mb-1.5 mt-3">
                    Answer
                  </p>
                  <p className="text-xs leading-relaxed bg-[var(--success-bg)] rounded-lg px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                    {q.answer}
                  </p>
                  <button
                    onClick={handleReopen}
                    className="mt-2 text-[10px] transition-colors flex items-center gap-1"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    <RotateCcw size={9} />
                    Reopen question
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div
        className="rounded-xl overflow-hidden transition-all duration-150"
        style={isAnswering ? {
          background: 'rgba(139,92,246,0.07)',
          border: '1px solid rgba(139,92,246,0.3)',
        } : {
          background: 'rgba(217,119,6,0.07)',
          border: '1px solid rgba(217,119,6,0.25)',
        }}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="text-[var(--warning-text)] text-sm mt-0.5 shrink-0 font-bold">?</span>
          <p className="text-sm flex-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{q.text}</p>
          <div className="flex items-center gap-1 shrink-0">
            {!isAnswering && (
              <button
                onClick={() => setIsAnswering(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors hover:text-[var(--accent-text)]"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                <MessageSquare size={10} />
                Answer
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="p-1 rounded transition-colors hover:text-[var(--text-primary)]"
              style={{ color: 'var(--text-dim)' }}
              aria-label="Dismiss question"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isAnswering && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 border-t border-violet-900/30">
                <p className="text-[10px] text-[var(--accent-text)] font-semibold uppercase tracking-wider mb-2 mt-3">
                  Your answer
                </p>
                <textarea
                  autoFocus
                  className="w-full min-h-[80px] px-3 py-2.5 rounded-lg text-xs placeholder-[var(--text-dim)] resize-none focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-transparent transition-all leading-relaxed"
                  style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  placeholder="Type your answer here…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmitAnswer();
                    if (e.key === 'Escape') setIsAnswering(false);
                  }}
                />
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    size="sm"
                    onClick={handleSubmitAnswer}
                    disabled={!draft.trim()}
                    className="gap-1.5 text-xs"
                  >
                    <Check size={11} />
                    Mark Resolved
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsAnswering(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>⌘↵ to save</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function BriefPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const briefWithHistory = useProjectStore((s) => s.brief);
  const restoreBriefVersion = useProjectStore((s) => s.restoreBriefVersion);
  const generateBrief = useProjectStore((s) => s.generateBrief);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  const isLoadingProject = useProjectStore((s) => s.isLoadingProject);
  // Project hydration is handled centrally by <ProjectWorkspace> in main.tsx —
  // do not call loadProject here or it will fight the workspace loader.

  const brief = briefWithHistory.current;
  const versions = briefWithHistory.versions;

  const openCount = brief.openQuestions.filter((q) => q.status === 'open').length;
  const answeredCount = brief.openQuestions.filter((q) => q.status === 'answered').length;
  const dismissedCount = brief.openQuestions.filter((q) => q.status === 'dismissed').length;
  const [showDismissed, setShowDismissed] = useState(false);

  const visibleQuestions = brief.openQuestions.filter(
    (q) => q.status !== 'dismissed' || showDismissed,
  );

  const canApprove = openCount === 0;
  const isEmpty = !brief.summary && versions.length === 0;
  const isGen = isGenerating === 'brief';

  function handleApprove() {
    navigate(`/projects/${projectId}/epics`);
  }

  if (isLoadingProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader size={20} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
      </div>
    );
  }

  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-1 min-h-0">
        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto pb-28">
          <div className="px-8 pt-8">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 text-[var(--accent-text)] mb-3">
                <ClipboardList size={14} />
                <span className="text-xs font-semibold uppercase tracking-widest">Step 2 — Brief Review</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {brief.title || 'Project Brief'}
                  </h1>
                  {brief.client && (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Client: <span style={{ color: 'var(--text-secondary)' }}>{brief.client}</span>
                      {brief.date && (
                        <>
                          <span className="mx-2" style={{ color: 'var(--border)' }}>·</span>
                          Extracted: <span style={{ color: 'var(--text-secondary)' }}>{brief.date}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Generate button */}
                  <Button
                    onClick={() => projectId && void generateBrief(projectId)}
                    disabled={isGen}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    {isGen ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {isEmpty ? 'Generate Brief' : 'Regenerate'}
                  </Button>
                  {/* Version history */}
                  <VersionDropdown
                    versions={versions}
                    onRestore={(v) => restoreBriefVersion(v)}
                  />
                </div>
              </div>
            </div>

            {/* Empty state */}
            {isEmpty && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                  style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  <Sparkles size={22} style={{ color: 'var(--accent-text)' }} />
                </div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No brief yet</p>
                <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
                  Click Generate Brief to extract a structured brief from the raw input.
                </p>
                <Button
                  onClick={() => projectId && void generateBrief(projectId)}
                  disabled={isGen}
                  className="gap-2"
                >
                  {isGen ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Generate Brief
                </Button>
              </div>
            )}

            {!isEmpty && (
            <div>
            {/* Summary */}
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Summary</h2>
              <div className="rounded-xl p-5" style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', border: '1px solid var(--border)' }}>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{brief.summary}</p>
              </div>
            </section>

            {/* Open Questions */}
            <section className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  Open Questions
                </h2>
                <div className="flex items-center gap-1.5">
                  {openCount > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)', boxShadow: 'inset 0 0 0 1px var(--warning-border)' }}>
                      {openCount} open
                    </span>
                  )}
                  {answeredCount > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ background: 'var(--success-bg)', color: 'var(--success-text)', boxShadow: 'inset 0 0 0 1px var(--success-border)' }}>
                      {answeredCount} answered
                    </span>
                  )}
                </div>
                {dismissedCount > 0 && (
                  <button
                    onClick={() => setShowDismissed((v) => !v)}
                    className="ml-auto text-[10px] transition-colors hover:text-[var(--accent-text)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
                  </button>
                )}
              </div>

              {!canApprove && openCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 mb-3"
                  style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: 'var(--warning-text)' }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--warning-text)' }}>
                    Answer or dismiss all open questions before approving the brief.
                  </p>
                </div>
              )}

              {brief.openQuestions.length === 0 ? (
                <p className="text-sm italic px-1" style={{ color: 'var(--text-muted)' }}>No open questions.</p>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence>
                    {visibleQuestions.map((q) => (
                      <QuestionCard key={q.id} q={q} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </section>

            {/* Scope */}
            <section className="mb-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Scope</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-4" style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
                  <h3 className="text-xs font-semibold text-[var(--success-text)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <CheckCircle size={11} />
                    In Scope
                  </h3>
                  <ul className="space-y-2">
                    {brief.inScope.map((item, i) => (
                      <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                        <span className="text-[var(--success-text)] mt-0.5 shrink-0">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl p-4" style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}>
                  <h3 className="text-xs font-semibold text-[var(--error-text)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <XCircle size={11} />
                    Out of Scope
                  </h3>
                  <ul className="space-y-2">
                    {brief.outOfScope.map((item, i) => (
                      <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                        <span className="text-[var(--error-text)] mt-0.5 shrink-0">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </div>)}
          </div>
        </div>

        {/* Right sidebar */}
        {!isEmpty && <div className="shrink-0 p-5 flex flex-col gap-4 overflow-y-auto" style={{ width: '36%', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
          {/* Assumptions */}
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Assumptions</h3>
            <ul className="space-y-2">
              {brief.assumptions.map((a) => (
                <li
                  key={a.id}
                  className="text-xs rounded-lg px-3 py-2.5 leading-relaxed"
                  style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
                >
                  {a.text}
                </li>
              ))}
            </ul>
          </div>

          {/* Questions progress */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Open</span>
                <span className={openCount > 0 ? 'text-[var(--warning-text)] font-medium' : ''} style={openCount > 0 ? undefined : { color: 'var(--text-muted)' }}>
                  {openCount}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Answered</span>
                <span className="text-[var(--success-text)] font-medium">{answeredCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Dismissed</span>
                <span style={{ color: 'var(--text-muted)' }}>{dismissedCount}</span>
              </div>
              <div className="pt-1">
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full bg-[var(--success)] rounded-full transition-all duration-300"
                    style={{
                      width: `${brief.openQuestions.length > 0 ? ((answeredCount + dismissedCount) / brief.openQuestions.length) * 100 : 100}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  {canApprove ? 'All questions resolved — ready to approve' : `${openCount} remaining before approval`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>}
      </div>

      {/* Sticky bottom bar: action row + challenge bar */}
      {!isEmpty && (
        <div className="shrink-0 backdrop-blur-sm" style={{ borderTop: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 92%, transparent)' }}>
          <div className="px-8 py-4 flex items-center gap-3">
            <div className="flex-1" />
            {!canApprove && (
              <span className="text-[11px] text-[var(--warning-text)] flex items-center gap-1.5">
                <AlertTriangle size={11} />
                {openCount} open question{openCount !== 1 ? 's' : ''} remaining
              </span>
            )}
            <Button onClick={handleApprove} disabled={!canApprove} className="gap-1.5">
              <CheckCircle size={14} />
              Approve Brief
            </Button>
          </div>
          <ChallengeBar stage="brief" />
        </div>
      )}
    </motion.div>
  );
}
