import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from '../LLMProvider.js';

// Structural type for OpenAI SDK — intentionally loose so it accepts both the
// official `openai` SDK and custom implementations without tight coupling.
export interface OpenAIChatCompletion {
  readonly choices: readonly { readonly message: { readonly content: string | null } }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
  readonly model: string;
}

export interface OpenAILike {
  readonly chat: {
    readonly completions: {
      // Deliberately accepts unknown-shaped args — callers always spread the
      // SDK-native parameter shape via the provider.
      create(args: Record<string, unknown>): Promise<OpenAIChatCompletion>;
    };
  };
}

export interface OpenAIProviderOptions {
  readonly client: OpenAILike;
  readonly model?: string;
  readonly name?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly defaultModel: string;

  constructor(private readonly opts: OpenAIProviderOptions) {
    this.name = opts.name ?? 'openai';
    this.defaultModel = opts.model ?? 'gpt-4o-mini';
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model ?? this.defaultModel;
    try {
      const resp = await this.opts.client.chat.completions.create({
        model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      });
      const text = resp.choices[0]?.message.content ?? '';
      if (!text) throw new LLMProviderError(this.name, 'Empty response', true);
      const usage = resp.usage
        ? {
            promptTokens: resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
            totalTokens: resp.usage.total_tokens,
          }
        : undefined;
      return {
        text,
        provider: this.name,
        model: resp.model,
        ...(usage ? { usage } : {}),
        raw: resp,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      const e = err as { status?: number; message?: string };
      const retriable = !e.status || e.status >= 500 || e.status === 429;
      throw new LLMProviderError(this.name, e.message ?? 'Request failed', retriable, err);
    }
  }
}
