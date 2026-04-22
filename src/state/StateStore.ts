import type { SessionState } from '../types/Session.js';

export interface StateStore {
  get(sessionId: string): Promise<SessionState | null>;
  save(sessionId: string, state: SessionState): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list?(): Promise<readonly string[]>;
}
