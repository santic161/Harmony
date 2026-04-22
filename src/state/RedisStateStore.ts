import type { SessionState } from '../types/Session.js';
import type { StateStore } from './StateStore.js';

// Minimal structural interface — avoids hard dep on ioredis types.
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan?(
    cursor: string,
    mode: 'MATCH',
    pattern: string,
    countKeyword: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
}

export interface RedisStateStoreOptions {
  readonly keyPrefix?: string;
  readonly ttlSeconds?: number;
}

export class RedisStateStore implements StateStore {
  private readonly prefix: string;
  private readonly ttl: number | undefined;

  constructor(
    private readonly client: RedisLike,
    opts: RedisStateStoreOptions = {},
  ) {
    this.prefix = opts.keyPrefix ?? 'agentic:session:';
    this.ttl = opts.ttlSeconds;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    const raw = await this.client.get(this.key(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionState;
  }

  async save(sessionId: string, state: SessionState): Promise<void> {
    const serialized = JSON.stringify(state);
    if (this.ttl) {
      await this.client.set(this.key(sessionId), serialized, 'EX', this.ttl);
    } else {
      await this.client.set(this.key(sessionId), serialized);
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.del(this.key(sessionId));
  }

  async list(): Promise<readonly string[]> {
    const pattern = `${this.prefix}*`;
    const keys = this.client.scan
      ? await this.scanKeys(pattern)
      : await this.client.keys(pattern);
    return keys.map((k) => k.slice(this.prefix.length));
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.client.scan!(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
