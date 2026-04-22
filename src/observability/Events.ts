import { EventEmitter } from 'node:events';
import type { Decision } from '../types/Decision.js';
import type { InboundMessage } from '../types/Message.js';
import type { ActionResult } from '../actions/ActionDefinitions.js';

export interface EngineEvents {
  decisionStart: (payload: { sessionId: string; userId: string; prompt: string }) => void;
  userReply: (payload: { sessionId: string; message: InboundMessage }) => void;
  agentTurn: (payload: { sessionId: string; action: string; confidence?: number }) => void;
  actionStart: (payload: {
    sessionId: string;
    actionId: string;
    kind: 'handler' | 'shell';
  }) => void;
  actionSuccess: (payload: {
    sessionId: string;
    actionId: string;
    result: ActionResult;
  }) => void;
  actionError: (payload: {
    sessionId: string;
    actionId: string;
    result: ActionResult;
  }) => void;
  decisionFinalized: (payload: { sessionId: string; decision: Decision<unknown> }) => void;
  error: (payload: { sessionId: string | null; error: Error; phase: string }) => void;
}

export class TypedEmitter extends EventEmitter {
  constructor() {
    super();
    // Prevent Node's default "unhandled error event throws" behavior —
    // library consumers opt in to error handling by attaching a listener.
    super.on('error', () => undefined);
  }

  override on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override once<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof EngineEvents>(
    event: K,
    ...args: Parameters<EngineEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
