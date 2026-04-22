import { z } from 'zod';

export const AgentActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ask'),
    question: z.string().min(1).max(2000),
    reasoning: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('propose'),
    proposal: z.string().min(1).max(4000),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('finalize'),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('run_action'),
    actionId: z.string().min(1).max(200),
    input: z.unknown(),
    progressMessage: z.string().min(1).max(1000),
    reasoning: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal('abort'),
    reason: z.string().min(1).max(1000),
  }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;
