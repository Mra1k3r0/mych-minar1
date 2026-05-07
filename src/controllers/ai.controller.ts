import { Controller, Command, CallbackQuery, On, Keyboard } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { config } from "../config.js";
import { agentExecutor, conversations, llm } from "../container.js";
import { commandRegistry } from "../commands/index.js";
import type { ChatMessage } from "../services/llm.js";
import { RateLimitError } from "../services/llm.js";
import { codeBlock } from "../utils/format.js";
import { renderTelegramRichText } from "@mra1k3r0/gramora";
import { guardMathExpression } from "../utils/security.js";
import { sendRichText } from "../services/telegram/rich.js";
import { buildTelegramContext } from "../services/telegram-context.js";
import { Parser } from "expr-eval-fork";
import { extractCommandName, findClosestCommandName } from "../commands/suggest.js";
import {
  findKeywordCommand,
  getAutoExecutableCommands,
  isCommandListQuery,
  metaForCommand,
  parseCommandIntent,
  resolveAliasTarget,
} from "../services/ai/intent.js";
import {
  normalizePlannerActionDecision,
  parsePlannerIntentJson,
  pickBestVotedIntent,
} from "../services/ai/plan.js";
import { aiCommandBridge } from "../services/ai/bridge.js";
import {
  commandCatalogJson,
  commandCatalogText,
  commandListCompact,
  detectCommandGroupPreference,
  localCommandListHeader,
  renderCommandCatalog,
} from "../services/ai/catalog.js";
import {
  runAutoExec,
  shouldClarifyCommandExec,
  shouldClarifyMediaExec,
} from "../services/ai/autoexec.js";

@Controller()
export class AiController {
  private pendingIntent = new Map<number, { command: string; baseArgs?: string }>();
  private lastAutoAction = new Map<number, { command: string; args: string; ts: number }>();
  private readonly autoExecutableCommands = getAutoExecutableCommands();
  private readonly mathParser = new Parser({
    operators: {
      logical: false,
      comparison: false,
      assignment: false,
      in: false,
    },
  });

  constructor() {
    aiCommandBridge.ask = this.runAskCommand.bind(this);
    aiCommandBridge.chat = this.runChatModeCommand.bind(this);
    aiCommandBridge.agent = this.runAgentModeCommand.bind(this);
    aiCommandBridge.clear = this.runClearCommand.bind(this);
  }

  private async decideAssistantAction(
    text: string,
  ): Promise<{ mode: "execute" | "chat"; command?: string; args?: string; confidence: number }> {
    const commandList = commandListCompact();
    const catalogJson = commandCatalogJson(this.autoExecutableCommands);
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: this.promptByProvider(
            [
              "You are an action planner for a Telegram AI bot.",
              "Decide if user wants an immediate command execution or normal chat response.",
              "Output JSON only with schema:",
              '{"mode":"execute|chat","command":string|null,"args":string,"confidence":number}',
              "Rules:",
              "- mode=execute only when user intent is actionable and beneficial to execute now.",
              "- command must be from this exact list: " + commandList,
              "- never invent commands.",
              "- infer natural intent (e.g. 'send me something cute' can map to /cat or /neko).",
              "- if uncertain, mode=chat.",
              "- args should be short executable args (caption/query/etc).",
              "Use this command catalog JSON for reasoning:",
              catalogJson,
            ],
            [
              "Action planner. JSON only:",
              '{"mode":"execute|chat","command":null|string,"args":"","confidence":0..1}',
              `Allowed: ${commandList}`,
              "No invented commands. Uncertain=>chat. Keep args short.",
              catalogJson,
            ],
          ),
        },
        { role: "user", content: text },
      ]);
      const parsed = parsePlannerIntentJson(message.content ?? "");
      return normalizePlannerActionDecision(parsed, (name) => Boolean(commandRegistry.get(name)));
    } catch {
      return { mode: "chat", confidence: 0 };
    }
  }

  private isGroqProvider(): boolean {
    const provider = config.llm.provider;
    const baseUrl = config.llm.baseUrl.toLowerCase();
    const model = config.llm.model.toLowerCase();
    return (
      provider === "openai_compatible" &&
      (baseUrl.includes("groq.com") || model.includes("gpt-oss"))
    );
  }

  private isLlmBudgetTight(): boolean {
    if (config.bot.lowTokenMode === "always") return true;
    if (config.bot.lowTokenMode === "off") return false;
    const s = llm.rateLimitStatus();
    const reqRatio = s.minuteRequests.max > 0 ? s.minuteRequests.used / s.minuteRequests.max : 0;
    const tokRatio = s.minuteTokens.max > 0 ? s.minuteTokens.used / s.minuteTokens.max : 0;
    return (
      !s.canProceed ||
      s.retryAfterMs > 0 ||
      reqRatio >= 0.72 ||
      tokRatio >= 0.72 ||
      s.estimatedTokensAvailable < 900
    );
  }

  private trimConversationHistory(messages: ChatMessage[]): ChatMessage[] {
    const maxTurns = this.isLlmBudgetTight() ? 6 : 12;
    const maxChars = this.isLlmBudgetTight() ? 2200 : 5200;
    const tail = messages.slice(-maxTurns);
    const out: ChatMessage[] = [];
    let used = 0;
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = tail[i];
      const size = (m.content?.length ?? 0) + 24;
      if (used + size > maxChars && out.length > 0) break;
      out.unshift(m);
      used += size;
    }
    return out;
  }

  private promptByProvider(full: string[], compactForGroq: string[]): string {
    return (this.isGroqProvider() ? compactForGroq : full).join("\n");
  }

  private async maybeSendCreativeCommandList(gram: BaseContext, text: string): Promise<boolean> {
    const lower = this.localPromptize(text);
    if (!isCommandListQuery(lower)) {
      return false;
    }
    const preferredGroup = detectCommandGroupPreference(lower);
    const wantsGrouped = /(category|group|by categ|by category|categor)/.test(lower);
    const grouped = renderCommandCatalog(wantsGrouped || Boolean(preferredGroup), preferredGroup);
    const fallbackHeader = localCommandListHeader(gram);
    if (this.isLlmBudgetTight()) {
      await this.sendAi(gram, [fallbackHeader, "", ...grouped].join("\n"));
      return true;
    }
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: this.promptByProvider(
            [
              "User asked for bot commands/features.",
              'Return JSON only: {"header": string}',
              "Header must be lively, human, non-repetitive, one short line.",
              "Do not include command entries; only the intro line.",
            ],
            ['JSON only {"header":string}', "One short human intro line. No command entries."],
          ),
        },
        { role: "user", content: text },
      ]);
      const m = message.content?.match(/\{[\s\S]*\}/);
      const parsed = m ? (JSON.parse(m[0]) as { header?: string }) : {};
      const headerRaw = (parsed.header ?? "").trim();
      const header = headerRaw.length >= 4 ? headerRaw : localCommandListHeader(gram);
      await this.sendAi(gram, [header, "", ...grouped].join("\n"));
      return true;
    } catch {
      await this.sendAi(gram, [fallbackHeader, "", ...grouped].join("\n"));
      return true;
    }
  }

  private isCommandListQuery(text: string): boolean {
    return isCommandListQuery(this.localPromptize(text));
  }

  private async decidePendingFollowup(
    pendingCommand: string,
    pendingArgs: string,
    followupText: string,
  ): Promise<
    | { mode: "continue"; args: string }
    | { mode: "switch"; command: string; args: string }
    | { mode: "chat" }
  > {
    if (this.isLlmBudgetTight()) {
      const switchIntent = this.parseCommandIntent(followupText);
      if (switchIntent?.command && switchIntent.command !== pendingCommand) {
        return { mode: "switch", command: switchIntent.command, args: switchIntent.args };
      }
      return {
        mode: "continue",
        args: [pendingArgs, followupText].filter(Boolean).join(" ").trim(),
      };
    }
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: [
            "Interpret user's follow-up in context of a pending bot action.",
            "Return JSON only with schema:",
            '{"mode":"continue|switch|chat","command":string|null,"args":string}',
            "Rules:",
            "- mode=continue: user clarifies pending command; produce better args.",
            "- mode=switch: user asks a different command; command must be valid slash command name without '/'.",
            "- mode=chat: user is not providing actionable follow-up.",
            "- never invent command names.",
            "Available commands: " + commandListCompact(),
            "Command catalog JSON:",
            commandCatalogJson(this.autoExecutableCommands),
          ].join("\n"),
        },
        {
          role: "user",
          content: `pending_command=${pendingCommand}\npending_args=${pendingArgs}\nfollowup=${followupText}`,
        },
      ]);
      const parsed = parsePlannerIntentJson(message.content ?? "");
      if (!parsed)
        return {
          mode: "continue",
          args: [pendingArgs, followupText].filter(Boolean).join(" ").trim(),
        };
      if (!parsed.command) {
        if (followupText.trim().length > 0)
          return {
            mode: "continue",
            args: [pendingArgs, followupText].filter(Boolean).join(" ").trim(),
          };
        return { mode: "chat" };
      }
      if (!commandRegistry.get(parsed.command))
        return {
          mode: "continue",
          args: [pendingArgs, followupText].filter(Boolean).join(" ").trim(),
        };
      if (parsed.command === pendingCommand) {
        return {
          mode: "continue",
          args: [pendingArgs, parsed.args || followupText].filter(Boolean).join(" ").trim(),
        };
      }
      return { mode: "switch", command: parsed.command, args: parsed.args };
    } catch {
      return {
        mode: "continue",
        args: [pendingArgs, followupText].filter(Boolean).join(" ").trim(),
      };
    }
  }

  private splitTelegramChunks(text: string, maxLen = 3200): string[] {
    if (text.length <= maxLen) return [text];
    const lines = text.split("\n");
    const chunks: string[] = [];
    let buf = "";
    let inFence = false;

    for (const line of lines) {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      const candidate = buf.length > 0 ? `${buf}\n${line}` : line;
      if (!inFence && buf.length > 0 && candidate.length > maxLen) {
        chunks.push(buf.trim());
        buf = line;
      } else {
        buf = candidate;
      }
    }

    if (buf.trim().length > 0) chunks.push(buf.trim());
    return chunks;
  }

  private isCodeGenerationRequest(text: string): boolean {
    const lower = this.localPromptize(text);
    return (
      /\b(code|snippet|program|script|function|class|algorithm|calculator|calc)\b/.test(lower) &&
      /\b(lua|java|python|javascript|typescript|c\+\+|cpp|c#|go|rust|php|swift|kotlin)\b/.test(
        lower,
      )
    );
  }

  private responseMaxTokens(userText: string): number | undefined {
    if (!this.isCodeGenerationRequest(userText)) return undefined;
    return this.isLlmBudgetTight() ? 700 : 1400;
  }

  private isLikelyGibberish(text: string): boolean {
    const t = text.trim();
    if (!t) return true;
    const hasLongRun = /(.)\1{8,}/.test(t);
    if (t.length < 160) return hasLongRun;

    // optimization: single pass for tokens and reuse lowercase string to avoid allocations
    const lower = t.toLowerCase();
    const tokens = lower.split(/\s+/);
    const freq = new Map<string, number>();
    let totalTokens = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.length === 0) continue;
      totalTokens++;
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }

    if (totalTokens < 12) return hasLongRun;
    let top = 0;
    for (const n of freq.values()) if (n > top) top = n;
    const topRatio = top / totalTokens;
    const uniqueRatio = freq.size / totalTokens;

    // optimization: use for loop with surrogate detection for faster, accurate unicode counting
    let nonAscii = 0;
    for (let i = 0; i < t.length; i++) {
      const code = t.charCodeAt(i);
      if (code > 127) {
        nonAscii++;
        // Skip low surrogate to count emoji/surrogate pairs as 1 logical unit
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < t.length) {
          const next = t.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) i++;
        }
      }
    }

    const nonAsciiRatio = nonAscii / t.length;
    const alphaWords = (t.match(/[a-zA-Z]{3,}/g) ?? []).length;
    const sentenceLike = /[.!?]/.test(t) && alphaWords >= 5;

    if (sentenceLike && nonAsciiRatio < 0.3 && topRatio < 0.35) return false;
    const looksLikeWordSoup = t.length > 300 && topRatio > 0.34 && uniqueRatio < 0.2;
    const unreadableUnicode = t.length > 220 && nonAsciiRatio > 0.35;
    return hasLongRun || looksLikeWordSoup || unreadableUnicode;
  }

  private shouldSendRawLiteral(userText?: string): boolean {
    if (!userText) return false;
    const q = userText.toLowerCase();
    return /\b(raw|as[- ]?is|verbatim|literal|plain text|no format|unformatted)\b/.test(q);
  }

  private async sendOrClarify(gram: BaseContext, text: string, userText?: string) {
    const rawMode = this.shouldSendRawLiteral(userText);
    if (this.isLikelyGibberish(text)) {
      const cleaned = text.replace(/\s+/g, " ").trim();
      // If it still reads fine, ship it instead of over-blocking.
      if (cleaned.length >= 40 && /[a-zA-Z]{3,}/.test(cleaned)) {
        await this.sendAi(gram, cleaned.slice(0, 3800), rawMode);
        return;
      }
      await sendRichText(
        gram,
        "I didn’t parse that cleanly 😵‍💫. Can you rephrase in one short line?",
      );
      return;
    }
    await this.sendAi(gram, text, rawMode);
  }

  private async sendAi(gram: BaseContext, text: string, raw = false) {
    const shouldUploadAsFile = this.shouldUploadAiAsFile(text);
    if (gram.chatId && shouldUploadAsFile) {
      const ext = this.inferCodeExtension(text);
      const tempPath = path.join(tmpdir(), `minar1-ai-${randomUUID()}.${ext}`);
      try {
        await writeFile(tempPath, text, "utf8");
        const apiWithDocument = gram.api as unknown as {
          sendDocument: (payload: {
            chat_id: number | string;
            document: string;
            caption?: string;
          }) => Promise<unknown>;
        };
        await apiWithDocument.sendDocument({
          chat_id: gram.chatId,
          document: tempPath,
          caption: "AI response attached as file (long code output).",
        });
        return;
      } catch {
        // Fallback to normal chunked send below.
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }
    }
    const chunks = this.splitTelegramChunks(text, 3200);
    for (const chunk of chunks) {
      if (gram.chatId) {
        const rendered = raw ? chunk : renderTelegramRichText(chunk);
        try {
          await gram.api.sendMessage({
            chat_id: gram.chatId,
            text: rendered,
            ...(raw ? {} : { parse_mode: "HTML" as const }),
          });
        } catch {
          // Telegram may reject formatted payloads (400 parse/length edge cases).
          // Fallback to plain text so AI replies still go through.
          await gram.api.sendMessage({
            chat_id: gram.chatId,
            text: chunk,
          });
        }
      } else {
        await sendRichText(gram, chunk);
      }
    }
  }

  private shouldUploadAiAsFile(text: string): boolean {
    const hasFence = /```[\s\S]*?```/.test(text);
    const isLong = text.length > 3000;
    return hasFence && isLong;
  }

  private inferCodeExtension(text: string): string {
    const lang = text.match(/```([a-zA-Z0-9_+#.-]+)/)?.[1]?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ts: "ts",
      typescript: "ts",
      js: "js",
      javascript: "js",
      py: "py",
      python: "py",
      go: "go",
      rs: "rs",
      rust: "rs",
      java: "java",
      c: "c",
      cpp: "cpp",
      cxx: "cpp",
      cc: "cpp",
      cs: "cs",
      sh: "sh",
      bash: "sh",
      zsh: "sh",
      json: "json",
      yaml: "yaml",
      yml: "yml",
      html: "html",
      css: "css",
      sql: "sql",
      md: "md",
      markdown: "md",
    };
    return map[lang] ?? "txt";
  }

  private capabilityContext(mode: "chat" | "agent"): string {
    const modeCapabilities =
      mode === "agent"
        ? [
            "Current mode: agent",
            "Agent tools available: calculate, datetime, generate_text, remember, recall.",
            "When user asks for available commands, list only commands from the source-of-truth list.",
          ]
        : [
            "Current mode: chat",
            "No external web search tool enabled yet.",
            "Tone: lively, human, smart-assistant vibe (not robotic).",
            "When user asks for available commands, list only commands from the source-of-truth list.",
            "Never invent commands. If a command is not in the source-of-truth list, say it is unavailable.",
            "When suggesting commands, use exact slash format from the source-of-truth list.",
            "Do not tell users to use /ask during normal conversation.",
          ];
    return [...modeCapabilities, "", commandCatalogText()].join("\n");
  }

  private fastPath(gram: BaseContext, text: string): string | null {
    const lower = text.trim().toLowerCase();
    const from = gram.message?.from;

    if (/(^|\b)(who are you|who r you|who u|about you|what are you)\b/.test(lower)) {
      return "I’m minar1 — your AI Telegram assistant built by mra1k3r0 (John Paul Caigas).";
    }

    if (/(^|\b)(who am i|my username|what is my username|username\??)\b/.test(lower)) {
      return `@${from?.username ?? "n/a"}`;
    }
    if (/(^|\b)(my id|user id|what is my id)\b/.test(lower)) {
      return `Your user id is ${String(gram.fromId ?? "n/a")}`;
    }
    if (/(^|\b)(chat id|group id|this chat id)\b/.test(lower)) {
      return `Chat id is ${String(gram.chatId ?? "n/a")}`;
    }
    const asksName =
      /^(who am i|what(?:'s| is)? my name\??|my name\??)$/i.test(lower) ||
      /\b(what(?:'s| is)\s+my\s+name)\b/i.test(lower);
    const isNameEditIntent = /\b(change|rename|set|edit|update)\s+my\s+name\b/i.test(lower);
    if (asksName && !isNameEditIntent) {
      const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
      return name ? `Your name is ${name}` : "I can't see your name in this update.";
    }

    const calcMatch =
      lower.match(/^\s*(?:calc|calculate|math)\s+(.+)\s*$/) ?? lower.match(/^\s*=\s*(.+)\s*$/);
    if (calcMatch?.[1]) {
      const expr = calcMatch[1].trim();
      const guard = guardMathExpression(expr);
      if (!guard.ok) return guard.error ?? "Invalid expression.";
      try {
        const result = this.mathParser.evaluate(expr);
        if (typeof result === "number" && Number.isFinite(result))
          return `Result: ${String(result)}`;
        return "That math expression did not return a number.";
      } catch {
        return "That math expression looks invalid.";
      }
    }

    const explicitCmd = lower.match(/(?:^|\s)\/([a-z0-9_]+)/i)?.[1];
    if (explicitCmd && !commandRegistry.get(explicitCmd)) {
      return `That command does not exist: /${explicitCmd}. Use /help for valid commands.`;
    }

    return null;
  }

  private localPromptize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\bu\b/g, "you")
      .replace(/\bur\b/g, "your")
      .replace(/\bpls\b/g, "please")
      .replace(/\brabdom\b/g, "random")
      .trim();
  }

  // Keep both raw + normalized text so intent routing stays sharp.
  private optimizePromptInput(text: string): string {
    const original = text.trim();
    const normalized = this.localPromptize(text);
    const tags: string[] = [];
    if (this.isCommandListQuery(text)) tags.push("capability_query");
    if (/\b(play|video)\b/.test(normalized)) tags.push("media_request");
    if (/\b(cat|dog|neko|hug|kiss|pat|cuddle|slap|meme|vtuber)\b/.test(normalized))
      tags.push("image_or_reaction_request");
    if (/\b(send|give|show|fetch|make|run|do)\b/.test(normalized)) tags.push("action_verb");
    if (/\b(please|pls|can you|could you)\b/.test(normalized)) tags.push("polite");
    if (/\b(what|how|why|explain)\b/.test(normalized)) tags.push("question");
    if (normalized.length <= 20) tags.push("short_input");

    return [
      "USER_INPUT_OPTIMIZED",
      `original="${original}"`,
      `normalized="${normalized}"`,
      `tags=${tags.length ? tags.join(",") : "none"}`,
    ].join("\n");
  }

  private findKeywordCommand(text: string): string | null {
    return findKeywordCommand(text);
  }

  private shouldUseHeavyIntentPlanning(text: string): boolean {
    const lower = this.localPromptize(text);
    if (!lower) return false;
    if (this.isCommandListQuery(lower)) return false;
    if (
      lower.length <= 18 &&
      !/\b(play|video|cat|dog|meme|hug|kiss|pat|cuddle|slap|neko|roll|choose|rps|8ball|vtuber|status|stats|help|id|ping|uptime)\b/.test(
        lower,
      )
    ) {
      return false;
    }
    const actionish =
      /\b(send|give|show|fetch|play|video|make|do|run|use|please|pls|can you|could you|i want|i need|help me)\b/.test(
        lower,
      );
    const mentionsKnownCommand = this.findKeywordCommand(lower) !== null;
    return actionish || mentionsKnownCommand;
  }

  private parseCommandIntent(text: string): { command: string; args: string } | null {
    return parseCommandIntent(text);
  }

  private extractCommandFromAssistantText(text: string): { command: string; args: string } | null {
    const cleaned = text
      .replace(/<code>/gi, "")
      .replace(/<\/code>/gi, "")
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
      .replace(/`/g, "")
      .trim();

    const direct = cleaned.match(/(?:^|\n)\s*\/([a-z0-9_]+)(?:\s+([^\n]+))?\s*$/i);
    if (direct?.[1]) {
      const command = direct[1].toLowerCase();
      if (this.autoExecutableCommands.has(command)) {
        return { command, args: typeof direct[2] === "string" ? direct[2].trim() : "" };
      }
    }

    const inline = cleaned.match(/\/([a-z0-9_]+)(?:\s+([a-z0-9_\- ]{1,64}))?/i);
    if (!inline?.[1]) return null;
    const command = inline[1].toLowerCase();
    if (!this.autoExecutableCommands.has(command)) return null;
    const rawArgs = typeof inline[2] === "string" ? inline[2].trim() : "";
    const args = rawArgs
      .replace(/\b(coming|right|up|now|please|thanks|thank you)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { command, args };
  }

  private async maybeSendActionPreface(
    gram: BaseContext,
    command: string,
    userText: string,
  ): Promise<void> {
    const socialSet = new Set([
      "cat",
      "dog",
      "neko",
      "hug",
      "kiss",
      "pat",
      "cuddle",
      "slap",
      "meme",
    ]);
    if (!socialSet.has(command)) return;
    if (this.isLlmBudgetTight()) return;
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: this.promptByProvider(
            [
              "Decide if assistant should send a short preface before executing this action command.",
              'Return JSON only: {"send": boolean, "text": string}',
              "Rules:",
              "- If user sounds polite, usually send=false.",
              "- If user sounds demanding, you may send a playful tease/hype line.",
              "- Keep text under 60 chars, natural, non-repetitive, friendly.",
              "- No markdown.",
            ],
            [
              'JSON only {"send":bool,"text":string}',
              "Preface optional; friendly, short, no markdown.",
              "Polite user => usually send=false.",
            ],
          ),
        },
        { role: "user", content: `command=${command}\nrequest=${userText}` },
      ]);
      const m = message.content?.match(/\{[\s\S]*\}/);
      if (!m) return;
      const parsed = JSON.parse(m[0]) as { send?: boolean; text?: string };
      if (!parsed.send) return;
      const t = (parsed.text ?? "").trim();
      if (t.length < 2) return;
      await sendRichText(gram, t.slice(0, 60));
    } catch {
      // Preface is just extra flavor; skip on failure.
    }
  }

  private isActionRequest(text: string): boolean {
    const lower = text.toLowerCase();
    if (/^(what|what\?|huh|who|who\?|hello|hi|hey|yo)$/i.test(lower.trim())) return false;
    if (this.parseCommandIntent(text)) return true;
    const hasKnownKeyword = this.findKeywordCommand(lower) !== null;
    return (
      hasKnownKeyword &&
      /\b(send|give|show|fetch|play|video|pls|please|can you|could you|want|need)\b/.test(lower)
    );
  }

  private async detectIntentWithLlm(
    text: string,
  ): Promise<{ command: string; args: string } | null> {
    const catalog = commandCatalogText();
    const commandList = commandListCompact();
    const catalogJson = commandCatalogJson(this.autoExecutableCommands);
    const prompts = [
      "Classifier A: prioritize action execution.",
      "Classifier B: prioritize avoiding hallucinations.",
      "Classifier C: prioritize extracting clean args/caption.",
    ];

    try {
      const results = await Promise.all(
        prompts.map(async (hint) => {
          const { message } = await llm.chat([
            {
              role: "system",
              content: [
                hint,
                "You are an intent classifier for a Telegram assistant.",
                "Output JSON ONLY with schema:",
                '{"command": string|null, "args": string, "confidence": number}',
                "Rules:",
                "- command must be one from this exact list: " + commandList,
                "- if no executable command intent, set command to null",
                "- never invent command names",
                "- keep args concise and executable",
                "- use command catalog JSON to reason about args/requirements",
                "",
                catalog,
                "",
                "Command catalog JSON:",
                catalogJson,
              ].join("\n"),
            },
            { role: "user", content: text },
          ]);
          return parsePlannerIntentJson(message.content ?? "");
        }),
      );
      return pickBestVotedIntent(results, (name) => Boolean(commandRegistry.get(name)));
    } catch {
      return null;
    }
  }

  private async executeKnownCommand(
    gram: BaseContext,
    command: string,
    args: string,
  ): Promise<boolean> {
    return runAutoExec({
      gram,
      command,
      args,
      userText: gram.text ?? "",
      lastAutoAction: this.lastAutoAction,
      llmChat: (messages) => llm.chat(messages),
      promptByProvider: (full, compact) => this.promptByProvider(full, compact),
      localPromptize: (text) => this.localPromptize(text),
    });
  }

  private requiresArgsMissing(command: string, args: string): boolean {
    return metaForCommand(command).requiresArgs && args.trim().length === 0;
  }

  private async promptForMissingArgs(
    gram: BaseContext,
    command: string,
    args: string,
    userText: string,
  ): Promise<void> {
    const userId = gram.fromId;
    if (userId) this.pendingIntent.set(userId, { command, baseArgs: args });
    const clarify = await shouldClarifyCommandExec({
      command,
      userText,
      args,
      llmBudgetTight: this.isLlmBudgetTight(),
      catalogJson: commandCatalogJson(this.autoExecutableCommands),
      llmChat: (messages) => llm.chat(messages),
    });
    await sendRichText(gram, clarify.prompt);
  }

  private async handleAdaptiveIntent(gram: BaseContext, text: string): Promise<boolean> {
    const promptized = this.localPromptize(text);
    if (this.isCommandListQuery(promptized)) return false;
    if (!this.shouldUseHeavyIntentPlanning(promptized)) return false;
    const parsedIntent = this.parseCommandIntent(promptized);
    if (parsedIntent?.command) {
      if (!this.requiresArgsMissing(parsedIntent.command, parsedIntent.args)) {
        const executed = await this.executeKnownCommand(
          gram,
          parsedIntent.command,
          parsedIntent.args,
        );
        if (executed) return true;
      }
    }
    if (this.isLlmBudgetTight()) return false;
    const optimized = this.optimizePromptInput(text);
    const decision = await this.decideAssistantAction(optimized);
    let intent =
      decision.mode === "execute" && decision.command
        ? { command: decision.command, args: decision.args ?? "" }
        : parsedIntent;
    if (parsedIntent && (parsedIntent.command === "play" || parsedIntent.command === "video")) {
      intent = parsedIntent;
    }
    if (!intent?.command) return false;
    if (
      intent.command === "vtuber" &&
      !/\b(vtuber|gura|pekora|korone|mumei|fubuki|botan|marine|random)\b/i.test(text)
    ) {
      return false;
    }

    if (intent.command === "play" || intent.command === "video") {
      const mediaCommand: "play" | "video" = intent.command;
      const shouldClarify = await shouldClarifyMediaExec({
        command: mediaCommand,
        userText: text,
        args: intent.args,
        llmBudgetTight: this.isLlmBudgetTight(),
        llmChat: (messages) => llm.chat(messages),
        promptByProvider: (full, compact) => this.promptByProvider(full, compact),
      });
      if (shouldClarify) {
        const userId = gram.fromId;
        if (userId)
          this.pendingIntent.set(userId, { command: intent.command, baseArgs: intent.args });
        const prompt =
          intent.command === "play"
            ? "Got you. What music vibe do you want? (artist/genre/mood, e.g. 'lofi chill' or 'The Weeknd')"
            : "Sure. What video should I search? (artist/title/topic, e.g. 'Clairo Pretty Girl official video')";
        await sendRichText(gram, prompt);
        return true;
      }
    }

    const clarify = await shouldClarifyCommandExec({
      command: intent.command,
      userText: text,
      args: intent.args,
      llmBudgetTight: this.isLlmBudgetTight(),
      catalogJson: commandCatalogJson(this.autoExecutableCommands),
      llmChat: (messages) => llm.chat(messages),
    });
    if (clarify.ask) {
      const userId = gram.fromId;
      if (userId)
        this.pendingIntent.set(userId, { command: intent.command, baseArgs: intent.args });
      await sendRichText(gram, clarify.prompt);
      return true;
    }

    await this.maybeSendActionPreface(gram, intent.command, text);

    if (intent.command === "help" && this.isCommandListQuery(text)) {
      await this.maybeSendCreativeCommandList(gram, text);
      return true;
    }

    if (this.requiresArgsMissing(intent.command, intent.args)) {
      await this.promptForMissingArgs(gram, intent.command, intent.args, text);
      return true;
    }

    const executed = await this.executeKnownCommand(gram, intent.command, intent.args);
    if (!executed && commandRegistry.get(intent.command)) {
      await sendRichText(
        gram,
        `I know /${intent.command} exists but it's not wired for AI auto-run yet. I'll add it next.`,
      );
    }
    return executed;
  }

  private buildMessagesWithTelegramContext(
    gram: BaseContext,
    mode: "chat" | "agent",
    userMessages: ChatMessage[],
  ): ChatMessage[] {
    const trimmed = this.trimConversationHistory(userMessages);
    return [
      { role: "system", content: config.bot.systemPrompt },
      { role: "system", content: buildTelegramContext(gram) },
      { role: "system", content: this.capabilityContext(mode) },
      ...trimmed,
    ];
  }

  private async runAskCommand(gram: BaseContext) {
    const question = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!question) {
      await sendRichText(gram, "Usage: /ask `<your question>`");
      return;
    }

    if (await this.maybeSendCreativeCommandList(gram, question)) return;

    const fast = this.fastPath(gram, question);
    if (fast) {
      await this.sendAi(gram, fast);
      return;
    }
    if (await this.handleAdaptiveIntent(gram, question)) return;

    const messages = this.buildMessagesWithTelegramContext(gram, "chat", [
      { role: "user", content: question },
    ]);
    const maxTokens = this.responseMaxTokens(question);

    try {
      const { message } = await llm.chat(messages, maxTokens ? { maxTokens } : undefined);
      await this.sendOrClarify(gram, message.content ?? "", question);
    } catch (err) {
      await this.handleAiError(gram, err);
    }
  }

  private async runChatModeCommand(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.setMode(userId, "chat");
    await sendRichText(
      gram,
      "💬 *Chat mode active*",
      Keyboard.inline().text("🗑 Clear", "ai:clear").text("🤖 Agent", "mode:agent").build(),
    );
  }

  private async runAgentModeCommand(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.setMode(userId, "agent");
    await sendRichText(
      gram,
      "🤖 *Agent mode active* (tools enabled)",
      Keyboard.inline().text("🗑 Clear", "ai:clear").text("💬 Chat", "mode:chat").build(),
    );
  }

  private async runClearCommand(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.clear(userId);
    await sendRichText(gram, "🗑 Cleared.");
  }

  @Command("ask")
  async ask(gram: BaseContext) {
    await commandRegistry.run("ask", gram);
  }

  @Command("chat")
  async chatMode(gram: BaseContext) {
    await commandRegistry.run("chat", gram);
  }

  @Command("agent")
  async agentMode(gram: BaseContext) {
    await commandRegistry.run("agent", gram);
  }

  @Command("clear")
  async clear(gram: BaseContext) {
    await commandRegistry.run("clear", gram);
  }

  @CallbackQuery("mode:*")
  async modeSwitch(gram: BaseContext) {
    const mode = gram.match?.[0];
    const userId = gram.fromId;
    if (!mode || !userId) return;
    await gram.answer();
    if (mode === "chat") conversations.setMode(userId, "chat");
    if (mode === "agent") conversations.setMode(userId, "agent");
    await sendRichText(gram, mode === "agent" ? "🤖 Agent mode." : "💬 Chat mode.");
  }

  @CallbackQuery("ai:*")
  async aiCallbacks(gram: BaseContext) {
    const action = gram.match?.[0];
    const userId = gram.fromId;
    if (!action || !userId) return;
    if (action === "clear") {
      conversations.clear(userId);
      await gram.answer("Cleared");
      await sendRichText(gram, "🗑 Cleared.");
    }
  }

  @On("text")
  async onText(gram: BaseContext) {
    const text = gram.text;
    const userId = gram.fromId;
    if (!text || !userId) return;
    if (text.startsWith("/")) {
      const cmdName = extractCommandName(text);
      if (!cmdName) return;
      if (commandRegistry.get(cmdName)) return;
      const aliasTarget = resolveAliasTarget(cmdName);
      if (aliasTarget) {
        if (!commandRegistry.get(aliasTarget)) {
          await sendRichText(
            gram,
            `"${cmdName}" alias is mapped but "/${aliasTarget}" is not loaded.`,
          );
          return;
        }
        const args = text.split(/\s+/).slice(1).join(" ").trim();
        const patchedText = `/${aliasTarget}${args ? ` ${args}` : ""}`;
        const patchedGram = new Proxy(gram, {
          get(target, prop, receiver) {
            if (prop === "text") return patchedText;
            const value: unknown = Reflect.get(target, prop, receiver);
            return value;
          },
        });
        const executed = await commandRegistry.run(aliasTarget, patchedGram);
        if (executed) return;
      }
      const suggestion = findClosestCommandName(cmdName, commandRegistry.all());
      if (suggestion) {
        await sendRichText(gram, `"${cmdName}" isnt available. you mean "/${suggestion}"?`);
        return;
      }
      await sendRichText(gram, `"${cmdName}" isnt available.`);
      return;
    }

    const fast = this.fastPath(gram, text);
    if (fast) {
      await sendRichText(gram, fast);
      return;
    }

    if (await this.maybeSendCreativeCommandList(gram, text)) return;

    const follow = text.trim().toLowerCase();
    const last = this.lastAutoAction.get(userId);
    const recentLast = last && Date.now() - last.ts < 10 * 60_000 ? last : null;
    if (recentLast) {
      if (/^(another one|again|one more|more|next)$/i.test(follow)) {
        const ran = await this.executeKnownCommand(gram, recentLast.command, recentLast.args);
        if (ran) return;
      }
      if (
        /^(who is that|who is this|who's that|name\??)$/i.test(follow) &&
        recentLast.command === "vtuber"
      ) {
        const who =
          /\b(gura|pekora|korone|uto|mumei|koyori|fubuki|chloe|ayame|polka|botan|amelia|okayu|watame|aloe|marine|coco|rushia)\b/i.exec(
            recentLast.args,
          )?.[1] ?? "a random vtuber";
        await gram.reply(`That was ${who}.`);
        return;
      }
    }

    const pending = this.pendingIntent.get(userId);
    if (pending) {
      this.pendingIntent.delete(userId);
      const pendingDecision = await this.decidePendingFollowup(
        pending.command,
        pending.baseArgs ?? "",
        text,
      );
      if (pendingDecision.mode === "chat") {
        // Chat mode means "no command execution needed".
      } else if (pendingDecision.mode === "switch") {
        if (this.requiresArgsMissing(pendingDecision.command, pendingDecision.args)) {
          await this.promptForMissingArgs(
            gram,
            pendingDecision.command,
            pendingDecision.args,
            text,
          );
          return;
        }
        const ok = await this.executeKnownCommand(
          gram,
          pendingDecision.command,
          pendingDecision.args,
        );
        if (ok) return;
      } else {
        if (this.requiresArgsMissing(pending.command, pendingDecision.args)) {
          await this.promptForMissingArgs(gram, pending.command, pendingDecision.args, text);
          return;
        }
        const ok = await this.executeKnownCommand(gram, pending.command, pendingDecision.args);
        if (ok) return;
      }
    }

    if (await this.handleAdaptiveIntent(gram, text)) return;

    const mode = conversations.getMode(userId);
    if (mode === "agent") {
      await this.handleAgent(gram, userId, text);
    } else {
      await this.handleChat(gram, userId, text);
    }
  }

  private async handleChat(gram: BaseContext, userId: number, text: string) {
    conversations.append(userId, { role: "user", content: text });
    const history = conversations.get(userId);

    const messages = this.buildMessagesWithTelegramContext(gram, "chat", history);
    const maxTokens = this.responseMaxTokens(text);
    try {
      const { message } = await llm.chat(messages, maxTokens ? { maxTokens } : undefined);
      const extracted = this.extractCommandFromAssistantText(message.content ?? "");
      const shouldAutoRunExtracted =
        this.isActionRequest(text) ||
        /^\/[a-z0-9_]+/i.test(text.trim()) ||
        /^(another one|again|one more|more|next)$/i.test(text.trim());
      if (extracted && shouldAutoRunExtracted) {
        if (this.requiresArgsMissing(extracted.command, extracted.args)) {
          await this.promptForMissingArgs(gram, extracted.command, extracted.args, text);
          return;
        }
        const ran = await this.executeKnownCommand(gram, extracted.command, extracted.args);
        if (ran) return;
      }
      if (this.isActionRequest(text)) {
        const suggested =
          this.parseCommandIntent(message.content ?? "") ??
          this.parseCommandIntent(this.localPromptize(text));
        if (suggested?.command) {
          if (this.requiresArgsMissing(suggested.command, suggested.args)) {
            await this.promptForMissingArgs(gram, suggested.command, suggested.args, text);
            return;
          }
          const ran = await this.executeKnownCommand(gram, suggested.command, suggested.args);
          if (ran) return;
        }
      }
      conversations.append(userId, { role: "assistant", content: message.content ?? "" });
      await this.sendOrClarify(gram, message.content ?? "", text);
    } catch (err) {
      await this.handleAiError(gram, err);
    }
  }

  private async handleAgent(gram: BaseContext, userId: number, text: string) {
    conversations.append(userId, { role: "user", content: text });
    const history = conversations.get(userId);
    const groundedHistory: ChatMessage[] = [
      { role: "system", content: buildTelegramContext(gram) },
      { role: "system", content: this.capabilityContext("agent") },
      ...history,
    ];

    try {
      const result = await agentExecutor.execute(userId, groundedHistory);
      conversations.append(userId, { role: "assistant", content: result.response });
      const cmds =
        result.toolCommands.length > 0
          ? `\n\n**Commands executed:**\n${codeBlock(result.toolCommands.slice(0, 8).join("\n"))}`
          : "";
      await this.sendOrClarify(gram, result.response + cmds);
    } catch (err) {
      await this.handleAiError(gram, err);
    }
  }

  private async handleAiError(gram: BaseContext, err: unknown) {
    if (err instanceof RateLimitError) {
      const waitSec = Math.ceil(err.retryAfterMs / 1000);
      await sendRichText(gram, `⏳ Rate limited. Try again in ~${String(waitSec)}s.`);
      return;
    }
    console.error("[AI Error]", err);
    await gram.send("❌ AI is currently unavailable. Try again in a moment.");
  }
}
