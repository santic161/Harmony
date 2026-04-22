import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DecisionOrchestrator } from '../src/core/DecisionOrchestrator.js';
import type { ActionDefinition, SkillDefinition } from '../src/actions/ActionDefinitions.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../src/llm/LLMProvider.js';
import type { InboundHandler, MessagingProvider } from '../src/messaging/MessagingProvider.js';
import type { OutboundMessage } from '../src/types/Message.js';

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('DecisionOrchestrator skillSources', () => {
  it('loads imported skills on start, merges them with static skills, and injects imported metadata into the prompt', async () => {
    const importedSkillDir = await createTempSkill(
      `---
name: External Audit
description: Audit external release evidence.
compatibility: codex, cursor, claude-code
metadata:
  registry: clawhub
---
Use bundled references before asking the reviewer for extra context.`,
      'references/rollout.md',
      '# Rollout',
    );

    const llm = new RecordingLLM([
      JSON.stringify({ action: 'abort', reason: 'done for test' }),
    ]);
    const messaging = new SilentMessaging();

    const staticSkills: readonly SkillDefinition[] = [
      {
        id: 'local-context',
        description: 'Adds local deployment context.',
        instructions: 'Mention the current release window when relevant.',
      },
    ];
    const actions: readonly ActionDefinition[] = [
      {
        id: 'inspect_release',
        title: 'Inspect release',
        description: 'Reads trusted release evidence.',
        kind: 'handler',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      },
    ];

    const orchestrator = new DecisionOrchestrator({
      llm,
      messaging: [messaging],
      skills: staticSkills,
      actions,
      skillSources: [{ kind: 'directory', path: importedSkillDir }],
    });

    await orchestrator.start();
    const decision = await orchestrator.startDecision({
      prompt: 'Decide whether the release should proceed.',
      userId: 'u-1',
      channel: 'test',
      externalUserId: 'user-1',
      schema: z.object({ approved: z.boolean() }),
      skillIds: ['external-audit', 'local-context'],
    });

    expect(decision.status).toBe('aborted');
    const systemPrompt = llm.requests[0]?.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('- external-audit: Audit external release evidence.');
    expect(systemPrompt).toContain('Compatibility: codex, cursor, claude-code');
    expect(systemPrompt).toContain('Resources: reference:references/rollout.md');
    expect(systemPrompt).toContain('- local-context: Adds local deployment context.');

    await orchestrator.stop();
  });

  it('fails deterministically when an imported skill id collides with a static skill id', async () => {
    const importedSkillDir = await createTempSkill(
      `---
name: Shared Skill
description: Imported duplicate.
---
Imported instructions.`,
    );

    const orchestrator = new DecisionOrchestrator({
      llm: new RecordingLLM([JSON.stringify({ action: 'abort', reason: 'unused' })]),
      messaging: [new SilentMessaging()],
      skills: [
        {
          id: 'shared-skill',
          description: 'Static duplicate.',
          instructions: 'Static instructions.',
        },
      ],
      skillSources: [{ kind: 'directory', path: importedSkillDir }],
    });

    await expect(orchestrator.start()).rejects.toThrow('Duplicate skill id "shared-skill"');
  });
});

class RecordingLLM implements LLMProvider {
  readonly name = 'recording-llm';
  readonly requests: LLMRequest[] = [];
  private index = 0;

  constructor(private readonly responses: readonly string[]) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    return {
      text:
        this.responses[this.index++] ??
        JSON.stringify({ action: 'abort', reason: 'out of responses' }),
      provider: this.name,
      model: 'test-model',
    };
  }
}

class SilentMessaging implements MessagingProvider {
  readonly name = 'test';
  private readonly handlers = new Set<InboundHandler>();

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.handlers.clear();
  }
  async send(to: string, msg: OutboundMessage): Promise<void> {
    void to;
    void msg;
  }
  onReply(handler: InboundHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

async function createTempSkill(
  skillMarkdown: string,
  extraRelativePath?: string,
  extraContent = '',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-skill-source-'));
  createdPaths.push(root);
  const skillPath = join(root, 'SKILL.md');
  await writeFile(skillPath, skillMarkdown, 'utf8');

  if (extraRelativePath) {
    const extraPath = join(root, extraRelativePath);
    await mkdir(dirname(extraPath), { recursive: true });
    await writeFile(extraPath, extraContent, 'utf8');
  }

  return root;
}
