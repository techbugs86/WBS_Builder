import { Navigate, Outlet } from 'react-router-dom';
import { useProjectStore } from '../store/useProjectStore';

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 3, pm: 3 };

export function ProtectedRoute({ requiredRole }: { requiredRole?: 'owner' | 'admin' | 'pm' }) {
  const currentUser = useProjectStore((s) => s.currentUser);

  if (!currentUser) return <Navigate to="/login" replace />;
  if (requiredRole) {
    const userRank = ROLE_RANK[currentUser.role] ?? 0;
    const requiredRank = ROLE_RANK[requiredRole] ?? 0;
    if (userRank < requiredRank) return <Navigate to="/projects" replace />;
  }

  return <Outlet />;
}
