/**
 * Retry logic with exponential backoff for transient failures
 */

import { isRetryableError, TimeoutError } from './errors.js';
import { logger } from './logger.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add jitter to delays (default: true) */
  jitter?: boolean;
  /** Operation name for logging */
  operationName?: string;
  /** Timeout per attempt in milliseconds */
  timeoutMs?: number;
  /** Custom retry condition */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback on each retry */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry' | 'timeoutMs'>> = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
  operationName: 'operation',
};

/**
 * Calculate delay with exponential backoff
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry' | 'timeoutMs'>>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const clampedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  if (options.jitter) {
    // Add up to 25% jitter
    const jitterFactor = 0.75 + Math.random() * 0.5;
    return Math.floor(clampedDelay * jitterFactor);
  }

  return clampedDelay;
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operationName, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Execute an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      const result = opts.timeoutMs
        ? await withTimeout(fn(), opts.timeoutMs, opts.operationName)
        : await fn();

      if (attempt > 1) {
        logger.info(`${opts.operationName} succeeded after ${attempt} attempts`);
      }

      return result;
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt > opts.maxRetries;
      const shouldRetry = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : isRetryableError(error);

      if (isLastAttempt || !shouldRetry) {
        logger.error(`${opts.operationName} failed after ${attempt} attempt(s)`, {
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        });
        throw error;
      }

      const delayMs = calculateDelay(attempt, opts);

      if (options.onRetry) {
        options.onRetry(error, attempt, delayMs);
      }

      logger.warn(`${opts.operationName} failed, retrying in ${delayMs}ms`, {
        attempt,
        maxRetries: opts.maxRetries,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Failure threshold to open circuit (default: 5) */
  failureThreshold?: number;
  /** Success threshold in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Time to wait before attempting half-open (default: 30000ms) */
  resetTimeoutMs?: number;
  /** Operation name for logging */
  operationName?: string;
  /** Callback on state change */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * Circuit breaker pattern to prevent cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number = 0;
  private readonly options: Required<Omit<CircuitBreakerOptions, 'onStateChange'>> & Pick<CircuitBreakerOptions, 'onStateChange'>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: 5,
      successThreshold: 2,
      resetTimeoutMs: 30000,
      operationName: 'operation',
      ...options,
    };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number | null;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime || null,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;

      if (timeSinceLastFailure >= this.options.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        const waitTime = this.options.resetTimeoutMs - timeSinceLastFailure;
        throw new Error(
          `Circuit breaker is open for ${this.options.operationName}. ` +
          `Retry after ${Math.ceil(waitTime / 1000)}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.options.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    logger.info(`Circuit breaker ${this.options.operationName}: ${oldState} -> ${newState}`);

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }

    if (this.options.onStateChange) {
      this.options.onStateChange(oldState, newState);
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }
}
