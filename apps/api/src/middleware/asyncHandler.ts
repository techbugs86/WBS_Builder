import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

/**
 * Wraps an async route handler so any thrown error is forwarded to Express's
 * error-handling middleware instead of becoming an unhandled rejection.
 *
 * Express 4 does NOT auto-catch async errors — without this wrapper a thrown
 * error in an async handler hangs the request indefinitely.
 *
 * Usage:
 *   router.get('/foo', asyncHandler(async (req, res) => {
 *     const row = await query(...);
 *     res.json(row);
 *   }));
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
