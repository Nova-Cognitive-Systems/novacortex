/**
 * Auth middleware — token extraction, scope enforcement, rate limiting.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash } from 'crypto';
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

/** Take one slot from the keyed bucket; sends the 429 and returns false when exhausted. */
function consumeBucket(key: string, perMinute: number, res: Response, hint?: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= perMinute) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests',
      hint: hint ?? `Retry after ${retryAfter} seconds`,
    });
    return false;
  }
  bucket.count += 1;
  return true;
}

/** In-memory per-IP rate limiter. */
export function rateLimit(opts: { perMinute: number }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (consumeBucket(`ip:${resolveClientIp(req)}`, opts.perMinute, res)) next();
  };
}

/**
 * License-tier request limiter (requests/minute across the data-plane routes),
 * keyed per bearer token (per-IP for unauthenticated requests). The per-minute
 * budget comes from the active license tier at request time, so activating a
 * Pro key raises the limit without a restart. Self-hosters can override or
 * disable via API_RATE_LIMIT (a number, or 0/off to disable) — this is an ops
 * guardrail and an honest implementation of the advertised tier feature, not
 * metering: storage and retrieval are never quota'd.
 */
export function tierRateLimit(getPerMinute: () => number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const override = process.env['API_RATE_LIMIT'];
    let perMinute: number;
    if (override !== undefined && override !== '') {
      if (override === 'off' || override === '0') return next();
      const parsed = parseInt(override, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return next();
      perMinute = parsed;
    } else {
      perMinute = getPerMinute();
    }
    if (!Number.isFinite(perMinute) || perMinute <= 0) return next();

    const token = extractToken(req);
    const key = token
      ? `tok:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
      : `ip:${resolveClientIp(req)}`;
    const hint =
      'Tier request limit reached. Upgrade your license for a higher limit, or set API_RATE_LIMIT to override on your own deployment.';
    if (consumeBucket(key, perMinute, res, hint)) next();
  };
}

// Re-export for tests
export { tokenService };
export type { TokenRecord };
