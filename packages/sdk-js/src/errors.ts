// Typed error hierarchy mirroring the API's HTTP status semantics.

export class NovaCortexError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'NovaCortexError';
    this.status = status;
    this.body = body;
  }
}

/** 401 — token missing, invalid, revoked or expired. */
export class AuthError extends NovaCortexError {
  constructor(message = 'Authentication failed', body?: unknown) {
    super(message, 401, body);
    this.name = 'AuthError';
  }
}

/** 403 — token lacks the required scope. */
export class ForbiddenError extends NovaCortexError {
  readonly required?: string[];
  readonly granted?: string[];
  constructor(message = 'Insufficient scope', body?: unknown, required?: string[], granted?: string[]) {
    super(message, 403, body);
    this.name = 'ForbiddenError';
    this.required = required;
    this.granted = granted;
  }
}

/** 404 — resource not found. */
export class NotFoundError extends NovaCortexError {
  constructor(message = 'Not found', body?: unknown) {
    super(message, 404, body);
    this.name = 'NotFoundError';
  }
}

/** 400 / 422 — invalid request payload. */
export class ValidationError extends NovaCortexError {
  constructor(message = 'Validation failed', status = 400, body?: unknown) {
    super(message, status, body);
    this.name = 'ValidationError';
  }
}

/** 429 — rate limited. */
export class RateLimitError extends NovaCortexError {
  constructor(message = 'Rate limited', body?: unknown) {
    super(message, 429, body);
    this.name = 'RateLimitError';
  }
}

/** 5xx — server error. */
export class ServerError extends NovaCortexError {
  constructor(message = 'Server error', status = 500, body?: unknown) {
    super(message, status, body);
    this.name = 'ServerError';
  }
}

/** Network failure / server unreachable. */
export class ConnectionError extends NovaCortexError {
  constructor(message = 'Could not reach the NovaCortex server') {
    super(message);
    this.name = 'ConnectionError';
  }
}
