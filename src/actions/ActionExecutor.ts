import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ActionDefinition,
  ActionExecutionContext,
  ActionResult,
} from './ActionDefinitions.js';
import { sanitizeErrorMessage } from '../security/ErrorSanitizer.js';

const execFileAsync = promisify(execFile);

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const MAX_STDIO_BUFFER_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 4_000;

export class ActionExecutor {
  async execute(
    def: ActionDefinition,
    input: unknown,
    ctx: ActionExecutionContext,
  ): Promise<ActionResult> {
    const startedAt = Date.now();
    const inputSummary = summarizeValue(input);

    try {
      if (def.kind === 'handler') {
        const output = await def.execute(ctx, input as never);
        const outputSummary = summarizeValue(output);
        return {
          ok: true,
          status: 'succeeded',
          actionId: def.id,
          title: def.title,
          kind: def.kind,
          inputSummary,
          outputSummary,
          output: outputSummary,
          durationMs: Date.now() - startedAt,
        };
      }

      const args = [...def.buildArgs(input as never)];
      const env = buildProcessEnv(def.envAllowlist);
      const result = await execFileAsync(def.command, args, {
        cwd: def.cwd,
        env,
        timeout: def.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
        maxBuffer: MAX_STDIO_BUFFER_BYTES,
        windowsHide: true,
      });
      const stdout = summarizeText(result.stdout);
      const stderr = summarizeText(result.stderr);
      const outputSummary =
        stdout || stderr || 'Command completed successfully with no captured output.';

      return {
        ok: true,
        status: 'succeeded',
        actionId: def.id,
        title: def.title,
        kind: def.kind,
        inputSummary,
        outputSummary,
        output: outputSummary,
        durationMs: Date.now() - startedAt,
        exitCode: 0,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        readonly stdout?: string | Buffer;
        readonly stderr?: string | Buffer;
        readonly code?: string | number;
        readonly signal?: string;
      };
      const stdout = summarizeText(err.stdout);
      const stderr = summarizeText(err.stderr);
      const errorText = summarizeText(err.message || String(error));
      const exitCode =
        typeof err.code === 'number'
          ? err.code
          : typeof err.code === 'string' && /^\d+$/.test(err.code)
            ? Number.parseInt(err.code, 10)
            : undefined;
      const outputSummary = stderr || stdout;

      ctx.logger.warn(
        {
          sessionId: ctx.sessionId,
          actionId: def.id,
          err: errorText,
          exitCode,
          signal: err.signal,
        },
        'action execution failed',
      );

      return {
        ok: false,
        status: 'failed',
        actionId: def.id,
        title: def.title,
        kind: def.kind,
        inputSummary,
        ...(outputSummary ? { outputSummary } : {}),
        ...(outputSummary ? { output: outputSummary } : {}),
        error: errorText,
        durationMs: Date.now() - startedAt,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      };
    }
  }
}

const BASE_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'TMP',
  'TEMP',
  'SystemRoot',
  'ComSpec',
  'WINDIR',
];

const buildProcessEnv = (
  envAllowlist?: readonly string[],
): Record<string, string> | undefined => {
  const env: Record<string, string> = {};
  for (const key of [...BASE_ENV_KEYS, ...(envAllowlist ?? [])]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
};

const summarizeText = (value: unknown): string => {
  const text = normalizeText(value);
  return truncateText(text);
};

const summarizeValue = (value: unknown): string => {
  if (typeof value === 'string') return summarizeText(value);

  try {
    return truncateText(
      sanitizeErrorMessage(
        JSON.stringify(
          value,
          (_, nested) => (typeof nested === 'bigint' ? nested.toString() : nested),
          2,
        ),
      ),
    );
  } catch {
    return truncateText(sanitizeErrorMessage(String(value)));
  }
};

const normalizeText = (value: unknown): string => {
  if (typeof value === 'string') return sanitizeErrorMessage(value);
  if (Buffer.isBuffer(value)) return sanitizeErrorMessage(value.toString('utf8'));
  if (value === undefined || value === null) return '';
  return sanitizeErrorMessage(String(value));
};

const truncateText = (text: string): string => {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}... [truncated]`;
};
