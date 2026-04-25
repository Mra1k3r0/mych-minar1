import { Controller, Command, CallbackQuery, On } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { Keyboard } from "@mra1k3r0/gramora";
import { config } from "../config.js";
import { agentExecutor, conversations, llm } from "../container.js";
import { commandRegistry } from "../commands/index.js";
import type { ChatMessage } from "../services/llm.js";
import { RateLimitError } from "../services/llm.js";
import { codeBlock, truncate } from "../utils/format.js";
import { buildTelegramContext } from "../services/telegram-context.js";
import { renderTelegramRichText } from "@mra1k3r0/gramora";
import { Parser } from "expr-eval";
import { FunController } from "./fun.controller.js";
import { CoreController } from "./core.controller.js";
import { AdminController } from "./admin.controller.js";
import { normalizeCommandIntentMap } from "../data/command-intent.schema.js";
import { getCommandIntentData } from "../services/command/store.js";

function buildCommandIntentMeta() {
  const raw = normalizeCommandIntentMap(getCommandIntentData());
  const out: Record<string, (typeof raw)[string]> = {};
  for (const [name, meta] of Object.entries(raw)) {
    const fromRegistry = commandRegistry.get(name);
    if (!fromRegistry) continue;
    out[name] = {
      group: meta.group ?? fromRegistry.group,
      ...meta,
    };
  }
  return Object.freeze(out);
}

const COMMAND_INTENT_META = buildCommandIntentMeta();
const COMMAND_KEYWORD_INDEX = Object.freeze(
  Object.entries(COMMAND_INTENT_META).map(([command, meta]) => ({
    command,
    tokens: Object.freeze([
      ...(meta.matchCommandName ? [command] : []),
      ...meta.aliases,
      ...meta.keywords,
    ]),
  })),
);

@Controller()
export class AiController {
  private pendingIntent = new Map<number, { command: string; baseArgs?: string }>();
  private lastAutoAction = new Map<number, { command: string; args: string; ts: number }>();
  private readonly autoExecutableCommands = new Set(
    Object.entries(COMMAND_INTENT_META)
      .filter(([, meta]) => meta.autoExecutable)
      .map(([name]) => name),
  );
  private readonly mathParser = new Parser({
    operators: {
      logical: false,
      comparison: false,
      assignment: false,
      in: false,
    },
  });

  private async decideAssistantAction(
    text: string,
  ): Promise<{ mode: "execute" | "chat"; command?: string; args?: string; confidence: number }> {
    const commandList = this.commandListCompact();
    const catalogJson = this.commandCatalogJson();
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
      const parsed = this.parseIntentJson(message.content ?? "");
      if (!parsed) return { mode: "chat", confidence: 0 };
      if (!parsed.command) return { mode: "chat", confidence: parsed.confidence };
      if (!commandRegistry.get(parsed.command))
        return { mode: "chat", confidence: parsed.confidence };
      return {
        mode: parsed.confidence >= 0.58 ? "execute" : "chat",
        command: parsed.command,
        args: parsed.args,
        confidence: parsed.confidence,
      };
    } catch {
      return { mode: "chat", confidence: 0 };
    }
  }

  private readonly fun = new FunController();
  private readonly core = new CoreController();
  private readonly admin = new AdminController();

  private formatCommandListHuman(gram: BaseContext): string {
    const from = gram.message?.from;
    const username = from?.username ? `@${from.username}` : "bro";
    const lines = commandRegistry.all().map((c) => `/${c.name} - ${c.description}`);
    return [`Sure ${username}, here are my real commands:`, "", ...lines].join("\n");
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
    if (
      !/(what commands|available commands|command list|list commands|help commands|show commands|feature list|features|what can you do|what can u do|what else can you do|what else u can do|what you can do|capabilities|list of commands|your commands|full command)/.test(
        lower,
      )
    ) {
      return false;
    }
    const preferredGroup = this.detectCommandGroupPreference(lower);
    const wantsGrouped = /(category|group|by categ|by category|categor)/.test(lower);
    const grouped = this.renderCommandCatalog(
      wantsGrouped || Boolean(preferredGroup),
      preferredGroup,
    );
    const fallbackHeader = this.localCommandListHeader(gram);
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
      const header = headerRaw.length >= 4 ? headerRaw : this.localCommandListHeader(gram);
      await this.sendAi(gram, [header, "", ...grouped].join("\n"));
      return true;
    } catch {
      await this.sendAi(gram, [fallbackHeader, "", ...grouped].join("\n"));
      return true;
    }
  }

  private localCommandListHeader(gram: BaseContext): string {
    const from = gram.message?.from;
    const username = from?.username ? `@${from.username}` : "bro";
    const headers = [
      `Here ${username}, full command list is ready:`,
      `Sure ${username} — here’s your live command board:`,
      `Aight ${username}, I got you. Full list below:`,
      `Yo ${username}, here are all commands I can run right now:`,
      `Done ${username} ✅ full feature/command list below:`,
    ];
    return headers[Math.floor(Math.random() * headers.length)];
  }

  private renderCommandCatalog(
    grouped: boolean,
    preferredGroup?: "core" | "ai" | "admin" | "fun",
  ): string[] {
    const all = commandRegistry.all();
    const filtered = preferredGroup ? all.filter((c) => c.group === preferredGroup) : all;
    if (!grouped) return filtered.map((c) => `/${c.name} - ${c.description}`);
    const order: Array<"core" | "ai" | "admin" | "fun"> = ["core", "ai", "admin", "fun"];
    const title: Record<(typeof order)[number], string> = {
      core: "Core",
      ai: "AI",
      admin: "Admin",
      fun: "Fun",
    };
    const lines: string[] = [];
    for (const g of order) {
      if (preferredGroup && g !== preferredGroup) continue;
      const items = filtered.filter((c) => c.group === g);
      if (!items.length) continue;
      lines.push(`${title[g]}:`);
      lines.push(...items.map((c) => `/${c.name} - ${c.description}`));
      lines.push("");
    }
    return lines.length > 0 ? lines.slice(0, -1) : [];
  }

  private detectCommandGroupPreference(text: string): "core" | "ai" | "admin" | "fun" | undefined {
    if (!text) return undefined;
    if (/\b(fun|funny|game|games|meme|random|entertainment|playful)\b/.test(text)) return "fun";
    if (/\b(admin|owner|ops|status|stats|budget)\b/.test(text)) return "admin";
    if (/\b(ai|agent|chat|llm)\b/.test(text)) return "ai";
    if (/\b(core|basic|utility|utilities)\b/.test(text)) return "core";
    return undefined;
  }

  private isCommandListQuery(text: string): boolean {
    const lower = this.localPromptize(text);
    return /(what commands|available commands|command list|list commands|help commands|show commands|feature list|features|what can you do|what can u do|what else can you do|what else u can do|what you can do|capabilities|list of commands|your commands|full command)/.test(
      lower,
    );
  }

  private commandListCompact(): string {
    return commandRegistry
      .all()
      .map((c) => `/${c.name}`)
      .join(", ");
  }

  private commandCatalogJson(): string {
    const catalog = commandRegistry.all().map((c) => ({
      name: c.name,
      slash: `/${c.name}`,
      group: c.group,
      description: c.description,
      autoExecutable: this.autoExecutableCommands.has(c.name),
      requiresArgs: COMMAND_INTENT_META[c.name].requiresArgs,
      argsHint: COMMAND_INTENT_META[c.name].argsHint,
      examples: COMMAND_INTENT_META[c.name].examples,
    }));
    return JSON.stringify(catalog, null, 2);
  }

  private isVagueMediaArgs(args: string): boolean {
    const v = args.trim().toLowerCase();
    if (!v) return true;
    if (v.length < 5) return true;
    const tokens = v.split(/\s+/).filter(Boolean);
    const generic = new Set([
      "some",
      "any",
      "cool",
      "good",
      "nice",
      "random",
      "music",
      "song",
      "video",
      "something",
      "play",
      "please",
      "i",
      "want",
      "me",
      "the",
      "a",
      "an",
    ]);
    const specificTokens = tokens.filter((t) => !generic.has(t) && t.length >= 3);
    if (specificTokens.length >= 2) return false;
    return (
      /\b(some|any|cool|good|nice|random|music|song|video|something)\b/.test(v) &&
      tokens.length <= 4
    );
  }

  private fallbackMediaQuery(command: "play" | "video"): string {
    if (command === "play") {
      const picks = [
        "chill pop hits official audio",
        "lofi chill beats official",
        "trending pop songs official audio",
      ];
      return picks[Math.floor(Math.random() * picks.length)];
    }
    const picks = [
      "best music videos official",
      "trending pop music video official",
      "chill music video official",
    ];
    return picks[Math.floor(Math.random() * picks.length)];
  }

  private async optimizeMediaQuery(
    command: "play" | "video",
    userText: string,
    currentArgs: string,
  ): Promise<string> {
    if (!this.isVagueMediaArgs(currentArgs)) return currentArgs;
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: this.promptByProvider(
            [
              "Rewrite the user's media request into one concise YouTube search query.",
              "Return plain text only (no quotes, no markdown).",
              `Target command: /${command}`,
              command === "play"
                ? "Prefer music-focused audio query terms like official audio, lyrics, chill, pop, lofi."
                : "Prefer video-focused query terms like official video, live performance, mv.",
              "Max 70 characters.",
            ],
            [
              `Rewrite to short YouTube query for /${command}.`,
              "Plain text only, <=70 chars.",
              command === "play" ? "Music-focused keywords." : "Video-focused keywords.",
            ],
          ),
        },
        { role: "user", content: userText },
      ]);
      const optimized = (message.content ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
      if (optimized.length >= 4) return optimized.slice(0, 70);
    } catch {
      // Silent fallback: local query fallback handles this path.
    }
    return this.fallbackMediaQuery(command);
  }

  private async enhanceCommandArgs(
    command: string,
    userText: string,
    args: string,
  ): Promise<string> {
    if (command === "play" || command === "video") {
      return this.optimizeMediaQuery(command, userText, args);
    }

    if (command === "vtuber") {
      const argText = args.trim();
      if (argText) return argText;
      const lower = this.localPromptize(userText);
      const namedMatch =
        /\b(gura|pekora|korone|uto|mumei|koyori|fubuki|chloe|ayame|polka|botan|amelia|okayu|watame|aloe|marine|coco|rushia)\b/.exec(
          lower,
        )?.[1] ?? null;
      const who = namedMatch ?? (/\brandom\b/.test(lower) ? "random" : "random");
      const count = /\b([1-3])\b/.exec(lower)?.[1] ?? "1";
      return `${who} ${count}`;
    }

    return args;
  }

  private async shouldClarifyMedia(
    command: "play" | "video",
    userText: string,
    args: string,
  ): Promise<boolean> {
    if (!this.isVagueMediaArgs(args)) return false;
    if (this.isLlmBudgetTight()) return true;
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: this.promptByProvider(
            [
              "Decide whether the assistant should ask a clarification question before executing media command.",
              'Return JSON only: {"ask": boolean, "reason": string}',
              `Command: /${command}`,
              "Ask=true only when query is too ambiguous and likely to produce poor results.",
              "If there is enough intent/context, ask=false.",
            ],
            [
              `Should ask clarification before /${command}?`,
              'JSON only {"ask":boolean,"reason":string}',
              "ask=true only if ambiguous.",
            ],
          ),
        },
        { role: "user", content: `userText=${userText}\nargs=${args}` },
      ]);
      const m = message.content?.match(/\{[\s\S]*\}/);
      if (!m) return false;
      const parsed = JSON.parse(m[0]) as { ask?: boolean };
      return Boolean(parsed.ask);
    } catch {
      return this.isVagueMediaArgs(args);
    }
  }

  private commandLikelyNeedsArgs(command: string): boolean {
    return COMMAND_INTENT_META[command].requiresArgs;
  }

  private commandNeverNeedsClarify(command: string): boolean {
    return COMMAND_INTENT_META[command].neverNeedsClarify;
  }

  private defaultClarifyPrompt(command: string): string {
    return COMMAND_INTENT_META[command].clarifyPrompt;
  }

  private async shouldClarifyCommand(
    command: string,
    userText: string,
    args: string,
  ): Promise<{ ask: boolean; prompt: string }> {
    if (this.commandNeverNeedsClarify(command)) {
      return { ask: false, prompt: this.defaultClarifyPrompt(command) };
    }
    if (this.isLlmBudgetTight()) {
      const ask = this.commandLikelyNeedsArgs(command) && !args.trim();
      return { ask, prompt: this.defaultClarifyPrompt(command) };
    }
    try {
      const { message } = await llm.chat([
        {
          role: "system",
          content: [
            "Decide whether to ask a follow-up question before executing a bot command.",
            'Return JSON only: {"ask": boolean, "prompt": string}',
            "ask=true when user intent is missing critical details for good execution.",
            "ask=false when execution can proceed confidently.",
            "Command catalog JSON:",
            this.commandCatalogJson(),
          ].join("\n"),
        },
        { role: "user", content: `command=${command}\nuserText=${userText}\nargs=${args}` },
      ]);
      const m = message.content?.match(/\{[\s\S]*\}/);
      if (!m) return { ask: false, prompt: this.defaultClarifyPrompt(command) };
      const parsed = JSON.parse(m[0]) as { ask?: boolean; prompt?: string };
      return {
        ask: Boolean(parsed.ask),
        prompt:
          typeof parsed.prompt === "string" && parsed.prompt.trim()
            ? parsed.prompt.trim()
            : this.defaultClarifyPrompt(command),
      };
    } catch {
      const ask = this.commandLikelyNeedsArgs(command) && !args.trim();
      return { ask, prompt: this.defaultClarifyPrompt(command) };
    }
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
            "Available commands: " + this.commandListCompact(),
            "Command catalog JSON:",
            this.commandCatalogJson(),
          ].join("\n"),
        },
        {
          role: "user",
          content: `pending_command=${pendingCommand}\npending_args=${pendingArgs}\nfollowup=${followupText}`,
        },
      ]);
      const parsed = this.parseIntentJson(message.content ?? "");
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

    const tokens = t.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length < 12) return hasLongRun;
    const freq = new Map<string, number>();
    for (const tok of tokens) freq.set(tok, (freq.get(tok) ?? 0) + 1);
    let top = 0;
    for (const n of freq.values()) top = Math.max(top, n);
    const topRatio = top / tokens.length;
    const uniqueRatio = freq.size / Math.max(tokens.length, 1);

    const nonAscii = Array.from(t).filter((ch) => ch.charCodeAt(0) > 127).length;
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
      await gram.send("I didn’t parse that cleanly 😵‍💫. Can you rephrase in one short line?");
      return;
    }
    await this.sendAi(gram, text, rawMode);
  }

  private async sendAi(gram: BaseContext, text: string, raw = false) {
    const chunks = this.splitTelegramChunks(text, 3200);
    for (const chunk of chunks) {
      if (gram.chatId) {
        const rendered = raw ? chunk : renderTelegramRichText(chunk);
        await gram.api.sendMessage({
          chat_id: gram.chatId,
          text: rendered,
          ...(raw ? {} : { parse_mode: "HTML" as const }),
        });
      } else {
        await gram.send(chunk);
      }
    }
  }

  private commandCatalogText(): string {
    const lines = commandRegistry.all().map((c) => `/${c.name} - ${c.description}`);
    return ["Available bot commands (source of truth):", ...lines].join("\n");
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
    return [...modeCapabilities, "", this.commandCatalogText()].join("\n");
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
      const expr = calcMatch[1];
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

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private hasKeywordMatch(text: string, token: string): boolean {
    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) return false;
    const escaped = this.escapeRegex(normalizedToken);
    const pattern = normalizedToken.includes(" ")
      ? new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i")
      : new RegExp(`\\b${escaped}\\b`, "i");
    return pattern.test(text);
  }

  private findKeywordCommand(text: string): string | null {
    for (const entry of COMMAND_KEYWORD_INDEX) {
      if (entry.tokens.some((token) => this.hasKeywordMatch(text, token))) {
        return entry.command;
      }
    }
    return null;
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
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const firstPersonSocialQuery =
      /^(?:can|could|may|should)\s+i\s+(?:get|have|do|give|send|use|try\s+)?(kiss|hug|pat|cuddle|slap)\b/.test(
        lower,
      ) && /\byou\b/.test(lower);
    if (firstPersonSocialQuery) return null;
    const slash = raw.match(/^\/([a-z0-9_]+)(?:\s+([\s\S]+))?$/i);
    if (slash?.[1]) {
      const name = slash[1].toLowerCase();
      if (commandRegistry.get(name))
        return { command: name, args: typeof slash[2] === "string" ? slash[2].trim() : "" };
      return null;
    }

    const direct = raw.match(/^(?:please\s+)?([a-z0-9_]+)(?:\s+([\s\S]+))?$/i);
    if (direct?.[1]) {
      const probe = direct[1].toLowerCase();
      const mapped = Object.keys(COMMAND_INTENT_META).find(
        (name) => name === probe || COMMAND_INTENT_META[name].aliases.includes(probe),
      );
      if (mapped)
        return { command: mapped, args: typeof direct[2] === "string" ? direct[2].trim() : "" };
    }

    const actionish =
      /\b(send|give|show|fetch|drop|make|want|need|do|pls|please|can you|could you)\b/.test(lower);
    const matchedKeyword = this.findKeywordCommand(lower);
    const wantsReaction =
      matchedKeyword &&
      new Set(["cat", "dog", "neko", "hug", "kiss", "pat", "cuddle", "slap", "meme", "vtuber"]).has(
        matchedKeyword,
      )
        ? matchedKeyword
        : null;
    const asksForAction =
      /\b(send|give|show|fetch|drop|want|need|do|pls|please|can you|could you)\b/.test(lower);
    if (wantsReaction && asksForAction) {
      return { command: wantsReaction, args: "" };
    }

    const playLike = raw.match(/\b(play|video)\s+(.+)/i);
    if (playLike && playLike[1] && playLike[2]) {
      return { command: playLike[1].toLowerCase(), args: playLike[2].trim() };
    }

    const hasMusicIntent =
      /\b(song|songs|music|audio|cover|acoustic|ukulele|bgm|karaoke|playlist|listen)\b/.test(
        lower,
      ) || /\bi\s+want\b/.test(lower);
    const hasVideoIntent = /\b(video|mv|clip|watch)\b/.test(lower);
    const hasVtuberName =
      /\b(gawr\s+gura|gura|pekora|korone|mumei|fubuki|ayame|marine|amelia)\b/.test(lower);
    if (hasMusicIntent && hasVtuberName) {
      return { command: "play", args: raw };
    }
    if (hasVideoIntent && hasVtuberName) {
      return { command: "video", args: raw };
    }

    if (actionish && matchedKeyword) {
      return { command: matchedKeyword, args: "" };
    }

    return null;
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
      await gram.send(t.slice(0, 60));
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

  private parseIntentJson(
    raw: string,
  ): { command: string | null; args: string; confidence: number } | null {
    const cleaned = raw.trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const data = JSON.parse(match[0]) as {
        command?: string | null;
        args?: string;
        confidence?: number;
      };
      const cmd =
        typeof data.command === "string" ? data.command.toLowerCase().replace(/^\//, "") : null;
      const args = typeof data.args === "string" ? data.args.trim() : "";
      const confidence = typeof data.confidence === "number" ? data.confidence : 0;
      return { command: cmd, args, confidence };
    } catch {
      return null;
    }
  }

  private async detectIntentWithLlm(
    text: string,
  ): Promise<{ command: string; args: string } | null> {
    const catalog = this.commandCatalogText();
    const commandList = this.commandListCompact();
    const catalogJson = this.commandCatalogJson();
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
          return this.parseIntentJson(message.content ?? "");
        }),
      );

      const valid = results.filter(
        (r): r is { command: string | null; args: string; confidence: number } => !!r,
      );
      if (!valid.length) return null;

      const votes = new Map<string, { count: number; bestConfidence: number; args: string }>();
      for (const r of valid) {
        if (!r.command) continue;
        if (!commandRegistry.get(r.command)) continue;
        const key = r.command;
        const prev = votes.get(key);
        if (!prev) {
          votes.set(key, { count: 1, bestConfidence: r.confidence, args: r.args });
        } else {
          votes.set(key, {
            count: prev.count + 1,
            bestConfidence: Math.max(prev.bestConfidence, r.confidence),
            args: r.confidence >= prev.bestConfidence ? r.args : prev.args,
          });
        }
      }

      let best: { command: string; count: number; bestConfidence: number; args: string } | null =
        null;
      for (const [command, score] of votes.entries()) {
        const candidate = { command, ...score };
        if (
          !best ||
          candidate.count > best.count ||
          (candidate.count === best.count && candidate.bestConfidence > best.bestConfidence)
        ) {
          best = candidate;
        }
      }
      if (!best) return null;
      if (best.count < 2 && best.bestConfidence < 0.8) return null;
      if (best.bestConfidence < 0.55) return null;
      return { command: best.command, args: best.args };
    } catch {
      return null;
    }
  }

  private async executeKnownCommand(
    gram: BaseContext,
    command: string,
    args: string,
  ): Promise<boolean> {
    const effectiveArgs = await this.enhanceCommandArgs(command, gram.text ?? "", args);
    const patchedText = `/${command}${effectiveArgs ? ` ${effectiveArgs}` : ""}`;
    const patchedGram = new Proxy(gram, {
      get(target, prop, receiver) {
        if (prop === "text") return patchedText;
        const value: unknown = Reflect.get(target, prop, receiver);
        return value;
      },
    });
    try {
      const userId = gram.fromId;
      const remember = () => {
        if (userId)
          this.lastAutoAction.set(userId, { command, args: effectiveArgs, ts: Date.now() });
      };
      switch (command) {
        case "play":
          await this.fun.play(patchedGram);
          remember();
          return true;
        case "video":
          await this.fun.video(patchedGram);
          remember();
          return true;
        case "hug":
          await this.fun.hug(patchedGram);
          return true;
        case "kiss":
          await this.fun.kiss(patchedGram);
          return true;
        case "pat":
          await this.fun.pat(patchedGram);
          return true;
        case "cuddle":
          await this.fun.cuddle(patchedGram);
          return true;
        case "slap":
          await this.fun.slap(patchedGram);
          return true;
        case "neko":
          await this.fun.neko(patchedGram);
          remember();
          return true;
        case "cat":
          await this.fun.cat(patchedGram);
          remember();
          return true;
        case "dog":
          await this.fun.dog(patchedGram);
          remember();
          return true;
        case "meme":
          await this.fun.meme(patchedGram);
          remember();
          return true;
        case "quote":
          await this.fun.quote(patchedGram);
          return true;
        case "fact":
          await this.fun.fact(patchedGram);
          return true;
        case "vtuber":
          await this.fun.vtuber(patchedGram);
          remember();
          return true;
        case "flip":
          await this.fun.flip(patchedGram);
          return true;
        case "roll":
          await this.fun.roll(patchedGram);
          return true;
        case "choose":
          await this.fun.choose(patchedGram);
          return true;
        case "rps":
          await this.fun.rps(patchedGram);
          return true;
        case "8ball":
          await this.fun.eightBall(patchedGram);
          return true;
        case "help":
          await this.core.help(patchedGram);
          return true;
        case "id":
          await this.core.id(patchedGram);
          return true;
        case "status":
          await this.admin.status(patchedGram);
          return true;
        case "stats":
          await this.admin.stats(patchedGram);
          return true;
        case "uptime":
          await this.core.uptime(patchedGram);
          return true;
        case "ping":
          await this.core.ping(patchedGram);
          return true;
        default:
          return false;
      }
    } finally {
      // Nothing to clean up here.
    }
  }

  private async handleAdaptiveIntent(gram: BaseContext, text: string): Promise<boolean> {
    const promptized = this.localPromptize(text);
    if (this.isCommandListQuery(promptized)) return false;
    if (!this.shouldUseHeavyIntentPlanning(promptized)) return false;
    const parsedIntent = this.parseCommandIntent(promptized);
    if (parsedIntent?.command) {
      const executed = await this.executeKnownCommand(
        gram,
        parsedIntent.command,
        parsedIntent.args,
      );
      if (executed) return true;
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
      const shouldClarify = await this.shouldClarifyMedia(mediaCommand, text, intent.args);
      if (shouldClarify) {
        const userId = gram.fromId;
        if (userId)
          this.pendingIntent.set(userId, { command: intent.command, baseArgs: intent.args });
        const prompt =
          intent.command === "play"
            ? "Got you. What music vibe do you want? (artist/genre/mood, e.g. 'lofi chill' or 'The Weeknd')"
            : "Sure. What video should I search? (artist/title/topic, e.g. 'Clairo Pretty Girl official video')";
        await gram.send(prompt);
        return true;
      }
    }

    const clarify = await this.shouldClarifyCommand(intent.command, text, intent.args);
    if (clarify.ask) {
      const userId = gram.fromId;
      if (userId)
        this.pendingIntent.set(userId, { command: intent.command, baseArgs: intent.args });
      await gram.send(clarify.prompt);
      return true;
    }

    await this.maybeSendActionPreface(gram, intent.command, text);

    if (intent.command === "help" && this.isCommandListQuery(text)) {
      await this.maybeSendCreativeCommandList(gram, text);
      return true;
    }

    const executed = await this.executeKnownCommand(gram, intent.command, intent.args);
    if (!executed && commandRegistry.get(intent.command)) {
      await gram.send(
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

  @Command("ask")
  async ask(gram: BaseContext) {
    const question = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!question) {
      await gram.send("Usage: /ask `<your question>`");
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

  @Command("chat")
  async chatMode(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.setMode(userId, "chat");
    await gram.send(
      "💬 *Chat mode active*",
      Keyboard.inline().text("🗑 Clear", "ai:clear").text("🤖 Agent", "mode:agent").build(),
    );
  }

  @Command("agent")
  async agentMode(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.setMode(userId, "agent");
    await gram.send(
      "🤖 *Agent mode active* (tools enabled)",
      Keyboard.inline().text("🗑 Clear", "ai:clear").text("💬 Chat", "mode:chat").build(),
    );
  }

  @Command("clear")
  async clear(gram: BaseContext) {
    const userId = gram.fromId;
    if (!userId) return;
    conversations.clear(userId);
    await gram.send("🗑 Cleared.");
  }

  @CallbackQuery("mode:*")
  async modeSwitch(gram: BaseContext) {
    const mode = gram.match?.[0];
    const userId = gram.fromId;
    if (!mode || !userId) return;
    await gram.answer();
    if (mode === "chat") conversations.setMode(userId, "chat");
    if (mode === "agent") conversations.setMode(userId, "agent");
    await gram.send(mode === "agent" ? "🤖 Agent mode." : "💬 Chat mode.");
  }

  @CallbackQuery("ai:*")
  async aiCallbacks(gram: BaseContext) {
    const action = gram.match?.[0];
    const userId = gram.fromId;
    if (!action || !userId) return;
    if (action === "clear") {
      conversations.clear(userId);
      await gram.answer("Cleared");
      await gram.send("🗑 Cleared.");
    }
  }

  @On("text")
  async onText(gram: BaseContext) {
    const text = gram.text;
    const userId = gram.fromId;
    if (!text || !userId) return;
    if (text.startsWith("/")) return;

    const fast = this.fastPath(gram, text);
    if (fast) {
      await gram.send(fast);
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
        const ok = await this.executeKnownCommand(
          gram,
          pendingDecision.command,
          pendingDecision.args,
        );
        if (ok) return;
      } else {
        if (!pendingDecision.args && (pending.command === "play" || pending.command === "video")) {
          await gram.send("I still need a search term (artist/title/genre) to continue.");
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
        const ran = await this.executeKnownCommand(gram, extracted.command, extracted.args);
        if (ran) return;
      }
      if (this.isActionRequest(text)) {
        const suggested =
          this.parseCommandIntent(message.content ?? "") ??
          this.parseCommandIntent(this.localPromptize(text));
        if (suggested?.command) {
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
      await gram.send(`⏳ Rate limited. Try again in ~${String(waitSec)}s.`);
      return;
    }
    console.error("[AI Error]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    await gram.send(`❌ AI error: ${truncate(msg, 200)}`);
  }
}
