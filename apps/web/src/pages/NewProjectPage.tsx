import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ArrowRight,
  ArrowLeft,
  Building,
  Link,
  Upload,
  X,
  FileImage,
  File,
  Paperclip,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { useAvailableProviders } from '../hooks/useAvailableProviders';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import type { ProjectDefinition, AttachedFile } from '../data/mockData';
import type { CommunicationChannel, AIProvider } from '../constants/enums';
import {
  PROJECT_TYPE_VALUES_SELECTABLE,
  PROJECT_TYPE_LABELS,
  COMMUNICATION_CHANNEL_VALUES,
  CHANNEL_LABELS,
  CHANNEL_PLACEHOLDERS,
} from '../constants/enums';

const PROJECT_TYPES = PROJECT_TYPE_VALUES_SELECTABLE.map(value => ({
  value,
  label: PROJECT_TYPE_LABELS[value],
}));

const CHANNEL_OPTIONS = COMMUNICATION_CHANNEL_VALUES.map(value => ({
  value,
  label: CHANNEL_LABELS[value],
  placeholder: CHANNEL_PLACEHOLDERS[value],
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <FileImage size={14} className="text-violet-400" />;
  if (type === 'application/pdf') return <FileText size={14} className="text-red-400" />;
  return <File size={14} style={{ color: 'var(--text-dim)' }} />;
}

/**
 * Inline error message rendered below an input. Reserves no space when null,
 * so layouts don't shift as errors appear/disappear.
 */
function FieldError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="text-[11px] mt-1.5 text-red-400 flex items-center gap-1">
      <span aria-hidden>•</span>
      {message}
    </p>
  );
}

const STEP_LABELS = ['Project Info', 'Communication', 'Raw Input'];

// Draft is persisted to localStorage so a hard refresh / accidental close
// doesn't wipe a half-typed form. Cleared after a successful create or on Cancel.
const DRAFT_KEY = 'wbs_new_project_draft';

interface ProjectDraft {
  step: number;
  name: string;
  client: string;
  projectType: ProjectDefinition['projectType'];
  estimatedBudget: string;
  startDate: string;
  communicationChannels: CommunicationChannel[];
  channelLinks: Partial<Record<CommunicationChannel, string>>;
  contactPerson: string;
  provider: AIProvider;
  rawInput: string;
}

function loadDraft(): Partial<ProjectDraft> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) as Partial<ProjectDraft> : {};
  } catch { return {}; }
}

function saveDraft(draft: ProjectDraft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota — ignore */ }
}

function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

interface LocalAttachedFile extends AttachedFile {
  /** Original File handle — kept so we can POST the bytes after createProject.
      Lost on reload (intentional — uploads don't persist in localStorage). */
  file?: File;
  /** Per-file upload lifecycle so the UI can show status pills. */
  uploadStatus?: 'idle' | 'uploading' | 'ok' | 'failed';
  /** Backend extraction result — chars extracted; null when failed. */
  extractedChars?: number | null;
  /** Human-readable failure reason when uploadStatus === 'failed'. */
  uploadError?: string;
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const setDefinitionField = useProjectStore((s) => s.setDefinitionField);

  // Restore draft from localStorage once at mount.
  const initial = loadDraft();

  const [step, setStep] = useState<number>(initial.step ?? 0);
  const [name, setName] = useState<string>(initial.name ?? '');
  const [client, setClient] = useState<string>(initial.client ?? '');
  const [projectType, setProjectType] = useState<ProjectDefinition['projectType']>(initial.projectType ?? 'web_app');
  const [estimatedBudget, setEstimatedBudget] = useState<string>(initial.estimatedBudget ?? '');
  const [startDate, setStartDate] = useState<string>(initial.startDate ?? '');
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>(initial.communicationChannels ?? ['upwork']);
  const [channelLinks, setChannelLinks] = useState<Partial<Record<CommunicationChannel, string>>>(initial.channelLinks ?? {});
  const [contactPerson, setContactPerson] = useState<string>(initial.contactPerson ?? '');
  const [provider, setProvider] = useState<AIProvider>(initial.provider ?? 'anthropic');
  const { providers: availableProviders, loading: loadingProviders } = useAvailableProviders();

  // Pin provider to a configured one — if the user's stored default isn't
  // available, fall back to whichever is. With zero providers configured the
  // toggle is hidden and the value is irrelevant until they set a key.
  useEffect(() => {
    if (loadingProviders || availableProviders.length === 0) return;
    if (!availableProviders.includes(provider)) {
      setProvider(availableProviders[0]!);
    }
  }, [availableProviders, loadingProviders, provider]);
  const [rawInput, setRawInput] = useState<string>(initial.rawInput ?? '');
  const [attachedFiles, setAttachedFiles] = useState<LocalAttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Save the draft to localStorage whenever any field changes. Doesn't include
  // attachedFiles because File/Blob objects don't serialise cleanly.
  useEffect(() => {
    saveDraft({
      step, name, client, projectType, estimatedBudget, startDate,
      communicationChannels, channelLinks, contactPerson, provider, rawInput,
    });
  }, [step, name, client, projectType, estimatedBudget, startDate, communicationChannels, channelLinks, contactPerson, provider, rawInput]);
  // Track which fields the user has interacted with so validation messages
  // appear on blur (or after a failed Continue click), not while they type.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    // Reject files > 10 MB before they hit the wire — multer would also
    // reject, but failing fast keeps the per-file UI honest.
    const MAX_BYTES = 10 * 1024 * 1024;
    const valid = Array.from(files).filter((f) => {
      const typeOk = ACCEPTED_TYPES.includes(f.type) || f.name.endsWith('.md');
      return typeOk && f.size <= MAX_BYTES;
    });
    const next: LocalAttachedFile[] = valid.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      type: f.type,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      file: f,
      uploadStatus: 'idle',
    }));
    const existing = new Set(attachedFiles.map((a) => `${a.name}-${a.size}`));
    setAttachedFiles((prev) => [...prev, ...next.filter((f) => !existing.has(`${f.name}-${f.size}`))]);
  }, [attachedFiles]);

  function removeFile(id: string) {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  // Submit lifecycle:
  //   isCreating  — guards against double-submits, drives the button spinner
  //   submitError — shown in the banner above the Nav row when create fails
  // Without these, the previous handler swallowed errors silently into
  // console.error, leaving the user staring at a button that "did nothing".
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (isCreating) return;
    setIsCreating(true);
    setSubmitError(null);

    // Update the store's active definition fields for display purposes
    setDefinitionField('name', name || 'Untitled Project');
    setDefinitionField('client', client);
    setDefinitionField('projectType', projectType);
    setDefinitionField('rawInput', rawInput);
    setDefinitionField('attachedFiles', attachedFiles);
    setDefinitionField('provider', provider);

    try {
      const id = await createProject({
        name: name || 'Untitled Project',
        client: client || '',
        projectType,
        estimatedBudget,
        startDate,
        communicationChannels,
        channelLinks,
        contactPerson,
        rawInput,
        provider,
      });

      // Upload + server-side extraction for any attached files. We do this
      // BEFORE navigating to the Brief page so the brief generator already
      // sees the extracted text on first load. Failures are surfaced inline
      // but do NOT block project creation — raw_input alone is still valid.
      const filesToUpload = attachedFiles.filter((f) => f.file);
      if (filesToUpload.length > 0) {
        setAttachedFiles((prev) =>
          prev.map((f) => (filesToUpload.some((u) => u.id === f.id) ? { ...f, uploadStatus: 'uploading' } : f)),
        );
        try {
          const fd = new FormData();
          for (const f of filesToUpload) {
            if (f.file) fd.append('files', f.file, f.name);
          }
          const result = await api.upload<{ attachments: Array<{ filename: string; status: 'ok' | 'failed'; extracted_chars: number; error_message: string | null }> }>(
            `/projects/${id}/attachments`,
            fd,
          );
          // Map each upload result back to its local file by filename. Names
          // are unique within a single create flow (handleFiles dedupes).
          const byName = new Map(result.attachments.map((a) => [a.filename, a]));
          setAttachedFiles((prev) =>
            prev.map((f) => {
              const r = byName.get(f.name);
              if (!r) return f;
              return {
                ...f,
                uploadStatus: r.status === 'ok' ? 'ok' : 'failed',
                extractedChars: r.status === 'ok' ? r.extracted_chars : null,
                uploadError: r.error_message ?? undefined,
              };
            }),
          );
        } catch (err) {
          // Network / 4xx / 5xx — mark every uploading file as failed so the
          // user sees what happened. Don't throw — project was already created.
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setAttachedFiles((prev) =>
            prev.map((f) => (f.uploadStatus === 'uploading' ? { ...f, uploadStatus: 'failed', uploadError: msg } : f)),
          );
          setSubmitError(`Project created, but some attachments could not be uploaded: ${msg}.`);
          setIsCreating(false);
          return;
        }
      }

      clearDraft();
      navigate(`/projects/${id}/brief`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create project.';
      console.error('Failed to create project:', err);
      setSubmitError(`Could not create project: ${msg}. Check that the API is running and that you're logged in.`);
      setIsCreating(false);
    }
    // Note: on success we navigate away, so we don't need to reset isCreating.
  }

  function toggleChannel(ch: CommunicationChannel) {
    setCommunicationChannels((prev) =>
      prev.includes(ch)
        ? prev.length > 1 ? prev.filter((c) => c !== ch) : prev // keep at least one
        : [...prev, ch]
    );
  }

  // Field-level validators. Each returns null when valid, or a user-facing
  // error string. Run on change; messages render only when `touched[field]`.
  //
  // Note: channel reference fields are deliberately NOT validated as URLs.
  // Per CHANNEL_PLACEHOLDERS, each channel takes freeform text (Upwork
  // contract ID, email address/subject, Slack channel name, meeting notes,
  // etc.) — not just URLs.

  const errors = {
    name:
      name.trim().length === 0
        ? 'Project name is required.'
        : name.trim().length < 3
        ? 'Use at least 3 characters.'
        : name.trim().length > 80
        ? 'Keep it under 80 characters.'
        : null,
    client:
      client.trim().length === 0
        ? 'Client name is required.'
        : client.trim().length < 2
        ? 'Use at least 2 characters.'
        : client.trim().length > 80
        ? 'Keep it under 80 characters.'
        : null,
    estimatedBudget:
      estimatedBudget.trim().length > 0 && !/\d/.test(estimatedBudget)
        ? 'Budget should include a number (e.g. "$50,000").'
        : null,
    startDate: (() => {
      if (!startDate) return null;
      const picked = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return picked < today ? 'Start date cannot be in the past.' : null;
    })(),
    contactPerson:
      contactPerson.trim().length === 0
        ? 'Contact person is required.'
        : contactPerson.trim().length < 2
        ? 'Use at least 2 characters.'
        : null,
    // Either-or rule: the user must give the AI *something* to extract a brief
    // from. Raw text is the primary path, but a single attachment (PDF, DOCX,
    // image, etc.) is equally valid — the brief extractor reads both. If the
    // user pastes raw text we still enforce the 30-char minimum so we don't
    // feed the LLM something like "make me an app".
    rawInput: (() => {
      const hasRaw = rawInput.trim().length > 0;
      const hasAttachment = attachedFiles.length > 0;
      if (!hasRaw && !hasAttachment) {
        return 'Provide raw client input OR upload at least one document so we can extract a brief.';
      }
      if (hasRaw && rawInput.trim().length < 30) {
        return 'Add more detail (at least 30 characters) — or remove the text and rely on the uploaded document instead.';
      }
      return null;
    })(),
  } as const;

  // No per-channel validation — references are freeform (URL, ID, email,
  // channel name, free text). Empty object kept so existing read sites still type-check.
  const channelLinkErrors: Partial<Record<CommunicationChannel, string>> = {};

  const canStep1 = !errors.name && !errors.client && !errors.estimatedBudget && !errors.startDate;
  const canStep2 = !errors.contactPerson && Object.keys(channelLinkErrors).length === 0;
  const canCreate = canStep1 && canStep2 && !errors.rawInput;

  // When Create Project is clicked but validation fails, we need to TELL the
  // user what's wrong (silent no-op is the worst UX) and JUMP them back to
  // the step that has the error so they can fix it. submitError is rendered
  // as a banner above the action buttons.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // When the user clicks Continue but a field is invalid, surface ALL errors
  // on the current step at once instead of waiting for individual blurs.
  function tryAdvance() {
    if (step === 0) {
      markTouched('name'); markTouched('client'); markTouched('estimatedBudget'); markTouched('startDate');
      if (!canStep1) return;
    } else if (step === 1) {
      markTouched('contactPerson');
      for (const ch of communicationChannels) markTouched(`channelLink:${ch}`);
      if (!canStep2) return;
    }
    setStep((s) => s + 1);
  }

  return (
    <motion.div
      className="h-full overflow-y-auto flex flex-col"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="w-full px-8 py-10 flex-1">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-violet-400 mb-3">
            <Building size={14} />
            <span className="text-xs font-semibold uppercase tracking-widest">New Project</span>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Project Setup</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Define the project before starting AI generation.</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-0 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                  style={i < step ? {
                    background: '#059669', color: '#fff',
                  } : i === step ? {
                    background: '#7c3aed', color: '#fff', boxShadow: '0 0 10px rgba(124,58,237,0.4)',
                  } : {
                    background: 'var(--bg-overlay-md)', color: 'var(--text-dim)', border: '1px solid var(--border)',
                  }}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <span className="text-xs font-medium" style={{ color: i === step ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className="w-12 h-px mx-3" style={{ background: i < step ? '#065f46' : 'var(--border)' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Project Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => markTouched('name')}
                  placeholder="e.g. Freelancer Marketplace Platform"
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: `1px solid ${touched['name'] && errors.name ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                />
                {touched['name'] && <FieldError message={errors.name} />}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Client Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  onBlur={() => markTouched('client')}
                  placeholder="e.g. TalentConnect Inc."
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: `1px solid ${touched['client'] && errors.client ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                />
                {touched['client'] && <FieldError message={errors.client} />}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Project Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_TYPES.map((pt) => (
                    <button
                      key={pt.value}
                      onClick={() => setProjectType(pt.value)}
                      className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
                      style={projectType === pt.value ? {
                        background: '#7c3aed', color: '#fff',
                      } : {
                        background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-muted)',
                      }}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Estimated Budget
                  </label>
                  <input
                    type="text"
                    value={estimatedBudget}
                    onChange={(e) => setEstimatedBudget(e.target.value)}
                    onBlur={() => markTouched('estimatedBudget')}
                    placeholder="e.g. $50,000"
                    className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                    style={{ background: 'var(--bg-input)', border: `1px solid ${touched['estimatedBudget'] && errors.estimatedBudget ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                  />
                  {touched['estimatedBudget'] && <FieldError message={errors.estimatedBudget} />}
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    onBlur={() => markTouched('startDate')}
                    className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                    style={{ background: 'var(--bg-input)', border: `1px solid ${touched['startDate'] && errors.startDate ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                  />
                  {touched['startDate'] && <FieldError message={errors.startDate} />}
                </div>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Communication Channels <span className="normal-case font-normal text-[10px]" style={{ color: 'var(--text-dim)' }}>(select all that apply)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {CHANNEL_OPTIONS.map((ch) => {
                    const active = communicationChannels.includes(ch.value);
                    return (
                      <button
                        key={ch.value}
                        onClick={() => toggleChannel(ch.value)}
                        className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
                        style={active ? {
                          background: '#7c3aed', color: '#fff',
                        } : {
                          background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-muted)',
                        }}
                      >
                        {ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {communicationChannels.map((ch) => (
                <div key={ch}>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <Link size={11} className="inline mr-1 mb-0.5" />
                    {CHANNEL_LABELS[ch]} Reference
                  </label>
                  <input
                    type="text"
                    value={channelLinks[ch] ?? ''}
                    onChange={(e) => setChannelLinks((prev) => ({ ...prev, [ch]: e.target.value }))}
                    onBlur={() => markTouched(`channelLink:${ch}`)}
                    placeholder={CHANNEL_PLACEHOLDERS[ch]}
                    className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                    style={{ background: 'var(--bg-input)', border: `1px solid ${touched[`channelLink:${ch}`] && channelLinkErrors[ch] ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                  />
                  {touched[`channelLink:${ch}`] && <FieldError message={channelLinkErrors[ch]} />}
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Contact Person <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  onBlur={() => markTouched('contactPerson')}
                  placeholder="e.g. Sarah Johnson"
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: `1px solid ${touched['contactPerson'] && errors.contactPerson ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                />
                {touched['contactPerson'] && <FieldError message={errors.contactPerson} />}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  AI Provider
                </label>
                {availableProviders.length >= 2 ? (
                  <div className="flex items-center gap-1 rounded-lg p-1 w-fit" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                    {availableProviders.map((p) => (
                      <button
                        key={p}
                        onClick={() => setProvider(p)}
                        className="px-4 py-2 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer"
                        style={provider === p ? {
                          background: '#7c3aed', color: '#fff',
                        } : { color: 'var(--text-muted)' }}
                      >
                        {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                      </button>
                    ))}
                  </div>
                ) : availableProviders.length === 1 ? (
                  <div
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                    style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
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
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <div>
                <label className="flex items-baseline justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Raw Client Input
                  </span>
                  <span className="text-[10px] normal-case font-normal" style={{ color: 'var(--text-dim)' }}>
                    {attachedFiles.length > 0 ? 'optional — attachments will be used' : 'required if no attachment'}
                  </span>
                </label>
                <textarea
                  className="w-full min-h-[200px] px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent font-mono leading-relaxed transition-colors"
                  style={{ background: 'var(--bg-input)', border: `1px solid ${touched['rawInput'] && errors.rawInput ? 'rgb(248,113,113)' : 'var(--border)'}` }}
                  placeholder={attachedFiles.length > 0
                    ? 'Optional — paste extra context, or leave empty and let the AI read your attachment…'
                    : 'Paste Upwork chat, transcript, or BD notes here — OR drop a scope doc below.'}
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  onBlur={() => markTouched('rawInput')}
                />
                {touched['rawInput'] && <FieldError message={errors.rawInput} />}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Attachments <span className="normal-case font-normal" style={{ color: 'var(--text-dim)' }}>(optional)</span>
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Drop files here or click to upload"
                  className="relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer"
                  style={isDragging ? {
                    borderColor: '#7c3aed', background: 'rgba(124,58,237,0.08)',
                  } : {
                    borderColor: 'var(--border)',
                  }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
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
                    {attachedFiles.length === 0 ? (
                      <motion.div
                        key="empty"
                        className="flex flex-col items-center justify-center gap-2 py-8"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: isDragging ? 'rgba(124,58,237,0.15)' : 'var(--bg-overlay-md)' }}>
                          <Upload size={16} className={isDragging ? 'text-violet-400' : ''} style={isDragging ? undefined : { color: 'var(--text-dim)' }} />
                        </div>
                        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                          <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Click to upload</span> or drag &amp; drop
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>PDF, Word, TXT, MD, PNG, JPG</p>
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
                            {attachedFiles.map((file) => (
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
                                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                    {formatBytes(file.size)}
                                    {file.uploadStatus === 'ok' && typeof file.extractedChars === 'number' && (
                                      <span className="ml-1" style={{ color: 'var(--success-text)' }}>· {file.extractedChars.toLocaleString()} chars</span>
                                    )}
                                  </p>
                                </div>
                                {file.uploadStatus === 'uploading' && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.3)' }}>
                                    extracting…
                                  </span>
                                )}
                                {file.uploadStatus === 'ok' && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-border)' }}>
                                    extracted
                                  </span>
                                )}
                                {file.uploadStatus === 'failed' && (
                                  <span
                                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                    style={{ background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)' }}
                                    title={file.uploadError}
                                  >
                                    failed
                                  </span>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                                  className="ml-1 transition-colors opacity-0 group-hover:opacity-100 hover:text-violet-300"
                                  style={{ color: 'var(--text-dim)' }}
                                >
                                  <X size={12} />
                                </button>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed transition-colors text-xs hover:text-violet-300"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit error banner — appears when Create Project is clicked but
            validation fails. Tells the user WHICH step is invalid so they
            don't sit on the last step wondering why nothing happens. */}
        {submitError && (
          <div
            className="mt-6 px-4 py-3 rounded-lg text-xs flex items-start gap-2"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#f87171',
            }}
            role="alert"
          >
            <span aria-hidden className="mt-0.5">⚠</span>
            <span className="flex-1 leading-relaxed">{submitError}</span>
            <button
              onClick={() => setSubmitError(null)}
              className="text-[10px] underline opacity-80 hover:opacity-100 shrink-0"
              aria-label="Dismiss error"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-3 mt-8 pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} className="gap-1.5">
              <ArrowLeft size={14} />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => { clearDraft(); navigate('/projects'); }} className="gap-1.5">
              <ArrowLeft size={14} />
              Cancel
            </Button>
          )}
          <div className="flex-1" />
          {step < 2 ? (
            <Button onClick={tryAdvance} className="gap-1.5">
              Continue
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              disabled={isCreating}
              onClick={() => {
                // Surface every error at once so the user can fix all of them.
                markTouched('name'); markTouched('client'); markTouched('estimatedBudget'); markTouched('startDate');
                markTouched('contactPerson'); markTouched('rawInput');
                for (const ch of communicationChannels) markTouched(`channelLink:${ch}`);

                if (canCreate) {
                  setSubmitError(null);
                  void handleCreate();
                  return;
                }

                // Build a specific, clickable banner explaining what's wrong
                // AND jump back to the step containing the first invalid field.
                if (!canStep1) {
                  const firstStep1Error = errors.name ?? errors.client ?? errors.estimatedBudget ?? errors.startDate;
                  setSubmitError(`Step 1 (Project Info) needs fixing: ${firstStep1Error}`);
                  setStep(0);
                } else if (!canStep2) {
                  const firstChannelErr = Object.values(channelLinkErrors)[0];
                  const firstStep2Error = errors.contactPerson ?? firstChannelErr;
                  setSubmitError(`Step 2 (Communication) needs fixing: ${firstStep2Error}`);
                  setStep(1);
                } else if (errors.rawInput) {
                  setSubmitError(errors.rawInput);
                }
              }}
              className="gap-1.5"
            >
              {isCreating ? 'Creating…' : 'Create Project'}
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
