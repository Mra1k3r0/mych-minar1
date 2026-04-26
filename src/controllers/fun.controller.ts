import { Controller, Command, CallbackQuery, Keyboard } from "@mra1k3r0/gramora";
import type { BaseContext } from "@mra1k3r0/gramora";
import type { InputMediaPhoto } from "@mra1k3r0/gramora";
import { Innertube } from "youtubei.js";
import { fetch as undiciFetch } from "undici";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { llm } from "../container.js";

const FALLBACK_QUOTES = [
  "Small steps daily > random big bursts.",
  "Discipline is just self-respect in action.",
  "Make it work, then make it clean.",
  "Done is better than perfect.",
  "Consistency builds unfair advantage.",
];

const FALLBACK_FACTS = [
  "Octopuses have three hearts.",
  "Bananas are berries, but strawberries are not.",
  "Sharks existed before trees.",
  "Honey never really spoils.",
  "A day on Venus is longer than a year on Venus.",
];

const FALLBACK_COLORS = [
  { hex: "FF6B6B", name: "Coral Burst" },
  { hex: "4ECDC4", name: "Mint Wave" },
  { hex: "556270", name: "Slate Breeze" },
  { hex: "C7F464", name: "Lime Glow" },
  { hex: "C44D58", name: "Crimson Pop" },
];

const NEKO_API_BASE = "https://nekos.best/api/v2";

const EIGHT_BALL = [
  "Yes.",
  "No.",
  "Big yes.",
  "Probably.",
  "Not now.",
  "Ask again later.",
  "Low-key yes.",
  "Absolutely not.",
  "Vibes say yes.",
  "Outcome uncertain.",
];

const VTUBER_API = "http://api-vtuber-rmagesaikidesu.vercel.app/";
const MEDIA_MAX_SECONDS = 3600;
const MEDIA_QUERY_BLOCKLIST = [
  "hentai",
  "porn",
  "nsfw",
  "gore",
  "sex",
  "xxx",
  "rule34",
  "nude",
] as const;
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

type PopcatRandomColor = {
  hex?: string;
  name?: string;
  image?: string;
};

const pick = <T>(arr: readonly T[]): T => arr[randomInt(arr.length)];
let ytClientPromise: Promise<Innertube> | null = null;
let ytEvaluatorPatched = false;
type YtDownloadOptions = NonNullable<Parameters<Innertube["download"]>[1]>;
type WebReadableLike = Parameters<typeof Readable.fromWeb>[0];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) return null;
  return value as UnknownRecord;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getTitleText(item: unknown): string | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const title = rec.title;
  if (typeof title === "string") return title;
  const titleRec = asRecord(title);
  if (!titleRec) return undefined;
  const fromText = getString(titleRec.text);
  if (fromText) return fromText;
  return undefined;
}

function getVideoId(item: unknown): string | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  return getString(rec.id) ?? getString(rec.video_id);
}

function buildShortAudioName(title: string | undefined, fallbackId: string): string {
  const source = (title ?? fallbackId).trim();
  const cleaned = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const base = cleaned || fallbackId;
  const rand = randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base}_${rand}.m4a`;
}

function ytLog(scope: string, message: string, data?: unknown) {
  if (data !== undefined) {
    console.debug(`[YTDL][${scope}] ${message}`, data);
    return;
  }
  console.debug(`[YTDL][${scope}] ${message}`);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isYoutubeLoginRequiredError(err: unknown): boolean {
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes("login required") ||
    msg.includes("sign in") ||
    msg.includes("age-restricted") ||
    msg.includes("confirm your age")
  );
}

function isCookieConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_COOKIE?.trim());
}

function buildMediaFailureMessage(mode: "audio" | "video", err: unknown): string {
  const mediaWord = mode === "audio" ? "audio-only m4a" : "video";
  if (isYoutubeLoginRequiredError(err)) {
    const cookieHint = isCookieConfigured()
      ? "Your current YouTube cookie likely expired/invalid."
      : "No YouTube cookie is configured.";
    return [
      `This result needs YouTube login, so I couldn't fetch the ${mediaWord}.`,
      cookieHint,
      "Refresh YOUTUBE_COOKIE (and YOUTUBE_VISITOR_DATA) in .env, then restart the bot.",
      "Tip: try another song/video query if this one is restricted.",
    ].join("\n");
  }
  return mode === "audio"
    ? "Couldn't fetch audio-only m4a from top results. Try a more specific song title (artist + title)."
    : "Couldn't fetch video stream. Try a direct YouTube link or a different result.";
}

async function ensureYtEvaluatorPatched() {
  if (ytEvaluatorPatched) return;
  try {
    const internalUtilsPath = path.join(
      process.cwd(),
      "node_modules",
      "youtubei.js",
      "dist",
      "src",
      "utils",
      "Utils.js",
    );
    const utilsModUnknown: unknown = await import(pathToFileURL(internalUtilsPath).href);
    const utilsMod = asRecord(utilsModUnknown);
    const platform = asRecord(utilsMod?.Platform);
    if (!platform) return;
    const shim = asRecord(platform.shim);
    const load = platform.load;
    if (!shim || typeof load !== "function") return;

    (
      load as (
        input: {
          eval: (data: { output?: string }, env?: Record<string, unknown>) => Promise<unknown>;
        } & UnknownRecord,
      ) => void
    )({
      ...shim,
      eval: (data: { output?: string }, env?: Record<string, unknown>) => {
        // Tiny shim so youtubei.js can execute player scripts safely in vm.
        const source = data.output ?? "";
        const context = vm.createContext({ ...(env ?? {}) });
        const script = new vm.Script(source);
        return Promise.resolve(script.runInContext(context));
      },
    });
    ytEvaluatorPatched = true;
    ytLog("init", "custom evaluator patched");
  } catch (err) {
    ytLog("init", "failed to patch evaluator", err instanceof Error ? err.message : String(err));
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await undiciFetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getYtClient(): Promise<Innertube> {
  if (!ytClientPromise) {
    await ensureYtEvaluatorPatched();
    const cookie = process.env.YOUTUBE_COOKIE?.trim();
    const visitorData = process.env.YOUTUBE_VISITOR_DATA?.trim();
    if (cookie) {
      ytLog("init", "youtube cookie mode enabled");
    }
    ytClientPromise = Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
      ...(cookie ? { cookie } : {}),
      ...(visitorData ? { visitor_data: visitorData } : {}),
    });
  }
  return ytClientPromise;
}

function extractVideoId(input: string): string | null {
  const value = input.trim();
  const patterns = [
    /(?:v=|\/watch\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = value.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function resolveYouTubeVideo(
  queryOrUrl: string,
): Promise<{ id: string; title?: string } | null> {
  const directId = extractVideoId(queryOrUrl);
  if (directId) return { id: directId };

  const yt = await getYtClient();
  const searchUnknown: unknown = await yt.search(queryOrUrl);
  const search = asRecord(searchUnknown);
  const pools = [
    ...getArray(search?.videos),
    ...getArray(search?.results),
    ...getArray(search?.items),
  ];
  const first =
    pools.find((r) => {
      const rec = asRecord(r);
      const type = getString(rec?.type);
      return type === "Video" || type === "video";
    }) ??
    pools.find((r) => Boolean(getVideoId(r))) ??
    null;
  const id = getVideoId(first);
  if (!id) return null;
  const title = getTitleText(first);
  ytLog("search", "resolved video", { id, title });
  return { id, title };
}

async function resolveYouTubeTrack(
  queryOrUrl: string,
): Promise<{ id: string; title?: string } | null> {
  const directId = extractVideoId(queryOrUrl);
  if (directId) return { id: directId };

  try {
    const yt = await getYtClient();
    const musicSearchUnknown: unknown = await yt.music.search(queryOrUrl, { type: "song" });
    const musicSearch = asRecord(musicSearchUnknown);
    const candidates = [
      ...getArray(musicSearch?.contents),
      ...getArray(musicSearch?.results),
      ...getArray(musicSearch?.items),
      ...getArray(musicSearch?.songs),
    ];
    const first = candidates.find((r) => Boolean(getVideoId(r))) ?? null;
    const id = getVideoId(first);
    if (!id) return null;
    const title = getTitleText(first);
    ytLog("music-search", "resolved track", { id, title });
    return { id, title };
  } catch (err) {
    ytLog(
      "music-search",
      "failed, fallback to regular search",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function getDurationSeconds(item: unknown): number | null {
  const rec = asRecord(item);
  const durationRec = asRecord(rec?.duration);
  const direct =
    durationRec?.seconds ??
    rec?.length_seconds ??
    rec?.lengthSeconds ??
    rec?.duration_seconds ??
    null;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const parsed = Number.parseInt(direct, 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const textCandidate =
    getString(durationRec?.text) ??
    getString(asRecord(rec?.length)?.text) ??
    getString(rec?.lengthText) ??
    "";
  if (typeof textCandidate !== "string" || !textCandidate.includes(":")) return null;
  const parts = textCandidate
    .split(":")
    .map((p: string) => Number.parseInt(p.trim(), 10))
    .filter((n: number) => Number.isFinite(n));
  if (!parts.length) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function isLikelyShort(item: unknown): boolean {
  const rec = asRecord(item);
  if (rec?.is_short === true || rec?.isShort === true) return true;
  if ((getString(rec?.url) ?? "").includes("/shorts/")) return true;
  const sec = getDurationSeconds(item);
  return sec !== null && sec > 0 && sec < 60;
}

function hasBlockedMediaWord(query: string): string | null {
  const lower = query.toLowerCase();
  for (const w of MEDIA_QUERY_BLOCKLIST) {
    if (lower.includes(w)) return w;
  }
  return null;
}

function requestsVeryLongMedia(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    /\b([1-9]\d?)\s*(h|hr|hrs|hour|hours)\b/.test(lower) ||
    /\b(\d{2,})\s*(m|min|mins|minute|minutes)\b/.test(lower)
  );
}

async function getVideoDurationSeconds(videoId: string): Promise<number | null> {
  try {
    const yt = await getYtClient();
    const infoUnknown: unknown = await yt.getInfo(videoId);
    const info = asRecord(infoUnknown);
    const raw = asRecord(info?.basic_info)?.duration;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveYouTubeAudioCandidates(
  queryOrUrl: string,
  limit = 5,
): Promise<Array<{ id: string; title?: string }>> {
  const directId = extractVideoId(queryOrUrl);
  if (directId) return [{ id: directId }];

  const out: Array<{ id: string; title?: string }> = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined, title: unknown) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: typeof title === "string" ? title : undefined });
  };

  const music = await resolveYouTubeTrack(queryOrUrl);
  if (music) push(music.id, music.title);

  try {
    const yt = await getYtClient();
    const searchUnknown: unknown = await yt.search(queryOrUrl);
    const search = asRecord(searchUnknown);
    const pools = [
      ...getArray(search?.videos),
      ...getArray(search?.results),
      ...getArray(search?.items),
    ];
    const videos = pools.filter((r) => {
      const rec = asRecord(r);
      const type = (getString(rec?.type) ?? "").toLowerCase();
      return type === "video" || !rec?.type;
    });
    const nonShorts = videos.filter((r) => !isLikelyShort(r));
    const ranked = nonShorts.length ? nonShorts : videos;
    for (const item of ranked.slice(0, 12)) {
      push(getVideoId(item), getTitleText(item));
      if (out.length >= limit) break;
    }
  } catch (err) {
    ytLog(
      "search",
      "audio candidates search failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  return out.slice(0, limit);
}

async function clearProgressMessage(gram: BaseContext, messageId?: number) {
  if (!messageId) return;
  try {
    await gram.deleteMessage(messageId);
  } catch {
    try {
      await gram.editText({ messageId, text: "Done." });
    } catch {
      // If cleanup flakes, no stress — user already got the result.
    }
  }
}

async function failProgressMessage(
  gram: BaseContext,
  messageId: number | undefined,
  text: string,
  replyTo?: number,
) {
  if (!messageId) {
    await gram.send({ text, ...(replyTo !== undefined ? { replyTo } : {}) });
    return;
  }
  try {
    await gram.editText({ messageId, text });
  } catch {
    // Progress message edits are optional UX sugar.
  }
}

function isTimeoutLike(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("timeout") || msg.includes("aborted");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadYouTubeToTemp(
  videoId: string,
  mode: "audio" | "video",
): Promise<{ filePath: string; title?: string; sourceUrl: string }> {
  const yt = await getYtClient();
  const infoUnknown: unknown = await yt.getInfo(videoId);
  const title = getString(asRecord(asRecord(infoUnknown)?.basic_info)?.title);
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const ext = mode === "audio" ? "m4a" : "mp4";
  const filePath =
    mode === "audio"
      ? path.join(tmpdir(), buildShortAudioName(title, videoId))
      : path.join(tmpdir(), `minar1_${videoId}_${randomUUID()}.${ext}`);

  const strategies: YtDownloadOptions[] =
    mode === "audio"
      ? [
          { type: "audio", quality: "best", format: "m4a", codec: "mp4a" },
          { type: "audio", quality: "best", format: "mp4" },
          { type: "audio", quality: "best", format: "any" },
        ]
      : [
          { type: "video+audio", quality: "360p", format: "mp4" },
          { type: "video+audio", quality: "best", format: "mp4" },
          { type: "video+audio", quality: "best", format: "any" },
        ];

  let lastError: unknown = null;
  const clients: Array<"IOS" | "ANDROID" | "TV" | undefined> =
    mode === "audio" ? [undefined, "IOS", "ANDROID", "TV"] : [undefined, "TV", "IOS", "ANDROID"];
  for (const strategy of strategies) {
    for (const client of clients) {
      const attempt = client ? { ...strategy, client } : strategy;
      try {
        ytLog("download", "trying strategy", attempt);
        const webStream = await yt.download(videoId, attempt);
        const nodeStream = Readable.fromWeb(webStream as WebReadableLike);
        await pipeline(nodeStream, createWriteStream(filePath));
        ytLog("download", "strategy success", attempt);
        return { filePath, title, sourceUrl };
      } catch (err) {
        lastError = err;
        ytLog("download", "strategy failed", {
          strategy: attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await unlink(filePath);
        } catch {
          // Temp cleanup fail is non-fatal; OS sweep can handle leftovers.
        }
      }
    }
  }

  ytLog("download", "all strategies failed", {
    videoId,
    mode,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error(`youtube download failed: ${errorText(lastError)}`);
}

async function downloadYouTubeAsStream(
  videoId: string,
  mode: "audio" | "video",
): Promise<{
  stream: NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  title?: string;
  sourceUrl: string;
}> {
  const yt = await getYtClient();
  const infoUnknown: unknown = await yt.getInfo(videoId);
  const title = getString(asRecord(asRecord(infoUnknown)?.basic_info)?.title);
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const strategies: Array<{ options: YtDownloadOptions; ext: string; mimeType: string }> =
    mode === "audio"
      ? [
          {
            options: { type: "audio", quality: "best", format: "m4a", codec: "mp4a" },
            ext: "m4a",
            mimeType: "audio/mp4",
          },
          {
            options: { type: "audio", quality: "best", format: "mp4" },
            ext: "m4a",
            mimeType: "audio/mp4",
          },
          {
            options: { type: "audio", quality: "best", format: "any" },
            ext: "m4a",
            mimeType: "audio/mp4",
          },
        ]
      : [
          {
            options: { type: "video+audio", quality: "360p", format: "mp4" },
            ext: "mp4",
            mimeType: "video/mp4",
          },
          {
            options: { type: "video+audio", quality: "best", format: "mp4" },
            ext: "mp4",
            mimeType: "video/mp4",
          },
          {
            options: { type: "video+audio", quality: "best", format: "any" },
            ext: "mp4",
            mimeType: "video/mp4",
          },
        ];

  let lastError: unknown = null;
  const clients: Array<"IOS" | "ANDROID" | "TV" | undefined> =
    mode === "audio" ? [undefined, "IOS", "ANDROID", "TV"] : [undefined, "TV", "IOS", "ANDROID"];
  for (const strategy of strategies) {
    for (const client of clients) {
      const attempt = client ? { ...strategy.options, client } : strategy.options;
      try {
        ytLog("stream", "trying strategy", {
          ...attempt,
          ext: strategy.ext,
          mimeType: strategy.mimeType,
        });
        const webStream = await yt.download(videoId, attempt);
        const nodeStream = Readable.fromWeb(webStream as WebReadableLike);
        ytLog("stream", "strategy success", attempt);
        return {
          stream: nodeStream,
          filename:
            mode === "audio"
              ? buildShortAudioName(title, videoId)
              : `minar1_${videoId}.${strategy.ext}`,
          mimeType: strategy.mimeType,
          title,
          sourceUrl,
        };
      } catch (err) {
        lastError = err;
        ytLog("stream", "strategy failed", {
          strategy: attempt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  ytLog("stream", "all strategies failed", {
    videoId,
    mode,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error(`youtube stream failed: ${errorText(lastError)}`);
}

const parseCount = (raw?: string): { count: number; overLimit: boolean } => {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed)) return { count: 1, overLimit: false };
  return {
    count: Math.min(3, Math.max(1, parsed)),
    overLimit: parsed > 3,
  };
};

const isVtuberName = (value: string): value is VtuberName =>
  (VTUBERS as readonly string[]).includes(value);

async function fetchRandomVtuberImage(character: VtuberName): Promise<VtuberApiResponse> {
  const response = await undiciFetch(`${VTUBER_API}?character=${encodeURIComponent(character)}`);
  if (!response.ok) throw new Error(`VTuber API HTTP ${String(response.status)}`);
  const payload = (await response.json()) as Partial<VtuberApiResponse>;
  if (payload.status !== "ok" || !payload.url || !payload.name) {
    throw new Error("Invalid VTuber payload");
  }
  return payload as VtuberApiResponse;
}

async function sendNekoAction(
  gram: BaseContext,
  endpoint: string,
  fallbackCaption: string,
  replyTo?: number,
) {
  const data = await getJson<{
    results?: Array<{ url?: string; anime_name?: string; artist_name?: string }>;
  }>(`${NEKO_API_BASE}/${endpoint}`);
  const result = data?.results?.[0];
  if (!result?.url) {
    await gram.send({
      text: "Neko API is sleepy rn. Try again.",
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    return;
  }

  const captionParts = [fallbackCaption];
  if (result.anime_name) captionParts.push(`anime: ${result.anime_name}`);
  if (result.artist_name) captionParts.push(`artist: ${result.artist_name}`);

  await gram.photo({
    photo: result.url,
    caption: captionParts.join("\n"),
    ...(replyTo !== undefined ? { replyTo } : {}),
  });
}

function getCommandArgs(gram: BaseContext): string {
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
  const kb = Keyboard.inline();
  VTUBERS.forEach((name, idx) => {
    const icon = idx % 2 === 0 ? "🌟" : "🎀";
    kb.text(`${icon} ${name}`, `vtb:${name}:1`);
    if ((idx + 1) % 3 === 0) kb.row();
  });
  kb.row().text("🎲 Random", "vtb:random:1");
  return kb.build();
}

function rpsKeyboard() {
  return Keyboard.inline()
    .text("🪨", "rps:rock")
    .text("📄", "rps:paper")
    .text("✂️", "rps:scissors")
    .build();
}

@Controller()
export class FunController {
  private static readonly RPS_MOVES = ["rock", "paper", "scissors"] as const;

  private static readonly RPS_EMOJI: Record<(typeof FunController.RPS_MOVES)[number], string> = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️",
  };

  private mentionTag(gram: BaseContext): string {
    const user = gram.message?.from;
    if (user?.username) return `@${user.username}`;
    return user?.first_name ?? "there";
  }

  private withMention(gram: BaseContext, text: string): string {
    return `${this.mentionTag(gram)} ${text}`.trim();
  }

  private async resolveRpsRound(
    gram: BaseContext,
    user: (typeof FunController.RPS_MOVES)[number],
    updateMessageId?: number,
  ) {
    const bot = pick(FunController.RPS_MOVES);
    const win =
      (user === "rock" && bot === "scissors") ||
      (user === "paper" && bot === "rock") ||
      (user === "scissors" && bot === "paper");
    const draw = user === bot;

    const outcome = draw ? "draw 🤝" : win ? "you win 🎉" : "you lose 💀";
    const text = [
      "🎮 rock paper scissors",
      "",
      `you: ${FunController.RPS_EMOJI[user]} ${user}`,
      `bot: ${FunController.RPS_EMOJI[bot]} ${bot}`,
      `result: ${outcome}`,
      "",
      "wanna run it back?",
    ].join("\n");

    if (updateMessageId !== undefined) {
      try {
        await gram.editText({ messageId: updateMessageId, text, replyMarkup: rpsKeyboard() });
        return;
      } catch {
        // If edit fails, fallback to a fresh message.
      }
    }

    const callbackQuery = asRecord((gram as unknown as Record<string, unknown>).callbackQuery);
    const callbackMessage = asRecord(callbackQuery?.message);
    const callbackReplyTo = getNumber(asRecord(callbackMessage?.reply_to_message)?.message_id);
    const replyTo = callbackReplyTo ?? gram.message?.message_id;
    await gram.send({
      text,
      replyMarkup: rpsKeyboard(),
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
  }

  private async adaptiveCaption(
    gram: BaseContext,
    command:
      | "meme"
      | "cat"
      | "dog"
      | "neko"
      | "hug"
      | "kiss"
      | "pat"
      | "cuddle"
      | "slap"
      | "vtuber",
    fallback: string,
  ): Promise<string> {
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
          { role: "user", content: `command=${command}\nrequest=${gram.text ?? ""}` },
        ],
        { maxTokens: 80 },
      );
      const caption = (message.content ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
      if (caption.length >= 3) return caption.slice(0, 55);
    } catch {
      // Caption fallback already exists, so we chill here.
    }
    return fallback;
  }

  private async sendVtuberBatch(
    gram: BaseContext,
    character: VtuberName,
    count: number,
    caption?: string,
  ) {
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

    const media: InputMediaPhoto[] = images.map((image, idx) => ({
      type: "photo",
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

  @Command("quote")
  async quote(gram: BaseContext) {
    const data = await getJson<Array<{ q?: string; a?: string }>>(
      "https://zenquotes.io/api/quotes/random?",
    );
    const quote = data?.[0];
    if (quote?.q) {
      await gram.reply(`"${quote.q}"\n— ${quote.a ?? "Unknown"}`);
      return;
    }
    await gram.reply(`"${pick(FALLBACK_QUOTES)}"\n— Unknown`);
  }

  @Command("fact")
  async fact(gram: BaseContext) {
    const data = await getJson<{ text?: string }>(
      "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en",
    );
    if (data?.text) {
      await gram.reply(data.text);
      return;
    }
    await gram.reply(pick(FALLBACK_FACTS));
  }

  @Command("randomcolor")
  async randomColor(gram: BaseContext) {
    const replyTo = gram.message?.message_id;
    const data = await getJson<PopcatRandomColor>("https://api.popcat.xyz/randomcolor");
    const hex = (data?.hex ?? "").trim().replace(/^#/, "").toUpperCase();
    const name = (data?.name ?? "").trim();
    const image = (data?.image ?? "").trim();

    if (hex && name && image) {
      await gram.photo({
        photo: image,
        caption: `${name}\n#${hex}`,
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }

    const fallback = pick(FALLBACK_COLORS);
    await gram.send({
      text: `${fallback.name}\n#${fallback.hex}`,
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
  }

  @Command("meme")
  async meme(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const data = await getJson<{ url?: string; title?: string }>("https://meme-api.com/gimme");
    if (data?.url) {
      const caption = customCaption ?? data.title ?? "Random meme";
      await gram.photo({
        photo: data.url,
        caption,
        ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
      });
      return;
    }
    await gram.reply(this.withMention(gram, "Couldn't fetch meme rn. Try again in a sec."));
  }

  @Command("cat")
  async cat(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const data = await getJson<Array<{ url?: string }>>(
      "https://api.thecatapi.com/v1/images/search",
    );
    const url = data?.[0]?.url;
    if (url) {
      const fallback = this.withMention(gram, "meow 🐱");
      const caption = customCaption ?? (await this.adaptiveCaption(gram, "cat", fallback));
      await gram.photo({
        photo: url,
        caption,
        ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
      });
      return;
    }
    await gram.reply(this.withMention(gram, "Cat API sleepy rn, try again."));
  }

  @Command("dog")
  async dog(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const data = await getJson<{ message?: string }>("https://dog.ceo/api/breeds/image/random");
    if (data?.message) {
      const fallback = this.withMention(gram, "woof 🐶");
      const caption = customCaption ?? (await this.adaptiveCaption(gram, "dog", fallback));
      await gram.photo({
        photo: data.message,
        caption,
        ...(gram.message?.message_id !== undefined ? { replyTo: gram.message.message_id } : {}),
      });
      return;
    }
    await gram.reply(this.withMention(gram, "Dog API lagged, run it back."));
  }

  @Command("neko")
  async neko(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "neko time 🐾");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "neko", fallback));
    await sendNekoAction(gram, "neko", caption, gram.message?.message_id);
  }

  @Command("hug")
  async hug(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "virtual hug 🤗");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "hug", fallback));
    await sendNekoAction(gram, "hug", caption, gram.message?.message_id);
  }

  @Command("kiss")
  async kiss(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "mwah 💋");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "kiss", fallback));
    await sendNekoAction(gram, "kiss", caption, gram.message?.message_id);
  }

  @Command("pat")
  async pat(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "headpats deployed ✋");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "pat", fallback));
    await sendNekoAction(gram, "pat", caption, gram.message?.message_id);
  }

  @Command("cuddle")
  async cuddle(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "cozy cuddle mode 🫶");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "cuddle", fallback));
    await sendNekoAction(gram, "cuddle", caption, gram.message?.message_id);
  }

  @Command("slap")
  async slap(gram: BaseContext) {
    const customCaption = parseCaptionArg(getCommandArgs(gram));
    const fallback = this.withMention(gram, "bonk/slap energy 👋");
    const caption = customCaption ?? (await this.adaptiveCaption(gram, "slap", fallback));
    await sendNekoAction(gram, "slap", caption, gram.message?.message_id);
  }

  @Command("play")
  async play(gram: BaseContext) {
    const query = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    const replyTo = gram.message?.message_id;
    if (!query) {
      await gram.send({
        text: "Usage: /play <youtube url or search query>",
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }

    const blocked = hasBlockedMediaWord(query);
    if (blocked) {
      await gram.send({
        text: `That request includes blocked term "${blocked}". Keep it safe/sfw.`,
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }
    if (requestsVeryLongMedia(query)) {
      await gram.send({
        text: "I can only handle media up to 1 hour. Try a shorter song/video.",
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }

    const resolving = await gram.send({
      text: "Resolving audio...",
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const resolvingId = getNumber(asRecord(resolving)?.message_id);
    const candidates = await resolveYouTubeAudioCandidates(query, 5);
    if (!candidates.length) {
      await failProgressMessage(gram, resolvingId, "No result found.", replyTo);
      return;
    }

    let lastMediaError: unknown = null;
    for (const resolved of candidates) {
      ytLog("play", "trying candidate", resolved);
      const durationSec = await getVideoDurationSeconds(resolved.id);
      if (durationSec !== null && durationSec > MEDIA_MAX_SECONDS) {
        ytLog("play", "skip over-1h candidate", { id: resolved.id, durationSec });
        continue;
      }
      try {
        const streamMedia = await downloadYouTubeAsStream(resolved.id, "audio");
        await gram.audio({
          audio: {
            stream: streamMedia.stream,
            filename: streamMedia.filename,
            mimeType: streamMedia.mimeType,
          },
          caption: streamMedia.title ? `play: ${streamMedia.title}` : "play",
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        await clearProgressMessage(gram, resolvingId);
        return;
      } catch (err) {
        ytLog(
          "play",
          "stream upload failed, fallback to temp file",
          err instanceof Error ? err.message : String(err),
        );
      }

      let media: { filePath: string; title?: string; sourceUrl: string };
      try {
        media = await downloadYouTubeToTemp(resolved.id, "audio");
      } catch (err) {
        lastMediaError = err;
        ytLog("play", "temp download failed, trying next candidate", errorText(err));
        continue;
      }

      try {
        try {
          await gram.audio({
            audio: { path: media.filePath },
            caption: media.title ? `play: ${media.title}` : "play",
            ...(replyTo !== undefined ? { replyTo } : {}),
          });
          await clearProgressMessage(gram, resolvingId);
          return;
        } catch (err) {
          lastMediaError = err;
          const reason = err instanceof Error ? err.message : String(err);
          ytLog("play", "temp upload failed", reason);
          if (isTimeoutLike(err)) {
            ytLog("play", "retrying same temp upload after timeout", { videoId: resolved.id });
            await sleep(1200);
            try {
              await gram.audio({
                audio: { path: media.filePath },
                caption: media.title ? `play: ${media.title}` : "play",
                ...(replyTo !== undefined ? { replyTo } : {}),
              });
              await clearProgressMessage(gram, resolvingId);
              return;
            } catch (retryErr) {
              lastMediaError = retryErr;
              ytLog(
                "play",
                "same temp upload retry failed, trying next candidate",
                retryErr instanceof Error ? retryErr.message : String(retryErr),
              );
            }
          }
        }
      } finally {
        try {
          await unlink(media.filePath);
        } catch {
          // Temp cleanup fail is non-fatal; OS sweep can handle leftovers.
        }
      }
    }

    await failProgressMessage(
      gram,
      resolvingId,
      buildMediaFailureMessage("audio", lastMediaError),
      replyTo,
    );
  }

  @Command("video")
  async video(gram: BaseContext) {
    const query = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    const replyTo = gram.message?.message_id;
    if (!query) {
      await gram.send({
        text: "Usage: /video <youtube url or search query>",
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }

    const blocked = hasBlockedMediaWord(query);
    if (blocked) {
      await gram.send({
        text: `That request includes blocked term "${blocked}". Keep it safe/sfw.`,
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }
    if (requestsVeryLongMedia(query)) {
      await gram.send({
        text: "I can only handle media up to 1 hour. Try a shorter video.",
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }

    const resolving = await gram.send({
      text: "Resolving video...",
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    const resolvingId = getNumber(asRecord(resolving)?.message_id);
    const resolved = await resolveYouTubeVideo(query);
    if (!resolved) {
      await failProgressMessage(gram, resolvingId, "No result found.", replyTo);
      return;
    }
    const durationSec = await getVideoDurationSeconds(resolved.id);
    if (durationSec !== null && durationSec > MEDIA_MAX_SECONDS) {
      await failProgressMessage(
        gram,
        resolvingId,
        "That video is longer than 1 hour. Please send a shorter one.",
        replyTo,
      );
      return;
    }

    try {
      const streamMedia = await downloadYouTubeAsStream(resolved.id, "video");
      await gram.video({
        video: {
          stream: streamMedia.stream,
          filename: streamMedia.filename,
          mimeType: streamMedia.mimeType,
        },
        caption: streamMedia.title ? `video: ${streamMedia.title}` : "video",
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      await clearProgressMessage(gram, resolvingId);
      return;
    } catch (err) {
      ytLog(
        "video",
        "stream upload failed, fallback to temp file",
        err instanceof Error ? err.message : String(err),
      );
    }

    let media: { filePath: string; title?: string; sourceUrl: string };
    try {
      media = await downloadYouTubeToTemp(resolved.id, "video");
    } catch (err) {
      ytLog("video", "temp download failed", errorText(err));
      await failProgressMessage(
        gram,
        resolvingId,
        `${buildMediaFailureMessage("video", err)}\nDirect link:\nhttps://www.youtube.com/watch?v=${resolved.id}`,
        replyTo,
      );
      return;
    }

    try {
      try {
        await gram.video({
          video: { path: media.filePath },
          caption: media.title ? `video: ${media.title}` : "video",
          ...(replyTo !== undefined ? { replyTo } : {}),
        });
        await clearProgressMessage(gram, resolvingId);
      } catch (err) {
        ytLog("video", "temp upload failed", err instanceof Error ? err.message : String(err));
        await failProgressMessage(
          gram,
          resolvingId,
          isTimeoutLike(err)
            ? "Video upload timed out. Please try a shorter video or try again."
            : buildMediaFailureMessage("video", err),
          replyTo,
        );
      }
    } finally {
      try {
        await unlink(media.filePath);
      } catch {
        // Temp cleanup fail is non-fatal; OS sweep can handle leftovers.
      }
    }
  }

  @Command("vtuber")
  async vtuber(gram: BaseContext) {
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
    const fallbackCaption = this.withMention(gram, `${characterArg || "vtuber"} drop ✨`);
    const adaptive = await this.adaptiveCaption(gram, "vtuber", fallbackCaption);
    const finalCaption = customCaption ?? adaptive;
    if (parsedCount.overLimit) {
      await gram.reply(this.withMention(gram, "max image count is 3. Using 3."));
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
      const random = pick(VTUBERS);
      await this.sendVtuberBatch(gram, random, count, finalCaption);
      return;
    }

    if (!isVtuberName(characterArg)) {
      await gram.reply(
        this.withMention(
          gram,
          `unknown character: ${characterArg}\nAvailable: ${VTUBERS.join(", ")}`,
        ),
      );
      return;
    }

    await this.sendVtuberBatch(gram, characterArg, count, finalCaption);
  }

  @CallbackQuery("vtb:*")
  async vtuberPick(gram: BaseContext) {
    const encoded = gram.match?.[0];
    if (!encoded) return;
    const [characterRaw, countRaw] = encoded.split(":");
    const parsedCount = parseCount(countRaw);
    const count = parsedCount.count;

    if (characterRaw === "random") {
      await gram.answer(`random x${String(count)}`);
      const random = pick(VTUBERS);
      await this.sendVtuberBatch(gram, random, count);
      return;
    }

    if (!isVtuberName(characterRaw)) {
      await gram.answer("unknown");
      return;
    }

    await gram.answer(`${characterRaw} x${String(count)}`);
    await this.sendVtuberBatch(gram, characterRaw, count);
  }

  @Command("flip")
  async flip(gram: BaseContext) {
    const result = randomInt(2) === 0 ? "heads" : "tails";
    await gram.reply(result);
  }

  @Command("8ball")
  async eightBall(gram: BaseContext) {
    const q = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!q) {
      await gram.reply("usage: /8ball <question>");
      return;
    }
    await gram.reply(pick(EIGHT_BALL));
  }

  @Command("choose")
  async choose(gram: BaseContext) {
    const raw = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    const options = raw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const fallbackOptions =
      options.length >= 2
        ? options
        : raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    if (fallbackOptions.length < 2) {
      await gram.reply("usage: /choose pizza | burger | ramen");
      return;
    }
    await gram.reply(pick(fallbackOptions));
  }

  @Command("roll")
  async roll(gram: BaseContext) {
    const arg = (gram.text ?? "").split(/\s+/).slice(1).join("").trim() || "1d6";
    const m = arg.match(/^(\d{1,2})d(\d{1,4})$/i);
    if (!m) {
      await gram.reply("usage: /roll 1d20");
      return;
    }
    const count = Number(m[1]);
    const sides = Number(m[2]);
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) {
      await gram.reply("use sane dice limits: count 1-20, sides 2-1000.");
      return;
    }
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const total = rolls.reduce((a, b) => a + b, 0);
    await gram.reply(
      count === 1 ? String(rolls[0]) : `${rolls.join(", ")} (total: ${String(total)})`,
    );
  }

  @Command("rps")
  async rps(gram: BaseContext) {
    const userRaw = (gram.text ?? "").split(/\s+/)[1]?.toLowerCase();
    const replyTo = gram.message?.message_id;
    if (!userRaw) {
      await gram.send({
        text: "🎮 rock paper scissors\npick your move:",
        replyMarkup: rpsKeyboard(),
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }
    if (!FunController.RPS_MOVES.includes(userRaw as (typeof FunController.RPS_MOVES)[number])) {
      await gram.send({
        text: "usage: /rps rock|paper|scissors",
        replyMarkup: rpsKeyboard(),
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      return;
    }
    await this.resolveRpsRound(gram, userRaw as (typeof FunController.RPS_MOVES)[number]);
  }

  @CallbackQuery("rps:*")
  async rpsPick(gram: BaseContext) {
    const encoded = gram.match?.[0];
    if (
      !encoded ||
      !FunController.RPS_MOVES.includes(encoded as (typeof FunController.RPS_MOVES)[number])
    ) {
      await gram.answer("invalid move");
      return;
    }
    const user = encoded as (typeof FunController.RPS_MOVES)[number];
    const callbackQuery = asRecord((gram as unknown as Record<string, unknown>).callbackQuery);
    const callbackMessage = asRecord(callbackQuery?.message);
    const messageId = getNumber(callbackMessage?.message_id);
    await gram.answer("ok");
    await this.resolveRpsRound(gram, user, messageId);
  }
}
