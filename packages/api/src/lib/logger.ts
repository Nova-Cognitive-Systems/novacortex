/**
 * Structured logging utility
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface LoggerOptions {
  level?: LogLevel;
  serviceName?: string;
  pretty?: boolean;
}

class Logger {
  private level: LogLevel;
  private serviceName: string;
  private pretty: boolean;

  constructor(options: LoggerOptions = {}) {
    const envLevel = process.env['LOG_LEVEL']?.toUpperCase();
    this.level = options.level ?? this.parseLogLevel(envLevel) ?? LogLevel.INFO;
    this.serviceName = options.serviceName ?? 'memory-stack-api';
    this.pretty = options.pretty ?? process.env['NODE_ENV'] !== 'production';
  }

  private parseLogLevel(level?: string): LogLevel | undefined {
    switch (level) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      default:
        return undefined;
    }
  }

  private formatEntry(entry: LogEntry): string {
    if (this.pretty) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const level = entry.level.padEnd(5);
      let msg = `[${time}] ${level} ${entry.message}`;

      if (entry.context && Object.keys(entry.context).length > 0) {
        msg += ` ${JSON.stringify(entry.context)}`;
      }

      if (entry.error) {
        msg += `\n  Error: ${entry.error.message}`;
        if (entry.error.stack) {
          msg += `\n${entry.error.stack.split('\n').slice(1, 4).join('\n')}`;
        }
      }

      return msg;
    }

    return JSON.stringify({
      ...entry,
      service: this.serviceName,
    });
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      message,
      context,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    const formatted = this.formatEntry(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    if (context instanceof Error) {
      this.log(LogLevel.ERROR, message, undefined, context);
    } else {
      this.log(LogLevel.ERROR, message, context, error);
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private context: Record<string, unknown>
  ) {}

  private mergeContext(context?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.context, ...context };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeContext(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    if (context instanceof Error) {
      this.parent.error(message, this.context, context);
    } else {
      this.parent.error(message, this.mergeContext(context), error);
    }
  }
}

// Singleton logger instance
export const logger = new Logger();

/**
 * Create a request logger middleware
 */
export function createRequestLogger() {
  return (req: { method: string; url: string; headers: Record<string, unknown> }, res: { statusCode: number; on: (event: string, cb: () => void) => void }, next: () => void) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    // Log request
    logger.info('Request started', {
      requestId,
      method: req.method,
      url: req.url,
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
  };
}

/**
 * Performance timer utility
 */
export function createTimer(operationName: string): () => number {
  const startTime = process.hrtime.bigint();

  return () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;

    logger.debug(`${operationName} completed`, { durationMs });

    return durationMs;
  };
}
