import type { SessionState } from '../types/Session.js';
import type { StateStore } from './StateStore.js';

export class InMemoryStateStore implements StateStore {
  private readonly map = new Map<string, SessionState>();

  async get(sessionId: string): Promise<SessionState | null> {
    return this.map.get(sessionId) ?? null;
  }

  async save(sessionId: string, state: SessionState): Promise<void> {
    this.map.set(sessionId, state);
  }

  async delete(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }

  async list(): Promise<readonly string[]> {
    return [...this.map.keys()];
  }
}
