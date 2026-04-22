/**
 * Local demo with no API keys or external messaging services.
 *
 * Run:
 *   pnpm demo:local
 */
import { z } from 'zod';
import {
  ConsoleProvider,
  DecisionOrchestrator,
  createLogger,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../src/index.js';

const schema = z.object({
  recommendation: z.enum(['pizza', 'sushi', 'burger']),
  reason: z.string().min(1),
});

class LocalDemoLLM implements LLMProvider {
  readonly name = 'local-demo';

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const turns = req.messages
      .filter((message) => message.role === 'user')
      .map((message) => unwrapUserInput(message.content))
      .filter((content) => content !== '[BEGIN]');

    const latest = turns.at(-1)?.toLowerCase() ?? '';
    const recommendation = inferMeal(turns.join(' '));

    let payload: Record<string, unknown>;
    if (!turns.length) {
      payload = {
        action: 'ask',
        question:
          'What sounds better tonight: something cheesy, something fresh, or something hearty?',
        reasoning: 'Need a starting preference from the user.',
      };
    } else if (turns.length === 1) {
      payload = {
        action: 'propose',
        proposal: `I recommend ${recommendation} based on what you told me.`,
        confidence: 0.74,
        reasoning: 'Made a first-pass recommendation from the stated preference.',
      };
    } else if (isConfirmation(latest)) {
      payload = {
        action: 'finalize',
        value: {
          recommendation,
          reason: `The user confirmed the ${recommendation} recommendation after the proposal.`,
        },
        confidence: 0.96,
        reasoning: 'User explicitly confirmed the recommendation.',
      };
    } else {
      payload = {
        action: 'ask',
        question:
          'What should I optimize more: comfort, speed, or something lighter? Reply in one sentence.',
        reasoning: 'Need one more signal before making a stronger recommendation.',
      };
    }

    return {
      text: JSON.stringify(payload),
      provider: this.name,
      model: 'local-rule-engine',
    };
  }
}

function unwrapUserInput(content: string): string {
  return content
    .replace(/^<user_input>\s*/i, '')
    .replace(/\s*<\/user_input>$/i, '')
    .trim();
}

function inferMeal(text: string): 'pizza' | 'sushi' | 'burger' {
  const input = text.toLowerCase();
  if (/(fresh|light|healthy|fish|rice|sushi)/.test(input)) return 'sushi';
  if (/(cheesy|comfort|share|pizza|italian)/.test(input)) return 'pizza';
  return 'burger';
}

function isConfirmation(text: string): boolean {
  return /^(yes|yep|yeah|ok|okay|dale|si|sí|confirm|sounds good)/i.test(text.trim());
}

async function main(): Promise<void> {
  const logger = createLogger({ pretty: true, level: 'info', name: 'local-demo' });
  const consoleProvider = new ConsoleProvider({ externalUserId: 'local-user' });
  const orchestrator = new DecisionOrchestrator({
    llm: new LocalDemoLLM(),
    messaging: [consoleProvider],
    logger,
    userReplyTimeoutMs: 2 * 60_000,
  });

  const decision = await orchestrator.startDecision({
    prompt:
      'Help the user decide dinner. Ask a question, make a proposal, and finalize once they confirm.',
    userId: 'local-demo-user',
    channel: 'console',
    externalUserId: 'local-user',
    schema,
    kickoffMessage:
      'Local demo started. Answer the question in the terminal, then confirm with "yes" or "si".',
  });

  logger.info({ decision }, 'local demo finished');
  await orchestrator.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
