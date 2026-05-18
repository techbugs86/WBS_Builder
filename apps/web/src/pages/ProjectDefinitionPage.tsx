import { useRef, useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building,
  Link,
  Upload,
  X,
  FileImage,
  FileText,
  File,
  Paperclip,
  Save,
  Loader,
  Check,
  Trash2,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { useAvailableProviders } from '../hooks/useAvailableProviders';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ChatSidebarColumn, ShowChatButton } from '../components/ChatSidebarColumn';
import { useChatSidebar } from '../hooks/useChatSidebar';
import type { CommunicationChannel } from '../constants/enums';
import {
  PROJECT_TYPE_VALUES_SELECTABLE,
  PROJECT_TYPE_LABELS,
  COMMUNICATION_CHANNEL_VALUES,
  CHANNEL_LABELS,
  CHANNEL_PLACEHOLDERS,
} from '../constants/enums';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_TYPES = PROJECT_TYPE_VALUES_SELECTABLE.map(value => ({
  value,
  label: PROJECT_TYPE_LABELS[value],
}));


const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <FileImage size={14} className="text-violet-400" />;
  if (type === 'application/pdf') return <FileText size={14} className="text-red-400" />;
  return <File size={14} style={{ color: 'var(--text-muted)' }} />;
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputCls = 'w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors';
const inputStyle = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
};

const labelCls = 'block text-xs font-semibold uppercase tracking-wider mb-2';
const labelStyle = { color: 'var(--text-secondary)' };

const sectionHeadingCls = 'text-[10px] font-semibold uppercase tracking-widest mb-4';
const sectionHeadingStyle = { color: 'var(--text-muted)' };

function PillSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
          style={
            value === opt.value
              ? { background: 'rgba(124,58,237,0.2)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.4)' }
              : { background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', color: 'var(--text-muted)', border: '1px solid var(--border)' }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ProjectDefinitionPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const definition = useProjectStore((s) => s.definition);
  const setDefinitionField = useProjectStore((s) => s.setDefinitionField);
  const addFiles = useProjectStore((s) => s.addFiles);
  const removeFile = useProjectStore((s) => s.removeFile);
  const saveProject = useProjectStore((s) => s.saveProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUser = useProjectStore((s) => s.currentUser);
  const { providers: availableProviders, loading: loadingProviders } = useAvailableProviders();
  const chatSidebar = useChatSidebar('definition');
  const chatMessageCount = useProjectStore((s) => (projectId ? s.definitionChat[projectId]?.length ?? 0 : 0));

  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);

  // Reconcile stored provider with what's actually configured. If the saved
  // project pinned a provider whose API key has since been removed, fall back
  // to the first available one so generations don't fail later.
  useEffect(() => {
    if (loadingProviders || availableProviders.length === 0) return;
    if (!availableProviders.includes(definition.provider)) {
      setDefinitionField('provider', availableProviders[0]!);
    }
  }, [availableProviders, loadingProviders, definition.provider, setDefinitionField]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // Track which fields the user has interacted with — validation messages
  // appear on blur (and on Save attempt), not while the user is mid-typing.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));
  // Project hydration handled by <ProjectWorkspace> — no loadProject here.

  // Validation. Mirror the rules from NewProjectPage so a project edited here
  // can't end up with values it couldn't have been created with.
  //
  // Note: channel reference fields are deliberately NOT validated as URLs.
  // Per CHANNEL_PLACEHOLDERS, each channel takes freeform text (Upwork
  // contract ID, email subject, Slack channel name, meeting notes, etc.)
  // — not just URLs. Forcing https://... was wrong.

  const errors = {
    name:
      definition.name.trim().length === 0
        ? 'Project name is required.'
        : definition.name.trim().length < 3
        ? 'Use at least 3 characters.'
        : definition.name.trim().length > 80
        ? 'Keep it under 80 characters.'
        : null,
    client:
      definition.client.trim().length === 0
        ? 'Client name is required.'
        : definition.client.trim().length < 2
        ? 'Use at least 2 characters.'
        : definition.client.trim().length > 80
        ? 'Keep it under 80 characters.'
        : null,
    estimatedBudget:
      definition.estimatedBudget.trim().length > 0 && !/\d/.test(definition.estimatedBudget)
        ? 'Budget should include a number (e.g. "$50,000").'
        : null,
    contactPerson:
      definition.contactPerson.trim().length === 0
        ? 'Contact person is required.'
        : definition.contactPerson.trim().length < 2
        ? 'Use at least 2 characters.'
        : null,
  } as const;
  // No per-channel validation — references are freeform.
  const channelLinkErrors: Partial<Record<CommunicationChannel, string>> = {};
  const hasAnyError = Boolean(
    errors.name || errors.client || errors.estimatedBudget || errors.contactPerson,
  );

  async function handleSave() {
    if (!projectId || saveStatus === 'saving') return;
    // Validate before save — surface ALL errors at once if any are present
    // so the user sees everything they need to fix in one pass.
    if (hasAnyError) {
      setTouched({
        name: true,
        client: true,
        estimatedBudget: true,
        contactPerson: true,
        ...Object.fromEntries(
          (definition.communicationChannels ?? []).map((ch) => [`channelLink:${ch}`, true]),
        ),
      });
      setSaveStatus('error');
      setSaveError('Please fix the highlighted fields before saving.');
      return;
    }
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await saveProject(projectId);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    }
  }

  async function handleDelete() {
    if (!projectId) return;
    await deleteProject(projectId);
    setShowDeleteDialog(false);
    navigate('/projects');
  }

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const valid = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type) || f.name.endsWith('.md'));
      addFiles(valid);
    },
    [addFiles],
  );

  function toggleChannel(ch: CommunicationChannel) {
    const current = definition.communicationChannels ?? ['upwork'];
    const next = current.includes(ch)
      ? current.length > 1 ? current.filter((c) => c !== ch) : current
      : [...current, ch];
    setDefinitionField('communicationChannels', next);
  }

  return (
    <div className="flex h-full">
    <motion.div
      className="flex-1 min-w-0 px-8 py-10 overflow-y-auto relative"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Save status toast — appears top-center, visible while saving and for ~3s after */}
      <AnimatePresence>
        {(saveStatus === 'saving' || saveStatus === 'saved') && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl"
            style={
              saveStatus === 'saving'
                ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)', color: 'var(--accent-text)' }
                : { background: 'var(--success-bg)', border: '1px solid var(--success-border)', color: 'var(--success-text)' }
            }
            role="status"
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader size={14} className="animate-spin" />
                <span className="text-xs font-medium">Saving project to database…</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span className="text-xs font-medium">Saved successfully — your changes are stored in the database.</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--accent-text)' }}>
          <Building size={14} />
          <span className="text-xs font-semibold uppercase tracking-widest">Step 1 — Definition</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Project Definition</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Edit project details, client info, and input at any time.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-xs text-[var(--error-text)]">{saveError}</span>
            )}
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? (
                <><Loader size={13} className="animate-spin" /> Saving…</>
              ) : saveStatus === 'saved' ? (
                <><Check size={13} /> Saved</>
              ) : (
                <><Save size={13} /> Save</>
              )}
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 size={13} />
                Delete
              </Button>
            )}
            <ShowChatButton hidden={chatSidebar.hidden} onShow={chatSidebar.show} count={chatMessageCount} />
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* Section: Project Info */}
        <section>
          <h2 className={sectionHeadingCls} style={sectionHeadingStyle}>Project Info</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={labelStyle}>Project Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={definition.name}
                onChange={(e) => setDefinitionField('name', e.target.value)}
                onBlur={() => markTouched('name')}
                className={inputCls}
                style={{ ...inputStyle, border: `1px solid ${touched['name'] && errors.name ? 'rgb(248,113,113)' : 'var(--border)'}` }}
              />
              {touched['name'] && errors.name && (
                <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1"><span aria-hidden>•</span>{errors.name}</p>
              )}
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Client Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={definition.client}
                onChange={(e) => setDefinitionField('client', e.target.value)}
                onBlur={() => markTouched('client')}
                className={inputCls}
                style={{ ...inputStyle, border: `1px solid ${touched['client'] && errors.client ? 'rgb(248,113,113)' : 'var(--border)'}` }}
              />
              {touched['client'] && errors.client && (
                <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1"><span aria-hidden>•</span>{errors.client}</p>
              )}
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Project Type</label>
              <PillSelector
                options={PROJECT_TYPES}
                value={definition.projectType}
                onChange={(v) => setDefinitionField('projectType', v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} style={labelStyle}>Estimated Budget</label>
                <input
                  type="text"
                  value={definition.estimatedBudget}
                  onChange={(e) => setDefinitionField('estimatedBudget', e.target.value)}
                  onBlur={() => markTouched('estimatedBudget')}
                  placeholder="e.g. $50,000"
                  className={inputCls}
                  style={{ ...inputStyle, border: `1px solid ${touched['estimatedBudget'] && errors.estimatedBudget ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                />
                {touched['estimatedBudget'] && errors.estimatedBudget && (
                  <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1"><span aria-hidden>•</span>{errors.estimatedBudget}</p>
                )}
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Start Date</label>
                <input
                  type="date"
                  value={definition.startDate}
                  onChange={(e) => setDefinitionField('startDate', e.target.value)}
                  className={inputCls}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* Section: Client Communication */}
        <section>
          <h2 className={sectionHeadingCls} style={sectionHeadingStyle}>Client Communication</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={labelStyle}>
                Channels <span className="normal-case font-normal text-[10px]" style={{ color: 'var(--text-dim)' }}>(select all that apply)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {COMMUNICATION_CHANNEL_VALUES.map((ch) => {
                  const active = (definition.communicationChannels ?? ['upwork']).includes(ch);
                  return (
                    <button
                      key={ch}
                      onClick={() => toggleChannel(ch)}
                      className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
                      style={active
                        ? { background: 'rgba(124,58,237,0.2)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.4)' }
                        : { background: 'var(--bg-overlay-md)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
                      }
                    >
                      {CHANNEL_LABELS[ch]}
                    </button>
                  );
                })}
              </div>
            </div>
            {(definition.communicationChannels ?? ['upwork']).map((ch) => (
              <div key={ch}>
                <label className={labelCls} style={labelStyle}>
                  <span className="inline-flex items-center gap-1">
                    <Link size={11} />
                    {CHANNEL_LABELS[ch]} Reference
                  </span>
                </label>
                <input
                  type="text"
                  value={definition.channelLinks?.[ch] ?? ''}
                  onChange={(e) => setDefinitionField('channelLinks', { ...definition.channelLinks, [ch]: e.target.value })}
                  onBlur={() => markTouched(`channelLink:${ch}`)}
                  placeholder={CHANNEL_PLACEHOLDERS[ch]}
                  className={inputCls}
                  style={{ ...inputStyle, border: `1px solid ${touched[`channelLink:${ch}`] && channelLinkErrors[ch] ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                />
                {touched[`channelLink:${ch}`] && channelLinkErrors[ch] && (
                  <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1"><span aria-hidden>•</span>{channelLinkErrors[ch]}</p>
                )}
              </div>
            ))}
            <div>
              <label className={labelCls} style={labelStyle}>Contact Person <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={definition.contactPerson}
                onChange={(e) => setDefinitionField('contactPerson', e.target.value)}
                onBlur={() => markTouched('contactPerson')}
                placeholder="e.g. Sarah Johnson"
                className={inputCls}
                style={{ ...inputStyle, border: `1px solid ${touched['contactPerson'] && errors.contactPerson ? 'rgb(248,113,113)' : 'var(--border)'}` }}
              />
              {touched['contactPerson'] && errors.contactPerson && (
                <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1"><span aria-hidden>•</span>{errors.contactPerson}</p>
              )}
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>AI Provider</label>
              {availableProviders.length >= 2 ? (
                <div
                  className="flex items-center gap-1 rounded-lg p-1 w-fit"
                  style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', border: '1px solid var(--border)' }}
                >
                  {availableProviders.map((p) => (
                    <button
                      key={p}
                      onClick={() => setDefinitionField('provider', p)}
                      className="px-4 py-2 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer"
                      style={
                        definition.provider === p
                          ? { background: 'rgba(124,58,237,0.2)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.4)' }
                          : { color: 'var(--text-muted)', border: '1px solid transparent' }
                      }
                    >
                      {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                    </button>
                  ))}
                </div>
              ) : availableProviders.length === 1 ? (
                <div
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: availableProviders[0] === 'anthropic' ? '#f97316' : '#10b981' }}
                  />
                  <span className="font-medium">
                    {availableProviders[0] === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                  </span>
                  <span style={{ color: 'var(--text-dim)' }}>· only configured provider</span>
                </div>
              ) : !loadingProviders ? (
                <div
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning-text)' }}
                >
                  No AI provider configured — set an API key in Admin → Integrations.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* Section: Raw Input */}
        <section>
          <h2 className={sectionHeadingCls} style={sectionHeadingStyle}>Raw Input</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={labelStyle}>Client Input</label>
              <textarea
                className="w-full min-h-[180px] px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono leading-relaxed transition-colors"
                style={inputStyle}
                placeholder="Paste Upwork chat, transcript, or BD notes here…"
                value={definition.rawInput}
                onChange={(e) => setDefinitionField('rawInput', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>
                Attachments{' '}
                <span className="normal-case font-normal" style={{ color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop files here or click to upload"
                className="relative rounded-xl transition-all duration-200 cursor-pointer"
                style={{ border: '2px dashed var(--border-dashed)' }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                  className="sr-only"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <AnimatePresence mode="wait">
                  {definition.attachedFiles.length === 0 ? (
                    <motion.div
                      key="empty"
                      className="flex flex-col items-center justify-center gap-2 py-8"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-overlay-md)' }}>
                        <Upload size={16} style={{ color: 'var(--text-muted)' }} />
                      </div>
                      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text-secondary)' }} className="font-medium">Click to upload</span> or drag &amp; drop
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="files"
                      className="p-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {definition.attachedFiles.map((file) => (
                            <motion.div
                              key={file.id}
                              className="flex items-center gap-2 rounded-lg px-3 py-2 group"
                              style={{ background: 'var(--bg-overlay-md)', border: '1px solid var(--border)' }}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.85 }}
                              transition={{ duration: 0.2 }}
                            >
                              {file.previewUrl ? (
                                <img src={file.previewUrl} alt={file.name} className="w-6 h-6 rounded object-cover" />
                              ) : (
                                <FileIcon type={file.type} />
                              )}
                              <div className="min-w-0">
                                <p className="text-xs truncate max-w-[140px]" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatBytes(file.size)}</p>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                                className="ml-1 transition-colors opacity-0 group-hover:opacity-100 hover:text-red-400"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                <X size={12} />
                              </button>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors hover:text-violet-300"
                          style={{ border: '1px dashed var(--border-dashed)', color: 'var(--text-muted)' }}
                        >
                          <Paperclip size={11} />
                          Add more
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete project?"
        message="This permanently removes the project and all of its briefs, epics, journeys, tasks, and ClickUp mappings. This action cannot be undone."
        detail={definition.name || 'Untitled project'}
        matchText={definition.name || undefined}
        confirmLabel="Delete project"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </motion.div>

    {/* Chat rail — hide/show + horizontal resize via useChatSidebar */}
    <ChatSidebarColumn
      projectId={projectId}
      stage="definition"
      hidden={chatSidebar.hidden}
      width={chatSidebar.width}
      isResizing={chatSidebar.isResizing}
      onHide={chatSidebar.hide}
      onResizeStart={chatSidebar.onResizeStart}
    />
    </div>
  );
}
