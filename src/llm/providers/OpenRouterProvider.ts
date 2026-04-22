import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from '../LLMProvider.js';

export interface OpenRouterProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly referer?: string;
  readonly appTitle?: string;
  readonly fetchImpl?: typeof fetch;
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message?: string; code?: number };
}

export class OpenRouterProvider implements LLMProvider {
  readonly name: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: OpenRouterProviderOptions) {
    this.name = opts.name ?? 'openrouter';
    this.defaultModel = opts.model ?? 'openrouter/auto';
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.jsonMode) body['response_format'] = { type: 'json_object' };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.opts.referer) headers['HTTP-Referer'] = this.opts.referer;
    if (this.opts.appTitle) headers['X-Title'] = this.opts.appTitle;

    let resp: Response;
    try {
      resp = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LLMProviderError(this.name, (err as Error).message, true, err);
    }

    if (!resp.ok) {
      const retriable = resp.status >= 500 || resp.status === 429;
      const txt = await resp.text().catch(() => '');
      throw new LLMProviderError(
        this.name,
        `HTTP ${resp.status}: ${txt.slice(0, 200)}`,
        retriable,
      );
    }

    const json = (await resp.json()) as OpenRouterResponse;
    if (json.error) {
      throw new LLMProviderError(this.name, json.error.message ?? 'unknown error', true);
    }
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LLMProviderError(this.name, 'Empty response', true);
    const usage = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined;
    return {
      text,
      provider: this.name,
      model: json.model ?? model,
      ...(usage ? { usage } : {}),
      raw: json,
    };
  }
}
