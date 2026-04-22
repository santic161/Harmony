import type { MessagingProvider } from '../messaging/MessagingProvider.js';
import type { BufferedInboundMessage, InboundMessage } from '../types/Message.js';
import { toBufferedInboundMessage } from '../types/Message.js';
import type { SessionState } from '../types/Session.js';
import type { StateStore } from '../state/StateStore.js';
import { TimeoutError } from '../reliability/Timeout.js';

interface Waiter {
  readonly resolve: (msg: InboundMessage) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Owns session lifecycle and message correlation.
 *
 * Correlation: an inbound channel message is routed to the session whose
 * (channel, externalUserId) tuple matches. The active session is the most
 * recent non-finalized one. Only one active session per (channel, externalUserId)
 * is allowed — enforced at startDecision time by DecisionOrchestrator.
 */
export class SessionManager {
  private readonly indexByExternal = new Map<string, string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly providers = new Map<string, MessagingProvider>();
  private readonly detachers = new Map<string, () => void>();

  constructor(private readonly store: StateStore) {}

  registerProvider(provider: MessagingProvider): void {
    this.providers.set(provider.name, provider);
    this.attachProvider(provider);
  }

  restoreProviderRoutes(): void {
    for (const provider of this.providers.values()) {
      this.attachProvider(provider);
    }
  }

  getProvider(name: string): MessagingProvider | undefined {
    return this.providers.get(name);
  }

  async attachSession(state: SessionState): Promise<void> {
    await this.store.save(state.sessionId, state);
    this.indexByExternal.set(this.extKey(state.channel, state.externalUserId), state.sessionId);
  }

  async updateSession(state: SessionState): Promise<void> {
    await this.store.save(state.sessionId, state);
    if (isTerminalState(state.status)) {
      this.indexByExternal.delete(this.extKey(state.channel, state.externalUserId));
    }
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    return this.store.get(sessionId);
  }

  async detachSession(sessionId: string): Promise<void> {
    const state = await this.store.get(sessionId);
    if (state) {
      this.indexByExternal.delete(this.extKey(state.channel, state.externalUserId));
    }

    const waiter = this.waiters.get(sessionId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(sessionId);
      waiter.reject(new Error(`Session ${sessionId} detached`));
    }

    await this.store.delete(sessionId);
  }

  hasActiveFor(channel: string, externalUserId: string): boolean {
    return this.indexByExternal.has(this.extKey(channel, externalUserId));
  }

  async rehydrate(): Promise<readonly SessionState[]> {
    const list = this.store.list ? await this.store.list() : [];
    const active: SessionState[] = [];
    for (const sessionId of list) {
      const state = await this.store.get(sessionId);
      if (!state || isTerminalState(state.status)) continue;
      this.indexByExternal.set(this.extKey(state.channel, state.externalUserId), state.sessionId);
      active.push(state);
    }
    return active;
  }

  async waitForReply(sessionId: string, timeoutMs: number): Promise<InboundMessage> {
    if (this.waiters.has(sessionId)) {
      throw new Error(`Already waiting on session ${sessionId}`);
    }

    const existing = await this.store.get(sessionId);
    const buffered = existing?.inbox?.[0];
    if (existing && buffered) {
      const nextInbox = existing.inbox?.slice(1) ?? [];
      const nextState: SessionState = nextInbox.length
        ? { ...existing, inbox: nextInbox, updatedAt: Date.now() }
        : (() => {
            const cleared = { ...existing, updatedAt: Date.now() } as SessionState & {
              inbox?: SessionState['inbox'];
            };
            delete cleared.inbox;
            return cleared;
          })();
      await this.store.save(sessionId, nextState);
      return this.toInbound(existing, buffered);
    }

    return new Promise<InboundMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(sessionId);
        reject(new TimeoutError(timeoutMs, `waitForReply(${sessionId})`));
      }, timeoutMs);
      this.waiters.set(sessionId, { resolve, reject, timer });
    });
  }

  async shutdown(): Promise<void> {
    for (const detach of this.detachers.values()) detach();
    this.detachers.clear();
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('SessionManager shutting down'));
    }
    this.waiters.clear();
  }

  private route(msg: InboundMessage): void {
    const key = this.extKey(msg.channel, msg.externalUserId);
    const sessionId = this.indexByExternal.get(key);
    if (!sessionId) return;
    const waiter = this.waiters.get(sessionId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(sessionId);
      waiter.resolve(msg);
      return;
    }

    void this.bufferMessage(sessionId, msg);
  }

  private async bufferMessage(sessionId: string, msg: InboundMessage): Promise<void> {
    const state = await this.store.get(sessionId);
    if (!state) return;
    const nextInbox = [...(state.inbox ?? []), toBufferedInboundMessage(msg)];
    await this.store.save(sessionId, {
      ...state,
      inbox: nextInbox,
      updatedAt: msg.receivedAt,
    });
  }

  private toInbound(
    state: SessionState,
    buffered: BufferedInboundMessage,
  ): InboundMessage {
    return {
      channel: state.channel,
      externalUserId: state.externalUserId,
      text: buffered.text,
      receivedAt: buffered.receivedAt,
    };
  }

  private extKey(channel: string, externalUserId: string): string {
    return `${channel}:${externalUserId}`;
  }

  private attachProvider(provider: MessagingProvider): void {
    if (this.detachers.has(provider.name)) return;
    const detach = provider.onReply((msg) => this.route(msg));
    this.detachers.set(provider.name, detach);
  }
}

const isTerminalState = (status: SessionState['status']): boolean =>
  status === 'finalized' || status === 'aborted' || status === 'timeout';
