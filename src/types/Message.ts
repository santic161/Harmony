export interface OutboundMessage {
  readonly text: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface BufferedInboundMessage {
  readonly channel: string;
  readonly externalUserId: string;
  readonly text: string;
  readonly receivedAt: number;
}

export interface InboundMessage {
  readonly channel: string;
  readonly externalUserId: string;
  readonly text: string;
  readonly receivedAt: number;
  readonly raw?: unknown;
}

export const toBufferedInboundMessage = (
  msg: InboundMessage,
): BufferedInboundMessage => ({
  channel: msg.channel,
  externalUserId: msg.externalUserId,
  text: msg.text,
  receivedAt: msg.receivedAt,
});
