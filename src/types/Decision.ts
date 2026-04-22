import type { Turn } from './Session.js';

export type DecisionStatus = 'finalized' | 'aborted' | 'timeout';

export interface DecisionUsage {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly totalUsd: number;
}

export interface Decision<T> {
  readonly status: DecisionStatus;
  readonly value: T | null;
  readonly confidence: number;
  readonly reason?: string;
  readonly turns: readonly Turn[];
  readonly costUsd?: number;
  readonly usage?: DecisionUsage;
  readonly sessionId: string;
}
