import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  FolderOpen,
  Layers,
  CheckSquare,
  RefreshCw,
  Clock,
  ChevronRight,
  LayoutGrid,
  Sparkles,
  Trash2,
  Search,
  X,
} from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { SavedProject } from '../data/mockData';

const STATUS_CONFIG: Record<
  SavedProject['status'],
  { label: string; variant: 'approved' | 'pending' | 'flagged' | 'default' | 'muted'; dot: string }
> = {
  synced:    { label: 'Synced',     variant: 'approved', dot: 'var(--success)' },
  approved:  { label: 'Approved',   variant: 'default',  dot: 'var(--accent)' },
  in_review: { label: 'In Review',  variant: 'pending',  dot: 'var(--warning)' },
  draft:     { label: 'Draft',      variant: 'muted',    dot: 'var(--text-dim)' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ProjectCard({
  project,
  index,
  canDelete,
  onRequestDelete,
}: {
  project: SavedProject;
  index: number;
  canDelete: boolean;
  onRequestDelete: (project: SavedProject) => void;
}) {
  const navigate = useNavigate();
  const cfg = STATUS_CONFIG[project.status];
  const syncPct = project.taskCount > 0 ? (project.syncedCount / project.taskCount) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.06 }}
      whileHover={{ y: -2 }}
      className="rounded-xl cursor-pointer group relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.3)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(124,58,237,0.15)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
      onClick={() => navigate(`/projects/${project.id}/brief`)}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.4), transparent)' }}
      />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h3
              className="text-sm font-semibold truncate mb-0.5 transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              {project.name}
            </h3>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{project.client}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}` }}
            />
            <Badge variant={cfg.variant}>{cfg.label}</Badge>
            {canDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRequestDelete(project); }}
                className="ml-1 p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:bg-red-900/20"
                style={{ color: 'var(--text-dim)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
                aria-label={`Delete ${project.name}`}
                title="Delete project"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
            <Layers size={11} />
            <span className="text-[11px]">{project.epicCount} epics</span>
          </div>
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
            <CheckSquare size={11} />
            <span className="text-[11px]">{project.taskCount} tasks</span>
          </div>
          {project.syncedCount > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: 'var(--success-text)' }}>
              <RefreshCw size={11} />
              <span className="text-[11px]">{project.syncedCount} synced</span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {project.taskCount > 0 && (
          <div className="mb-4">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'var(--accent)' }}
                initial={{ width: 0 }}
                animate={{ width: `${syncPct}%` }}
                transition={{ duration: 0.8, delay: index * 0.06 + 0.2, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
            <Clock size={11} />
            <span className="text-[10px]">Updated {formatDate(project.updatedAt)}</span>
          </div>
          <div
            className="flex items-center gap-1 text-[10px] font-medium transition-colors"
            style={{ color: 'var(--text-dim)' }}
          >
            <span className="group-hover:text-violet-400 transition-colors">Open</span>
            <ChevronRight size={12} className="group-hover:text-violet-400 transition-colors" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const savedProjects = useProjectStore((s) => s.savedProjects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUser = useProjectStore((s) => s.currentUser);

  // All authenticated org members can delete — see middleware/requireRole.ts
  const canDelete = Boolean(currentUser);
  const [pendingDelete, setPendingDelete] = useState<SavedProject | null>(null);

  // Client-side search + status filter. We deliberately don't paginate
  // server-side: agencies typically have <100 projects total, so fetching
  // everything once and filtering in-memory is faster + simpler than
  // round-tripping for every keystroke.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SavedProject['status']>('all');

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const totalTasks = savedProjects.reduce((sum, p) => sum + p.taskCount, 0);
  const totalSynced = savedProjects.reduce((sum, p) => sum + p.syncedCount, 0);
  const activeProjects = savedProjects.filter((p) => p.status !== 'draft').length;

  const searchLower = search.trim().toLowerCase();
  const filteredProjects = savedProjects.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (!searchLower) return true;
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.client.toLowerCase().includes(searchLower)
    );
  });

  // Counts per status (for filter pill badges). Computed off the unfiltered
  // list so the user can see "Synced (3)" before filtering down to it.
  const statusCounts = {
    all: savedProjects.length,
    draft: savedProjects.filter((p) => p.status === 'draft').length,
    in_review: savedProjects.filter((p) => p.status === 'in_review').length,
    approved: savedProjects.filter((p) => p.status === 'approved').length,
    synced: savedProjects.filter((p) => p.status === 'synced').length,
  } as const;

  const stats = [
    { label: 'Total Projects', value: savedProjects.length, icon: FolderOpen, color: 'var(--accent-text)', glow: 'rgba(124,58,237,0.12)' },
    { label: 'Active Plans', value: activeProjects, icon: Layers, color: 'var(--accent-text)', glow: 'rgba(124,58,237,0.12)' },
    { label: 'Tasks Synced', value: `${totalSynced} / ${totalTasks}`, icon: RefreshCw, color: 'var(--success-text)', glow: 'var(--success-bg)' },
  ];

  return (
    <motion.div
      className="h-full overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <LayoutGrid size={14} style={{ color: 'var(--accent-text)' }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-text)' }}>All Projects</span>
            </div>
            <h1 className="text-3xl font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>Project Plans</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Saved WBS project plans ready to review or sync.</p>
          </div>
          <Button onClick={() => navigate('/projects/new')} className="gap-2 shadow-lg shadow-violet-900/30">
            <Plus size={14} />
            New Project
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.06 }}
              className="rounded-xl px-5 py-4 flex items-center gap-4 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-alt) 100%)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at 0% 50%, ${stat.glow} 0%, transparent 60%)` }}
              />
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 relative"
                style={{ background: stat.glow, border: `1px solid ${stat.color}22` }}
              >
                <stat.icon size={16} style={{ color: stat.color }} />
              </div>
              <div className="relative">
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stat.value}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{stat.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Search + status filter bar — only shown when there's something to filter.
            Search matches project name OR client name (case-insensitive).
            Status pills act like quick filters with live counts. */}
        {savedProjects.length > 0 && (
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            {/* Status pills */}
            <div
              className="flex items-center gap-1 rounded-lg p-1"
              style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}
            >
              {([
                { value: 'all',       label: 'All' },
                { value: 'draft',     label: 'Draft' },
                { value: 'in_review', label: 'In Review' },
                { value: 'approved',  label: 'Approved' },
                { value: 'synced',    label: 'Synced' },
              ] as const).map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer flex items-center gap-1.5"
                  style={statusFilter === tab.value ? {
                    background: 'rgba(124,58,237,0.15)', color: 'var(--accent-text)', border: '1px solid rgba(124,58,237,0.3)',
                  } : { color: 'var(--text-muted)', border: '1px solid transparent' }}
                >
                  {tab.label}
                  <span
                    className="text-[10px] font-mono px-1 rounded"
                    style={{
                      background: statusFilter === tab.value ? 'rgba(124,58,237,0.25)' : 'var(--bg-overlay-md)',
                      color: statusFilter === tab.value ? 'var(--accent-text)' : 'var(--text-dim)',
                    }}
                  >
                    {statusCounts[tab.value]}
                  </span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Search by project or client name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2 rounded-lg text-xs placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/5"
                  style={{ color: 'var(--text-dim)' }}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
              {filteredProjects.length} of {savedProjects.length}
            </span>
          </div>
        )}

        {/* Project grid */}
        {savedProjects.length === 0 ? (
          // No projects exist at all — first-time state
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
            >
              <Sparkles size={22} style={{ color: 'var(--accent-text)' }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No projects yet</p>
            <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>Define a project to start generating your WBS.</p>
            <Button onClick={() => navigate('/projects/new')} className="gap-2">
              <Plus size={13} />
              New Project
            </Button>
          </div>
        ) : filteredProjects.length === 0 ? (
          // Projects exist but the current filter excludes all of them
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}
            >
              <Search size={18} style={{ color: 'var(--text-dim)' }} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>No projects match your filters</p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Try adjusting the search term or status filter.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(''); setStatusFilter('all'); }}
              className="gap-1.5"
            >
              <X size={12} />
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                canDelete={canDelete}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete project?"
        message="This permanently removes the project and all of its briefs, epics, journeys, tasks, and ClickUp mappings. This action cannot be undone."
        detail={pendingDelete?.name}
        matchText={pendingDelete?.name}
        confirmLabel="Delete project"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteProject(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
}
