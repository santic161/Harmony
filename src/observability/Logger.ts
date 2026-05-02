import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { sanitizeErrorMessage } from '../security/ErrorSanitizer.js';

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  readonly level?: LoggerOptions['level'];
  readonly name?: string;
  readonly pretty?: boolean;
}

const REDACT_PATHS = [
  'userId',
  'externalUserId',
  'phone',
  'email',
  '*.userId',
  '*.externalUserId',
  '*.phone',
  '*.email',
  'msg.text',
  '*.msg.text',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
];

// Sanitize API keys / secrets that leak through error messages into logs.
const errorSerializer = (err: unknown): unknown => {
  if (!err || typeof err !== 'object') return err;
  const e = err as Record<string, unknown>;
  return {
    ...e,
    ...(typeof e['message'] === 'string'
      ? { message: sanitizeErrorMessage(e['message']) }
      : {}),
    ...(typeof e['stack'] === 'string'
      ? { stack: sanitizeErrorMessage(e['stack']) }
      : {}),
  };
};

export const createLogger = (opts: CreateLoggerOptions = {}): Logger => {
  const base: LoggerOptions = {
    level: opts.level ?? process.env['LOG_LEVEL'] ?? 'info',
    name: opts.name ?? 'harmony-agentic-decisions',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { err: errorSerializer, error: errorSerializer },
  };
  if (opts.pretty) {
    return pino({
      ...base,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  }
  return pino(base);
};
