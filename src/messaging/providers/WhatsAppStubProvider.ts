import type { InboundMessage, OutboundMessage } from '../../types/Message.js';
import type { InboundHandler, MessagingProvider } from '../MessagingProvider.js';

/**
 * WhatsAppStubProvider
 *
 * Ships intentionally without a hard dep on `whatsapp-web.js`. Use this as a
 * reference implementation: wire your own `wwebjs` Client inside the hooks
 * passed to `WhatsAppStubProvider` (see examples/whatsapp-stub.ts).
 *
 * The stub itself:
 *  - Accepts an optional `send` hook (defaults to console.log)
 *  - Exposes `inject(raw)` for tests / manual message injection
 *  - Implements the full MessagingProvider interface
 */
export interface WhatsAppStubOptions {
  readonly sendHook?: (to: string, msg: OutboundMessage) => Promise<void> | void;
  readonly name?: string;
}

export class WhatsAppStubProvider implements MessagingProvider {
  readonly name: string;
  private readonly handlers = new Set<InboundHandler>();
  private started = false;

  constructor(private readonly opts: WhatsAppStubOptions = {}) {
    this.name = opts.name ?? 'whatsapp';
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.handlers.clear();
  }

  async send(to: string, msg: OutboundMessage): Promise<void> {
    if (!this.started) throw new Error('WhatsAppStubProvider: not started');
    if (this.opts.sendHook) {
      await this.opts.sendHook(to, msg);
    } else {
      console.log(`[whatsapp-stub -> ${to}] ${msg.text}`);
    }
  }

  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Manual injection - use from wwebjs message listener or tests. */
  inject(raw: { externalUserId: string; text: string; receivedAt?: number; raw?: unknown }): void {
    if (!this.started) return;
    const msg: InboundMessage = {
      channel: this.name,
      externalUserId: raw.externalUserId,
      text: raw.text,
      receivedAt: raw.receivedAt ?? Date.now(),
      ...(raw.raw !== undefined ? { raw: raw.raw } : {}),
    };
    for (const h of this.handlers) h(msg);
  }
}
