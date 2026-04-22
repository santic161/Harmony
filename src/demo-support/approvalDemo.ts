import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const PostDraftSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  label: z.string().min(1),
  channel: z.string().min(1),
  audience: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().min(1),
  hashtags: z.array(z.string().min(1)).default([]),
});

const PostDraftCatalogSchema = z.object({
  drafts: z.array(PostDraftSchema).min(1),
});

const ApprovalStoreSchema = z.object({
  version: z.literal(1),
  decisions: z.array(
    z.object({
      decisionId: z.string().min(1),
      draftId: z.string().min(1),
      templateId: z.string().min(1),
      label: z.string().min(1),
      channel: z.string().min(1),
      reviewerChatId: z.string().min(1),
      outcome: z.enum(['approved', 'edit_requested', 'rejected']),
      feedback: z.string().min(1).optional(),
      startedAt: z.string().min(1),
      decidedAt: z.string().min(1),
      draftSnapshot: PostDraftSchema,
    }),
  ),
});

export type PostDraft = z.infer<typeof PostDraftSchema>;
export type ApprovalStoreState = z.infer<typeof ApprovalStoreSchema>;
export type ApprovalDecisionRecord = ApprovalStoreState['decisions'][number];
export type ReviewOutcome = ApprovalDecisionRecord['outcome'];

export interface ParsedReviewReply {
  readonly outcome: ReviewOutcome;
  readonly feedback?: string;
}

export async function loadDraftCatalog(filePath: string): Promise<readonly PostDraft[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = PostDraftCatalogSchema.parse(JSON.parse(raw));
  return parsed.drafts;
}

export function resolveDraftSelection(
  input: string,
  drafts: readonly PostDraft[],
): PostDraft | null {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= drafts.length) {
    return drafts[numeric - 1] ?? null;
  }

  return (
    drafts.find((draft) => draft.id.toLowerCase() === normalized) ??
    drafts.find((draft) => draft.label.toLowerCase() === normalized) ??
    null
  );
}

export function parseReviewReply(input: string): ParsedReviewReply | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const match = /^(approve|approved|edit|reject|rejected)\b[\s:,-]*(.*)$/i.exec(trimmed);
  if (!match) return null;

  const verb = match[1]!.toLowerCase();
  const remainder = match[2]?.trim();
  const feedback = remainder && remainder.length > 0 ? remainder : undefined;

  if (verb.startsWith('approve')) return { outcome: 'approved', ...(feedback ? { feedback } : {}) };
  if (verb === 'edit') return { outcome: 'edit_requested', ...(feedback ? { feedback } : {}) };
  return { outcome: 'rejected', ...(feedback ? { feedback } : {}) };
}

export function buildDraftMenu(drafts: readonly PostDraft[]): string {
  return [
    '*Post approval demo*',
    '',
    'Available drafts:',
    ...drafts.map(
      (draft, index) => `${index + 1}. ${draft.label} (${draft.channel}, ${draft.templateId})`,
    ),
    '',
    'Reply with a number or draft id to load a draft.',
    'Once a draft is loaded, reply with:',
    'APPROVE optional note',
    'EDIT what should change',
    'REJECT optional reason',
    '',
    'Send MENU at any time to see the draft list again.',
  ].join('\n');
}

export function buildDraftMessage(draft: PostDraft): string {
  const hashtags = draft.hashtags.length > 0 ? draft.hashtags.join(' ') : 'None';
  return [
    `*Draft loaded:* ${draft.label}`,
    `Draft ID: ${draft.id}`,
    `Template: ${draft.templateId}`,
    `Channel: ${draft.channel}`,
    `Audience: ${draft.audience}`,
    '',
    '*Body*',
    draft.body,
    '',
    '*CTA*',
    draft.cta,
    '',
    `*Hashtags* ${hashtags}`,
    '',
    'Reply with APPROVE, EDIT, or REJECT.',
  ].join('\n');
}

export function buildDecisionConfirmation(record: ApprovalDecisionRecord): string {
  const label =
    record.outcome === 'approved'
      ? 'approved'
      : record.outcome === 'edit_requested'
        ? 'saved as changes requested'
        : 'rejected';

  return [
    `Saved: ${record.label} was ${label}.`,
    record.feedback ? `Feedback: ${record.feedback}` : 'Feedback: none supplied.',
    `Decision id: ${record.decisionId}`,
    '',
    'Send MENU to review another draft.',
  ].join('\n');
}

export function createDecisionRecord(args: {
  readonly chatId: string;
  readonly draft: PostDraft;
  readonly review: ParsedReviewReply;
  readonly startedAt: string;
  readonly decidedAt?: string;
}): ApprovalDecisionRecord {
  return {
    decisionId: randomUUID(),
    draftId: args.draft.id,
    templateId: args.draft.templateId,
    label: args.draft.label,
    channel: args.draft.channel,
    reviewerChatId: args.chatId,
    outcome: args.review.outcome,
    ...(args.review.feedback ? { feedback: args.review.feedback } : {}),
    startedAt: args.startedAt,
    decidedAt: args.decidedAt ?? new Date().toISOString(),
    draftSnapshot: args.draft,
  };
}

export class LocalApprovalDecisionStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly ApprovalDecisionRecord[]> {
    const state = await this.readState();
    return state.decisions;
  }

  async append(record: ApprovalDecisionRecord): Promise<void> {
    const writeTask = this.writeChain.then(async () => {
      const state = await this.readState();
      const nextState: ApprovalStoreState = {
        version: 1,
        decisions: [record, ...state.decisions],
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
    });

    this.writeChain = writeTask.catch(() => undefined);
    await writeTask;
  }

  private async readState(): Promise<ApprovalStoreState> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return ApprovalStoreSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFile(error)) {
        return { version: 1, decisions: [] };
      }
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT',
  );
}
