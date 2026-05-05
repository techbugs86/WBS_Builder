import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  Loader,
  Users,
  UserPlus,
  Trash2,
  ShieldCheck,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  X,
  Mail,
  Calendar,
  Crown,
  User,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'pm';
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  owner: { label: 'Owner',  color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: 'var(--warning-border)', icon: <Crown size={9} /> },
  admin: { label: 'Admin',  color: 'var(--accent-text)', bg: 'rgba(139,92,246,0.1)',  border: 'rgba(139,92,246,0.25)', icon: <ShieldCheck size={9} /> },
  pm:    { label: 'PM',     color: 'var(--text-secondary)', bg: 'var(--bg-overlay-md)', border: 'var(--border)', icon: <User size={9} /> },
};

function formatDate(isoString: string): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function avatarInitials(name: string): string {
  return name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, role, size = 'md' }: { name: string; role: string; size?: 'sm' | 'md' | 'lg' }) {
  const rs = ROLE_STYLE[role] ?? ROLE_STYLE['pm']!;
  const dims = size === 'lg' ? 'w-14 h-14 text-base' : size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div
      className={`${dims} rounded-full flex items-center justify-center shrink-0 font-bold`}
      style={{ background: rs.bg, border: `1.5px solid ${rs.border}`, color: rs.color }}
    >
      {avatarInitials(name)}
    </div>
  );
}

// ─── RoleBadge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const rs = ROLE_STYLE[role] ?? ROLE_STYLE['pm']!;
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
      style={{ color: rs.color, background: rs.bg, border: `1px solid ${rs.border}` }}
    >
      {rs.icon}
      {rs.label}
    </span>
  );
}

// ─── MemberList ───────────────────────────────────────────────────────────────

function MemberList({
  users,
  selectedId,
  selfId,
  onSelect,
  onInvite,
}: {
  users: UserInfo[];
  selectedId: string | null;
  selfId: string | undefined;
  onSelect: (u: UserInfo) => void;
  onInvite: () => void;
}) {
  return (
    <div className="flex flex-col h-full" style={{ borderRight: '1px solid var(--border-subtle)' }}>
      {/* List header */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {users.length} member{users.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onInvite}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
          style={{ color: 'var(--accent-text)', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}
        >
          <UserPlus size={11} />
          Invite
        </button>
      </div>

      {/* Members */}
      <div className="flex-1 overflow-y-auto py-2">
        {users.map((u) => {
          const isSelected = u.id === selectedId;
          const isSelf = u.id === selfId;
          return (
            <button
              key={u.id}
              onClick={() => onSelect(u)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all relative"
              style={{
                background: isSelected ? 'rgba(124,58,237,0.1)' : 'transparent',
                borderRight: isSelected ? '2px solid #8b5cf6' : '2px solid transparent',
              }}
            >
              <Avatar name={u.name} role={u.role} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold truncate" style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {u.name}
                  </span>
                  {isSelf && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ color: '#6ee7b7', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      you
                    </span>
                  )}
                </div>
                <RoleBadge role={u.role} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── DetailPanel ─────────────────────────────────────────────────────────────

function DetailPanel({
  user,
  isSelf,
  onUpdated,
  onClose,
}: {
  user: UserInfo;
  isSelf: boolean;
  onUpdated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'resetting' | 'deleting'>('idle');
  const [error, setError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  // Reset local state when user changes
  useEffect(() => {
    setName(user.name);
    setRole(user.role);
    setNewPassword('');
    setError('');
    setPwSuccess(false);
  }, [user.id]);

  const hasChanges = name !== user.name || role !== user.role;
  const rs = ROLE_STYLE[user.role] ?? ROLE_STYLE['pm']!;

  async function handleSave() {
    setError('');
    setStatus('saving');
    try {
      await api.patch(`/admin/users/${user.id}`, { name, role });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setStatus('idle');
    }
  }

  async function handleResetPassword() {
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError('');
    setStatus('resetting');
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password: newPassword });
      setNewPassword('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setStatus('idle');
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${user.name} from this organisation? This cannot be undone.`)) return;
    setError('');
    setStatus('deleting');
    try {
      await api.del(`/admin/users/${user.id}`);
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setStatus('idle');
    }
  }

  return (
    <motion.div
      key={user.id}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col h-full overflow-y-auto"
    >
      {/* Profile header */}
      <div className="px-8 py-6 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-start justify-between mb-4">
          <Avatar name={user.name} role={user.role} size="lg" />
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-dim)' }}>
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{user.name}</h2>
          {isSelf && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#6ee7b7', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              you
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RoleBadge role={user.role} />
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Mail size={10} />
            {user.email}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Calendar size={10} />
            Joined {formatDate(user.createdAt)}
          </span>
        </div>
      </div>

      {/* Edit fields */}
      <div className="flex-1 px-8 py-6 space-y-6">

        {/* Identity */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>Identity</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserInfo['role'])}
                disabled={isSelf}
                className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-40"
                style={{ background: 'var(--bg-input)', border: `1px solid ${isSelf ? 'var(--border)' : rs.border}` }}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="pm">PM</option>
              </select>
              {isSelf && <p className="text-[9px] mt-1" style={{ color: 'var(--text-dim)' }}>Cannot change your own role.</p>}
            </div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => void handleSave()} disabled={!hasChanges || status !== 'idle'}>
            {status === 'saving' ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </Button>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* Security */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>Security</p>
          <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Reset Password</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwSuccess(false); }}
                placeholder="New password (min 8 chars)"
                className="w-full px-3 py-2 pr-9 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }}>
                {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <Button size="sm" variant="ghost" className="gap-1.5 shrink-0"
              onClick={() => void handleResetPassword()}
              disabled={!newPassword || status !== 'idle'}>
              {status === 'resetting' ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Reset
            </Button>
          </div>
          <AnimatePresence>
            {pwSuccess && (
              <motion.p
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-xs mt-2 px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--success-text)', background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}
              >
                Password updated successfully.
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ color: 'var(--error-text)', background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Danger zone */}
        {!isSelf && (
          <>
            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>Danger Zone</p>
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}
              >
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--error-text)' }}>Remove from organisation</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>This will revoke all access immediately.</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-[var(--error-text)] hover:text-[var(--error-text)] hover:bg-red-500/10 shrink-0"
                  onClick={() => void handleDelete()}
                  disabled={status !== 'idle'}
                >
                  {status === 'deleting' ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Remove
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── InvitePanel ──────────────────────────────────────────────────────────────

function InvitePanel({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'pm' as UserInfo['role'], password: '', confirm: '' });
  const [status, setStatus] = useState<'idle' | 'creating'>('idle');
  const [error, setError] = useState('');

  function setField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError('All fields are required.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setStatus('creating');
    try {
      await api.post('/admin/users', { name: form.name.trim(), email: form.email.trim(), role: form.role, password: form.password });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setStatus('idle');
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-500';
  const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)' };

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col h-full overflow-y-auto"
    >
      {/* Header */}
      <div className="px-8 py-6 shrink-0 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Invite Member</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Add someone to your organisation.</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--text-dim)' }}>
          <X size={14} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 px-8 py-6 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Full Name</label>
            <input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Jane Smith" className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
            <select value={form.role} onChange={(e) => setField('role', e.target.value)} className={inputCls} style={inputStyle}>
              <option value="pm">PM</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Email</label>
          <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="jane@yourcompany.com" className={inputCls} style={inputStyle} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
            <input type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} placeholder="Min 8 characters" className={`${inputCls} font-mono`} style={inputStyle} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>Confirm</label>
            <input type="password" value={form.confirm} onChange={(e) => setField('confirm', e.target.value)} placeholder="Repeat password" className={`${inputCls} font-mono`} style={inputStyle} />
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ color: 'var(--error-text)', background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}>
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex gap-2 pt-2">
          <Button type="submit" size="sm" className="gap-1.5 flex-1" disabled={status !== 'idle'}>
            {status === 'creating' ? <Loader size={12} className="animate-spin" /> : <UserPlus size={12} />}
            Create & Invite
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyRight({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}
      >
        <Users size={22} style={{ color: '#7c3aed', opacity: 0.5 }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Select a member</p>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>or invite someone new to your organisation</p>
      </div>
      <button
        onClick={onInvite}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all"
        style={{ color: 'var(--accent-text)', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}
      >
        <UserPlus size={12} />
        Invite Member
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const currentUser = useProjectStore((s) => s.currentUser);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<UserInfo | null>(null);
  const [inviting, setInviting] = useState(false);

  async function loadUsers() {
    setIsLoading(true);
    try {
      const data = await api.get<UserInfo[]>('/admin/users');
      setUsers(data);
      // Keep selected in sync if user was updated
      if (selected) {
        const refreshed = data.find((u) => u.id === selected.id);
        setSelected(refreshed ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  function handleSelect(u: UserInfo) {
    setInviting(false);
    setSelected(u);
  }

  function handleInvite() {
    setSelected(null);
    setInviting(true);
  }

  const adminCount = users.filter((u) => u.role === 'admin' || u.role === 'owner').length;
  const pmCount = users.filter((u) => u.role === 'pm').length;

  return (
    <motion.div
      className="h-full flex flex-col overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Page header */}
      <div className="px-8 py-6 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--accent-text)' }}>
          <Settings2 size={13} />
          <span className="text-xs font-semibold uppercase tracking-widest">Admin / Team</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Team</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Manage members and access within your organisation.</p>
          </div>
          {/* Stats */}
          {!isLoading && (
            <div className="flex items-center gap-2 mb-0.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', color: 'var(--accent-text)' }}>
                <ShieldCheck size={11} />
                {adminCount} admin{adminCount !== 1 ? 's' : ''}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--accent-text)' }}>
                <Users size={11} />
                {pmCount} PM{pmCount !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Two-panel body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader size={18} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: member list — fixed width */}
          <div className="w-64 shrink-0 overflow-hidden">
            <MemberList
              users={users}
              selectedId={selected?.id ?? null}
              selfId={currentUser?.id}
              onSelect={handleSelect}
              onInvite={handleInvite}
            />
          </div>

          {/* Right: detail / invite / empty */}
          <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-deep)' }}>
            <AnimatePresence mode="wait">
              {inviting ? (
                <InvitePanel
                  key="invite"
                  onCreated={() => { void loadUsers(); }}
                  onClose={() => setInviting(false)}
                />
              ) : selected ? (
                <DetailPanel
                  key={selected.id}
                  user={selected}
                  isSelf={selected.id === currentUser?.id}
                  onUpdated={() => { void loadUsers(); }}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <EmptyRight key="empty" onInvite={handleInvite} />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.div>
  );
}
