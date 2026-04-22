export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  readonly role: LLMRole;
  readonly content: string;
}

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly jsonMode?: boolean;
  readonly timeoutMs?: number;
}

export interface LLMUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly usage?: LLMUsage;
  readonly costUsd?: number;
  readonly raw?: unknown;
}

export interface LLMProvider {
  readonly name: string;
  generate(req: LLMRequest): Promise<LLMResponse>;
}

export class LLMProviderError extends Error {
  readonly provider: string;
  readonly retriable: boolean;
  override cause?: unknown;
  constructor(provider: string, message: string, retriable = true, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMProviderError';
    this.provider = provider;
    this.retriable = retriable;
    if (cause !== undefined) this.cause = cause;
  }
}
