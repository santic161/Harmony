import type { BufferedInboundMessage } from './Message.js';

export type TurnRole = 'system' | 'agent' | 'user' | 'action' | 'internal';

export interface ActionTurnData {
  readonly actionId: string;
  readonly title: string;
  readonly kind: 'handler' | 'shell';
  readonly status: 'succeeded' | 'failed';
  readonly inputSummary: string;
  readonly outputSummary?: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly exitCode?: number;
}

export interface Turn {
  readonly role: TurnRole;
  readonly content: string;
  readonly ts: number;
  readonly flags?: readonly string[];
  readonly action?: ActionTurnData;
}

export type SessionStatus =
  | 'active'
  | 'awaiting_user'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'finalizable'
  | 'finalized'
  | 'aborted'
  | 'timeout';

export interface SessionState {
  readonly sessionId: string;
  readonly userId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly prompt: string;
  readonly status: SessionStatus;
  readonly turns: readonly Turn[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly schemaDescription?: string;
  readonly inbox?: readonly BufferedInboundMessage[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly skillIds?: readonly string[];
  readonly allowedActionIds?: readonly string[];
}
