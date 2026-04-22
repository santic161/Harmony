import { describe, it, expect } from 'vitest';
import { InMemoryStateStore } from '../src/state/InMemoryStateStore.js';
import { RedisStateStore, type RedisLike } from '../src/state/RedisStateStore.js';
import type { SessionState } from '../src/types/Session.js';

const mkState = (id: string): SessionState => ({
  sessionId: id,
  userId: 'u',
  channel: 'console',
  externalUserId: 'e',
  prompt: 'p',
  status: 'active',
  turns: [],
  createdAt: 1,
  updatedAt: 1,
});

describe('InMemoryStateStore', () => {
  it('round-trips', async () => {
    const s = new InMemoryStateStore();
    await s.save('a', mkState('a'));
    expect(await s.get('a')).toMatchObject({ sessionId: 'a' });
    expect(await s.list()).toEqual(['a']);
    await s.delete('a');
    expect(await s.get('a')).toBeNull();
  });
});

describe('RedisStateStore', () => {
  it('serializes through RedisLike', async () => {
    const store = new Map<string, string>();
    const redis: RedisLike = {
      async get(k) {
        return store.get(k) ?? null;
      },
      async set(k, v) {
        store.set(k, v);
        return 'OK';
      },
      async del(k) {
        return store.delete(k) ? 1 : 0;
      },
      async keys(pattern) {
        const prefix = pattern.replace(/\*$/, '');
        return [...store.keys()].filter((k) => k.startsWith(prefix));
      },
      async scan(cursor, _mode, pattern, _countKeyword, count) {
        const prefix = pattern.replace(/\*$/, '');
        const matches = [...store.keys()].filter((k) => k.startsWith(prefix));
        const start = Number.parseInt(cursor, 10);
        const batch = matches.slice(start, start + count);
        const next = start + count >= matches.length ? '0' : String(start + count);
        return [next, batch];
      },
    };

    const s = new RedisStateStore(redis, { keyPrefix: 't:' });
    await s.save('x', mkState('x'));
    expect(store.get('t:x')).toContain('"sessionId":"x"');
    expect(await s.get('x')).toMatchObject({ sessionId: 'x' });
    expect(await s.list()).toEqual(['x']);
    await s.delete('x');
    expect(await s.get('x')).toBeNull();
  });
});
