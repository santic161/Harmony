/**
 * Real Telegram example.
 *
 * Requires:
 *   pnpm add node-telegram-bot-api openai
 *   env: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * Run:
 *   node --env-file=.env --import tsx examples/basic-telegram.ts
 */
import { z } from 'zod';
import OpenAI from 'openai';
import TelegramBot from 'node-telegram-bot-api';
import {
  DecisionOrchestrator,
  OpenAIProvider,
  TelegramProvider,
  createLogger,
  type OpenAILike,
  type TelegramBotLike,
} from '../src/index.js';

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
const TELEGRAM_BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
const TELEGRAM_CHAT_ID = process.env['TELEGRAM_CHAT_ID'];
if (!OPENAI_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error('Missing env: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const llm = new OpenAIProvider({ client: openai as unknown as OpenAILike, model: 'gpt-4o-mini' });
const telegram = new TelegramProvider({ bot: bot as unknown as TelegramBotLike });
const logger = createLogger({ level: 'info', pretty: true });

const orchestrator = new DecisionOrchestrator({
  llm,
  messaging: [telegram],
  logger,
  userReplyTimeoutMs: 5 * 60_000,
});

orchestrator.on('agentTurn', ({ sessionId, action, confidence }) => {
  logger.info({ sessionId, action, confidence }, 'agent turn');
});

const schema = z.object({
  choice: z.enum(['pizza', 'sushi', 'burger']),
  notes: z.string().max(200).optional(),
});

async function main(): Promise<void> {
  const decision = await orchestrator.startDecision({
    prompt:
      'Help the user decide what to have for dinner tonight. Options: pizza, sushi, burger. Ask about preferences (dietary restrictions, mood, budget) and propose one.',
    userId: 'demo-user',
    channel: 'telegram',
    externalUserId: TELEGRAM_CHAT_ID!,
    schema,
    kickoffMessage: 'Hi! I will help you decide dinner. Let me ask a few quick questions.',
  });

  logger.info({ decision }, 'decision result');
  await orchestrator.stop();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
