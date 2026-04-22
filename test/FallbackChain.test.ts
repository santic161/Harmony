import { describe, it, expect } from 'vitest';
import {
  FallbackChain,
  AllProvidersFailedError,
} from '../src/llm/FallbackChain.js';
import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from '../src/llm/LLMProvider.js';

const mkProvider = (
  name: string,
  impl: (req: LLMRequest) => Promise<LLMResponse>,
): LLMProvider => ({ name, generate: impl });

describe('FallbackChain', () => {
  it('returns first provider success', async () => {
    const a = mkProvider('a', async () => ({ text: 'hello', provider: 'a', model: 'm' }));
    const b = mkProvider('b', async () => ({ text: 'no', provider: 'b', model: 'm' }));
    const chain = new FallbackChain({ providers: [a, b] });
    const res = await chain.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello');
    expect(res.provider).toBe('a');
  });

  it('falls back to next provider on failure', async () => {
    const a = mkProvider('a', async () => {
      throw new LLMProviderError('a', 'down', false);
    });
    const b = mkProvider('b', async () => ({ text: 'from-b', provider: 'b', model: 'm' }));
    const chain = new FallbackChain({
      providers: [a, b],
      retryPerProvider: 1,
    });
    const res = await chain.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.provider).toBe('b');
  });

  it('throws AllProvidersFailedError when all fail', async () => {
    const a = mkProvider('a', async () => {
      throw new LLMProviderError('a', 'down', false);
    });
    const b = mkProvider('b', async () => {
      throw new LLMProviderError('b', 'down', false);
    });
    const chain = new FallbackChain({
      providers: [a, b],
      retryPerProvider: 1,
    });
    await expect(
      chain.generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});
