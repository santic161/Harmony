import { describe, it, expect, vi } from 'vitest';
import { retry } from '../src/reliability/Retry.js';
import { withTimeout, TimeoutError } from '../src/reliability/Timeout.js';
import { CircuitBreaker, CircuitOpenError } from '../src/reliability/CircuitBreaker.js';

describe('retry', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(retry(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n < 3) throw new Error('boom');
      return 'ok';
    });
    await expect(retry(fn, { maxAttempts: 5, baseMs: 1, capMs: 5, factor: 2 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects isRetryable', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(
      retry(fn, { maxAttempts: 5, baseMs: 1, capMs: 5, factor: 2, isRetryable: () => false }),
    ).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('throws TimeoutError past deadline', async () => {
    const slow = new Promise((r) => setTimeout(() => r('late'), 100));
    await expect(withTimeout(slow, 20)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('passes through successful result', async () => {
    const fast = Promise.resolve('ok');
    await expect(withTimeout(fast, 1000)).resolves.toBe('ok');
  });
});

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 3,
      rollingWindowMs: 1000,
      openDurationMs: 100,
    });
    const fail = () => Promise.reject(new Error('x'));
    for (let i = 0; i < 3; i++) await cb.exec(fail).catch(() => {});
    await expect(cb.exec(fail)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('transitions to half_open after cooldown', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 2,
      rollingWindowMs: 1000,
      openDurationMs: 30,
    });
    const fail = () => Promise.reject(new Error('x'));
    await cb.exec(fail).catch(() => {});
    await cb.exec(fail).catch(() => {});
    expect(cb.current()).toBe('open');
    await new Promise((r) => setTimeout(r, 40));
    expect(cb.current()).toBe('half_open');
    await cb.exec(() => Promise.resolve('ok'));
    expect(cb.current()).toBe('closed');
  });
});
