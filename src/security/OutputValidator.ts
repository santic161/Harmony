import type { ZodType } from 'zod';

export class OutputValidationError extends Error {
  readonly issues: unknown;
  constructor(message: string, issues: unknown) {
    super(message);
    this.name = 'OutputValidationError';
    this.issues = issues;
  }
}

export class OutputValidator {
  validate<T>(schema: ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new OutputValidationError(
        'LLM output failed schema validation',
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  // Best-effort extractor: models sometimes wrap JSON in ```json fences or prose.
  extractJson(raw: string): unknown {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : raw;
    const text = (candidate ?? raw).trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new OutputValidationError('No JSON object found in LLM output', { raw });
    }
    const slice = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch (err) {
      throw new OutputValidationError('Invalid JSON in LLM output', {
        raw: slice,
        cause: (err as Error).message,
      });
    }
  }
}
