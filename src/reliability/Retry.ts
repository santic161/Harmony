export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly capMs: number;
  readonly factor: number;
  readonly isRetryable?: (err: unknown) => boolean;
  readonly onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 4,
  baseMs: 500,
  capMs: 8000,
  factor: 2,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const retry = async <T>(
  fn: () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> => {
  const o: RetryOptions = { ...DEFAULT_RETRY, ...opts };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (o.isRetryable && !o.isRetryable(err)) throw err;
      if (attempt === o.maxAttempts) break;
      const exp = Math.min(o.capMs, o.baseMs * Math.pow(o.factor, attempt - 1));
      const delay = Math.floor(Math.random() * exp); // full jitter
      o.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
};
