/**
 * Auth middleware — token extraction, scope enforcement, rate limiting.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { tokenService, type TokenRecord } from '../services/token-service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        tokenId: string;
        scopes: string[];
        agentId?: string;
        namespaceClaim?: string;
      };
    }
  }
}

/** Extract a bearer token from the Authorization header or X-API-Key header. */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rest = authHeader.slice(7).trim();
    return rest.length > 0 ? rest : null;
  }
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) return apiKeyHeader;
  return null;
}

/** Resolve client IP, honoring TRUST_PROXY env var. */
export function resolveClientIp(req: Request): string {
  if (process.env['TRUST_PROXY'] === 'true') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]!.trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Enforce that the request bears a token with all of the required scopes. */
export function requireScopes(...required: string[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveClientIp(req);
    const cleartext = extractToken(req);
    if (!cleartext) {
      void tokenService.auditEvent('auth.failed', { reason: 'missing_token', ip, path: req.path });
      res.status(401).json({
        error: 'missing_token',
        message: 'Authentication required',
        hint: 'Send Authorization: Bearer <token>',
      });
      return;
    }

    const record = await tokenService.validate(cleartext);
    if (!record) {
      void tokenService.auditEvent('auth.failed', { reason: 'invalid_token', ip, path: req.path });
      res.status(401).json({
        error: 'invalid_token',
        message: 'Token is invalid, revoked, or expired',
      });
      return;
    }

    const missing = required.filter((s) => !tokenService.hasScope(record, s));
    if (missing.length > 0) {
      void tokenService.auditEvent('auth.scope_denied', {
        ip,
        path: req.path,
        tokenId: record.id,
        required,
        granted: record.scopes,
      });
      res.status(403).json({
        error: 'insufficient_scope',
        message: 'Token does not grant the required scopes',
        required,
        granted: record.scopes,
      });
      return;
    }

    req.auth = {
      tokenId: record.id,
      scopes: record.scopes,
      agentId: record.agentId,
      namespaceClaim: record.namespaceClaim,
    };
    next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt < now) rateBuckets.delete(key);
  }
}, 60_000).unref?.();

/** In-memory per-IP rate limiter. */
export function rateLimit(opts: { perMinute: number }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveClientIp(req);
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    if (bucket.count >= opts.perMinute) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests',
        hint: `Retry after ${retryAfter} seconds`,
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}

// Re-export for tests
export { tokenService };
export type { TokenRecord };
