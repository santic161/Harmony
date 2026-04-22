import { createInterface, type Interface } from 'node:readline';
import type { InboundMessage, OutboundMessage } from '../../types/Message.js';
import type { InboundHandler, MessagingProvider } from '../MessagingProvider.js';

export interface ConsoleProviderOptions {
  readonly externalUserId?: string;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export class ConsoleProvider implements MessagingProvider {
  readonly name = 'console';
  private readonly handlers = new Set<InboundHandler>();
  private rl: Interface | undefined;
  private readonly externalUserId: string;
  private readonly out: NodeJS.WritableStream;
  private readonly inp: NodeJS.ReadableStream;

  constructor(opts: ConsoleProviderOptions = {}) {
    this.externalUserId = opts.externalUserId ?? 'console-user';
    this.out = opts.output ?? process.stdout;
    this.inp = opts.input ?? process.stdin;
  }

  async start(): Promise<void> {
    this.rl = createInterface({ input: this.inp, output: this.out, terminal: false });
    this.rl.on('line', (line) => {
      const msg: InboundMessage = {
        channel: this.name,
        externalUserId: this.externalUserId,
        text: line,
        receivedAt: Date.now(),
      };
      for (const h of this.handlers) h(msg);
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = undefined;
  }

  async send(to: string, msg: OutboundMessage): Promise<void> {
    this.out.write(`\n[agent → ${to}] ${msg.text}\n> `);
  }

  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
