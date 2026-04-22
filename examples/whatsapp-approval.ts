/**
 * WhatsApp approval demo backed by a real whatsapp-web.js client.
 *
 * Run:
 *   node --env-file=.env --import tsx examples/whatsapp-approval.ts
 *
 * Usage:
 *   1. Scan the QR code shown in the terminal.
 *   2. Send any message to the linked WhatsApp account.
 *   3. Reply with a draft number to load it.
 *   4. Reply with APPROVE, EDIT, or REJECT.
 *   5. Inspect the saved decision log on disk.
 */
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcodeTerminal from 'qrcode-terminal';
import WAWebJS from 'whatsapp-web.js';
import {
  WhatsAppWebProvider,
  createLogger,
  type InboundMessage,
  type WhatsAppWebClientLike,
} from '../src/index.js';
import {
  LocalApprovalDecisionStore,
  buildDecisionConfirmation,
  buildDraftMenu,
  buildDraftMessage,
  createDecisionRecord,
  loadDraftCatalog,
  parseReviewReply,
  resolveDraftSelection,
  type PostDraft,
} from './support/approvalDemo.js';

const WHATSAPP_SESSION_NAME =
  process.env['WHATSAPP_SESSION_NAME'] ?? 'agentic-decision-approval-demo';
const WHATSAPP_AUTH_DIR = process.env['WHATSAPP_AUTH_DIR'] ?? '.wwebjs_auth';
const WHATSAPP_HEADLESS = parseBoolean(process.env['WHATSAPP_HEADLESS'], false);
const PUPPETEER_EXECUTABLE_PATH = process.env['PUPPETEER_EXECUTABLE_PATH'];
const TEMPLATE_PATH = resolvePath(
  process.env['WHATSAPP_APPROVAL_TEMPLATE_PATH'],
  new URL('./data/post-drafts.json', import.meta.url),
);
const STORE_PATH = resolvePath(
  process.env['WHATSAPP_APPROVAL_STORE_PATH'],
  new URL('./data/approval-decisions.local.json', import.meta.url),
);

type ChatState =
  | { readonly kind: 'awaiting-selection' }
  | {
      readonly kind: 'awaiting-decision';
      readonly draft: PostDraft;
      readonly startedAt: string;
    };

const logger = createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  pretty: true,
  name: 'whatsapp-approval-demo',
});

const client = new WAWebJS.Client(buildClientOptions());
const whatsapp = new WhatsAppWebProvider({
  client: client as unknown as WhatsAppWebClientLike,
  initializeClientOnStart: true,
});
const decisionStore = new LocalApprovalDecisionStore(STORE_PATH);
const chatStates = new Map<string, ChatState>();

client.on('qr', (qr) => {
  console.log('\nScan this QR code with WhatsApp:\n');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => logger.info('WhatsApp authenticated'));

client.on('ready', () => {
  logger.info({ templatePath: TEMPLATE_PATH, storePath: STORE_PATH }, 'approval demo ready');
  logger.info('Send any WhatsApp message to receive the approval menu');
});

client.on('loading_screen', (percent, message) => {
  logger.info({ percent, message }, 'loading WhatsApp Web');
});

client.on('auth_failure', (message) => {
  logger.error({ message }, 'WhatsApp auth failure');
});

client.on('disconnected', (reason) => {
  logger.warn({ reason }, 'WhatsApp disconnected');
});

whatsapp.onReply((message) => {
  void handleInboundMessage(message).catch((error) => {
    logger.error({ err: error, chatId: message.externalUserId }, 'failed to handle review reply');
  });
});

async function handleInboundMessage(message: InboundMessage): Promise<void> {
  const chatId = message.externalUserId;
  const text = message.text.trim();
  if (!text) return;

  if (isMenuCommand(text) || !chatStates.has(chatId)) {
    await showDraftMenu(chatId);
    return;
  }

  const currentState = chatStates.get(chatId);
  if (!currentState) {
    await showDraftMenu(chatId);
    return;
  }

  if (currentState.kind === 'awaiting-selection') {
    await handleDraftSelection(chatId, text);
    return;
  }

  await handleDecisionReply(chatId, currentState, text);
}

async function handleDraftSelection(chatId: string, text: string): Promise<void> {
  const drafts = await loadDraftCatalog(TEMPLATE_PATH);
  const selectedDraft = resolveDraftSelection(text, drafts);

  if (!selectedDraft) {
    await whatsapp.send(
      chatId,
      {
        text: [
          `I could not match "${text}" to a draft.`,
          '',
          buildDraftMenu(drafts),
        ].join('\n'),
      },
    );
    return;
  }

  const startedAt = new Date().toISOString();
  chatStates.set(chatId, { kind: 'awaiting-decision', draft: selectedDraft, startedAt });
  await whatsapp.send(chatId, { text: buildDraftMessage(selectedDraft) });
  logger.info({ chatId, draftId: selectedDraft.id }, 'draft sent for review');
}

async function handleDecisionReply(
  chatId: string,
  state: Extract<ChatState, { kind: 'awaiting-decision' }>,
  text: string,
): Promise<void> {
  const review = parseReviewReply(text);
  if (!review) {
    await whatsapp.send(chatId, {
      text: 'Reply with APPROVE, EDIT <what to change>, or REJECT <reason>.',
    });
    return;
  }

  const record = createDecisionRecord({
    chatId,
    draft: state.draft,
    review,
    startedAt: state.startedAt,
  });
  await decisionStore.append(record);
  chatStates.delete(chatId);

  const savedCount = (await decisionStore.list()).length;
  logger.info(
    { chatId, decisionId: record.decisionId, outcome: record.outcome, savedCount },
    'approval decision saved locally',
  );

  await whatsapp.send(chatId, { text: buildDecisionConfirmation(record) });
}

async function showDraftMenu(chatId: string): Promise<void> {
  const drafts = await loadDraftCatalog(TEMPLATE_PATH);
  chatStates.set(chatId, { kind: 'awaiting-selection' });
  await whatsapp.send(chatId, { text: buildDraftMenu(drafts) });
}

function buildClientOptions(): WAWebJS.ClientOptions {
  const puppeteer: NonNullable<WAWebJS.ClientOptions['puppeteer']> = {
    headless: WHATSAPP_HEADLESS,
    ...(PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: PUPPETEER_EXECUTABLE_PATH }
      : {}),
  };

  return {
    authStrategy: new WAWebJS.LocalAuth({
      clientId: WHATSAPP_SESSION_NAME,
      dataPath: WHATSAPP_AUTH_DIR,
    }),
    puppeteer,
    qrMaxRetries: 5,
  };
}

function isMenuCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === 'menu' || normalized === 'start' || normalized === 'help';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolvePath(envValue: string | undefined, fallbackUrl: URL): string {
  if (!envValue || envValue.trim().length === 0) {
    return fileURLToPath(fallbackUrl);
  }

  return isAbsolute(envValue) ? envValue : resolve(process.cwd(), envValue);
}

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await Promise.allSettled([whatsapp.stop(), client.destroy()]);
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  registerShutdownHandlers();
  await whatsapp.start();
}

main().catch((error) => {
  logger.error({ err: error }, 'fatal startup error');
  process.exit(1);
});
