import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  OutputValidator,
  OutputValidationError,
} from '../src/security/OutputValidator.js';
import { AgentActionSchema } from '../src/utils/schemas.js';

describe('OutputValidator', () => {
  const v = new OutputValidator();

  it('extracts JSON from fenced block', () => {
    const raw = 'here:\n```json\n{"action":"abort","reason":"x"}\n```';
    const obj = v.extractJson(raw);
    expect(obj).toEqual({ action: 'abort', reason: 'x' });
  });

  it('extracts JSON from prose', () => {
    const raw = 'sure thing { "action": "ask", "question": "ok?" } end';
    const obj = v.extractJson(raw);
    expect(obj).toEqual({ action: 'ask', question: 'ok?' });
  });

  it('throws when no JSON present', () => {
    expect(() => v.extractJson('no json here')).toThrowError(OutputValidationError);
  });

  it('validates AgentAction schema', () => {
    const ok = v.validate(AgentActionSchema, {
      action: 'finalize',
      value: { x: 1 },
      confidence: 0.9,
    });
    expect(ok.action).toBe('finalize');
  });

  it('rejects invalid AgentAction', () => {
    expect(() =>
      v.validate(AgentActionSchema, { action: 'finalize', confidence: 2 }),
    ).toThrowError(OutputValidationError);
  });

  it('wraps zod for arbitrary schemas', () => {
    const s = z.object({ n: z.number() });
    expect(() => v.validate(s, { n: 'nope' })).toThrowError(OutputValidationError);
    expect(v.validate(s, { n: 7 })).toEqual({ n: 7 });
  });
});
