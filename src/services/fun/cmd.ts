import { Keyboard } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import { randomInt } from "node:crypto";
import { Fetch } from "../http/undici.js";

type UnknownRecord = Record<string, unknown>;
type RpsMove = "rock" | "paper" | "scissors";

const NEKO_API_BASE = "https://nekos.best/api/v2";
const RPS_MOVES: readonly RpsMove[] = ["rock", "paper", "scissors"] as const;
const RPS_EMOJI: Record<RpsMove, string> = {
  rock: "🪨",
  paper: "📄",
  scissors: "✂️",
};
const BOT_TARGET_GENERIC_WORDS = new Set(["you", "u", "bot"]);
const BOT_ID_FROM_TOKEN = (() => {
  const raw = process.env.TELEGRAM_BOT_TOKEN?.split(":")[0]?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
})();
let botIdentityCache: { id?: number; username?: string } | null = null;
let botIdentityPromise: Promise<{ id?: number; username?: string }> | null = null;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

async function getJson<T>(url: string): Promise<T | null> {
  return Fetch<T>(url);
}

function mediaExtFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot < 0 || dot === last.length - 1) return null;
    return last.slice(dot + 1).toLowerCase();
  } catch {
    const noQuery = url.split("?")[0] ?? url;
    const last = noQuery.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot < 0 || dot === last.length - 1) return null;
    return last.slice(dot + 1).toLowerCase();
  }
}

function isAnimatedMediaUrl(url: string): boolean {
  const ext = mediaExtFromUrl(url);
  if (!ext) return false;
  return ext === "gif" || ext === "mp4" || ext === "webm";
}

function getArgs(gram: BaseContext): string {
  return (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
}

function parseCaptionArg(rawArgs: string): string | null {
  if (!rawArgs) return null;
  const explicit = rawArgs.match(/(?:--caption|caption:|caption)\s+([\s\S]+)/i);
  if (explicit?.[1]) return explicit[1].trim().replace(/^["']|["']$/g, "");
  const says = rawArgs.match(/(?:with\s+caption|saying|that\s+says)\s+([\s\S]+)/i);
  if (says?.[1]) return says[1].trim().replace(/^["']|["']$/g, "");
  if (rawArgs.includes("|")) {
    const right = rawArgs.split("|").slice(1).join("|").trim();
    if (right) return right;
  }
  return rawArgs.trim();
}

function parseExplicitCaptionArg(rawArgs: string): string | null {
  if (!rawArgs) return null;
  const explicit = rawArgs.match(/(?:--caption|caption:|caption)\s+([\s\S]+)/i);
  if (explicit?.[1]) return explicit[1].trim().replace(/^["']|["']$/g, "");
  const says = rawArgs.match(/(?:with\s+caption|saying|that\s+says)\s+([\s\S]+)/i);
  if (says?.[1]) return says[1].trim().replace(/^["']|["']$/g, "");
  if (rawArgs.includes("|")) {
    const right = rawArgs.split("|").slice(1).join("|").trim();
    if (right) return right;
  }
  return null;
}

function mentionTag(gram: BaseContext): string {
  const user = gram.message?.from;
  if (user?.username) return `@${user.username}`;
  return user?.first_name ?? "you";
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

function getBotAliases(): Set<string> {
  const out = new Set<string>();
  const fromEnv = [
    process.env.TELEGRAM_BOT_USERNAME,
    process.env.BOT_USERNAME,
    process.env.BOT_NAME,
  ];
  for (const value of fromEnv) {
    const v = value?.trim().toLowerCase();
    if (!v) continue;
    out.add(v.startsWith("@") ? v.slice(1) : v);
  }
  return out;
}

function extractMentionTargetsFromMessage(gram: BaseContext): {
  userIds: Set<number>;
  usernames: Set<string>;
} {
  const userIds = new Set<number>();
  const usernames = new Set<string>();
  const msg = asRecord((gram as unknown as Record<string, unknown>).message);
  const entitiesValue = msg ? msg.entities : undefined;
  const entities = Array.isArray(entitiesValue) ? (entitiesValue as unknown[]) : [];
  const text = typeof gram.text === "string" ? gram.text : "";

  for (const item of entities) {
    const entity = asRecord(item);
    if (!entity) continue;
    const type = typeof entity.type === "string" ? entity.type : "";
    if (type === "text_mention") {
      const user = asRecord(entity.user);
      const id = typeof user?.id === "number" ? user.id : undefined;
      if (id !== undefined) userIds.add(id);
      continue;
    }
    if (type === "mention") {
      const offset = typeof entity.offset === "number" ? entity.offset : undefined;
      const length = typeof entity.length === "number" ? entity.length : undefined;
      if (offset === undefined || length === undefined || length <= 0) continue;
      const token = text
        .slice(offset, offset + length)
        .trim()
        .toLowerCase();
      if (token.startsWith("@")) usernames.add(token.slice(1));
    }
  }

  return { userIds, usernames };
}

async function getBotIdentity(gram: BaseContext): Promise<{ id?: number; username?: string }> {
  if (botIdentityCache) return botIdentityCache;
  if (!botIdentityPromise) {
    botIdentityPromise = (async () => {
      try {
        const me = await gram.api.getMe();
        return {
          id: typeof me.id === "number" ? me.id : BOT_ID_FROM_TOKEN,
          username: typeof me.username === "string" ? me.username.toLowerCase() : undefined,
        };
      } catch {
        return { id: BOT_ID_FROM_TOKEN, username: undefined };
      }
    })();
  }
  botIdentityCache = await botIdentityPromise;
  return botIdentityCache;
}

async function isBotTarget(gram: BaseContext, rawArgs: string): Promise<boolean> {
  const lower = rawArgs.trim().toLowerCase();
  if (!lower) return false;
  if (BOT_TARGET_GENERIC_WORDS.has(lower)) return true;

  const { userIds, usernames } = extractMentionTargetsFromMessage(gram);
  const bot = await getBotIdentity(gram);
  if (bot.id !== undefined && userIds.has(bot.id)) return true;
  if (bot.username && usernames.has(bot.username)) return true;
  if (bot.username && lower.includes(`@${bot.username}`)) return true;
  if (
    bot.id !== undefined &&
    (lower.includes(`tg://user?id=${String(bot.id)}`) ||
      new RegExp(`\\b${String(bot.id)}\\b`).test(lower))
  ) {
    return true;
  }

  const aliases = getBotAliases();
  const tokens = lower.match(/@[a-z0-9_]+|[a-z0-9_]+/g) ?? [];
  for (const token of tokens) {
    const normalized = token.startsWith("@") ? token.slice(1) : token;
    if (aliases.has(normalized)) return true;
    // Fallback: explicit @something_bot mention usually indicates bot targeting.
    if (token.startsWith("@") && normalized.endsWith("bot")) return true;
  }
  return false;
}

async function buildCuddleCaption(gram: BaseContext, rawArgs: string): Promise<string> {
  const actor = mentionTag(gram);
  const targetRaw = rawArgs.trim();
  const targetLower = targetRaw.toLowerCase();
  if (!targetRaw) {
    return pick(["cuddle mode 🫂", "soft cuddle vibes 🫂", "comfy cuddle unlocked 🫂"]);
  }
  if (targetLower === "me") {
    return pick([
      `${actor} gets a warm cuddle 🫂`,
      `sending cozy cuddles to ${actor} 🫂`,
      `${actor} is now in cuddle mode 🫂`,
    ]);
  }
  if (await isBotTarget(gram, targetRaw)) {
    return pick([
      "nah, i am not your pillow today 😤",
      "you really tried to cuddle the bot? wild 😤",
      "bot says no cuddles rn, maybe later 😤",
    ]);
  }
  return pick([
    `${actor} cuddles ${targetRaw} 🫂`,
    `${targetRaw} got summoned for cuddles by ${actor} 🫂`,
    `${actor} sends cuddle energy to ${targetRaw} 🫂`,
  ]);
}

async function buildHugCaption(gram: BaseContext, rawArgs: string): Promise<string> {
  const actor = mentionTag(gram);
  const targetRaw = rawArgs.trim();
  const targetLower = targetRaw.toLowerCase();
  if (!targetRaw) return pick(["virtual hug 🤗", "sending warm hugs 🤗", "hug energy deployed 🤗"]);
  if (targetLower === "me") {
    return pick([
      `${actor} gets a warm hug 🤗`,
      `big hug for ${actor} 🤗`,
      `${actor} receives hug buff 🤗`,
    ]);
  }
  if (await isBotTarget(gram, targetRaw)) {
    return pick([
      "w-what... a hug? i-it's not like i needed it or anything 😳🤗",
      "okay fine, one quick hug. no teasing after this 😤🤗",
      "bot.exe received hug and is pretending to be calm 😶🤗",
      "hug accepted... but act normal pls 😳",
      "hmpf. i allow this hug once 😤🤗",
    ]);
  }
  return pick([
    `${actor} hugs ${targetRaw} 🤗`,
    `${targetRaw} gets a hug from ${actor} 🤗`,
    `${actor} sends hug vibes to ${targetRaw} 🤗`,
  ]);
}

async function buildKissCaption(gram: BaseContext, rawArgs: string): Promise<string> {
  const actor = mentionTag(gram);
  const targetRaw = rawArgs.trim();
  const targetLower = targetRaw.toLowerCase();
  if (!targetRaw) return pick(["mwah 💋", "kiss vibes only 💋", "air kiss deployed 💋"]);
  if (targetLower === "me") {
    return pick([
      `${actor} gets a cheek kiss 💋`,
      `mwah for ${actor} 💋`,
      `${actor} receives rizz kiss 💋`,
    ]);
  }
  if (await isBotTarget(gram, targetRaw)) {
    return pick([
      "wha-?! d-don't just kiss me out of nowhere 😳💢",
      "absolutely not. personal space, human 😤",
      "bot says kiss request denied. try a hug maybe 😤",
      "too bold. my tsundere shield blocked it 💢",
      "i am filing this under emotional damage 😳💢",
    ]);
  }
  return pick([
    `${actor} kisses ${targetRaw} 💋`,
    `${targetRaw} gets a kiss from ${actor} 💋`,
    `${actor} sends a kiss to ${targetRaw} 💋`,
  ]);
}

async function buildPatCaption(gram: BaseContext, rawArgs: string): Promise<string> {
  const actor = mentionTag(gram);
  const targetRaw = rawArgs.trim();
  const targetLower = targetRaw.toLowerCase();
  if (!targetRaw) return pick(["headpats for everyone ✋", "pat pat ✋", "soft pat combo ✋"]);
  if (targetLower === "me") {
    return pick([
      `${actor} gets gentle headpats ✋`,
      `headpats for ${actor} ✋`,
      `${actor} received comfort pats ✋`,
    ]);
  }
  if (await isBotTarget(gram, targetRaw)) {
    return pick(["okay one pat only 😤", "fine... pat accepted 😤", "bot patched with one pat 😤"]);
  }
  return pick([
    `${actor} pats ${targetRaw} ✋`,
    `${targetRaw} gets headpats from ${actor} ✋`,
    `${actor} sends comfy pats to ${targetRaw} ✋`,
  ]);
}

async function buildSlapCaption(gram: BaseContext, rawArgs: string): Promise<string> {
  const actor = mentionTag(gram);
  const targetRaw = rawArgs.trim();
  const targetLower = targetRaw.toLowerCase();
  if (!targetRaw) return pick(["bonk time 👋", "slap deployed 👋", "instant bonk 👋"]);
  if (targetLower === "me") {
    return pick([
      `${actor} asked for self-bonk 👋`,
      `${actor} gets lightly bonked 👋`,
      `${actor} triggered slap mode 👋`,
    ]);
  }
  if (await isBotTarget(gram, targetRaw)) {
    return pick([
      "excuse me?! no slapping the bot 😤💢",
      "bot dodged it. ultra instinct activated 😤",
      "one more slap attempt and i bonk back 😤💢",
      "rude. extremely rude. i am mad now 😠",
      "slap denied. attitude penalty applied 💢",
    ]);
  }
  return pick([
    `${actor} slaps ${targetRaw} 👋`,
    `${targetRaw} got bonked by ${actor} 👋`,
    `${actor} sends a dramatic slap to ${targetRaw} 👋`,
  ]);
}

export function rpsKb() {
  return Keyboard.inline()
    .text("🪨", "rps:rock")
    .text("📄", "rps:paper")
    .text("✂️", "rps:scissors")
    .build();
}

function rpsPick(): RpsMove {
  return RPS_MOVES[randomInt(RPS_MOVES.length)];
}

export async function runRpsRound(gram: BaseContext, user: RpsMove, updateMessageId?: number) {
  const bot = rpsPick();
  const win =
    (user === "rock" && bot === "scissors") ||
    (user === "paper" && bot === "rock") ||
    (user === "scissors" && bot === "paper");
  const draw = user === bot;
  const outcome = draw ? "draw 🤝" : win ? "you win 🎉" : "you lose 💀";
  const text = [
    "🎮 rock paper scissors",
    "",
    `you: ${RPS_EMOJI[user]} ${user}`,
    `bot: ${RPS_EMOJI[bot]} ${bot}`,
    `result: ${outcome}`,
    "",
    "wanna run it back?",
  ].join("\n");

  if (updateMessageId !== undefined) {
    try {
      await gram.editText({ messageId: updateMessageId, text, replyMarkup: rpsKb() });
      return;
    } catch {
      // Fallback below handles edit failures.
    }
  }

  const callbackQuery = asRecord((gram as unknown as Record<string, unknown>).callbackQuery);
  const isCallback = Boolean(callbackQuery);
  const replyTo = isCallback ? undefined : gram.message?.message_id;
  await gram.send({ text, replyMarkup: rpsKb(), ...(replyTo !== undefined ? { replyTo } : {}) });
}

export async function runRps(gram: BaseContext) {
  const userRaw = (gram.text ?? "").split(/\s+/)[1]?.toLowerCase();
  const replyTo = gram.message?.message_id;
  if (!userRaw) {
    await gram.send({
      text: "🎮 rock paper scissors\npick your move:",
      replyMarkup: rpsKb(),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }
  if (!RPS_MOVES.includes(userRaw as RpsMove)) {
    await gram.send({
      text: "usage: /rps rock|paper|scissors",
      replyMarkup: rpsKb(),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }
  await runRpsRound(gram, userRaw as RpsMove);
}

async function sendNekoAction(gram: BaseContext, endpoint: string, fallbackCaption: string) {
  const replyTo = gram.message?.message_id;
  const data = await getJson<{
    results?: Array<{ url?: string }>;
  }>(`${NEKO_API_BASE}/${endpoint}`);
  const result = data?.results?.[0];
  if (!result?.url) {
    await gram.send({
      text: "Neko API is sleepy rn. Try again.",
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }

  if (isAnimatedMediaUrl(result.url)) {
    await gram.animation({
      animation: result.url,
      caption: fallbackCaption,
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }

  await gram.photo({
    photo: result.url,
    caption: fallbackCaption,
    ...(replyTo !== undefined ? { replyTo } : {}),
  });
}

export async function runMeme(gram: BaseContext) {
  const customCaption = parseCaptionArg(getArgs(gram));
  const data = await getJson<{ url?: string; title?: string }>("https://meme-api.com/gimme");
  if (data?.url) {
    await gram.photo({
      photo: data.url,
      caption: customCaption ?? data.title ?? "Random meme",
      ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
    });
    return;
  }
  await gram.reply("Couldn't fetch meme rn. Try again in a sec.");
}

export async function runCat(gram: BaseContext) {
  const customCaption = parseCaptionArg(getArgs(gram));
  const data = await getJson<Array<{ url?: string }>>("https://api.thecatapi.com/v1/images/search");
  const url = data?.[0]?.url;
  if (url) {
    await gram.photo({
      photo: url,
      caption: customCaption ?? "meow",
      ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
    });
    return;
  }
  await gram.reply("Cat API sleepy rn, try again.");
}

export async function runDog(gram: BaseContext) {
  const customCaption = parseCaptionArg(getArgs(gram));
  const data = await getJson<{ message?: string }>("https://dog.ceo/api/breeds/image/random");
  if (data?.message) {
    await gram.photo({
      photo: data.message,
      caption: customCaption ?? "woof",
      ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
    });
    return;
  }
  await gram.reply("Dog API lagged, run it back.");
}

export async function runNeko(gram: BaseContext) {
  const customCaption = parseCaptionArg(getArgs(gram));
  await sendNekoAction(gram, "neko", customCaption ?? "neko time");
}

export async function runHug(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "hug", customCaption ?? (await buildHugCaption(gram, rawArgs)));
}

export async function runKiss(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "kiss", customCaption ?? (await buildKissCaption(gram, rawArgs)));
}

export async function runPat(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "pat", customCaption ?? (await buildPatCaption(gram, rawArgs)));
}

export async function runCuddle(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "cuddle", customCaption ?? (await buildCuddleCaption(gram, rawArgs)));
}

export async function runSlap(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "slap", customCaption ?? (await buildSlapCaption(gram, rawArgs)));
}
