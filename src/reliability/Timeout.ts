export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(`Operation${label ? ` "${label}"` : ''} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};
