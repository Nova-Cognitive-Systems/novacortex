/**
 * Structured error classes for consistent API error handling
 */

export enum ErrorCode {
  // Client errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  details?: unknown;
  field?: string;
  retryable?: boolean;
  timestamp: string;
  requestId?: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly field?: string;
  public readonly retryable: boolean;
  public readonly timestamp: Date;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options?: {
      details?: unknown;
      field?: string;
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
    this.field = options?.field;
    this.retryable = options?.retryable ?? false;
    this.timestamp = new Date();

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): ErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      field: this.field,
      retryable: this.retryable,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, field?: string) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, { details, field });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} '${identifier}' not found`
      : `${resource} not found`;
    super(ErrorCode.NOT_FOUND, message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.CONFLICT, message, 409, { details });
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super(ErrorCode.RATE_LIMITED, 'Rate limit exceeded', 429, {
      details: retryAfter ? { retryAfter } : undefined,
      retryable: true,
    });
    this.name = 'RateLimitError';
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(maxSize: string) {
    super(ErrorCode.PAYLOAD_TOO_LARGE, `Payload too large. Maximum size: ${maxSize}`, 413);
    this.name = 'PayloadTooLargeError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: Error) {
    super(ErrorCode.DATABASE_ERROR, message, 503, {
      retryable: true,
      cause,
    });
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, cause?: Error) {
    super(ErrorCode.EXTERNAL_SERVICE_ERROR, `${service}: ${message}`, 502, {
      retryable: true,
      cause,
    });
    this.name = 'ExternalServiceError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, 503, { retryable: true });
    this.name = 'ServiceUnavailableError';
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(
      ErrorCode.TIMEOUT,
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      504,
      { retryable: true }
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap unknown errors into AppError
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return new ExternalServiceError('Database', 'Connection refused', error);
    }
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return new TimeoutError('request', 30000);
    }
    if (error.name === 'ZodError') {
      return new ValidationError('Validation failed', error);
    }

    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      error.message || 'An unexpected error occurred',
      500,
      { cause: error }
    );
  }

  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    'An unexpected error occurred',
    500,
    { details: error }
  );
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('timeout') ||
      message.includes('temporarily unavailable') ||
      message.includes('rate limit')
    );
  }

  return false;
}
