import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  Plug,
  Eye,
  EyeOff,
  Loader,
  RefreshCw,
  Unplug,
  Link2,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingKey = 'anthropic_api_key' | 'openai_api_key' | 'clickup_api_key' | 'clickup_space_id';

interface SettingInfo {
  masked: string;
  set: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface ConnectorConfig {
  label: string;
  description: string;
  category: string;
  placeholder: string;
  accentColor: string;
  accentBorder: string;
  accentBg: string;
  logo: React.ReactNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(isoString: string): string {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Connector config ─────────────────────────────────────────────────────────

const CONNECTOR_CONFIG: Record<SettingKey, ConnectorConfig> = {
  anthropic_api_key: {
    label: 'Anthropic Claude',
    description: 'Powers brief extraction, epic generation, journey mapping, and task decomposition using Claude Sonnet.',
    category: 'AI Provider',
    placeholder: 'sk-ant-api03-…',
    accentColor: '#f97316',
    accentBorder: 'rgba(249,115,22,0.35)',
    accentBg: 'rgba(249,115,22,0.07)',
    logo: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8">
        <rect width="48" height="48" rx="12" fill="#CC785C" />
        <path d="M28.5 12h-3.8L18 36h4l1.5-4.5h7l1.5 4.5h4L28.5 12zm-4 16 2.5-7.5 2.5 7.5h-5z" fill="white" />
      </svg>
    ),
  },
  openai_api_key: {
    label: 'OpenAI GPT',
    description: 'Alternative AI provider using GPT-4o for generation and GPT-4o-mini for linting passes.',
    category: 'AI Provider',
    placeholder: 'sk-proj-…',
    accentColor: '#10b981',
    accentBorder: 'rgba(16,185,129,0.35)',
    accentBg: 'rgba(16,185,129,0.07)',
    logo: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8">
        <rect width="48" height="48" rx="12" fill="#1a1a1a" />
        <path d="M33.6 20.4a6.4 6.4 0 0 0-.55-5.24 6.5 6.5 0 0 0-7-3.12 6.4 6.4 0 0 0-4.82-2.14 6.5 6.5 0 0 0-6.19 4.5 6.4 6.4 0 0 0-4.27 3.1 6.5 6.5 0 0 0 .8 7.6 6.4 6.4 0 0 0 .55 5.24 6.5 6.5 0 0 0 7 3.12 6.4 6.4 0 0 0 4.82 2.14 6.5 6.5 0 0 0 6.2-4.5 6.4 6.4 0 0 0 4.26-3.1 6.5 6.5 0 0 0-.8-7.6zm-9.6 13.47a4.82 4.82 0 0 1-3.1-1.12l.15-.09 5.15-2.97a.85.85 0 0 0 .43-.74v-7.26l2.18 1.26a.08.08 0 0 1 .04.06v6a4.83 4.83 0 0 1-4.85 4.86zm-10.4-4.44a4.82 4.82 0 0 1-.58-3.25l.15.09 5.16 2.97a.85.85 0 0 0 .85 0l6.3-3.64v2.51a.08.08 0 0 1-.03.07L19.9 31.2a4.83 4.83 0 0 1-6.3-1.77zm-1.35-11.2a4.82 4.82 0 0 1 2.52-2.12v6.1a.85.85 0 0 0 .43.74l6.28 3.62-2.18 1.26a.08.08 0 0 1-.08 0l-5.2-3a4.83 4.83 0 0 1-1.77-6.6zm17.93 4.14-6.3-3.64 2.18-1.25a.08.08 0 0 1 .08 0l5.2 3a4.83 4.83 0 0 1-.75 8.72v-6.1a.85.85 0 0 0-.41-.73zm2.17-3.27-.15-.09-5.15-2.97a.85.85 0 0 0-.86 0l-6.28 3.62v-2.51a.08.08 0 0 1 .03-.07l5.2-3a4.83 4.83 0 0 1 7.21 5.02zm-13.63 4.48-2.18-1.25a.08.08 0 0 1-.04-.07v-6a4.83 4.83 0 0 1 7.93-3.71l-.15.09-5.15 2.97a.85.85 0 0 0-.43.74l-.03 7.23zm1.18-2.55 2.8-1.62 2.8 1.61v3.23l-2.8 1.62-2.8-1.62v-3.22z" fill="white" />
      </svg>
    ),
  },
  clickup_api_key: {
    label: 'ClickUp API Key',
    description: 'Pushes approved tasks to your ClickUp workspace during the sync step, with idempotent WBS ID mapping.',
    category: 'Project Management',
    placeholder: 'pk_…',
    accentColor: '#7c3aed',
    accentBorder: 'rgba(124,58,237,0.35)',
    accentBg: 'rgba(124,58,237,0.07)',
    logo: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8">
        <rect width="48" height="48" rx="12" fill="#7B68EE" />
        <path d="M12 31.5l4.5-4.5c2.1 2.1 4.2 3.2 7.5 3.2s5.4-1.1 7.5-3.2l4.5 4.5C33 34.8 28.8 36.7 24 36.7s-9-1.9-12-5.2z" fill="white" />
        <path d="M12 22.5l4.5 4.5c2.1-2.1 4.2-3.2 7.5-3.2s5.4 1.1 7.5 3.2l4.5-4.5C33 19.2 28.8 17.3 24 17.3s-9 1.9-12 5.2z" fill="#00D4CF" />
      </svg>
    ),
  },
  clickup_space_id: {
    label: 'ClickUp Space ID',
    description: 'The numeric Space ID where new project folders should be created. Find it in the URL when viewing a Space in ClickUp.',
    category: 'Project Management',
    placeholder: '90123456789',
    accentColor: '#7c3aed',
    accentBorder: 'rgba(124,58,237,0.35)',
    accentBg: 'rgba(124,58,237,0.07)',
    logo: (
      <svg viewBox="0 0 48 48" fill="none" className="w-8 h-8">
        <rect width="48" height="48" rx="12" fill="#7B68EE" />
        <path d="M12 31.5l4.5-4.5c2.1 2.1 4.2 3.2 7.5 3.2s5.4-1.1 7.5-3.2l4.5 4.5C33 34.8 28.8 36.7 24 36.7s-9-1.9-12-5.2z" fill="white" />
        <path d="M12 22.5l4.5 4.5c2.1-2.1 4.2-3.2 7.5-3.2s5.4 1.1 7.5 3.2l4.5-4.5C33 19.2 28.8 17.3 24 17.3s-9 1.9-12 5.2z" fill="#00D4CF" />
      </svg>
    ),
  },
};

// ─── ConnectorCard ────────────────────────────────────────────────────────────

function ConnectorCard({ keyName, info, onSaved }: { keyName: SettingKey; info: SettingInfo; onSaved: () => void }) {
  const cfg = CONNECTOR_CONFIG[keyName];
  const [connecting, setConnecting] = useState(false);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'disconnecting'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isConnected = info.set;

  async function handleConnect() {
    if (!draft.trim()) {
      setErrorMsg('Please paste your API key in the input first.');
      return;
    }
    setStatus('saving');
    setErrorMsg(null);
    try {
      await api.put(`/admin/settings/${keyName}`, { value: draft.trim() });
      setDraft('');
      setConnecting(false);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      setErrorMsg(msg);
    } finally {
      setStatus('idle');
    }
  }

  async function handleDisconnect() {
    setStatus('disconnecting');
    setErrorMsg(null);
    try {
      await api.del(`/admin/settings/${keyName}`);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Disconnect failed.';
      console.error('[ConnectorCard] disconnect failed:', err);
      setErrorMsg(msg);
    } finally {
      setStatus('idle');
    }
  }

  return (
    <motion.div
      layout
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card-alt) 100%)',
        border: `1px solid ${isConnected ? cfg.accentBorder : connecting ? cfg.accentBorder : 'var(--border)'}`,
        transition: 'border-color 0.25s',
      }}
    >
      {/* Card body */}
      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Top row: logo + status */}
        <div className="flex items-start justify-between">
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-overlay)', padding: '6px' }}>
            {cfg.logo}
          </div>
          {isConnected ? (
            <span
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ color: 'var(--success-text)', background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Connected
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ color: 'var(--text-dim)', background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-dim)' }} />
              Not connected
            </span>
          )}
        </div>

        {/* Labels */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{cfg.label}</span>
            <span
              className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: cfg.accentColor, background: cfg.accentBg, border: `1px solid ${cfg.accentBorder}` }}
            >
              {cfg.category}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{cfg.description}</p>
        </div>

        {/* Connected meta */}
        {isConnected && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px]"
            style={{ background: cfg.accentBg, border: `1px solid ${cfg.accentBorder}` }}
          >
            <Link2 size={10} style={{ color: cfg.accentColor, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>
              <span className="font-mono" style={{ color: cfg.accentColor }}>{info.masked}</span>
              {' '}· by {info.updatedBy} · {formatRelative(info.updatedAt)}
            </span>
          </div>
        )}

        {/* Inline connect form */}
        <AnimatePresence>
          {connecting && !isConnected && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div
                className="rounded-xl p-3 space-y-2"
                style={{ background: cfg.accentBg, border: `1px solid ${cfg.accentBorder}` }}
              >
                <label className="block text-[10px] font-semibold uppercase tracking-widest" style={{ color: cfg.accentColor }}>
                  API Key
                </label>
                <div className="relative">
                  <input
                    autoFocus
                    type={show ? 'text' : 'password'}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={cfg.placeholder}
                    className="w-full px-3 py-2 pr-9 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleConnect(); if (e.key === 'Escape') { setConnecting(false); setDraft(''); } }}
                  />
                  <button type="button" onClick={() => setShow((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }}>
                    {show ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                {errorMsg && (
                  <div className="text-[11px] px-2 py-1.5 rounded-md"
                    style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>
                    ✗ {errorMsg}
                  </div>
                )}
                <div className="flex gap-2 pt-0.5">
                  <Button size="sm" className="gap-1.5 flex-1" onClick={() => void handleConnect()} disabled={!draft.trim() || status !== 'idle'}>
                    {status === 'saving' ? <Loader size={11} className="animate-spin" /> : <Save size={11} />}
                    Save & Connect
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setConnecting(false); setDraft(''); setErrorMsg(null); }}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer action */}
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {isConnected ? (
          <>
            <button
              className="flex items-center gap-1.5 text-xs font-medium transition-colors"
              style={{ color: cfg.accentColor }}
              onClick={() => { setConnecting(true); }}
            >
              <RefreshCw size={11} />
              Rotate key
            </button>
            <button
              className="flex items-center gap-1.5 text-xs font-medium transition-colors"
              style={{ color: '#f87171' }}
              onClick={() => void handleDisconnect()}
              disabled={status !== 'idle'}
            >
              {status === 'disconnecting' ? <Loader size={11} className="animate-spin" /> : <Unplug size={11} />}
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="flex items-center gap-1.5 text-xs font-semibold w-full justify-center py-1 rounded-lg transition-all"
            style={{
              color: connecting ? 'var(--text-dim)' : cfg.accentColor,
              background: connecting ? 'transparent' : cfg.accentBg,
              border: `1px solid ${connecting ? 'transparent' : cfg.accentBorder}`,
            }}
            onClick={() => setConnecting((v) => !v)}
          >
            <Plug size={11} />
            {connecting ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminIntegrationsPage() {
  const [apiKeyInfo, setApiKeyInfo] = useState<Record<string, SettingInfo>>({});
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);

  async function loadApiKeys() {
    setIsLoadingKeys(true);
    try {
      const data = await api.get<Record<string, SettingInfo>>('/admin/settings');
      setApiKeyInfo(data);
    } finally {
      setIsLoadingKeys(false);
    }
  }

  useEffect(() => { void loadApiKeys(); }, []);

  return (
    <motion.div
      className="px-8 py-10 h-full overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--accent-text)' }}>
          <Settings2 size={14} />
          <span className="text-xs font-semibold uppercase tracking-widest">Admin / Integrations</span>
        </div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Integrations</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Connect AI providers and project management tools.
        </p>
      </div>

      {isLoadingKeys ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={18} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
        </div>
      ) : (
        <>
          {/* Section: AI Providers */}
          <div className="mb-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>
              AI Providers
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['anthropic_api_key', 'openai_api_key'] as SettingKey[]).map((keyName) => (
                <ConnectorCard
                  key={keyName}
                  keyName={keyName}
                  info={apiKeyInfo[keyName] ?? { masked: '', set: false, updatedAt: '', updatedBy: '' }}
                  onSaved={() => void loadApiKeys()}
                />
              ))}
            </div>
          </div>

          {/* Section: Project Management */}
          <div className="mb-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>
              Project Management
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['clickup_api_key', 'clickup_space_id'] as SettingKey[]).map((keyName) => (
                <ConnectorCard
                  key={keyName}
                  keyName={keyName}
                  info={apiKeyInfo[keyName] ?? { masked: '', set: false, updatedAt: '', updatedBy: '' }}
                  onSaved={() => void loadApiKeys()}
                />
              ))}
            </div>
          </div>

          <div className="px-4 py-3 rounded-xl text-xs"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--accent-text)' }} className="font-semibold">Security: </span>
            Keys are encrypted at rest and never returned in full to the client. Changes take effect immediately — no restart required.
          </div>
        </>
      )}
    </motion.div>
  );
}
