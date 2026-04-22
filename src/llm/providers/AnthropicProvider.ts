import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from '../LLMProvider.js';

export interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      system?: string;
      messages: { role: 'user' | 'assistant'; content: string }[];
      max_tokens: number;
      temperature?: number;
    }): Promise<{
      content: { type: string; text?: string }[];
      model: string;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface AnthropicProviderOptions {
  readonly client: AnthropicLike;
  readonly model?: string;
  readonly name?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  private readonly defaultModel: string;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.name = opts.name ?? 'anthropic';
    this.defaultModel = opts.model ?? 'claude-3-5-sonnet-latest';
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model ?? this.defaultModel;
    const systemParts = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const convo = req.messages.filter((m) => m.role !== 'system');

    try {
      const resp = await this.opts.client.messages.create({
        model,
        ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
        messages: convo.map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
        max_tokens: req.maxTokens ?? 1024,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });
      const text = resp.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      if (!text) throw new LLMProviderError(this.name, 'Empty response', true);
      const usage = resp.usage
        ? {
            promptTokens: resp.usage.input_tokens,
            completionTokens: resp.usage.output_tokens,
            totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
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
