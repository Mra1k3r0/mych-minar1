import { commandRegistry } from "../registry.js";
import type { CommandDef } from "../types.js";
import { Fetch } from "../../services/http/undici.js";
import { randomInt } from "node:crypto";
import { llm } from "../../container.js";

const VTUBER_API = "https://api-vtuber-rmagesaikidesu.vercel.app/";
const VTUBERS = [
  "gura",
  "pekora",
  "korone",
  "uto",
  "mumei",
  "koyori",
  "fubuki",
  "chloe",
  "ayame",
  "polka",
  "botan",
  "amelia",
  "okayu",
  "watame",
  "aloe",
  "marine",
  "coco",
  "rushia",
] as const;
type VtuberName = (typeof VTUBERS)[number];
type VtuberApiResponse = {
  status: "ok";
  name: string;
  url: string;
  count?: number;
  author?: string;
};

const pick = <T>(arr: readonly T[]): T => arr[randomInt(arr.length)];
type Gram = Parameters<NonNullable<CommandDef["run"]>>[0];

const parseCount = (raw?: string): { count: number; overLimit: boolean } => {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed)) return { count: 1, overLimit: false };
  return { count: Math.min(3, Math.max(1, parsed)), overLimit: parsed > 3 };
};

const isVtuberName = (value: string): value is VtuberName =>
  (VTUBERS as readonly string[]).includes(value);

async function fetchRandomVtuberImage(character: VtuberName): Promise<VtuberApiResponse> {
  const payload = await Fetch<Partial<VtuberApiResponse>>(
    `${VTUBER_API}?character=${encodeURIComponent(character)}`,
    { mode: "strict" },
  );
  if (payload.status !== "ok" || !payload.url || !payload.name) {
    throw new Error("Invalid VTuber payload");
  }
  return payload as VtuberApiResponse;
}

function getCommandArgs(gram: Gram): string {
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

function vtuberCharacterKeyboard() {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  let row: Array<{ text: string; callback_data: string }> = [];
  VTUBERS.forEach((name, idx) => {
    const icon = idx % 2 === 0 ? "🌟" : "🎀";
    row.push({ text: `${icon} ${name}`, callback_data: `vtb:${name}:1` });
    if ((idx + 1) % 3 === 0) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length) rows.push(row);
  rows.push([{ text: "🎲 Random", callback_data: "vtb:random:1" }]);
  return { inline_keyboard: rows };
}

function mentionTag(gram: Gram): string {
  const user = gram.message?.from;
  if (user?.username) return `@${user.username}`;
  return user?.first_name ?? "there";
}

function withMention(gram: Gram, text: string): string {
  return `${mentionTag(gram)} ${text}`.trim();
}

async function adaptiveCaption(gram: Gram, fallback: string): Promise<string> {
  const status = llm.rateLimitStatus();
  if (!status.canProceed || status.retryAfterMs > 0 || status.estimatedTokensAvailable < 600) {
    return fallback;
  }
  try {
    const { message } = await llm.chat(
      [
        {
          role: "system",
          content: [
            "Generate one short caption for Telegram image output.",
            "Style: lively, friendly, command-aware.",
            "Return plain text only, no markdown, no quotes.",
            "Max 55 chars.",
          ].join("\n"),
        },
        { role: "user", content: `command=vtuber\nrequest=${gram.text ?? ""}` },
      ],
      { maxTokens: 80 },
    );
    const caption = (message.content ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
    if (caption.length >= 3) return caption.slice(0, 55);
  } catch {
    // Caption fallback already exists.
  }
  return fallback;
}

async function sendVtuberBatch(gram: Gram, character: VtuberName, count: number, caption?: string) {
  const replyTo = gram.message?.message_id;
  const images = await Promise.all(
    Array.from({ length: count }, () => fetchRandomVtuberImage(character)),
  );

  if (count === 1) {
    const image = images[0];
    await gram.photo({
      photo: image.url,
      caption: caption?.trim() || `${image.name}\ncredit: ${image.author ?? "unknown"}`,
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }

  const media = images.map((image, idx) => ({
    type: "photo" as const,
    media: image.url,
    ...(idx === 0
      ? {
          caption:
            caption?.trim() ||
            `${character} x${String(count)}\ncredit: ${image.author ?? "unknown"}`,
        }
      : {}),
  }));
  await gram.sendMediaGroup({ media, ...(replyTo !== undefined ? { replyTo } : {}) });
}

async function runVtuber(gram: Gram) {
  const encoded = gram.match?.[0];
  if (encoded) {
    const [characterRaw, countRaw] = encoded.split(":");
    const parsedCount = parseCount(countRaw);
    const count = parsedCount.count;
    if (characterRaw === "random") {
      await gram.answer(`random x${String(count)}`);
      await sendVtuberBatch(gram, pick(VTUBERS), count);
      return;
    }
    if (!isVtuberName(characterRaw)) {
      await gram.answer("unknown");
      return;
    }
    await gram.answer(`${characterRaw} x${String(count)}`);
    await sendVtuberBatch(gram, characterRaw, count);
    return;
  }

  const rawArgs = getCommandArgs(gram);
  const parts = rawArgs.split(/\s+/).filter(Boolean);
  const alias = (parts[0] ?? "").toLowerCase();
  const characterArg = alias === "gawr" ? "gura" : alias;
  const countToken = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : undefined;
  const parsedCount = parseCount(countToken);
  const count = parsedCount.count;
  const remainder = parts
    .slice(countToken ? 2 : 1)
    .join(" ")
    .trim();
  const customCaption = parseCaptionArg(remainder);
  const fallbackCaption = withMention(gram, `${characterArg || "vtuber"} drop ✨`);
  const finalCaption = customCaption ?? (await adaptiveCaption(gram, fallbackCaption));

  if (parsedCount.overLimit) {
    await gram.reply(withMention(gram, "max image count is 3. Using 3."));
  }

  if (!characterArg) {
    await gram.send(
      [
        "VTuber picker",
        "Pick a character from buttons, or use command args for multiple images.",
        "",
        "Example:",
        "/vtuber gura 2",
      ].join("\n"),
      vtuberCharacterKeyboard(),
    );
    return;
  }

  if (characterArg === "random") {
    await sendVtuberBatch(gram, pick(VTUBERS), count, finalCaption);
    return;
  }

  if (!isVtuberName(characterArg)) {
    await gram.reply(
      withMention(gram, `unknown character: ${characterArg}\nAvailable: ${VTUBERS.join(", ")}`),
    );
    return;
  }

  await sendVtuberBatch(gram, characterArg, count, finalCaption);
}

export const CMD_VTUBER = commandRegistry.register({
  name: "vtuber",
  description: "Random VTuber images: /vtuber [name|random] [1-3]",
  group: "fun",
  cooldownSeconds: 4,
  run: runVtuber,
});
