import { useState } from 'react';
import { NavLink, useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ClipboardList,
  Layers,
  Map,
  CheckSquare,
  RefreshCw,
  Zap,
  User,
  LayoutGrid,
  Plus,
  Building,
  ChevronLeft,
  CheckCircle2,
  Settings2,
  LogOut,
  Sun,
  Moon,
  Plug,
  Users,
  FileText,
  Lock,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { usePipelineStatus } from '../hooks/usePipelineStatus';
import type { Stage } from '../lib/pipelineStatus';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { ConfirmDialog } from './ConfirmDialog';

interface NavItem {
  to: (id: string) => string;
  label: string;
  icon: React.ReactNode;
  step: number;
  pathKey: string;
  stage: Stage;
}

const PROJECT_NAV_ITEMS: NavItem[] = [
  { to: (id) => `/projects/${id}/definition`, label: 'Definition',   icon: <Building size={14} />,     step: 1, pathKey: 'definition', stage: 'definition' },
  { to: (id) => `/projects/${id}/brief`,      label: 'Brief Review', icon: <ClipboardList size={14} />, step: 2, pathKey: 'brief',      stage: 'brief' },
  { to: (id) => `/projects/${id}/epics`,      label: 'Epics',        icon: <Layers size={14} />,        step: 3, pathKey: 'epics',      stage: 'epics' },
  { to: (id) => `/projects/${id}/journeys`,   label: 'Journeys',     icon: <Map size={14} />,           step: 4, pathKey: 'journeys',   stage: 'journeys' },
  { to: (id) => `/projects/${id}/tasks`,      label: 'Tasks',        icon: <CheckSquare size={14} />,   step: 5, pathKey: 'tasks',      stage: 'tasks' },
  { to: (id) => `/projects/${id}/sync`,       label: 'Sync',         icon: <RefreshCw size={14} />,     step: 6, pathKey: 'sync',       stage: 'sync' },
];

function getActiveStep(pathname: string): number {
  if (pathname.includes('/sync'))       return 6;
  if (pathname.includes('/tasks'))      return 5;
  if (pathname.includes('/journeys'))   return 4;
  if (pathname.includes('/epics'))      return 3;
  if (pathname.includes('/brief'))      return 2;
  if (pathname.includes('/definition')) return 1;
  return 0;
}

const ROLE_BADGE: Record<string, { label: string }> = {
  owner: { label: 'owner' },
  admin: { label: 'admin' },
  pm:    { label: 'pm' },
};

// ─── Shared nav item styles ───────────────────────────────────────────────────

function activeStyle(isActive: boolean): React.CSSProperties {
  return {
    color:      isActive ? 'var(--text-primary)' : 'var(--text-muted)',
    background: isActive ? 'var(--bg-overlay-md)' : 'transparent',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const definition     = useProjectStore((s) => s.definition);
  const savedProjects  = useProjectStore((s) => s.savedProjects);
  const currentUser    = useProjectStore((s) => s.currentUser);
  const logout         = useProjectStore((s) => s.logout);
  const theme          = useProjectStore((s) => s.theme);
  const toggleTheme    = useProjectStore((s) => s.toggleTheme);
  const { canAccess }  = usePipelineStatus();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const isInsideProject  = Boolean(projectId);
  const isInsideSettings = location.pathname.startsWith('/admin/settings');
  const activeStep       = getActiveStep(location.pathname);

  const projectName   = isInsideProject
    ? (savedProjects.find((p) => p.id === projectId)?.name ?? definition.name)
    : '';
  const projectClient = isInsideProject
    ? (savedProjects.find((p) => p.id === projectId)?.client ?? definition.client)
    : '';

  return (
    <aside
      className="w-56 h-full flex flex-col shrink-0 relative"
      style={{
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {/* Logo */}
      <div className="relative px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'var(--accent)',
              boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
            }}
          >
            <Zap size={13} className="text-white" />
          </div>
          <p className="text-sm font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
            WBS Builder
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">

        {/* ── Settings sub-nav ── */}
        {isInsideSettings ? (
          <>
            <button
              onClick={() => navigate('/projects')}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs font-medium transition-colors mb-2"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <ChevronLeft size={13} />
              <span>All Projects</span>
            </button>

            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              Settings
            </p>
            <ul className="space-y-0.5">
              {([
                { to: '/admin/settings/integrations', icon: <Plug size={14} />,     label: 'Integrations' },
                { to: '/admin/settings/users',        icon: <Users size={14} />,    label: 'Team' },
                { to: '/admin/settings/prompts',      icon: <FileText size={14} />, label: 'Prompt Config' },
              ] as { to: string; icon: React.ReactNode; label: string }[]).map((item) => {
                const isActive = location.pathname === item.to;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className="relative flex items-center gap-2.5 px-2 py-2 rounded-md text-xs font-medium transition-colors group"
                      style={activeStyle(isActive)}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebar-active"
                          className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                          style={{ background: 'var(--accent)' }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                      )}
                      <span className="shrink-0 ml-1" style={{ color: isActive ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </>

        /* ── Project pipeline nav ── */
        ) : isInsideProject ? (
          <>
            <button
              onClick={() => navigate('/projects')}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs font-medium transition-colors mb-2"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <ChevronLeft size={13} />
              <span>All Projects</span>
            </button>

            {/* Project chip */}
            <div
              className="mx-1 mb-3 px-3 py-2.5 rounded-lg"
              style={{ background: 'var(--bg-overlay-md)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {projectName || 'Untitled'}
              </p>
              {projectClient && (
                <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {projectClient}
                </p>
              )}
            </div>

            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              Pipeline
            </p>
            <ul className="space-y-0.5">
              {(() => {
                // Step 6 (Sync) shows the green "completed" check when the project's
                // status is 'synced' — the backend sets this after a successful sync.
                const isProjectSynced = savedProjects.find((p) => p.id === projectId)?.status === 'synced';
                return PROJECT_NAV_ITEMS.map((item) => {
                const isActive    = location.pathname.includes(`/${item.pathKey}`);
                const isCompleted = item.step < activeStep || (item.step === 6 && isProjectSynced);
                const access      = canAccess(item.stage);
                const isLocked    = !access.allowed && !isActive;

                const itemClasses = 'relative flex items-center gap-2.5 px-2 py-2 rounded-md text-xs font-medium transition-colors group';
                const itemStyle: React.CSSProperties = {
                  color: isActive
                    ? 'var(--text-primary)'
                    : isLocked
                    ? 'var(--text-dim)'
                    : isCompleted
                    ? 'var(--success-text)'
                    : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-overlay-md)' : 'transparent',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.55 : 1,
                };

                const iconNode = (
                  <span
                    className="shrink-0 ml-1"
                    style={{
                      color: isActive
                        ? 'var(--accent-text)'
                        : isLocked
                        ? 'var(--text-dim)'
                        : isCompleted
                        ? 'var(--success-text)'
                        : 'var(--text-dim)',
                    }}
                  >
                    {isLocked ? <Lock size={13} /> : isCompleted ? <CheckCircle2 size={14} /> : item.icon}
                  </span>
                );

                const stepBadge = (
                  <span
                    className="text-[10px] w-4 h-4 rounded-full flex items-center justify-center shrink-0 font-mono"
                    style={{
                      background: isActive
                        ? 'rgba(124,58,237,0.15)'
                        : isCompleted
                        ? 'var(--success-bg)'
                        : 'var(--bg-overlay-md)',
                      color: isActive
                        ? 'var(--accent-text)'
                        : isCompleted
                        ? 'var(--success-text)'
                        : 'var(--text-dim)',
                      border: `1px solid ${isActive
                        ? 'rgba(124,58,237,0.25)'
                        : isCompleted
                        ? 'var(--success-border)'
                        : 'var(--border)'}`,
                    }}
                  >
                    {item.step}
                  </span>
                );

                const innerContent = (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                        style={{ background: 'var(--accent)' }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    {iconNode}
                    <span className="flex-1 truncate">{item.label}</span>
                    {stepBadge}
                  </>
                );

                if (isLocked) {
                  return (
                    <li key={item.pathKey}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className={itemClasses}
                            style={itemStyle}
                          >
                            {innerContent}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {access.reason || `Approve previous stage to unlock.`}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }

                return (
                  <li key={item.pathKey}>
                    <NavLink
                      to={item.to(projectId!)}
                      className={itemClasses}
                      style={itemStyle}
                    >
                      {innerContent}
                    </NavLink>
                  </li>
                );
              });
              })()}
            </ul>
          </>

        /* ── Global nav ── */
        ) : (
          <>
            {[
              { to: '/projects',     icon: <LayoutGrid size={14} />, label: 'All Projects' },
              { to: '/projects/new', icon: <Plus size={14} />,       label: 'New Project' },
            ].map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="relative flex items-center gap-2.5 px-2 py-2 rounded-md text-xs font-medium transition-colors mb-0.5 group"
                  style={activeStyle(isActive)}
                  end
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                      style={{ background: 'var(--accent)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="shrink-0 ml-1" style={{ color: isActive ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                </NavLink>
              );
            })}

            {/* Admin section visible to all authenticated users — every role
                has full backend permissions per middleware/requireRole.ts. */}
            {currentUser && (
              <>
                <div className="px-2 pt-4 pb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
                    Admin
                  </p>
                </div>
                {(() => {
                  const isActive = location.pathname.startsWith('/admin');
                  return (
                    <NavLink
                      to="/admin/settings"
                      className="relative flex items-center gap-2.5 px-2 py-2 rounded-md text-xs font-medium transition-colors mb-0.5"
                      style={activeStyle(isActive)}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebar-active"
                          className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                          style={{ background: 'var(--accent)' }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                      )}
                      <span className="shrink-0 ml-1" style={{ color: isActive ? 'var(--accent-text)' : 'var(--text-dim)' }}>
                        <Settings2 size={14} />
                      </span>
                      <span className="flex-1 truncate">Settings</span>
                    </NavLink>
                  );
                })()}
              </>
            )}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--bg-overlay-md)', border: '1px solid var(--border)' }}
          >
            <User size={11} style={{ color: 'var(--text-secondary)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
              {currentUser?.name ?? 'Guest'}
            </p>
            {currentUser && (
              <span
                className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 rounded"
                style={{
                  color: currentUser.role !== 'pm' ? 'var(--accent-text)' : 'var(--text-muted)',
                  background: currentUser.role !== 'pm' ? 'rgba(124,58,237,0.1)' : 'var(--bg-overlay-md)',
                  border: `1px solid ${currentUser.role !== 'pm' ? 'rgba(124,58,237,0.2)' : 'var(--border)'}`,
                }}
              >
                {ROLE_BADGE[currentUser.role]?.label ?? currentUser.role}
              </span>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className="shrink-0 p-1 rounded transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          </button>
          <button
            onClick={() => setSignOutOpen(true)}
            className="shrink-0 p-1 rounded transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--error-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            title="Sign out"
          >
            <LogOut size={12} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <kbd
            className="text-[9px] font-mono rounded px-1 py-0.5"
            style={{ background: 'var(--bg-overlay-md)', border: '1px solid var(--border-dashed)', color: 'var(--text-muted)' }}
          >⌘K</kbd>
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>command palette</span>
        </div>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out?"
        message="Your unsaved changes on the active project will be saved automatically before you're returned to the login screen."
        detail={currentUser?.email}
        confirmLabel="Save & sign out"
        cancelLabel="Stay signed in"
        variant="destructive"
        onConfirm={async () => {
          await logout();
          setSignOutOpen(false);
          navigate('/login');
        }}
        onCancel={() => setSignOutOpen(false)}
      />
    </aside>
  );
}
