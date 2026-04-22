import { CircuitBreaker, CircuitOpenError } from '../reliability/CircuitBreaker.js';
import { retry } from '../reliability/Retry.js';
import { withTimeout } from '../reliability/Timeout.js';
import type { Logger } from '../observability/Logger.js';
import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from './LLMProvider.js';

export interface FallbackChainOptions {
  readonly providers: readonly LLMProvider[];
  readonly logger?: Logger;
  readonly stepTimeoutMs?: number;
  readonly retryPerProvider?: number;
}

export class AllProvidersFailedError extends Error {
  readonly errors: readonly Error[];
  constructor(errors: readonly Error[]) {
    super(`All LLM providers failed: ${errors.map((e) => e.message).join(' | ')}`);
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
  }
}

export class FallbackChain implements LLMProvider {
  readonly name = 'FallbackChain';
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly opts: FallbackChainOptions) {
    if (!opts.providers.length) {
      throw new Error('FallbackChain requires at least one provider');
    }
    for (const p of opts.providers) {
      this.breakers.set(p.name, new CircuitBreaker(p.name));
    }
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const errors: Error[] = [];
    const timeout = req.timeoutMs ?? this.opts.stepTimeoutMs ?? 30_000;

    for (const provider of this.opts.providers) {
      const breaker = this.breakers.get(provider.name)!;
      if (breaker.current() === 'open') {
        this.opts.logger?.warn({ provider: provider.name }, 'circuit open, skipping');
        continue;
      }
      try {
        const result = await breaker.exec(() =>
          retry(
            () => withTimeout(provider.generate(req), timeout, provider.name),
            {
              maxAttempts: this.opts.retryPerProvider ?? 2,
              isRetryable: (err) => {
                if (err instanceof LLMProviderError) return err.retriable;
                return true;
              },
              onRetry: (err, attempt, delay) => {
                this.opts.logger?.warn(
                  { provider: provider.name, attempt, delay, err: (err as Error).message },
                  'retrying llm call',
                );
              },
            },
          ),
        );
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        errors.push(e);
        if (e instanceof CircuitOpenError) continue;
        this.opts.logger?.warn(
          { provider: provider.name, err: e.message },
          'provider failed, trying next',
        );
      }
    }
    throw new AllProvidersFailedError(errors);
  }
}
