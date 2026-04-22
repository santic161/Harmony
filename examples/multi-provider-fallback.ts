/**
 * Multi-provider fallback example.
 * OpenAI -> Anthropic -> Gemini. First healthy one wins.
 */
import { z } from 'zod';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  DecisionOrchestrator,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  FallbackChain,
  ConsoleProvider,
  createLogger,
  CostTracker,
  type OpenAILike,
  type AnthropicLike,
  type GeminiLike,
  type LLMProvider,
} from '../src/index.js';

const logger = createLogger({ level: 'debug', pretty: true });
const costTracker = new CostTracker();

const providers: LLMProvider[] = [];
if (process.env['OPENAI_API_KEY']) {
  providers.push(
    new OpenAIProvider({
      client: new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] }) as unknown as OpenAILike,
    }),
  );
}
if (process.env['ANTHROPIC_API_KEY']) {
  providers.push(
    new AnthropicProvider({
      client: new Anthropic({
        apiKey: process.env['ANTHROPIC_API_KEY'],
      }) as unknown as AnthropicLike,
    }),
  );
}
if (process.env['GOOGLE_API_KEY']) {
  providers.push(
    new GeminiProvider({
      client: new GoogleGenerativeAI(
        process.env['GOOGLE_API_KEY'],
      ) as unknown as GeminiLike,
    }),
  );
}
if (!providers.length) throw new Error('Set at least one LLM provider API key in env');

const chain = new FallbackChain({ providers, logger, stepTimeoutMs: 30_000 });
const console_ = new ConsoleProvider({ externalUserId: 'local-user' });

const orchestrator = new DecisionOrchestrator({
  llm: chain,
  messaging: [console_],
  logger,
  costTracker,
});

async function main(): Promise<void> {
  const schema = z.object({
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    owner: z.string().min(1),
  });

  const decision = await orchestrator.startDecision({
    prompt:
      'Triage a support ticket. Find out severity and assign an owner (engineering, support, sales). Ask the user clarifying questions in the terminal.',
    userId: 'local',
    channel: 'console',
    externalUserId: 'local-user',
    schema,
    kickoffMessage: 'New ticket triage starting — reply in the terminal.',
  });

  logger.info({ decision, cost: costTracker.snapshot() }, 'done');
  await orchestrator.stop();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
