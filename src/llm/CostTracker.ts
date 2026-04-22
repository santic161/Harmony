import type { LLMResponse } from './LLMProvider.js';

export interface ModelPricing {
  readonly inputPer1k: number;
  readonly outputPer1k: number;
}

export interface CostSnapshot {
  readonly totalUsd: number;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'claude-3-5-sonnet-latest': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-haiku-latest': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
};

export const estimateCost = (
  model: string,
  promptTokens: number,
  completionTokens: number,
  pricing: Readonly<Record<string, ModelPricing>> = DEFAULT_PRICING,
): number => {
  const p = pricing[model];
  if (!p) return 0;
  return (promptTokens / 1000) * p.inputPer1k + (completionTokens / 1000) * p.outputPer1k;
};

export class CostTracker {
  private totalUsd = 0;
  private calls = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;

  record(res: LLMResponse): number {
    const cost =
      res.costUsd ??
      (res.usage
        ? estimateCost(res.model, res.usage.promptTokens, res.usage.completionTokens)
        : 0);
    this.totalUsd += cost;
    this.calls += 1;
    if (res.usage) {
      this.promptTokens += res.usage.promptTokens;
      this.completionTokens += res.usage.completionTokens;
      this.totalTokens += res.usage.totalTokens;
    }
    return cost;
  }

  snapshot(): CostSnapshot {
    return {
      totalUsd: this.totalUsd,
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
    };
  }

  reset(): void {
    this.totalUsd = 0;
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
  }
}
