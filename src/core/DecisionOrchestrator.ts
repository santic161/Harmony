import type { ZodType } from 'zod';
import type { ActionDefinition, SkillDefinition } from '../actions/ActionDefinitions.js';
import { CostTracker } from '../llm/CostTracker.js';
import type { LLMProvider } from '../llm/LLMProvider.js';
import type { MessagingProvider } from '../messaging/MessagingProvider.js';
import { TypedEmitter, type EngineEvents } from '../observability/Events.js';
import { createLogger, type Logger } from '../observability/Logger.js';
import { InputSanitizer } from '../security/InputSanitizer.js';
import { OutputValidator } from '../security/OutputValidator.js';
import { PromptGuard } from '../security/PromptGuard.js';
import { InMemoryStateStore } from '../state/InMemoryStateStore.js';
import type { StateStore } from '../state/StateStore.js';
import type { Decision } from '../types/Decision.js';
import type { SessionState } from '../types/Session.js';
import { newSessionId } from '../utils/id.js';
import { describeSchema } from '../utils/schemaDescription.js';
import { loadSkillFromSource } from '../skills/SkillImporter.js';
import type { ImportedSkill, SkillSource } from '../skills/SkillTypes.js';
import { AgentEngine } from './AgentEngine.js';
import { ConfidenceGate } from './ConfidenceGate.js';
import { SessionManager } from './SessionManager.js';

export interface RehydratedSessionOptions<T> {
  readonly schema: ZodType<T>;
}

export type SessionRehydrator = (
  session: SessionState,
) =>
  | RehydratedSessionOptions<unknown>
  | null
  | Promise<RehydratedSessionOptions<unknown> | null>;

export interface OrchestratorOptions {
  readonly llm: LLMProvider;
  readonly messaging: readonly MessagingProvider[];
  readonly skills?: readonly SkillDefinition[];
  readonly skillSources?: readonly SkillSource[];
  readonly actions?: readonly ActionDefinition[];
  readonly store?: StateStore;
  readonly logger?: Logger;
  readonly events?: TypedEmitter;
  readonly costTracker?: CostTracker;
  readonly sanitizer?: InputSanitizer;
  readonly guard?: PromptGuard;
  readonly validator?: OutputValidator;
  readonly gate?: ConfidenceGate;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly userReplyTimeoutMs?: number;
  readonly llmTimeoutMs?: number;
  readonly llmTemperature?: number;
  readonly llmMaxTokens?: number;
  readonly rehydrator?: SessionRehydrator;
}

export interface StartDecisionRequest<T> {
  readonly prompt: string;
  readonly userId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly schema: ZodType<T>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly kickoffMessage?: string;
  readonly skillIds?: readonly string[];
  readonly allowedActionIds?: readonly string[];
}

export class DecisionOrchestrator {
  readonly logger: Logger;
  readonly events: TypedEmitter;
  readonly costTracker: CostTracker;
  private readonly store: StateStore;
  private readonly sessions: SessionManager;
  private readonly staticSkills: readonly SkillDefinition[];
  private readonly skillSources: readonly SkillSource[];
  private readonly importedSkills = new Map<string, ImportedSkill>();
  private skillRegistry: ReadonlyMap<string, SkillDefinition>;
  private readonly actionRegistry: ReadonlyMap<string, ActionDefinition>;
  private readonly activeRuns = new Set<string>();
  private skillSourcesLoaded = false;
  private skillSourceLoad?: Promise<void>;
  private started = false;

  constructor(private readonly opts: OrchestratorOptions) {
    this.logger = opts.logger ?? createLogger();
    this.events = opts.events ?? new TypedEmitter();
    this.costTracker = opts.costTracker ?? new CostTracker();
    this.store = opts.store ?? new InMemoryStateStore();
    this.staticSkills = opts.skills ?? [];
    this.skillSources = opts.skillSources ?? [];
    this.skillRegistry = buildRegistry(this.staticSkills, 'skill');
    this.actionRegistry = buildRegistry(opts.actions ?? [], 'action');
    validateSkillReferences(this.skillRegistry, this.actionRegistry);
    this.sessions = new SessionManager(this.store);
    for (const provider of opts.messaging) this.sessions.registerProvider(provider);
  }

  on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this {
    this.events.on(event, listener);
    return this;
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.ensureSkillSourcesLoaded();
    this.sessions.restoreProviderRoutes();
    const activeSessions = await this.sessions.rehydrate();
    await Promise.all(this.opts.messaging.map((provider) => provider.start()));
    this.started = true;
    await this.resumeStoredSessions(activeSessions);
  }

  async stop(): Promise<void> {
    await this.sessions.shutdown();
    await Promise.all(this.opts.messaging.map((provider) => provider.stop().catch(() => {})));
    this.started = false;
  }

  async startDecision<T>(req: StartDecisionRequest<T>): Promise<Decision<T>> {
    if (!this.started) await this.start();

    const provider = this.sessions.getProvider(req.channel);
    if (!provider) {
      throw new Error(`No messaging provider registered for channel "${req.channel}"`);
    }
    if (this.sessions.hasActiveFor(req.channel, req.externalUserId)) {
      throw new Error(
        `Active session already running for ${req.channel}:${req.externalUserId}`,
      );
    }

    resolveSelected(req.skillIds, this.skillRegistry, 'skill');
    resolveSelected(req.allowedActionIds, this.actionRegistry, 'action');

    const now = Date.now();
    const initial: SessionState = {
      sessionId: newSessionId(),
      userId: req.userId,
      channel: req.channel,
      externalUserId: req.externalUserId,
      prompt: req.prompt,
      status: 'active',
      turns: [{ role: 'system', content: req.prompt, ts: now }],
      createdAt: now,
      updatedAt: now,
      schemaDescription: describeSchema(req.schema),
      ...(req.metadata ? { metadata: req.metadata } : {}),
      ...(req.skillIds ? { skillIds: [...req.skillIds] } : {}),
      ...(req.allowedActionIds ? { allowedActionIds: [...req.allowedActionIds] } : {}),
    };

    let attached = false;
    try {
      await this.sessions.attachSession(initial);
      attached = true;

      this.events.emit('decisionStart', {
        sessionId: initial.sessionId,
        userId: req.userId,
        prompt: req.prompt,
      });
      this.logger.info(
        { sessionId: initial.sessionId, channel: req.channel },
        'decision started',
      );

      if (req.kickoffMessage) {
        await provider.send(req.externalUserId, { text: req.kickoffMessage });
      }

      return this.runSession(initial, provider, req.schema);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.events.emit('error', {
        sessionId: initial.sessionId,
        error,
        phase: 'orchestrator.startDecision',
      });
      if (attached) {
        await this.sessions.detachSession(initial.sessionId).catch(() => undefined);
      }
      throw error;
    }
  }

  private async ensureSkillSourcesLoaded(): Promise<void> {
    if (this.skillSourcesLoaded || this.skillSources.length === 0) {
      this.skillSourcesLoaded = true;
      return;
    }
    if (!this.skillSourceLoad) {
      this.skillSourceLoad = this.loadSkillSources();
    }
    await this.skillSourceLoad;
  }

  private async loadSkillSources(): Promise<void> {
    const imported = await Promise.all(this.skillSources.map((source) => loadSkillFromSource(source)));
    const merged = [...this.staticSkills, ...imported];
    this.skillRegistry = buildRegistry(merged, 'skill');
    validateSkillReferences(this.skillRegistry, this.actionRegistry);

    this.importedSkills.clear();
    for (const skill of imported) {
      this.importedSkills.set(skill.id, skill);
    }
    this.skillSourcesLoaded = true;
  }

  private async resumeStoredSessions(states: readonly SessionState[]): Promise<void> {
    if (!states.length) return;

    for (const state of states) {
      const provider = this.sessions.getProvider(state.channel);
      if (!provider) {
        await this.abandonStoredSession(
          state,
          `No messaging provider registered for channel "${state.channel}" during rehydration.`,
        );
        continue;
      }

      if (!this.opts.rehydrator) {
        this.logger.warn(
          { sessionId: state.sessionId, channel: state.channel },
          'active session found in store but no rehydrator configured',
        );
        await this.abandonStoredSession(
          state,
          'Stored session could not be resumed because no rehydrator was configured.',
        );
        continue;
      }

      try {
        const rehydrated = await this.opts.rehydrator(state);
        if (!rehydrated) {
          this.logger.warn(
            { sessionId: state.sessionId, channel: state.channel },
            'rehydrator skipped stored session',
          );
          await this.abandonStoredSession(
            state,
            'Stored session could not be resumed because the rehydrator returned null.',
          );
          continue;
        }

        void this.runSession(state, provider, rehydrated.schema).catch((err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.events.emit('error', {
            sessionId: state.sessionId,
            error,
            phase: 'orchestrator.rehydrate',
          });
          this.logger.error(
            { sessionId: state.sessionId, err: error },
            'failed to resume stored session',
          );
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.events.emit('error', {
          sessionId: state.sessionId,
          error,
          phase: 'orchestrator.rehydrate',
        });
        this.logger.error(
          { sessionId: state.sessionId, err: error },
          'failed to prepare stored session for resume',
        );
      }
    }
  }

  private async abandonStoredSession(
    state: SessionState,
    reason: string,
  ): Promise<void> {
    const ts = Date.now();
    await this.sessions.updateSession({
      ...state,
      status: 'aborted',
      updatedAt: ts,
      turns: [
        ...state.turns,
        {
          role: 'internal',
          content: `REHYDRATION_ABORTED: ${reason}`,
          ts,
          flags: ['rehydration_aborted'],
        },
      ],
    });
  }

  private async runSession<T>(
    session: SessionState,
    provider: MessagingProvider,
    schema: ZodType<T>,
  ): Promise<Decision<T>> {
    if (this.activeRuns.has(session.sessionId)) {
      throw new Error(`Session ${session.sessionId} is already running`);
    }

    const selectedSkills = resolveSelected(session.skillIds, this.skillRegistry, 'skill');
    const selectedActions = resolveSelected(
      session.allowedActionIds,
      this.actionRegistry,
      'action',
    );

    this.activeRuns.add(session.sessionId);
    try {
      const engine = new AgentEngine<T>({
        llm: this.opts.llm,
        messaging: provider,
        sessions: this.sessions,
        valueSchema: schema,
        skills: selectedSkills,
        actions: selectedActions,
        logger: this.logger,
        events: this.events,
        costTracker: this.costTracker,
        ...(this.opts.sanitizer ? { sanitizer: this.opts.sanitizer } : {}),
        ...(this.opts.guard ? { guard: this.opts.guard } : {}),
        ...(this.opts.validator ? { validator: this.opts.validator } : {}),
        ...(this.opts.gate ? { gate: this.opts.gate } : {}),
        ...(this.opts.systemPrompt ? { systemPrompt: this.opts.systemPrompt } : {}),
        ...(this.opts.maxTurns !== undefined ? { maxTurns: this.opts.maxTurns } : {}),
        ...(this.opts.userReplyTimeoutMs !== undefined
          ? { userReplyTimeoutMs: this.opts.userReplyTimeoutMs }
          : {}),
        ...(this.opts.llmTimeoutMs !== undefined ? { llmTimeoutMs: this.opts.llmTimeoutMs } : {}),
        ...(this.opts.llmTemperature !== undefined
          ? { llmTemperature: this.opts.llmTemperature }
          : {}),
        ...(this.opts.llmMaxTokens !== undefined ? { llmMaxTokens: this.opts.llmMaxTokens } : {}),
      });

      return await engine.run(session);
    } finally {
      this.activeRuns.delete(session.sessionId);
    }
  }
}

const buildRegistry = <T extends { readonly id: string }>(
  defs: readonly T[],
  label: 'skill' | 'action',
): ReadonlyMap<string, T> => {
  const map = new Map<string, T>();
  for (const def of defs) {
    if (map.has(def.id)) {
      throw new Error(`Duplicate ${label} id "${def.id}"`);
    }
    map.set(def.id, def);
  }
  return map;
};

const resolveSelected = <T extends { readonly id: string }>(
  ids: readonly string[] | undefined,
  registry: ReadonlyMap<string, T>,
  label: 'skill' | 'action',
): readonly T[] => {
  if (!ids || ids.length === 0) return [];

  const selected: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const def = registry.get(id);
    if (!def) throw new Error(`Unknown ${label} id "${id}"`);
    seen.add(id);
    selected.push(def);
  }
  return selected;
};

const validateSkillReferences = (
  skills: ReadonlyMap<string, SkillDefinition>,
  actions: ReadonlyMap<string, ActionDefinition>,
): void => {
  for (const skill of skills.values()) {
    for (const actionId of skill.preferredActionIds ?? []) {
      if (!actions.has(actionId)) {
        throw new Error(`Skill "${skill.id}" references unknown action "${actionId}"`);
      }
    }
  }
};
