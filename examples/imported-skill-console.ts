/**
 * Local demo for portable/imported skills.
 *
 * Run:
 *   pnpm demo:imported-skill
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  ConsoleProvider,
  DecisionOrchestrator,
  createLogger,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../src/index.js';

const DecisionSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
});

class ImportedSkillDemoLLM implements LLMProvider {
  readonly name = 'imported-skill-demo';

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const systemPrompt = req.messages.find((message) => message.role === 'system')?.content ?? '';
    const skillLoaded = systemPrompt.includes('portable-release-review');
    if (!skillLoaded) {
      return {
        text: JSON.stringify({
          action: 'abort',
          reason: 'The imported skill was not active for this decision.',
        }),
        provider: this.name,
        model: 'local-imported-skill-demo',
      };
    }

    const turns = req.messages
      .filter((message) => message.role === 'user')
      .map((message) => unwrapUserInput(message.content))
      .filter((content) => content !== '[BEGIN]');
    const latest = turns.at(-1)?.toLowerCase().trim() ?? '';

    let payload: Record<string, unknown>;
    if (!turns.length) {
      payload = {
        action: 'ask',
        question:
          'What is the main release concern right now: tests, rollback, monitoring, or something else?',
        reasoning: 'Need a first signal before proposing a release decision.',
      };
    } else if (turns.length === 1) {
      payload = {
        action: 'propose',
        proposal:
          'Using the imported portable-release-review skill and its rollout checklist, I recommend proceeding only if rollback and monitoring are both ready. Please confirm or refine.',
        confidence: 0.81,
        reasoning: 'There is enough context for a first proposal, but confirmation is still required.',
      };
    } else if (isConfirmation(latest)) {
      payload = {
        action: 'finalize',
        value: {
          approved: true,
          summary:
            'The user confirmed the guarded rollout plan after reviewing the imported skill guidance and checklist-oriented proposal.',
        },
        confidence: 0.96,
        reasoning: 'The user explicitly confirmed the recommendation.',
      };
    } else {
      payload = {
        action: 'ask',
        question:
          'Before I finalize, do we have a rollback owner and monitoring coverage in place? Reply in one sentence.',
        reasoning: 'Need confirmation on the two risk controls emphasized by the imported skill.',
      };
    }

    return {
      text: JSON.stringify(payload),
      provider: this.name,
      model: 'local-imported-skill-demo',
    };
  }
}

function unwrapUserInput(content: string): string {
  return content
    .replace(/^<user_input>\s*/i, '')
    .replace(/\s*<\/user_input>$/i, '')
    .trim();
}

function isConfirmation(text: string): boolean {
  return /^(yes|y|sure|ok|okay|dale|si|sí|confirm|confirmed)/i.test(text);
}

async function main(): Promise<void> {
  const logger = createLogger({ pretty: true, level: 'info', name: 'imported-skill-demo' });
  const consoleProvider = new ConsoleProvider({ externalUserId: 'local-user' });
  const here = dirname(fileURLToPath(import.meta.url));
  const portableSkillDir = join(here, 'data', 'portable-skills', 'release-review');

  const orchestrator = new DecisionOrchestrator({
    llm: new ImportedSkillDemoLLM(),
    messaging: [consoleProvider],
    logger,
    skillSources: [{ kind: 'directory', path: portableSkillDir }],
    userReplyTimeoutMs: 2 * 60_000,
  });

  const decision = await orchestrator.startDecision({
    prompt:
      'Use the imported release-review skill to guide a cautious deployment decision and finalize only after confirmation.',
    userId: 'local-demo-user',
    channel: 'console',
    externalUserId: 'local-user',
    schema: DecisionSchema,
    skillIds: ['portable-release-review'],
    kickoffMessage:
      'Imported-skill demo started. Answer the question in the terminal and confirm when you are happy with the guarded rollout plan.',
  });

  logger.info({ decision }, 'imported skill demo finished');
  await orchestrator.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
