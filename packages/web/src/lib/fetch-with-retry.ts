/**
 * Fetch wrapper with retry logic and exponential backoff
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 500) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Status codes that should trigger a retry */
  retryStatusCodes?: number[];
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  timeoutMs: 30000,
  retryStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'onRetry'>>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const clampedDelay = Math.min(exponentialDelay, options.maxDelayMs);
  // Add jitter (0.5 to 1.5x)
  const jitter = 0.5 + Math.random();
  return Math.floor(clampedDelay * jitter);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // Network errors (fetch failed, CORS, etc.)
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    // Timeout
    return true;
  }
  return false;
}

/**
 * Fetch with abort timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * API Error with additional metadata
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
    public code?: string,
    public details?: unknown,
    public retryable?: boolean,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: {
      error?: string;
      message?: string;
      code?: string;
      details?: unknown;
      retryable?: boolean;
      requestId?: string;
    } = {};

    try {
      body = await response.json();
    } catch {
      // Response body might not be JSON
    }

    return new ApiError(
      response.status,
      response.statusText,
      body.error || body.message || `Request failed with status ${response.status}`,
      body.code,
      body.details,
      body.retryable,
      body.requestId
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      status: this.status,
      statusText: this.statusText,
      message: this.message,
      code: this.code,
      details: this.details,
      retryable: this.retryable,
      requestId: this.requestId,
    };
  }
}

/**
 * Fetch with retry logic and exponential backoff
 */
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...retryOptions };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, opts.timeoutMs);

      // Handle successful responses
      if (response.ok) {
        if (response.status === 204) {
          return undefined as T;
        }
        return response.json() as Promise<T>;
      }

      // Check if this status code is retryable
      const isRetryableStatus = opts.retryStatusCodes.includes(response.status);

      if (!isRetryableStatus || attempt > opts.maxRetries) {
        throw await ApiError.fromResponse(response);
      }

      // Handle rate limiting with Retry-After header
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : calculateDelay(attempt, opts);

      if (retryOptions.onRetry) {
        retryOptions.onRetry(
          attempt,
          new Error(`HTTP ${response.status}: ${response.statusText}`),
          delayMs
        );
      }

      await sleep(delayMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors
      if (error instanceof ApiError && !opts.retryStatusCodes.includes(error.status)) {
        throw error;
      }

      // Check if error is retryable
      const shouldRetry = attempt <= opts.maxRetries && isRetryableError(error);

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, opts);

      if (retryOptions.onRetry) {
        retryOptions.onRetry(attempt, lastError, delayMs);
      }

      console.warn(`[fetchWithRetry] Attempt ${attempt} failed, retrying in ${delayMs}ms`, error);

      await sleep(delayMs);
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError || new Error('Request failed after retries');
}

/**
 * Create a configured fetch function with default retry options
 */
export function createFetchClient(baseUrl: string, defaultOptions?: RetryOptions) {
  return async function <T>(
    endpoint: string,
    options?: RequestInit,
    retryOptions?: RetryOptions
  ): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const mergedRetryOptions = { ...defaultOptions, ...retryOptions };

    return fetchWithRetry<T>(
      url,
      {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      },
      mergedRetryOptions
    );
  };
}

/**
 * Check if currently offline
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * Wait for online status
 */
export function waitForOnline(): Promise<void> {
  if (!isOffline()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handler = () => {
      window.removeEventListener('online', handler);
      resolve();
    };
    window.addEventListener('online', handler);
  });
}
