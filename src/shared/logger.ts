/**
 * Logging with mandatory redaction.
 *
 * Tokens, device codes and OAuth payloads must never reach a log line, a
 * diagnostic export, or a screenshot, so every value passes through `redact`
 * before it is formatted.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
}

const REDACTED = '[redacted]';
const SENSITIVE_KEY =
  /(token|secret|password|authorization|device_?code|user_?code|client_?secret|cookie)/i;
const SECRET_IN_TEXT = /\b(gh[opsu]_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,})\b/g;

const MAX_BUFFERED_ENTRIES = 200;
const buffer: LogEntry[] = [];

export function redactText(value: string): string {
  return value.replace(SECRET_IN_TEXT, REDACTED);
}

/** Deep-clones `value`, replacing secrets with a placeholder. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return result;
}

function record(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFERED_ENTRIES) buffer.shift();
}

export function getRecentLogs(): LogEntry[] {
  return [...buffer];
}

export function clearLogs(): void {
  buffer.length = 0;
}

export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = LEVEL_ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_ORDER[level];
}

function emit(level: LogLevel, scope: string, message: string, details?: unknown): void {
  const safeMessage = redactText(message);
  record({ at: new Date().toISOString(), level, scope, message: safeMessage });
  if (LEVEL_ORDER[level] < threshold) return;
  const prefix = `[leetsensei:${scope}]`;
  const payload: unknown[] =
    details === undefined ? [prefix, safeMessage] : [prefix, safeMessage, redact(details)];
  switch (level) {
    case 'debug':
      console.debug(...payload);
      break;
    case 'info':
      console.info(...payload);
      break;
    case 'warn':
      console.warn(...payload);
      break;
    case 'error':
      console.error(...payload);
      break;
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, details) => emit('debug', scope, message, details),
    info: (message, details) => emit('info', scope, message, details),
    warn: (message, details) => emit('warn', scope, message, details),
    error: (message, details) => emit('error', scope, message, details),
  };
}
