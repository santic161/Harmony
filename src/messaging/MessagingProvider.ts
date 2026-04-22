import type { InboundMessage, OutboundMessage } from '../types/Message.js';

export type InboundHandler = (msg: InboundMessage) => void;

export interface MessagingProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(to: string, msg: OutboundMessage): Promise<void>;
  onReply(handler: InboundHandler): () => void;
}
