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

  useEffect(() => {
    if (id) void loadProject(id);
  }, [id, loadProject]);

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
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/new" element={<NewProjectPage />} />
              <Route path="projects/:id" element={<ProjectWorkspace />}>
                <Route index element={<Navigate to="brief" replace />} />
                <Route path="definition" element={<ProjectDefinitionPage />} />
                <Route path="brief" element={<StageGuard stage="brief"><BriefPage /></StageGuard>} />
                <Route path="epics" element={<StageGuard stage="epics"><EpicsPage /></StageGuard>} />
                <Route path="journeys" element={<StageGuard stage="journeys"><JourneysPage /></StageGuard>} />
                <Route path="tasks" element={<StageGuard stage="tasks"><TasksPage /></StageGuard>} />
                <Route path="sync" element={<StageGuard stage="sync"><SyncPage /></StageGuard>} />
              </Route>

              {/* Admin-only */}
              <Route element={<ProtectedRoute requiredRole="admin" />}>
                <Route path="admin/settings" element={<Navigate to="/admin/settings/integrations" replace />} />
                <Route path="admin/settings/integrations" element={<AdminIntegrationsPage />} />
                <Route path="admin/settings/users" element={<AdminUsersPage />} />
                <Route path="admin/settings/prompts" element={<AdminPromptsPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
