import { commandRegistry } from "../../commands/index.js";
import { normalizeCommandIntentMap } from "../../data/cmd-intent.schema.js";
import { getCommandIntentData } from "../command/store.js";

// static regexes hoisted to module level to avoid redundant allocations/recompilations
const COMMAND_LIST_QUERY_RE =
  /(what commands|available commands|command list|list commands|help commands|show commands|feature list|features|what can you do|what can u do|what else can you do|what else u can do|what you can do|capabilities|list of commands|your commands|full command)/i;

const SOCIAL_QUERY_RE =
  /^(?:can|could|may|should)\s+i\s+(?:get|have|do|give|send|use|try\s+)?(kiss|hug|pat|cuddle|slap)\b/i;
const ACTION_KEYWORDS_RE =
  /\b(send|give|show|fetch|drop|make|want|need|do|pls|please|can you|could you)\b/i;
const MUSIC_INTENT_RE =
  /\b(song|songs|music|audio|cover|acoustic|ukulele|bgm|karaoke|playlist|listen)\b/i;
const WANT_INTENT_RE = /\bi\s+want\b/i;
const VIDEO_INTENT_RE = /\b(video|mv|clip|watch)\b/i;
const VTUBER_NAME_RE = /\b(gawr\s+gura|gura|pekora|korone|mumei|fubuki|ayame|marine|amelia)\b/i;
const REACTION_COMMANDS = new Set([
  "cat",
  "dog",
  "neko",
  "hug",
  "kiss",
  "pat",
  "cuddle",
  "slap",
  "meme",
  "vtuber",
]);

function buildCommandIntentMeta() {
  const raw = normalizeCommandIntentMap(getCommandIntentData());
  const out: Partial<Record<string, (typeof raw)[string]>> = {};
  for (const [name, meta] of Object.entries(raw)) {
    const fromRegistry = commandRegistry.get(name);
    out[name] = {
      group: meta.group ?? fromRegistry?.group ?? "core",
      ...meta,
    };
  }
  return Object.freeze(out);
}

const COMMAND_INTENT_META: Readonly<
  Partial<Record<string, ReturnType<typeof normalizeCommandIntentMap>[string]>>
> = buildCommandIntentMeta();

// consolidate tokens into a single merged regexp per command to reduce test() evaluations
const COMMAND_KEYWORD_INDEX = Object.freeze(
  Object.entries(COMMAND_INTENT_META)
    .map(([command, meta]) => {
      if (!meta) return null;
      const tokens = [
        ...(meta.matchCommandName ? [command] : []),
        ...meta.aliases,
        ...meta.keywords,
      ]
        .filter((t) => t.trim().length > 0)
        .sort((a, b) => b.length - a.length);

      if (tokens.length === 0) return null;

      const patterns = tokens.map((t) => {
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return t.includes(" ") ? `(?:^|\\b)${escaped}(?:\\b|$)` : `\\b${escaped}\\b`;
      });

      return {
        command,
        pattern: new RegExp(patterns.join("|"), "i"),
      };
    })
    .filter((row): row is { command: string; pattern: RegExp } => row !== null),
);

const COMMAND_ALIAS_INDEX = Object.freeze(
  Object.entries(COMMAND_INTENT_META).reduce<Record<string, string>>((acc, [command, meta]) => {
    if (!meta) return acc;
    for (const alias of meta.aliases) {
      const key = alias.trim().toLowerCase();
      if (!key) continue;
      if (acc[key] || commandRegistry.get(key)) continue;
      acc[key] = command;
    }
    return acc;
  }, {}),
);

export function getAutoExecutableCommands(): ReadonlySet<string> {
  return new Set(
    Object.entries(COMMAND_INTENT_META)
      .filter(([, meta]) => Boolean(meta?.autoExecutable))
      .map(([name]) => name),
  );
}

// o(1) alias lookup to avoid iterating intent meta on every parse
export function resolveAliasTarget(commandName: string): string | null {
  const key = commandName.trim().toLowerCase();
  if (!key || !Object.prototype.hasOwnProperty.call(COMMAND_ALIAS_INDEX, key)) return null;
  return COMMAND_ALIAS_INDEX[key];
}

export function metaForCommand(command: string) {
  const fromMeta = COMMAND_INTENT_META[command];
  if (fromMeta) return fromMeta;
  const fromRegistry = commandRegistry.get(command);
  return {
    group: fromRegistry?.group ?? "core",
    autoExecutable: false,
    requiresArgs: false,
    argsHint: "optional",
    examples: [command],
    keywords: [],
    aliases: [],
    matchCommandName: true,
    neverNeedsClarify: false,
    clarifyPrompt: `what should i use for /${command}?`,
  };
}

export function isCommandListQuery(text: string): boolean {
  return COMMAND_LIST_QUERY_RE.test(text);
}

export function findKeywordCommand(text: string): string | null {
  for (const entry of COMMAND_KEYWORD_INDEX) {
    if (entry.pattern.test(text)) return entry.command;
  }
  return null;
}

export function parseCommandIntent(text: string): { command: string; args: string } | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  // early exit for social queries to avoid heavier pattern matching
  if (SOCIAL_QUERY_RE.test(lower) && /\byou\b/i.test(lower)) return null;
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
    // use direct lookups for o(1) command/alias resolution instead of o(n) find()
    if (Object.prototype.hasOwnProperty.call(COMMAND_INTENT_META, probe)) {
      return { command: probe, args: typeof direct[2] === "string" ? direct[2].trim() : "" };
    }
    const aliasTarget = resolveAliasTarget(probe);
    if (aliasTarget) {
      return { command: aliasTarget, args: typeof direct[2] === "string" ? direct[2].trim() : "" };
    }
  }

  const actionish = ACTION_KEYWORDS_RE.test(lower);
  const matchedKeyword = findKeywordCommand(lower);

  if (matchedKeyword && REACTION_COMMANDS.has(matchedKeyword) && actionish) {
    return { command: matchedKeyword, args: "" };
  }

  const playLike = raw.match(/\b(play|video)\s+(.+)/i);
  if (playLike?.[1] && playLike[2]) {
    return { command: playLike[1].toLowerCase(), args: playLike[2].trim() };
  }

  const hasMusicIntent = MUSIC_INTENT_RE.test(lower) || WANT_INTENT_RE.test(lower);
  const hasVideoIntent = VIDEO_INTENT_RE.test(lower);
  const hasVtuberName = VTUBER_NAME_RE.test(lower);

  if (hasVtuberName) {
    if (hasMusicIntent) return { command: "play", args: raw };
    if (hasVideoIntent) return { command: "video", args: raw };
  }

  if (actionish && matchedKeyword) {
    return { command: matchedKeyword, args: "" };
  }

  return null;
}
