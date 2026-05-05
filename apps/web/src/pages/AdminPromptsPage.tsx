import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  FileText,
  Layers,
  Map,
  CheckSquare,
  Save,
  RotateCcw,
  Loader,
  History,
  ChevronRight,
  Globe,
  Smartphone,
  Server,
  Zap,
  X,
  CornerUpLeft,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import {
  PROMPT_STAGE_VALUES,
  PROJECT_TYPE_VALUES,
  PROJECT_TYPE_LABELS,
} from '../constants/enums';
import type { PromptStage, ProjectType } from '../constants/enums';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PromptConfig {
  id: string;
  stage: PromptStage;
  projectType: ProjectType;
  label: string;
  systemPrompt: string;
  userPromptTemplate: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  isInherited: boolean;
  inheritedFrom?: string;
}

interface HistoryEntry {
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;
  updatedBy: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_TYPE_ICONS: Record<ProjectType, React.ReactNode> = {
  general:    <Globe size={12} />,
  web_app:    <Layers size={12} />,
  mobile:     <Smartphone size={12} />,
  api:        <Server size={12} />,
  automation: <Zap size={12} />,
};

const PROJECT_TYPES = PROJECT_TYPE_VALUES.map(id => ({
  id,
  label: PROJECT_TYPE_LABELS[id],
  icon: PROJECT_TYPE_ICONS[id],
  color: '#94a3b8', // neutral — label carries identity
}));

const STAGES = PROMPT_STAGE_VALUES;

const STAGE_CONFIG: Record<PromptStage, { label: string; icon: React.ReactNode; color: string; border: string; bg: string }> = {
  brief_extraction: {
    label: 'Brief Extraction',
    icon: <FileText size={14} />,
    color: '#3b82f6',
    border: 'rgba(59,130,246,0.3)',
    bg: 'rgba(59,130,246,0.08)',
  },
  epic_generation: {
    label: 'Epic Generation',
    icon: <Layers size={14} />,
    color: '#8b5cf6',
    border: 'rgba(139,92,246,0.3)',
    bg: 'rgba(139,92,246,0.08)',
  },
  journey_generation: {
    label: 'Journey Generation',
    icon: <Map size={14} />,
    color: '#f59e0b',
    border: 'rgba(245,158,11,0.3)',
    bg: 'rgba(245,158,11,0.08)',
  },
  task_decomposition: {
    label: 'Task Decomposition',
    icon: <CheckSquare size={14} />,
    color: '#10b981',
    border: 'rgba(16,185,129,0.3)',
    bg: 'rgba(16,185,129,0.08)',
  },
};

const STAGE_KEYWORDS: Record<PromptStage, { key: string; desc: string }[]> = {
  brief_extraction: [
    { key: '{{raw_input}}',   desc: 'The raw client text / transcript' },
    { key: '{{client_name}}', desc: 'Client / company name' },
    { key: '{{project_type}}', desc: 'Project type (web_app, mobile…)' },
  ],
  epic_generation: [
    { key: '{{brief_json}}',  desc: 'Structured brief as JSON' },
    { key: '{{project_name}}', desc: 'Project name' },
    { key: '{{project_type}}', desc: 'Project type' },
  ],
  journey_generation: [
    { key: '{{epic_json}}',   desc: 'Epic as JSON' },
    { key: '{{brief_json}}',  desc: 'Structured brief as JSON' },
    { key: '{{project_type}}', desc: 'Project type' },
  ],
  task_decomposition: [
    { key: '{{journey_json}}', desc: 'Journey as JSON' },
    { key: '{{epic_json}}',    desc: 'Parent epic as JSON' },
    { key: '{{project_type}}', desc: 'Project type' },
    { key: '{{stack}}',        desc: 'Tech stack hints (optional)' },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const textareaCls =
  'w-full px-4 py-3 rounded-xl text-xs font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors';
const textareaStyle = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
};

// ─── KeywordRef ───────────────────────────────────────────────────────────────

function KeywordRef({ stage }: { stage: PromptStage }) {
  const keywords = STAGE_KEYWORDS[stage];
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: 'rgba(124,58,237,0.05)',
        border: '1px solid rgba(124,58,237,0.15)',
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--accent-text)' }}>
        Available variables
      </p>
      <div className="flex flex-wrap gap-2">
        {keywords.map((kw) => (
          <div key={kw.key} className="flex items-center gap-1.5">
            <code
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(124,58,237,0.15)',
                color: 'var(--accent-text-dim)',
                border: '1px solid rgba(124,58,237,0.2)',
              }}
            >
              {kw.key}
            </code>
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {kw.desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────

function HistoryPanel({
  stage,
  projectType,
  currentVersion,
  onClose,
  onRestore,
}: {
  stage: PromptStage;
  projectType: ProjectType;
  currentVersion: number;
  onClose: () => void;
  onRestore: (config: PromptConfig) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<HistoryEntry[]>(`/admin/prompts/${stage}/history?projectType=${projectType}`)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [stage, projectType]);

  async function handleRestore(entry: HistoryEntry) {
    setRestoring(entry.version);
    try {
      const updated = await api.post<PromptConfig>(
        `/admin/prompts/${stage}/restore?projectType=${projectType}`,
        { version: entry.version },
      );
      onRestore(updated);
      onClose();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <motion.div
      className="absolute inset-y-0 right-0 flex flex-col z-10 overflow-hidden"
      style={{
        width: '420px',
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        borderRadius: '0 1rem 1rem 0',
      }}
      initial={{ x: 420 }}
      animate={{ x: 0 }}
      exit={{ x: 420 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <History size={14} style={{ color: 'var(--accent-text)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Version History
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: 'var(--text-dim)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader size={16} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-dim)' }}>
            No history yet.
          </p>
        ) : (
          entries.map((entry) => {
            const isCurrent = entry.version === currentVersion;
            const isOpen = expanded === entry.version;
            return (
              <div
                key={entry.version}
                className="rounded-xl overflow-hidden"
                style={{
                  background: isCurrent ? 'rgba(124,58,237,0.06)' : 'var(--bg-card-alt)',
                  border: `1px solid ${isCurrent ? 'rgba(124,58,237,0.25)' : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        v{entry.version}
                      </span>
                      {isCurrent && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                          style={{ color: 'var(--accent-text)', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}
                        >
                          current
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                        {entry.updatedBy} · {formatRelative(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isCurrent && (
                      <button
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors hover:bg-violet-500/10"
                        style={{ color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.2)' }}
                        onClick={() => void handleRestore(entry)}
                        disabled={restoring === entry.version}
                      >
                        {restoring === entry.version ? (
                          <Loader size={10} className="animate-spin" />
                        ) : (
                          <CornerUpLeft size={10} />
                        )}
                        Restore
                      </button>
                    )}
                    <button
                      className="p-1 rounded-lg transition-colors hover:bg-white/5"
                      style={{ color: 'var(--text-dim)' }}
                      onClick={() => setExpanded(isOpen ? null : entry.version)}
                    >
                      <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
                        <ChevronRight size={12} />
                      </motion.div>
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 pb-3 space-y-2"
                        style={{ borderTop: '1px solid var(--border)' }}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-widest pt-2" style={{ color: 'var(--text-dim)' }}>
                          System prompt
                        </p>
                        <pre
                          className="text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed"
                          style={{ color: 'var(--text-muted)', maxHeight: '120px', overflow: 'auto' }}
                        >
                          {entry.systemPrompt || '(empty)'}
                        </pre>
                        <p className="text-[9px] font-semibold uppercase tracking-widest pt-1" style={{ color: 'var(--text-dim)' }}>
                          User template
                        </p>
                        <pre
                          className="text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed"
                          style={{ color: 'var(--text-muted)', maxHeight: '80px', overflow: 'auto' }}
                        >
                          {entry.userPromptTemplate || '(empty)'}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

// ─── StageEditor ──────────────────────────────────────────────────────────────

function StageEditor({
  config,
  projectType,
  onSaved,
}: {
  config: PromptConfig;
  projectType: ProjectType;
  onSaved: (updated: PromptConfig) => void;
}) {
  const cfg = STAGE_CONFIG[config.stage];

  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt);
  const [userTemplate, setUserTemplate] = useState(config.userPromptTemplate);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync fields when config prop changes (stage switch or restore)
  useEffect(() => {
    setSystemPrompt(config.systemPrompt);
    setUserTemplate(config.userPromptTemplate);
    setShowHistory(false);
  }, [config.id, config.version]);

  const hasUnsaved = systemPrompt !== config.systemPrompt || userTemplate !== config.userPromptTemplate;

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await api.put<PromptConfig>(
        `/admin/prompts/${config.stage}?projectType=${projectType}`,
        { systemPrompt, userPromptTemplate: userTemplate },
      );
      onSaved(updated);
    } finally {
      setIsSaving(false);
    }
  }

  function handleRestore(updated: PromptConfig) {
    onSaved(updated);
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col h-full overflow-hidden relative">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span style={{ color: cfg.color }}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {cfg.label}
            </span>
            {config.isInherited && (
              <span
                className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  color: '#94a3b8',
                  background: 'rgba(148,163,184,0.1)',
                  border: '1px solid rgba(148,163,184,0.2)',
                }}
              >
                Inherited from General
              </span>
            )}
            {hasUnsaved && (
              <span
                className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  color: '#f59e0b',
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.25)',
                }}
              >
                Unsaved
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
            v{config.version} · {config.updatedBy} · {formatRelative(config.updatedAt)}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
          style={{
            color: showHistory ? 'var(--accent-text)' : 'var(--text-muted)',
            border: `1px solid ${showHistory ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
          }}
          onClick={() => setShowHistory((v) => !v)}
        >
          <History size={12} />
          History
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* System prompt */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            System Prompt
          </label>
          <textarea
            className={textareaCls}
            style={textareaStyle}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
          />
        </div>

        {/* User prompt template */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            User Prompt Template
          </label>
          <textarea
            className={textareaCls}
            style={textareaStyle}
            value={userTemplate}
            onChange={(e) => setUserTemplate(e.target.value)}
            rows={6}
          />
        </div>

        {/* Keyword reference */}
        <KeywordRef stage={config.stage} />
      </div>

      {/* Footer actions */}
      <div
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <Button size="sm" className="gap-1.5" onClick={() => void handleSave()} disabled={!hasUnsaved || isSaving}>
          {isSaving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
          Save Changes
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => { setSystemPrompt(config.systemPrompt); setUserTemplate(config.userPromptTemplate); }}
          disabled={!hasUnsaved}
        >
          <RotateCcw size={12} />
          Reset
        </Button>
        {!hasUnsaved && (
          <span className="text-xs ml-1" style={{ color: 'var(--text-dim)' }}>No unsaved changes</span>
        )}
      </div>

      {/* History panel overlay */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel
            stage={config.stage}
            projectType={projectType}
            currentVersion={config.version}
            onClose={() => setShowHistory(false)}
            onRestore={handleRestore}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminPromptsPage() {
  const [activeType, setActiveType] = useState<ProjectType>('general');
  const [activeStage, setActiveStage] = useState<PromptStage>('brief_extraction');
  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<PromptConfig[]>(`/admin/prompts?projectType=${activeType}`)
      .then(setConfigs)
      .finally(() => setLoading(false));
  }, [activeType]);

  function handleSaved(updated: PromptConfig) {
    setConfigs((prev) =>
      prev.map((c) => (c.stage === updated.stage ? { ...updated, isInherited: false } : c)),
    );
  }

  const activeConfig = configs.find((c) => c.stage === activeStage);

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Page header */}
      <div className="px-8 pt-8 pb-5 shrink-0">
        <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--accent-text)' }}>
          <Settings2 size={14} />
          <span className="text-xs font-semibold uppercase tracking-widest">Admin / Prompt Config</span>
        </div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Prompt Config
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Tune AI prompts per pipeline stage and project type.
        </p>

        {/* Project type tabs */}
        <div className="flex items-center gap-1 mt-5 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {PROJECT_TYPES.map((pt) => {
            const isActive = pt.id === activeType;
            return (
              <button
                key={pt.id}
                onClick={() => { setActiveType(pt.id); setActiveStage('brief_extraction'); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  color: isActive ? pt.color : 'var(--text-muted)',
                  background: isActive ? `${pt.color}15` : 'transparent',
                  border: isActive ? `1px solid ${pt.color}30` : '1px solid transparent',
                }}
              >
                <span style={{ color: isActive ? pt.color : 'var(--text-dim)' }}>{pt.icon}</span>
                {pt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-panel body */}
      <div
        className="flex flex-1 min-h-0 mx-8 mb-8 rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
      >
        {/* Left: stage list */}
        <div
          className="w-56 shrink-0 flex flex-col"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              Pipeline Stages
            </span>
          </div>
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader size={14} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
              </div>
            ) : (
              STAGES.map((stage) => {
                const cfg = STAGE_CONFIG[stage];
                const conf = configs.find((c) => c.stage === stage);
                const isActive = activeStage === stage;
                return (
                  <button
                    key={stage}
                    onClick={() => setActiveStage(stage)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{
                      background: isActive ? `${cfg.color}12` : 'transparent',
                      border: isActive ? `1px solid ${cfg.color}30` : '1px solid transparent',
                    }}
                  >
                    <span style={{ color: isActive ? cfg.color : 'var(--text-dim)' }}>{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-medium leading-tight"
                        style={{ color: isActive ? cfg.color : 'var(--text-secondary)' }}
                      >
                        {cfg.label}
                      </p>
                      {conf?.isInherited && (
                        <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                          General fallback
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </nav>
        </div>

        {/* Right: editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {loading || !activeConfig ? (
              <motion.div
                key="loading"
                className="flex-1 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {loading ? (
                  <Loader size={18} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Select a stage to edit.</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key={`${activeType}-${activeStage}`}
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
              >
                <StageEditor
                  config={activeConfig}
                  projectType={activeType}
                  onSaved={handleSaved}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
