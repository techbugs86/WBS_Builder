import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { FlashBanner } from './components/FlashBanner';
import { ErrorToast } from './components/ErrorToast';
import { TooltipProvider } from './components/ui/tooltip';

export function App() {
  const location = useLocation();

  if (location.pathname === '/') {
    return <Navigate to="/projects" replace />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative" style={{ background: 'var(--bg)' }}>
          <FlashBanner />
          <ErrorToast />
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}

export default App;
