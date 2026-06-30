/**
 * Express error handling middleware with structured logging
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  normalizeError,
  ErrorCode,
  type ErrorDetails,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Generate a unique request ID
 */
function getRequestId(req: Request): string {
  return (req.headers['x-request-id'] as string) || crypto.randomUUID();
}

/**
 * Format Zod validation errors
 */
function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Determine if error details should be exposed to client
 */
function shouldExposeDetails(error: AppError, _req: Request): boolean {
  // In production, only expose details for client errors
  if (process.env['NODE_ENV'] === 'production') {
    return error.statusCode < 500;
  }
  return true;
}

/**
 * Main error handler middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = getRequestId(req);

  // If the response already started (e.g. a streaming endpoint failed mid-stream),
  // we cannot write a JSON error without ERR_HTTP_HEADERS_SENT. Delegate to
  // Express's default finalhandler, which destroys the socket so the client sees
  // a truncated (not silently "complete") response.
  if (res.headersSent) {
    _next(err);
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = formatZodError(err);
    logger.warn('Validation error', {
      requestId,
      method: req.method,
      url: req.url,
      details,
    });

    res.status(400).json({
      error: 'Validation error',
      code: ErrorCode.VALIDATION_ERROR,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Malformed JSON request body (thrown by express.json/body-parser) -> 400, not 500.
  if (err instanceof SyntaxError && 'body' in (err as unknown as Record<string, unknown>)) {
    logger.warn('Malformed JSON body', { requestId, method: req.method, url: req.url });
    res.status(400).json({
      error: 'Invalid JSON in request body',
      code: ErrorCode.VALIDATION_ERROR,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Normalize unknown errors to AppError
  const appError = normalizeError(err);

  // Log the error
  const logContext = {
    requestId,
    method: req.method,
    url: req.url,
    statusCode: appError.statusCode,
    errorCode: appError.code,
    retryable: appError.retryable,
  };

  if (appError.statusCode >= 500) {
    logger.error(appError.message, logContext, appError.cause as Error);
  } else if (appError.statusCode >= 400) {
    logger.warn(appError.message, logContext);
  }

  // Build response
  const response: ErrorDetails & { requestId: string } = {
    ...appError.toJSON(),
    requestId,
  };

  // Remove details in production for server errors
  if (!shouldExposeDetails(appError, req)) {
    delete response.details;
  }

  res.status(appError.statusCode).json(response);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = getRequestId(req);

  logger.debug('Route not found', {
    requestId,
    method: req.method,
    url: req.url,
  });

  res.status(404).json({
    error: 'Not found',
    code: ErrorCode.NOT_FOUND,
    message: `Cannot ${req.method} ${req.url}`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Async route handler wrapper
 * Catches async errors and passes them to error handler
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Request logging middleware
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = getRequestId(req);

  // Attach request ID to request
  req.headers['x-request-id'] = requestId;

  // Log request start
  logger.debug('Request started', {
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length'],
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('Request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

/**
 * Timeout middleware
 */
export function timeoutMiddleware(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const requestId = getRequestId(req);
        logger.error('Request timeout', {
          requestId,
          method: req.method,
          url: req.url,
          timeoutMs,
        });

        res.status(504).json({
          error: 'Request timeout',
          code: ErrorCode.TIMEOUT,
          message: `Request timed out after ${timeoutMs}ms`,
          requestId,
          timestamp: new Date().toISOString(),
          retryable: true,
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));

    next();
  };
}

/**
 * Health check bypass middleware
 * Skips certain middleware for health check endpoints
 */
export function healthCheckBypass(
  middleware: (req: Request, res: Response, next: NextFunction) => void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/health/qdrant') {
      next();
      return;
    }
    middleware(req, res, next);
  };
}
