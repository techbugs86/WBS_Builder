import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader } from 'lucide-react';
import './index.css';
import { App } from './App';
import { ProjectsPage } from './pages/ProjectsPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectDefinitionPage } from './pages/ProjectDefinitionPage';
import { BriefPage } from './pages/BriefPage';
import { EpicsPage } from './pages/EpicsPage';
import { JourneysPage } from './pages/JourneysPage';
import { TasksPage } from './pages/TasksPage';
import { SyncPage } from './pages/SyncPage';
import { LoginPage } from './pages/LoginPage';
import { AdminIntegrationsPage } from './pages/AdminIntegrationsPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminPromptsPage } from './pages/AdminPromptsPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { StageGuard } from './components/StageGuard';
import { useProjectStore } from './store/useProjectStore';
import { Outlet, useParams } from 'react-router-dom';
import { installGlobalErrorReporter } from './lib/errorReporter';
import { ErrorBoundary } from './components/ErrorBoundary';

installGlobalErrorReporter();

const queryClient = new QueryClient();

/**
 * Loads project data once when entering the workspace. Children render only
 * after data hydrates so StageGuard never evaluates against stale state.
 */
function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const loadProject = useProjectStore((s) => s.loadProject);
  const isLoadingProject = useProjectStore((s) => s.isLoadingProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectLoadError = useProjectStore((s) => s.projectLoadError);

  useEffect(() => {
    if (id) void loadProject(id);
  }, [id, loadProject]);

  // 404 / project missing → render the not-found screen instead of routing
  // to a child route that would otherwise show stale data from a previous load.
  if (projectLoadError && projectLoadError.id === id) {
    return <ProjectNotFound projectId={id} message={projectLoadError.message} />;
  }

  const isHydrating = isLoadingProject || activeProjectId !== id;
  if (isHydrating) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader size={20} className="animate-spin" style={{ color: 'var(--text-dim)' }} />
      </div>
    );
  }

  return <Outlet />;
}

/**
 * Friendly fallback shown when the URL contains an id that doesn't exist or
 * the user no longer has access. Includes a quick way back to the project
 * list. The failure is already in errors.log via loadProject's catch.
 */
function ProjectNotFound({ projectId, message }: { projectId: string | undefined; message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div
        className="max-w-md w-full rounded-2xl p-7 text-center"
        style={{
          background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))',
          border: '1px solid var(--error-border)',
          boxShadow: '0 12px 40px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
          }}
        >
          <span style={{ color: 'var(--error-text)', fontSize: 28, lineHeight: 1, fontWeight: 700 }}>!</span>
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Project not found
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          The project you're trying to open doesn't exist, has been deleted, or you don't have access.
        </p>
        {projectId && (
          <p
            className="text-[11px] font-mono px-3 py-2 rounded-lg mb-5 break-all"
            style={{
              background: 'var(--bg-overlay-md)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}
          >
            id: {projectId}
          </p>
        )}
        <p className="text-[11px] mb-5" style={{ color: 'var(--text-dim)' }}>
          {message}
        </p>
        <button
          onClick={() => { window.location.href = '/projects'; }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-150"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)',
            color: '#fff',
            boxShadow: '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 6px 20px -2px rgba(124,58,237,0.7), inset 0 1px 0 rgba(255,255,255,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 14px -2px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)';
          }}
        >
          ← Back to all projects
        </button>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected — any authenticated user */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<App />}>
              <Route index element={<Navigate to="/projects" replace />} />
              <Route path="projects" element={<ErrorBoundary scope="ProjectsPage"><ProjectsPage /></ErrorBoundary>} />
              <Route path="projects/new" element={<ErrorBoundary scope="NewProjectPage"><NewProjectPage /></ErrorBoundary>} />
              <Route path="projects/:id" element={<ProjectWorkspace />}>
                <Route index element={<Navigate to="brief" replace />} />
                <Route path="definition" element={<ErrorBoundary scope="ProjectDefinitionPage"><ProjectDefinitionPage /></ErrorBoundary>} />
                <Route path="brief" element={<ErrorBoundary scope="BriefPage"><StageGuard stage="brief"><BriefPage /></StageGuard></ErrorBoundary>} />
                <Route path="epics" element={<ErrorBoundary scope="EpicsPage"><StageGuard stage="epics"><EpicsPage /></StageGuard></ErrorBoundary>} />
                <Route path="journeys" element={<ErrorBoundary scope="JourneysPage"><StageGuard stage="journeys"><JourneysPage /></StageGuard></ErrorBoundary>} />
                <Route path="tasks" element={<ErrorBoundary scope="TasksPage"><StageGuard stage="tasks"><TasksPage /></StageGuard></ErrorBoundary>} />
                <Route path="sync" element={<ErrorBoundary scope="SyncPage"><StageGuard stage="sync"><SyncPage /></StageGuard></ErrorBoundary>} />
              </Route>

              {/* Admin-only */}
              <Route element={<ProtectedRoute requiredRole="admin" />}>
                <Route path="admin/settings" element={<Navigate to="/admin/settings/integrations" replace />} />
                <Route path="admin/settings/integrations" element={<ErrorBoundary scope="AdminIntegrationsPage"><AdminIntegrationsPage /></ErrorBoundary>} />
                <Route path="admin/settings/users" element={<ErrorBoundary scope="AdminUsersPage"><AdminUsersPage /></ErrorBoundary>} />
                <Route path="admin/settings/prompts" element={<ErrorBoundary scope="AdminPromptsPage"><AdminPromptsPage /></ErrorBoundary>} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
