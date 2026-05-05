import { useRef, useState, useCallback } from 'react';
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
import { Button } from '../components/ui/button';
import type { ProjectDefinition, AttachedFile } from '../data/mockData';
import type { CommunicationChannel } from '../constants/enums';
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

const STEP_LABELS = ['Project Info', 'Communication', 'Raw Input'];

interface LocalAttachedFile extends AttachedFile {}

export function NewProjectPage() {
  const navigate = useNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const setDefinitionField = useProjectStore((s) => s.setDefinitionField);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [projectType, setProjectType] = useState<ProjectDefinition['projectType']>('web_app');
  const [estimatedBudget, setEstimatedBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>(['upwork']);
  const [channelLinks, setChannelLinks] = useState<Partial<Record<CommunicationChannel, string>>>({});
  const [contactPerson, setContactPerson] = useState('');
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [rawInput, setRawInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<LocalAttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type) || f.name.endsWith('.md'));
    const next: LocalAttachedFile[] = valid.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      type: f.type,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
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

  async function handleCreate() {
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
      navigate(`/projects/${id}/brief`);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }

  function toggleChannel(ch: CommunicationChannel) {
    setCommunicationChannels((prev) =>
      prev.includes(ch)
        ? prev.length > 1 ? prev.filter((c) => c !== ch) : prev // keep at least one
        : [...prev, ch]
    );
  }

  const canStep1 = name.trim().length > 0 && client.trim().length > 0;
  const canStep2 = contactPerson.trim().length > 0;

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
                  placeholder="e.g. Freelancer Marketplace Platform"
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Client Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="e.g. TalentConnect Inc."
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                />
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
                    placeholder="e.g. $50,000"
                    className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                  />
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
                    placeholder={CHANNEL_PLACEHOLDERS[ch]}
                    className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                  />
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
                  placeholder="e.g. Sarah Johnson"
                  className="w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  AI Provider
                </label>
                <div className="flex items-center gap-1 rounded-lg p-1 w-fit" style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                  {(['anthropic', 'openai'] as const).map((p) => (
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
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Raw Client Input
                </label>
                <textarea
                  className="w-full min-h-[200px] px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent font-mono leading-relaxed transition-colors"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                  placeholder="Paste Upwork chat, transcript, or BD notes here…"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                />
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                  PII is stripped before extraction. Raw input never reaches the LLM directly.
                </p>
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
                                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatBytes(file.size)}</p>
                                </div>
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

        {/* Navigation */}
        <div className="flex items-center gap-3 mt-8 pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} className="gap-1.5">
              <ArrowLeft size={14} />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => navigate('/projects')} className="gap-1.5">
              <ArrowLeft size={14} />
              Cancel
            </Button>
          )}
          <div className="flex-1" />
          {step < 2 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 ? !canStep1 : step === 1 ? !canStep2 : false}
              className="gap-1.5"
            >
              Continue
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button onClick={handleCreate} className="gap-1.5">
              Create Project
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
