import type { InboundMessage, OutboundMessage } from '../../types/Message.js';
import type { InboundHandler, MessagingProvider } from '../MessagingProvider.js';

// Structural shape matching node-telegram-bot-api without requiring it at compile time.
export interface TelegramBotLike {
  on(event: 'message', listener: (msg: TelegramRawMessage) => void): void;
  removeListener(event: 'message', listener: (msg: TelegramRawMessage) => void): void;
  sendMessage(chatId: number | string, text: string, options?: unknown): Promise<unknown>;
  startPolling?(): Promise<void>;
  stopPolling?(): Promise<void>;
}

export interface TelegramRawMessage {
  message_id: number;
  from?: { id: number; username?: string };
  chat: { id: number };
  text?: string;
  date: number;
}

export interface TelegramProviderOptions {
  readonly bot: TelegramBotLike;
  readonly name?: string;
}

export class TelegramProvider implements MessagingProvider {
  readonly name: string;
  private readonly handlers = new Set<InboundHandler>();
  private readonly listener: (raw: TelegramRawMessage) => void;

  constructor(private readonly opts: TelegramProviderOptions) {
    this.name = opts.name ?? 'telegram';
    this.listener = (raw) => {
      if (!raw.text || !raw.from) return;
      const inbound: InboundMessage = {
        channel: this.name,
        externalUserId: String(raw.from.id),
        text: raw.text,
        receivedAt: raw.date * 1000,
        raw,
      };
      for (const h of this.handlers) h(inbound);
    };
  }

  async start(): Promise<void> {
    this.opts.bot.on('message', this.listener);
    if (this.opts.bot.startPolling) await this.opts.bot.startPolling();
  }

  async stop(): Promise<void> {
    this.opts.bot.removeListener('message', this.listener);
    if (this.opts.bot.stopPolling) await this.opts.bot.stopPolling();
  }

  async send(to: string, msg: OutboundMessage): Promise<void> {
    await this.opts.bot.sendMessage(to, msg.text);
  }

  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
