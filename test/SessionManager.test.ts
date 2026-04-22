import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/core/SessionManager.js';
import { InMemoryStateStore } from '../src/state/InMemoryStateStore.js';
import type { InboundMessage } from '../src/types/Message.js';
import type { SessionState } from '../src/types/Session.js';
import type { InboundHandler, MessagingProvider } from '../src/messaging/MessagingProvider.js';

class TestProvider implements MessagingProvider {
  readonly name = 'test';
  private readonly handlers = new Set<InboundHandler>();

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(): Promise<void> {}

  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  inject(text: string, externalUserId = 'user-1'): void {
    const msg: InboundMessage = {
      channel: this.name,
      externalUserId,
      text,
      receivedAt: Date.now(),
    };
    for (const handler of this.handlers) handler(msg);
  }
}

const mkState = (): SessionState => ({
  sessionId: 'session-1',
  userId: 'user-1',
  channel: 'test',
  externalUserId: 'user-1',
  prompt: 'prompt',
  status: 'awaiting_user',
  turns: [],
  createdAt: 1,
  updatedAt: 1,
  inbox: [
    {
      channel: 'test',
      externalUserId: 'user-1',
      text: 'first buffered reply',
      receivedAt: 10,
    },
  ],
});

describe('SessionManager', () => {
  it('consumes a buffered reply only once', async () => {
    const store = new InMemoryStateStore();
    const sessions = new SessionManager(store);
    const provider = new TestProvider();
    sessions.registerProvider(provider);
    await sessions.attachSession(mkState());

    const first = await sessions.waitForReply('session-1', 200);
    expect(first.text).toBe('first buffered reply');

    const storedAfterFirstRead = await store.get('session-1');
    expect(storedAfterFirstRead?.inbox).toBeUndefined();

    const secondReplyPromise = sessions.waitForReply('session-1', 200);
    setTimeout(() => provider.inject('second live reply'), 20);

    const second = await secondReplyPromise;
    expect(second.text).toBe('second live reply');
  });
});
