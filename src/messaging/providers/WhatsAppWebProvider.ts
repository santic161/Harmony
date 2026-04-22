import type { InboundMessage, OutboundMessage } from '../../types/Message.js';
import type { InboundHandler, MessagingProvider } from '../MessagingProvider.js';

// Structural types let callers pass a real whatsapp-web.js client without
// making this package depend on Chromium-aware runtime code.
export interface WhatsAppWebMessageLike {
  readonly from: string;
  readonly body?: string;
  readonly timestamp?: number;
  readonly fromMe?: boolean;
  readonly isStatus?: boolean;
}

export interface WhatsAppWebClientLike {
  on(event: 'message', listener: (msg: WhatsAppWebMessageLike) => void): void;
  removeListener(event: 'message', listener: (msg: WhatsAppWebMessageLike) => void): void;
  sendMessage(chatId: string, text: string, options?: unknown): Promise<unknown>;
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;
}

export interface WhatsAppWebProviderOptions {
  readonly client: WhatsAppWebClientLike;
  readonly name?: string;
  readonly initializeClientOnStart?: boolean;
  readonly destroyClientOnStop?: boolean;
  readonly ignoreFromMe?: boolean;
  readonly ignoreStatusMessages?: boolean;
  readonly ignoreGroups?: boolean;
  readonly shouldHandleMessage?: (msg: WhatsAppWebMessageLike) => boolean;
}

export class WhatsAppWebProvider implements MessagingProvider {
  readonly name: string;
  private readonly handlers = new Set<InboundHandler>();
  private readonly listener: (raw: WhatsAppWebMessageLike) => void;
  private started = false;

  constructor(private readonly opts: WhatsAppWebProviderOptions) {
    this.name = opts.name ?? 'whatsapp';
    this.listener = (raw) => {
      if (!this.shouldHandle(raw)) return;
      const inbound: InboundMessage = {
        channel: this.name,
        externalUserId: raw.from,
        text: raw.body!,
        receivedAt: raw.timestamp !== undefined ? raw.timestamp * 1000 : Date.now(),
        raw,
      };
      for (const h of this.handlers) h(inbound);
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.opts.client.on('message', this.listener);
    if (this.opts.initializeClientOnStart && this.opts.client.initialize) {
      await this.opts.client.initialize();
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.opts.client.removeListener('message', this.listener);
    if (this.opts.destroyClientOnStop && this.opts.client.destroy) {
      await this.opts.client.destroy();
    }
    this.started = false;
  }

  async send(to: string, msg: OutboundMessage): Promise<void> {
    await this.opts.client.sendMessage(to, msg.text);
  }

  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private shouldHandle(raw: WhatsAppWebMessageLike): boolean {
    if (!raw.body || raw.body.trim().length === 0) return false;
    if (this.opts.ignoreFromMe !== false && raw.fromMe) return false;
    if (this.opts.ignoreStatusMessages !== false && raw.isStatus) return false;
    if (this.opts.ignoreGroups !== false && raw.from.endsWith('@g.us')) return false;
    if (this.opts.shouldHandleMessage && !this.opts.shouldHandleMessage(raw)) return false;
    return true;
  }
}
