import { describe, expect, it } from 'vitest';
import { WhatsAppWebProvider } from '../src/messaging/providers/WhatsAppWebProvider.js';
import { parseReviewReply, resolveDraftSelection } from '../src/demo-support/approvalDemo.js';
import type {
  WhatsAppWebClientLike,
  WhatsAppWebMessageLike,
} from '../src/messaging/providers/WhatsAppWebProvider.js';

class FakeWhatsAppClient implements WhatsAppWebClientLike {
  readonly sent: Array<{ to: string; text: string }> = [];
  private readonly listeners = new Set<(msg: WhatsAppWebMessageLike) => void>();
  initialized = 0;
  destroyed = 0;

  on(_event: 'message', listener: (msg: WhatsAppWebMessageLike) => void): void {
    this.listeners.add(listener);
  }

  removeListener(_event: 'message', listener: (msg: WhatsAppWebMessageLike) => void): void {
    this.listeners.delete(listener);
  }

  async sendMessage(chatId: string, text: string): Promise<unknown> {
    this.sent.push({ to: chatId, text });
    return { ok: true };
  }

  async initialize(): Promise<void> {
    this.initialized += 1;
  }

  async destroy(): Promise<void> {
    this.destroyed += 1;
  }

  emit(msg: WhatsAppWebMessageLike): void {
    for (const listener of this.listeners) listener(msg);
  }
}

describe('WhatsAppWebProvider', () => {
  it('forwards inbound messages and manages the client lifecycle', async () => {
    const client = new FakeWhatsAppClient();
    const provider = new WhatsAppWebProvider({
      client,
      initializeClientOnStart: true,
      destroyClientOnStop: true,
    });

    const inbound: string[] = [];
    provider.onReply((message) => inbound.push(`${message.externalUserId}:${message.text}`));

    await provider.start();
    client.emit({ from: '15550000001@c.us', body: 'approve looks good', timestamp: 10 });
    client.emit({ from: '15550000002@g.us', body: 'ignore this group message', timestamp: 11 });
    client.emit({ from: '15550000003@c.us', body: '   ', timestamp: 12 });

    await provider.send('15550000001@c.us', { text: 'draft body' });
    await provider.stop();

    expect(client.initialized).toBe(1);
    expect(client.destroyed).toBe(1);
    expect(inbound).toEqual(['15550000001@c.us:approve looks good']);
    expect(client.sent).toEqual([{ to: '15550000001@c.us', text: 'draft body' }]);
  });
});

describe('approval demo helpers', () => {
  it('parses reviewer replies and resolves draft selections', () => {
    expect(parseReviewReply('approve ship it')).toEqual({
      outcome: 'approved',
      feedback: 'ship it',
    });
    expect(parseReviewReply('edit tighten the hook')).toEqual({
      outcome: 'edit_requested',
      feedback: 'tighten the hook',
    });
    expect(parseReviewReply('reject')).toEqual({ outcome: 'rejected' });

    const drafts = [
      {
        id: 'draft-1',
        templateId: 'launch',
        label: 'Launch note',
        channel: 'LinkedIn',
        audience: 'Ops',
        body: 'Body',
        cta: 'CTA',
        hashtags: ['#demo'],
      },
    ];

    expect(resolveDraftSelection('1', drafts)?.id).toBe('draft-1');
    expect(resolveDraftSelection('draft-1', drafts)?.id).toBe('draft-1');
    expect(resolveDraftSelection('missing', drafts)).toBeNull();
  });
});
