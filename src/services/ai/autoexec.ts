import type { BaseContext } from "@mra1k3r0/gramora";
import { commandRegistry } from "../../commands/index.js";
import { metaForCommand } from "./intent.js";
import type { ChatMessage } from "../llm.js";

type AutoAction = { command: string; args: string; ts: number };

const REMEMBERED_AUTO_ACTIONS = new Set(["play", "video", "neko", "cat", "dog", "meme", "vtuber"]);
const EXPLICIT_MEDIA_RANDOMNESS_RE =
  /\b(random|surprise|anything|whatever|viral|trending|top|popular|hot|recommended)\b/i;

function patchedContext(gram: BaseContext, command: string, args: string): BaseContext {
  const patchedText = `/${command}${args ? ` ${args}` : ""}`;
  return new Proxy(gram, {
    get(target, prop, receiver) {
      if (prop === "text") return patchedText;
      const value: unknown = Reflect.get(target, prop, receiver);
      return value;
    },
  });
}

function isVagueMediaArgs(args: string): boolean {
  const value = args.trim().toLowerCase();
  if (!value) return true;
  if (value.length < 5) return true;
  const tokens = value.split(/\s+/).filter(Boolean);
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
  const specificTokens = tokens.filter((token) => !generic.has(token) && token.length >= 3);
  if (specificTokens.length >= 2) return false;
  return (
    /\b(some|any|cool|good|nice|random|music|song|video|something)\b/.test(value) &&
    tokens.length <= 4
  );
}

function fallbackMediaQuery(command: "play" | "video"): string {
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

export async function enhanceAutoExecArgs(params: {
  command: string;
  userText: string;
  args: string;
  llmChat: (messages: ChatMessage[]) => Promise<{ message: { content?: string | null } }>;
  promptByProvider: (full: string[], compactForGroq: string[]) => string;
  localPromptize: (text: string) => string;
}): Promise<string> {
  const { command, userText, args, llmChat, promptByProvider, localPromptize } = params;
  if (command === "play" || command === "video") {
    if (!isVagueMediaArgs(args)) return args;
    try {
      const { message } = await llmChat([
        {
          role: "system",
          content: promptByProvider(
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
      // fallback below
    }
    return fallbackMediaQuery(command);
  }

  if (command === "vtuber") {
    const argText = args.trim();
    if (argText) return argText;
    const lower = localPromptize(userText);
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

export async function shouldClarifyMediaExec(params: {
  command: "play" | "video";
  userText: string;
  args: string;
  llmBudgetTight: boolean;
  llmChat: (messages: ChatMessage[]) => Promise<{ message: { content?: string | null } }>;
  promptByProvider: (full: string[], compactForGroq: string[]) => string;
}): Promise<boolean> {
  const { command, userText, args, llmBudgetTight, llmChat, promptByProvider } = params;
  if (!isVagueMediaArgs(args)) return false;
  // Strict policy: vague media intent must clarify unless user explicitly wants random/trending picks.
  if (EXPLICIT_MEDIA_RANDOMNESS_RE.test(userText)) return false;
  if (llmBudgetTight) return true;
  try {
    const { message } = await llmChat([
      {
        role: "system",
        content: promptByProvider(
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
    const match = message.content?.match(/\{[\s\S]*\}/);
    if (!match) return true;
    const parsed = JSON.parse(match[0]) as { ask?: boolean };
    return parsed.ask !== false;
  } catch {
    return true;
  }
}

export async function shouldClarifyCommandExec(params: {
  command: string;
  userText: string;
  args: string;
  llmBudgetTight: boolean;
  catalogJson: string;
  llmChat: (messages: ChatMessage[]) => Promise<{ message: { content?: string | null } }>;
}): Promise<{ ask: boolean; prompt: string }> {
  const { command, userText, args, llmBudgetTight, catalogJson, llmChat } = params;
  const fallbackPrompt = metaForCommand(command).clarifyPrompt;
  if (metaForCommand(command).neverNeedsClarify) return { ask: false, prompt: fallbackPrompt };
  if (llmBudgetTight) {
    const ask = metaForCommand(command).requiresArgs && !args.trim();
    return { ask, prompt: fallbackPrompt };
  }
  try {
    const { message } = await llmChat([
      {
        role: "system",
        content: [
          "Decide whether to ask a follow-up question before executing a bot command.",
          'Return JSON only: {"ask": boolean, "prompt": string}',
          "ask=true when user intent is missing critical details for good execution.",
          "ask=false when execution can proceed confidently.",
          "Command catalog JSON:",
          catalogJson,
        ].join("\n"),
      },
      { role: "user", content: `command=${command}\nuserText=${userText}\nargs=${args}` },
    ]);
    const match = message.content?.match(/\{[\s\S]*\}/);
    if (!match) return { ask: false, prompt: fallbackPrompt };
    const parsed = JSON.parse(match[0]) as { ask?: boolean; prompt?: string };
    return {
      ask: Boolean(parsed.ask),
      prompt:
        typeof parsed.prompt === "string" && parsed.prompt.trim()
          ? parsed.prompt.trim()
          : fallbackPrompt,
    };
  } catch {
    const ask = metaForCommand(command).requiresArgs && !args.trim();
    return { ask, prompt: fallbackPrompt };
  }
}

export async function runAutoExec(params: {
  gram: BaseContext;
  command: string;
  args: string;
  userText: string;
  lastAutoAction: Map<number, AutoAction>;
  llmChat: (messages: ChatMessage[]) => Promise<{ message: { content?: string | null } }>;
  promptByProvider: (full: string[], compactForGroq: string[]) => string;
  localPromptize: (text: string) => string;
}): Promise<boolean> {
  const {
    gram,
    command,
    args,
    userText,
    lastAutoAction,
    llmChat,
    promptByProvider,
    localPromptize,
  } = params;
  const effectiveArgs = await enhanceAutoExecArgs({
    command,
    userText,
    args,
    llmChat,
    promptByProvider,
    localPromptize,
  });
  const executed = await commandRegistry.run(command, patchedContext(gram, command, effectiveArgs));
  const userId = gram.fromId;
  if (executed && userId && REMEMBERED_AUTO_ACTIONS.has(command)) {
    lastAutoAction.set(userId, { command, args: effectiveArgs, ts: Date.now() });
  }
  return executed;
}
