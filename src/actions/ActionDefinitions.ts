import { z, type ZodTypeAny } from 'zod';
import type { Logger } from '../observability/Logger.js';

export interface SkillDefinition {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly preferredActionIds?: readonly string[];
  readonly examples?: readonly string[];
}

export interface ActionExecutionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly prompt: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly logger: Logger;
}

interface ActionDefinitionBase<TInputSchema extends ZodTypeAny = ZodTypeAny> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly timeoutMs?: number;
  readonly approvalMode?: 'auto';
}

export interface HandlerActionDefinition<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends ActionDefinitionBase<TInputSchema> {
  readonly kind: 'handler';
  readonly execute: (
    ctx: ActionExecutionContext,
    input: z.infer<TInputSchema>,
  ) => Promise<unknown> | unknown;
}

export interface ShellActionDefinition<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends ActionDefinitionBase<TInputSchema> {
  readonly kind: 'shell';
  readonly command: string;
  readonly buildArgs: (input: z.infer<TInputSchema>) => readonly string[];
  readonly cwd?: string;
  readonly envAllowlist?: readonly string[];
}

export type ActionDefinition<TInputSchema extends ZodTypeAny = ZodTypeAny> =
  | HandlerActionDefinition<TInputSchema>
  | ShellActionDefinition<TInputSchema>;

export interface ActionResult {
  readonly ok: boolean;
  readonly status: 'succeeded' | 'failed';
  readonly actionId: string;
  readonly title: string;
  readonly kind: ActionDefinition['kind'];
  readonly inputSummary: string;
  readonly outputSummary?: string;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}
