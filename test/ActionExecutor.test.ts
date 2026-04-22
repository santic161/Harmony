import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionExecutor } from '../src/actions/ActionExecutor.js';
import { createLogger } from '../src/observability/Logger.js';
import type { ActionExecutionContext, ShellActionDefinition } from '../src/actions/ActionDefinitions.js';

const logger = createLogger({ level: 'silent' });

const ctx: ActionExecutionContext = {
  sessionId: 'session-1',
  userId: 'user-1',
  channel: 'test',
  externalUserId: 'user-1',
  prompt: 'prompt',
  logger,
};

const mkShellAction = (envAllowlist?: readonly string[]): ShellActionDefinition =>
  ({
    id: 'print-env',
    title: 'Print env',
    description: 'Reports whether a secret env var is visible to the child process.',
    kind: 'shell',
    inputSchema: z.object({}),
    command: process.execPath,
    buildArgs: () => [
      '-e',
      "process.stdout.write(process.env.AGENTIC_SECRET_FOR_TESTS ? 'present' : 'missing')",
    ],
    ...(envAllowlist ? { envAllowlist } : {}),
  }) satisfies ShellActionDefinition;

describe('ActionExecutor', () => {
  it('does not leak the parent environment into shell actions by default', async () => {
    const executor = new ActionExecutor();
    const previous = process.env.AGENTIC_SECRET_FOR_TESTS;
    process.env.AGENTIC_SECRET_FOR_TESTS = 'super-secret';

    try {
      const result = await executor.execute(mkShellAction(), {}, ctx);
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe('missing');
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTIC_SECRET_FOR_TESTS;
      } else {
        process.env.AGENTIC_SECRET_FOR_TESTS = previous;
      }
    }
  });

  it('passes through only explicitly allowlisted environment variables', async () => {
    const executor = new ActionExecutor();
    const previous = process.env.AGENTIC_SECRET_FOR_TESTS;
    process.env.AGENTIC_SECRET_FOR_TESTS = 'super-secret';

    try {
      const result = await executor.execute(
        mkShellAction(['AGENTIC_SECRET_FOR_TESTS']),
        {},
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe('present');
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTIC_SECRET_FOR_TESTS;
      } else {
        process.env.AGENTIC_SECRET_FOR_TESTS = previous;
      }
    }
  });
});
