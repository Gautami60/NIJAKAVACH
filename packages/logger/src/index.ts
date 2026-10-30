export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  service?: string;
  correlationId?: string;
  userId?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
};

/**
 * PII Redaction keys to sanitize sensitive details from log dumps
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "secret",
  "rawphone",
  "phonenumber",
  "plainidentifier",
  "encryptedvalue"
]);

function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      sanitized[k] = "[REDACTED_PII]";
    } else if (typeof v === "object" && v !== null) {
      sanitized[k] = sanitize(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export class Logger {
  private serviceName: string;
  private minLevel: LogLevel;

  constructor(serviceName: string, minLevel: LogLevel = "info") {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel];
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service: this.serviceName,
      message,
      ...(context ? (sanitize(context) as Record<string, unknown>) : {})
    };

    const output = JSON.stringify(logEntry);
    if (level === "error") {
      process.stderr.write(`${output}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger(this.serviceName, this.minLevel);
    const origWrite = childLogger.write.bind(childLogger);
    childLogger.write = (level: LogLevel, message: string, context?: LogContext) => {
      origWrite(level, message, { ...additionalContext, ...context });
    };
    return childLogger;
  }
}

export function createLogger(serviceName: string, level: LogLevel = "info"): Logger {
  return new Logger(serviceName, level);
}
