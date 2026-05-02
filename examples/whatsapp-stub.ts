/**
 * WhatsApp Workflow Assistant — powered by Harmony + whatsapp-web.js.
 *
 * A structured assistant that guides users through a workflow via WhatsApp.
 * The agent asks one question at a time, gathers context, and produces a
 * concrete recommendation at the end.
 *
 * Requires:
 *   pnpm add @google/generative-ai whatsapp-web.js qrcode-terminal
 *   env: GOOGLE_API_KEY
 *
 * Optional env:
 *   GEMINI_MODEL=gemini-2.0-flash
 *   WHATSAPP_SESSION_NAME=harmony-demo
 *   WHATSAPP_AUTH_DIR=.wwebjs_auth
 *   WHATSAPP_HEADLESS=false
 *   PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
 *   LOG_LEVEL=info
 *
 * Run:
 *   node --env-file=.env --import tsx examples/whatsapp-stub.ts
 *
 * Usage:
 *   1. Scan the QR code shown in the terminal.
 *   2. Send any message to the linked WhatsApp account to see available workflows.
 *   3. Reply with the number of the workflow you want to start.
 *   4. Answer the assistant's questions in plain language.
 *   5. Receive a structured recommendation at the end.
 */
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import qrcodeTerminal from "qrcode-terminal";
import WAWebJS from "whatsapp-web.js";
import {
  DecisionOrchestrator,
  GeminiProvider,
  WhatsAppWebProvider,
  createLogger,
  type Decision,
  type GeminiLike,
  type InboundMessage,
  type WhatsAppWebClientLike,
  safeUserErrorMessage,
} from "../src/index.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const GOOGLE_API_KEY = process.env["GOOGLE_API_KEY"];
if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");

const GEMINI_MODEL = process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
const WHATSAPP_SESSION_NAME =
  process.env["WHATSAPP_SESSION_NAME"] ?? "harmony-demo";
const WHATSAPP_AUTH_DIR = process.env["WHATSAPP_AUTH_DIR"] ?? ".wwebjs_auth";
const WHATSAPP_HEADLESS = parseBoolean(process.env["WHATSAPP_HEADLESS"], false);
const PUPPETEER_EXECUTABLE_PATH = process.env["PUPPETEER_EXECUTABLE_PATH"];

// ─── Workflows ────────────────────────────────────────────────────────────────

interface Workflow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly prompt: string;
  readonly schema: z.ZodTypeAny;
  readonly kickoffMessage: string;
}

const WorkflowResultSchema = z.object({
  recommendation: z.string().min(1).max(300),
  reasoning: z.string().min(1).max(600),
  nextStep: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});

type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

const WORKFLOWS: readonly Workflow[] = [
  {
    id: "meal",
    label: "🍽️  What to eat today",
    description: "Get a personalised meal recommendation for any time of day.",
    prompt: `You are a helpful meal planning assistant. Guide the user to decide what to eat today.

Ask questions one at a time to understand:
1. Time of day / which meal (breakfast, lunch, dinner, snack)
2. Current mood or energy level
3. Dietary restrictions or strong dislikes
4. How much time or effort they want to spend (quick / cook / order)
5. Any ingredients they already have or crave

Then propose one concrete meal option with a brief reason and a simple next step (e.g. "Order from X" or "Make pasta carbonara — here's what you need").
Use the same language as the user (Spanish or English).`,
    schema: WorkflowResultSchema,
    kickoffMessage:
      "¡Hola! Soy tu asistente de comidas 🍴\nVoy a hacerte unas preguntas para recomendarte qué comer hoy.\n\n¿Para qué momento del día es? (desayuno / almuerzo / cena / snack)",
  },
  {
    id: "deploy",
    label: "🚀  Deployment decision",
    description: "Decide whether and when to deploy a change to production.",
    prompt: `You are a senior engineering advisor. Help the user decide whether to deploy a change to production.

Ask questions one at a time to understand:
1. What the change does (feature, fix, refactor, config)
2. How confident is the team in the change (tests, reviews, staging)
3. Current traffic / time of day / day of week
4. Rollback plan availability
5. Any recent incidents or fragile dependencies

Then recommend: deploy now / deploy at low-traffic window / delay + list blockers.
Be specific about timing and conditions.`,
    schema: WorkflowResultSchema,
    kickoffMessage:
      "I'll help you decide whether to deploy. Let me ask a few questions first.\n\nWhat does this change do? (one sentence)",
  },
  {
    id: "purchase",
    label: "💳  Purchase approval",
    description: "Evaluate whether a purchase or investment is justified.",
    prompt: `You are a pragmatic business advisor. Help the user decide whether to make a purchase or investment.

Ask questions one at a time to understand:
1. What they want to buy and approximately how much it costs
2. The primary problem it solves or goal it achieves
3. Urgency — is there a deadline or can it wait?
4. Alternatives considered (cheaper, free, or already available)
5. Budget situation (tight / comfortable / flexible)

Then give a clear recommendation: approve / delay / find alternative, with specific reasoning.`,
    schema: WorkflowResultSchema,
    kickoffMessage:
      "I'll help you decide whether this purchase makes sense. What do you want to buy?",
  },
  {
    id: "custom",
    label: "✏️  Custom topic",
    description: "Start a workflow on any topic you describe.",
    prompt: "", // filled dynamically
    schema: WorkflowResultSchema,
    kickoffMessage: "Tell me what you'd like to decide and I'll guide you through it.",
  },
];

const MENU_TEXT = [
  "👋 *Workflow Assistant*",
  "",
  "Choose a workflow to start:",
  ...WORKFLOWS.map((w, i) => `*${i + 1}.* ${w.label}`),
  "",
  "Reply with the number, or describe your own topic.",
].join("\n");

// ─── State ────────────────────────────────────────────────────────────────────

const activeChats = new Set<string>();

// ─── Setup ────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: process.env["LOG_LEVEL"] ?? "info",
  pretty: true,
  name: "whatsapp-demo",
});

const client = new WAWebJS.Client(buildClientOptions());

const whatsapp = new WhatsAppWebProvider({
  client: client as unknown as WhatsAppWebClientLike,
  initializeClientOnStart: true,
});

const orchestrator = new DecisionOrchestrator({
  llm: new GeminiProvider({
    client: new GoogleGenerativeAI(GOOGLE_API_KEY) as unknown as GeminiLike,
    model: GEMINI_MODEL,
  }),
  messaging: [whatsapp],
  logger,
  userReplyTimeoutMs: 5 * 60_000,
  maxTurns: 12,
});

orchestrator.on("agentTurn", ({ sessionId, action, confidence }) => {
  logger.info({ sessionId, action, confidence }, "agent turn");
});

orchestrator.on("error", ({ sessionId, error, phase }) => {
  // Error message printed to terminal with secrets already redacted by logger serializer.
  logger.error({ sessionId, err: error, phase }, "orchestrator error");
});

// ─── WhatsApp client events ───────────────────────────────────────────────────

client.on("qr", (qr) => {
  console.log("\nScan this QR code with WhatsApp:\n");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => logger.info("WhatsApp authenticated"));

client.on("ready", () => {
  logger.info({ wid: client.info.wid._serialized }, "WhatsApp client ready");
  logger.info("Send any message from WhatsApp to start the workflow menu");
});

client.on("loading_screen", (percent, message) => {
  logger.info({ percent, message }, "loading WhatsApp Web");
});

client.on("auth_failure", (message) => {
  logger.error({ message }, "WhatsApp auth failure");
});

client.on("disconnected", (reason) => {
  logger.warn({ reason }, "WhatsApp disconnected");
});

whatsapp.onReply((message) => {
  void handleInboundMessage(message).catch((err) => {
    logger.error(
      { err, from: message.externalUserId },
      "failed to handle inbound message",
    );
  });
});

// ─── Message routing ──────────────────────────────────────────────────────────

async function handleInboundMessage(message: InboundMessage): Promise<void> {
  const text = message.text.trim();
  if (!text) return;

  // If chat has active decision — forward reply to engine.
  if (activeChats.has(message.externalUserId)) {
    return;
  }

  // Parse workflow selection or custom topic.
  const numChoice = parseInt(text, 10);
  const isValidNumber = !isNaN(numChoice) && numChoice >= 1 && numChoice <= WORKFLOWS.length;

  if (isValidNumber) {
    const workflow = WORKFLOWS[numChoice - 1]!;
    if (workflow.id === "custom") {
      await client.sendMessage(
        message.externalUserId,
        "✏️ *Custom workflow*\n\nDescribe the topic or decision you want to work through:",
      );
      // Mark as pending custom — next message starts the decision.
      pendingCustom.add(message.externalUserId);
      return;
    }
    await launchWorkflow(message.externalUserId, workflow, null);
    return;
  }

  if (pendingCustom.has(message.externalUserId)) {
    pendingCustom.delete(message.externalUserId);
    const customWorkflow: Workflow = {
      ...WORKFLOWS.find((w) => w.id === "custom")!,
      prompt: buildCustomPrompt(text),
    };
    await launchWorkflow(message.externalUserId, customWorkflow, text);
    return;
  }

  // Default: show menu.
  await client.sendMessage(message.externalUserId, MENU_TEXT);
}

const pendingCustom = new Set<string>();

// ─── Workflow launcher ────────────────────────────────────────────────────────

async function launchWorkflow(
  chatId: string,
  workflow: Workflow,
  customTopic: string | null,
): Promise<void> {
  if (activeChats.has(chatId)) {
    await client.sendMessage(
      chatId,
      "⏳ There's already an active workflow in this chat. Answer the current question or wait for the result.",
    );
    return;
  }

  activeChats.add(chatId);
  logger.info({ chatId, workflowId: workflow.id, customTopic }, "launching workflow");

  const prompt = workflow.id === "custom" && customTopic
    ? buildCustomPrompt(customTopic)
    : workflow.prompt;

  void orchestrator
    .startDecision({
      prompt,
      userId: `whatsapp:${chatId}`,
      channel: "whatsapp",
      externalUserId: chatId,
      schema: workflow.schema,
      metadata: { workflowId: workflow.id },
      kickoffMessage: workflow.kickoffMessage,
    })
    .then(async (decision) => {
      activeChats.delete(chatId);
      await sendResult(chatId, workflow, decision as Decision<WorkflowResult>);
    })
    .catch(async (err) => {
      activeChats.delete(chatId);
      // Log full error (secrets redacted by serializer) — send safe message to user.
      logger.error({ err, chatId, workflowId: workflow.id }, "workflow failed");
      await client.sendMessage(chatId, `❌ ${safeUserErrorMessage(err)}`);
    });
}

// ─── Result formatter ─────────────────────────────────────────────────────────

async function sendResult(
  chatId: string,
  workflow: Workflow,
  decision: Decision<WorkflowResult>,
): Promise<void> {
  if (decision.status === "finalized" && decision.value) {
    const v = decision.value;
    const pct = Math.round(v.confidence * 100);
    const msg = [
      `✅ *Workflow complete* — ${workflow.label}`,
      "",
      `*Recommendation:* ${v.recommendation}`,
      "",
      `*Why:* ${v.reasoning}`,
      "",
      `*Next step:* ${v.nextStep}`,
      "",
      `_Confidence: ${pct}%_`,
      "",
      "Reply with any number to start a new workflow.",
    ].join("\n");
    await client.sendMessage(chatId, msg);
    return;
  }

  if (decision.status === "timeout") {
    await client.sendMessage(
      chatId,
      "⏰ The workflow timed out — no reply received. Send any message to start again.",
    );
    return;
  }

  const abortMsg = decision.reason
    ? `⚠️ Workflow ended: ${decision.reason}`
    : "⚠️ Workflow ended unexpectedly. Send any message to start again.";
  await client.sendMessage(chatId, abortMsg);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCustomPrompt(topic: string): string {
  return [
    `You are a structured decision assistant. The user wants to decide: "${topic}".`,
    "Ask one focused question at a time to understand their goals, constraints, options, and priorities.",
    "Use the same language as the user (Spanish or English).",
    "After 3–6 questions, propose a concrete recommendation with clear reasoning and one specific next step.",
    "When finalizing, fill recommendation, reasoning, nextStep, and confidence (0–1).",
  ].join(" ");
}

function buildClientOptions(): WAWebJS.ClientOptions {
  const puppeteer: NonNullable<WAWebJS.ClientOptions["puppeteer"]> = {
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function registerShutdownHandlers(): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    await Promise.allSettled([orchestrator.stop(), client.destroy()]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  registerShutdownHandlers();
  await orchestrator.start();
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
