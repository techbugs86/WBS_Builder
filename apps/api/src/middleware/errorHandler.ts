import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

/**
 * Global error-handling middleware. MUST be registered LAST in app.ts after
 * all routes. Returns a JSON error body with appropriate HTTP status.
 *
 * Behaviour:
 *  - ZodError (LLM output validation, etc.)        → 422 Unprocessable Entity
 *  - SyntaxError (e.g. JSON.parse on malformed)    → 400 Bad Request
 *  - Errors with explicit `.statusCode` field      → that status
 *  - Anything else                                  → 500 Internal Server Error
 *
 * In development the stack is included; in production only the message.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // If headers were already sent, delegate to Express's default handler so
  // we don't try to write to a closed socket.
  if (res.headersSent) {
    return;
  }

  let status = 500;
  let code: string | undefined;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Response did not match expected schema.';
    details = err.issues;
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    // express.json() throws SyntaxError on malformed bodies
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON.';
  } else if (err instanceof Error) {
    const errObj = err as Error & { statusCode?: number; code?: string };
    if (typeof errObj.statusCode === 'number') {
      status = errObj.statusCode;
    }
    if (typeof errObj.code === 'string') {
      code = errObj.code;
    }
    message = err.message || message;
  }

  // Always log server-side so we can audit prod failures
  console.error('[api:error]', {
    status,
    code,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });

  const body: Record<string, unknown> = { error: message };
  if (code) body['code'] = code;
  if (details) body['details'] = details;
  if (process.env['NODE_ENV'] !== 'production' && err instanceof Error) {
    body['stack'] = err.stack;
  }

  res.status(status).json(body);
}

/**
 * Helper to throw an HTTP error with a specific status code that the global
 * errorHandler will pick up. Use inside route handlers wrapped with asyncHandler.
 */
export class HttpError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, message: string, code = 'HTTP_ERROR') {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
