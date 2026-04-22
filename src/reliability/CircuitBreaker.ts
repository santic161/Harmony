export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly rollingWindowMs: number;
  readonly openDurationMs: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit "${name}" is open`);
    this.name = 'CircuitOpenError';
  }
}

export const DEFAULT_BREAKER: CircuitBreakerOptions = {
  failureThreshold: 5,
  rollingWindowMs: 60_000,
  openDurationMs: 30_000,
};

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures: number[] = [];
  private openedAt = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(
    readonly name: string,
    opts: Partial<CircuitBreakerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_BREAKER, ...opts };
  }

  current(): BreakerState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.opts.openDurationMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.current();
    if (s === 'open') throw new CircuitOpenError(this.name);
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = [];
    this.state = 'closed';
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.opts.rollingWindowMs);
    this.failures.push(now);
    if (this.failures.length >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }
}
