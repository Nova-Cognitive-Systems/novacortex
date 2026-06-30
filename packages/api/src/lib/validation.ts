/**
 * Input validation and sanitization utilities
 */

import { z, ZodError, ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './errors.js';

/**
 * Maximum request body size (50MB)
 */
export const MAX_BODY_SIZE = 50 * 1024 * 1024;

/**
 * Maximum string length for content fields
 */
export const MAX_CONTENT_LENGTH = 1_000_000; // 1MB of text

/**
 * Maximum array length for tags, entities, etc.
 */
export const MAX_ARRAY_LENGTH = 100;

/**
 * Maximum namespace name length
 */
export const MAX_NAMESPACE_LENGTH = 64;

/**
 * Namespace name pattern
 */
export const NAMESPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Sanitize a string by removing control characters and trimming
 */
export function sanitizeString(input: string): string {
  // Remove control characters except newlines and tabs
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Sanitize an object's string values recursively
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Convert Zod error to a user-friendly format
 */
export function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validate request body against a Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sanitize input before validation
      const sanitized = sanitizeObject(req.body);
      const parsed = schema.parse(sanitized);
      req.body = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: formatZodError(error),
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Validate request query parameters against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const sanitized = sanitizeObject(req.query);
      const parsed = schema.parse(sanitized);
      req.query = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: formatZodError(error),
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Validate request path parameters against a Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const sanitized = sanitizeObject(req.params);
      const parsed = schema.parse(sanitized);
      req.params = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: formatZodError(error),
        });
        return;
      }
      next(error);
    }
  };
}

// Common validation schemas
export const NamespaceSchema = z
  .string()
  .min(1)
  .max(MAX_NAMESPACE_LENGTH)
  .regex(NAMESPACE_PATTERN, 'Namespace must be alphanumeric with hyphens/underscores only');

export const MemoryIdSchema = z.string().min(1).max(128);

export const TagsSchema = z
  .array(z.string().min(1).max(128))
  .max(MAX_ARRAY_LENGTH)
  .optional();

export const ContentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(MAX_CONTENT_LENGTH, `Content must be less than ${MAX_CONTENT_LENGTH} characters`);

export const EmbeddingSchema = z
  .array(z.number())
  .min(1)
  .max(4096) // Support up to 4096-dimensional embeddings
  .optional();

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Validate namespace parameter
 */
export function validateNamespace(namespace: string): void {
  const result = NamespaceSchema.safeParse(namespace);
  if (!result.success) {
    throw new ValidationError(
      formatZodError(result.error)[0]?.message ?? 'Invalid namespace',
      undefined,
      'namespace'
    );
  }
}

/**
 * Check if a value is null or undefined
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Safely access nested object properties
 */
export function safeGet<T>(obj: unknown, path: string, defaultValue: T): T {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (isNullish(current) || typeof current !== 'object') {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return (current as T) ?? defaultValue;
}

/**
 * Ensure a value is an array
 */
export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (isNullish(value)) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Deduplicate an array while preserving order
 */
export function deduplicate<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Middleware to check request body size
 */
export function checkBodySize(maxSize: number = MAX_BODY_SIZE) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Busboy enforces its own size limits for multipart uploads
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      return next();
    }
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      res.status(413).json({
        error: 'Payload too large',
        code: 'PAYLOAD_TOO_LARGE',
        maxSize: `${Math.round(maxSize / 1024 / 1024)}MB`,
        actualSize: `${Math.round(contentLength / 1024 / 1024)}MB`,
      });
      return;
    }

    next();
  };
}
