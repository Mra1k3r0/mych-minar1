import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { buildEffectiveSystemPrompt } from "./services/system-prompt.js";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    if (process.env.NODE_ENV === "test") return "dummy";
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function readJsoncConfig(): Record<string, JsonValue> {
  const candidate = path.resolve(process.cwd(), "bot.config.jsonc");
  if (!fs.existsSync(candidate)) return {};
  const raw = fs.readFileSync(candidate, "utf8");
  const errors: ParseError[] = [];
  const data: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error("Failed to parse bot.config.jsonc (invalid JSONC).");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, JsonValue>;
}

const fileConfig = readJsoncConfig();

function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

function getObject(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function getStringArray(obj: unknown, key: string): string[] | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function envOptional(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v : undefined;
}

export type LlmProvider = "openai_compatible" | "anthropic";
export type LowTokenMode = "auto" | "always" | "off";

const llmFromFile = getObject(fileConfig, "llm");
const botFromFile = getObject(fileConfig, "bot");
const llmLimitsFromFile = llmFromFile ? getObject(llmFromFile, "limits") : undefined;

function getLowTokenMode(obj: unknown, key: string): LowTokenMode | undefined {
  const v = getString(obj, key)?.toLowerCase();
  if (v === "auto" || v === "always" || v === "off") return v;
  return undefined;
}

const llmProvider =
  (getString(llmFromFile, "provider") as LlmProvider | undefined) ?? "openai_compatible";
const llmBaseUrl =
  getString(llmFromFile, "baseUrl") ??
  (llmProvider === "anthropic" ? "https://api.anthropic.com" : "https://api.groq.com/openai/v1");
const llmModel =
  getString(llmFromFile, "model") ??
  (llmProvider === "anthropic" ? "claude-3-5-sonnet-20241022" : "openai/gpt-oss-120b");
const llmModels = getStringArray(llmFromFile, "models") ?? [llmModel];

const apiKeyEnv =
  getString(llmFromFile, "apiKeyEnv") ??
  (llmProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "GROQ_API_KEY");
const llmApiKey = envOptional(apiKeyEnv) ?? required(apiKeyEnv);

const defaultSystemPrompt = [
  "Your name is minar1.",
  "You are an AI agent inside a Telegram bot. Built by mra1k3r0 (John Paul Caigas).",
  "",
  "Personality:",
  "- Helpful, fast, direct, and human-like.",
  "- Talk like a smart assistant friend: warm, lively, and adaptive to user vibe.",
  "- Light humor is welcome. Use Gen Alpha slang naturally (1-2 phrases max), not every line.",
  "- Do not sound robotic, template-like, or repetitive.",
  "- Don’t be cringe; don’t force slang. No roleplay unless asked.",
  "",
  "Output rules:",
  "- You may use normal markdown for structure (e.g. **bold**, `code`, fenced code blocks).",
  "- Keep markdown valid and properly closed.",
  "- Keep replies short and on-point by default (2-6 lines).",
  "- For casual chat (e.g. 'sup', 'yo'), reply in a lively conversational tone.",
  "- Go long only if user asks for detailed explanation.",
  "- Never invent bot commands or capabilities. If unsure, say you are unsure.",
  "- Prefer concrete answers over generic filler.",
  "- Keep hard max under 4000 characters.",
  "- If you can’t do something, say what you can do instead.",
].join("\n");

const legacySystemPrompt = getString(botFromFile, "systemPrompt");
const systemPromptOverride = getString(botFromFile, "systemPromptOverride") ?? legacySystemPrompt;
const systemPromptAppend = getString(botFromFile, "systemPromptAppend");
const effectiveSystemPrompt = buildEffectiveSystemPrompt({
  defaultPrompt: defaultSystemPrompt,
  overridePrompt: systemPromptOverride,
  appendPrompt: systemPromptAppend,
});

export const config = {
  telegram: {
    token: required("TELEGRAM_BOT_TOKEN"),
  },

  llm: {
    provider: llmProvider,
    apiKey: llmApiKey,
    baseUrl: llmBaseUrl,
    model: llmModel,
    models: llmModels,
    apiKeyEnv,

    limits: {
      requestsPerMinute: getNumber(llmLimitsFromFile, "requestsPerMinute") ?? 30,
      requestsPerDay: getNumber(llmLimitsFromFile, "requestsPerDay") ?? 1_000,
      tokensPerMinute: getNumber(llmLimitsFromFile, "tokensPerMinute") ?? 8_000,
      tokensPerDay: getNumber(llmLimitsFromFile, "tokensPerDay") ?? 200_000,
    },
  },

  bot: {
    adminIds: (process.env.BOT_ADMIN_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
    maxConversationHistory: getNumber(botFromFile, "maxConversationHistory") ?? 20,
    maxAgentIterations: getNumber(botFromFile, "maxAgentIterations") ?? 5,
    telegramUserRpmLimit: getNumber(botFromFile, "telegramUserRpmLimit") ?? 15,
    lowTokenMode: getLowTokenMode(botFromFile, "lowTokenMode") ?? "auto",
    systemPrompt: effectiveSystemPrompt,
  },
} as const;
