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

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

async function getJson<T>(url: string): Promise<T | null> {
  return Fetch<T>(url);
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

function isBotTarget(rawArgs: string): boolean {
  const lower = rawArgs.trim().toLowerCase();
  if (!lower) return false;
  if (BOT_TARGET_GENERIC_WORDS.has(lower)) return true;

  const aliases = getBotAliases();
  if (!aliases.size) return false;

  const tokens = lower.match(/@[a-z0-9_]+|[a-z0-9_]+/g) ?? [];
  for (const token of tokens) {
    const normalized = token.startsWith("@") ? token.slice(1) : token;
    if (aliases.has(normalized)) return true;
  }
  return false;
}

function buildCuddleCaption(gram: BaseContext, rawArgs: string): string {
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
  if (isBotTarget(targetRaw)) {
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

function buildHugCaption(gram: BaseContext, rawArgs: string): string {
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
  if (isBotTarget(targetRaw)) {
    return pick([
      "i accept one quick hug, chill 🤖🤗",
      "okay fine... one bot hug 🤗",
      "hug received. no screenshot pls 🤗",
    ]);
  }
  return pick([
    `${actor} hugs ${targetRaw} 🤗`,
    `${targetRaw} gets a hug from ${actor} 🤗`,
    `${actor} sends hug vibes to ${targetRaw} 🤗`,
  ]);
}

function buildKissCaption(gram: BaseContext, rawArgs: string): string {
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
  if (isBotTarget(targetRaw)) {
    return pick([
      "nah, keep that rizz away from me 😤",
      "bot says no kisses rn 😤",
      "too much. denied 😤",
    ]);
  }
  return pick([
    `${actor} kisses ${targetRaw} 💋`,
    `${targetRaw} gets a kiss from ${actor} 💋`,
    `${actor} sends a kiss to ${targetRaw} 💋`,
  ]);
}

function buildPatCaption(gram: BaseContext, rawArgs: string): string {
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
  if (isBotTarget(targetRaw)) {
    return pick(["okay one pat only 😤", "fine... pat accepted 😤", "bot patched with one pat 😤"]);
  }
  return pick([
    `${actor} pats ${targetRaw} ✋`,
    `${targetRaw} gets headpats from ${actor} ✋`,
    `${actor} sends comfy pats to ${targetRaw} ✋`,
  ]);
}

function buildSlapCaption(gram: BaseContext, rawArgs: string): string {
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
  if (isBotTarget(targetRaw)) {
    return pick([
      "yo chill, no slapping the bot 😤",
      "try me again and it's timeout 😤",
      "bot dodged that slap 😤",
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
  await sendNekoAction(gram, "hug", customCaption ?? buildHugCaption(gram, rawArgs));
}

export async function runKiss(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "kiss", customCaption ?? buildKissCaption(gram, rawArgs));
}

export async function runPat(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "pat", customCaption ?? buildPatCaption(gram, rawArgs));
}

export async function runCuddle(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "cuddle", customCaption ?? buildCuddleCaption(gram, rawArgs));
}

export async function runSlap(gram: BaseContext) {
  const rawArgs = getArgs(gram);
  const customCaption = parseExplicitCaptionArg(rawArgs);
  await sendNekoAction(gram, "slap", customCaption ?? buildSlapCaption(gram, rawArgs));
}
