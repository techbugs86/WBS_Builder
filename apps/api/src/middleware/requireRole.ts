import type { Request, Response, NextFunction } from 'express';

// Role hierarchy: owner > admin > pm
const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, pm: 1 };

// requireRole('admin') allows owner and admin through
export function requireRole(minRole: 'owner' | 'admin' | 'pm') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated.' });
      return;
    }
    const userRank = ROLE_RANK[req.user.role] ?? 0;
    const requiredRank = ROLE_RANK[minRole] ?? 0;
    if (userRank < requiredRank) {
      res.status(403).json({ error: `Requires role: ${minRole} or higher.` });
      return;
    }
    next();
  };
}
