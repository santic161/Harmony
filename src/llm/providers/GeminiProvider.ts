import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  LLMProviderError,
} from '../LLMProvider.js';

export interface GeminiModelLike {
  generateContent(args: {
    contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
    systemInstruction?: { role: 'system'; parts: { text: string }[] };
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
      responseMimeType?: string;
    };
  }): Promise<{
    response: {
      text(): string;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };
    };
  }>;
}

export interface GeminiLike {
  getGenerativeModel(args: { model: string }): GeminiModelLike;
}

export interface GeminiProviderOptions {
  readonly client: GeminiLike;
  readonly model?: string;
  readonly name?: string;
}

export class GeminiProvider implements LLMProvider {
  readonly name: string;
  private readonly defaultModel: string;

  constructor(private readonly opts: GeminiProviderOptions) {
    this.name = opts.name ?? 'gemini';
    this.defaultModel = opts.model ?? 'gemini-1.5-flash';
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const modelName = req.model ?? this.defaultModel;
    const systemParts = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const convo = req.messages.filter((m) => m.role !== 'system');

    try {
      const model = this.opts.client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: convo.map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('model' as const),
          parts: [{ text: m.content }],
        })),
        ...(systemParts.length
          ? {
              systemInstruction: {
                role: 'system' as const,
                parts: [{ text: systemParts.join('\n\n') }],
              },
            }
          : {}),
        generationConfig: {
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      });
      const text = result.response.text();
      if (!text) throw new LLMProviderError(this.name, 'Empty response', true);
      const u = result.response.usageMetadata;
      const usage = u
        ? {
            promptTokens: u.promptTokenCount,
            completionTokens: u.candidatesTokenCount,
            totalTokens: u.totalTokenCount,
          }
        : undefined;
      return {
        text,
        provider: this.name,
        model: modelName,
        ...(usage ? { usage } : {}),
        raw: result,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      const e = err as { status?: number; message?: string };
      const retriable = !e.status || e.status >= 500 || e.status === 429;
      throw new LLMProviderError(this.name, e.message ?? 'Request failed', retriable, err);
    }
  }
}
