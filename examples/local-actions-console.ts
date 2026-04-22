/**
 * Local demo for controlled actions + contextual skills.
 *
 * Run:
 *   pnpm demo:actions
 */
import { readdir, readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  ConsoleProvider,
  DecisionOrchestrator,
  createLogger,
  type ActionDefinition,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type SkillDefinition,
} from '../src/index.js';

const DecisionSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  inspectedActions: z.array(z.string().min(1)).min(1),
});

class LocalActionDemoLLM implements LLMProvider {
  readonly name = 'local-actions-demo';

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const actionResults = extractActionResults(req.messages);
    const userReplies = extractUserReplies(req.messages);
    const latestReply = userReplies.at(-1)?.toLowerCase().trim() ?? '';

    const hasInspect = actionResults.some((result) => result.actionId === 'inspect_files');
    const hasPackage = actionResults.some((result) => result.actionId === 'read_package_json');
    const testResult = actionResults.find((result) => result.actionId === 'run_tests');

    let payload: Record<string, unknown>;
    if (!hasInspect) {
      payload = {
        action: 'run_action',
        actionId: 'inspect_files',
        input: { limit: 8 },
        progressMessage: 'Inspecting the repository structure before deciding.',
        reasoning: 'Need quick filesystem context first.',
      };
    } else if (!hasPackage) {
      payload = {
        action: 'run_action',
        actionId: 'read_package_json',
        input: {},
        progressMessage: 'Reading package.json to understand scripts and dependencies.',
        reasoning: 'Need the project metadata and available scripts.',
      };
    } else if (!testResult && !isConfirmation(latestReply)) {
      payload = {
        action: 'ask',
        question: 'I already inspected the repo. Should I also run the focused test suite?',
        reasoning: 'Need confirmation before spending more time on shell execution.',
      };
    } else if (!testResult && isConfirmation(latestReply)) {
      payload = {
        action: 'run_action',
        actionId: 'run_tests',
        input: {},
        progressMessage: 'Running the focused Vitest suite now.',
        reasoning: 'User explicitly approved the test run.',
      };
    } else if (testResult && !isConfirmation(latestReply)) {
      payload = {
        action: 'propose',
        proposal: buildProposal(actionResults),
        confidence: testResult.ok ? 0.9 : 0.72,
        reasoning: 'Enough runtime context is available to present a recommendation.',
      };
    } else {
      payload = {
        action: 'finalize',
        value: {
          approved: Boolean(testResult?.ok),
          summary: buildSummary(actionResults),
          inspectedActions: actionResults.map((result) => result.actionId),
        },
        confidence: testResult?.ok ? 0.95 : 0.82,
        reasoning: 'User confirmed the recommendation after the runtime actions finished.',
      };
    }

    return {
      text: JSON.stringify(payload),
      provider: this.name,
      model: 'local-actions-rule-engine',
    };
  }
}

const skills: readonly SkillDefinition[] = [
  {
    id: 'repo-audit',
    description: 'Inspect the repository and summarize evidence before deciding.',
    instructions:
      'Prefer repository inspection first, then read package.json, and only run tests when the extra signal is worth the cost.',
    preferredActionIds: ['inspect_files', 'read_package_json', 'run_tests'],
    examples: ['Inspect files -> read package.json -> optionally run tests -> propose'],
  },
];

const actions: readonly ActionDefinition[] = [
  {
    id: 'inspect_files',
    title: 'Inspect files',
    description: 'Lists the top-level repository entries.',
    kind: 'handler',
    inputSchema: z.object({
      limit: z.number().int().positive().max(20).optional(),
    }),
    execute: async (_ctx, input) => {
      const entries = await readdir(process.cwd(), { withFileTypes: true });
      return {
        cwd: process.cwd(),
        entries: entries
          .slice(0, input.limit ?? 10)
          .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`),
      };
    },
  },
  {
    id: 'read_package_json',
    title: 'Read package.json',
    description: 'Returns a compact summary of the package manifest.',
    kind: 'handler',
    inputSchema: z.object({}),
    execute: async () => {
      const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
      const pkg = JSON.parse(raw) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      return {
        name: pkg.name ?? 'unknown',
        scripts: Object.keys(pkg.scripts ?? {}),
        dependencies: Object.keys(pkg.dependencies ?? {}).slice(0, 8),
      };
    },
  },
  {
    id: 'run_tests',
    title: 'Run focused tests',
    description: 'Runs the AgentEngine test suite through pnpm/vitest.',
    kind: 'shell',
    inputSchema: z.object({}),
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    buildArgs: () => ['exec', 'vitest', 'run', 'test/AgentEngine.test.ts'],
    cwd: process.cwd(),
    timeoutMs: 120_000,
  },
];

function extractUserReplies(messages: readonly { role: string; content: string }[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => unwrapUserInput(message.content))
    .filter((content) => content !== '[BEGIN]' && !content.startsWith('<action_result>'));
}

function extractActionResults(messages: readonly { role: string; content: string }[]): ActionResultView[] {
  const results: ActionResultView[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const match = /<action_result>\s*([\s\S]+?)\s*<\/action_result>/i.exec(message.content);
    if (!match?.[1]) continue;
    try {
      results.push(JSON.parse(match[1]) as ActionResultView);
    } catch {
      continue;
    }
  }
  return results;
}

function unwrapUserInput(content: string): string {
  return content
    .replace(/^<user_input>\s*/i, '')
    .replace(/\s*<\/user_input>$/i, '')
    .trim();
}

function isConfirmation(text: string): boolean {
  return /^(yes|y|sure|ok|okay|si|dale|run them|go ahead)/i.test(text);
}

function buildProposal(results: readonly ActionResultView[]): string {
  const tests = results.find((result) => result.actionId === 'run_tests');
  const inspect = results.find((result) => result.actionId === 'inspect_files');
  const manifest = results.find((result) => result.actionId === 'read_package_json');
  const testState = tests?.ok ? 'passed' : 'failed';
  return [
    `I inspected the repo${inspect?.ok ? '' : ' with partial data'}, reviewed package.json, and the focused tests ${testState}.`,
    `Based on that evidence, I recommend ${tests?.ok ? 'continuing' : 'fixing the failing command before continuing'}.`,
    manifest?.outputSummary ? `package.json summary: ${manifest.outputSummary}` : undefined,
    'Please confirm if you want me to finalize this recommendation.',
  ]
    .filter((line): line is string => Boolean(line))
    .join(' ');
}

function buildSummary(results: readonly ActionResultView[]): string {
  return results
    .map((result) => {
      const status = result.ok ? 'ok' : 'failed';
      const detail = result.outputSummary ?? result.error ?? 'no details';
      return `${result.actionId}: ${status} (${detail})`;
    })
    .join(' | ');
}

interface ActionResultView {
  readonly ok: boolean;
  readonly actionId: string;
  readonly outputSummary?: string;
  readonly error?: string;
}

async function main(): Promise<void> {
  const logger = createLogger({ pretty: true, level: 'info', name: 'local-actions-demo' });
  const consoleProvider = new ConsoleProvider({ externalUserId: 'local-user' });
  const orchestrator = new DecisionOrchestrator({
    llm: new LocalActionDemoLLM(),
    messaging: [consoleProvider],
    skills,
    actions,
    logger,
    userReplyTimeoutMs: 2 * 60_000,
  });

  const decision = await orchestrator.startDecision({
    prompt:
      'Use the available skills and controlled actions to evaluate repo readiness, explain the evidence, and finalize only after confirmation.',
    userId: 'local-demo-user',
    channel: 'console',
    externalUserId: 'local-user',
    schema: DecisionSchema,
    skillIds: ['repo-audit'],
    allowedActionIds: ['inspect_files', 'read_package_json', 'run_tests'],
    kickoffMessage:
      'Controlled-actions demo started. I may inspect files, read package.json, and optionally run tests before asking for confirmation.',
  });

  logger.info({ decision }, 'controlled actions demo finished');
  await orchestrator.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
