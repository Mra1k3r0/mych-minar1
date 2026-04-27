import type { BaseContext } from "@mra1k3r0/gramora";
import { Innertube } from "youtubei.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

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

type UnknownRecord = Record<string, unknown>;
type YtDownloadOptions = NonNullable<Parameters<Innertube["download"]>[1]>;
type WebReadableLike = Parameters<typeof Readable.fromWeb>[0];

let ytClientPromise: Promise<Innertube> | null = null;
let ytEvaluatorPatched = false;

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
  return getString(titleRec.text);
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
        const source = data.output ?? "";
        const context = vm.createContext({ ...(env ?? {}) });
        const script = new vm.Script(source);
        return Promise.resolve(script.runInContext(context));
      },
    });
    ytEvaluatorPatched = true;
  } catch (err) {
    ytLog("init", "failed to patch evaluator", err instanceof Error ? err.message : String(err));
  }
}

async function getYtClient(): Promise<Innertube> {
  if (!ytClientPromise) {
    await ensureYtEvaluatorPatched();
    const cookie = process.env.YOUTUBE_COOKIE?.trim();
    const visitorData = process.env.YOUTUBE_VISITOR_DATA?.trim();
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
    pools.find((r) => ["Video", "video"].includes(getString(asRecord(r)?.type) ?? "")) ??
    pools.find((r) => Boolean(getVideoId(r))) ??
    null;
  const id = getVideoId(first);
  if (!id) return null;
  return { id, title: getTitleText(first) };
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
    return { id, title: getTitleText(first) };
  } catch {
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
  if (!textCandidate.includes(":")) return null;
  const parts = textCandidate
    .split(":")
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n));
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
    const ranked = videos.filter((r) => !isLikelyShort(r));
    for (const item of (ranked.length ? ranked : videos).slice(0, 12)) {
      push(getVideoId(item), getTitleText(item));
      if (out.length >= limit) break;
    }
  } catch {
    // Best-effort search fallback.
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
      // Progress cleanup is optional.
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
    // Fallback to plain message if edit fails.
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
): Promise<{ filePath: string; title?: string }> {
  const yt = await getYtClient();
  const infoUnknown: unknown = await yt.getInfo(videoId);
  const title = getString(asRecord(asRecord(infoUnknown)?.basic_info)?.title);
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
        const webStream = await yt.download(videoId, attempt);
        const nodeStream = Readable.fromWeb(webStream as WebReadableLike);
        await pipeline(nodeStream, createWriteStream(filePath));
        return { filePath, title };
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw new Error(`youtube download failed: ${errorText(lastError)}`);
}

async function downloadYouTubeAsStream(
  videoId: string,
  mode: "audio" | "video",
): Promise<{ stream: NodeJS.ReadableStream; filename: string; mimeType: string; title?: string }> {
  const yt = await getYtClient();
  const infoUnknown: unknown = await yt.getInfo(videoId);
  const title = getString(asRecord(asRecord(infoUnknown)?.basic_info)?.title);
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
        const webStream = await yt.download(videoId, attempt);
        return {
          stream: Readable.fromWeb(webStream as WebReadableLike),
          filename:
            mode === "audio"
              ? buildShortAudioName(title, videoId)
              : `minar1_${videoId}.${strategy.ext}`,
          mimeType: strategy.mimeType,
          title,
        };
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw new Error(`youtube stream failed: ${errorText(lastError)}`);
}

export async function runPlay(gram: BaseContext) {
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
    const durationSec = await getVideoDurationSeconds(resolved.id);
    if (durationSec !== null && durationSec > MEDIA_MAX_SECONDS) continue;
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
    } catch {
      // Stream path failed; try temp-file path.
    }
    let media: { filePath: string; title?: string };
    try {
      media = await downloadYouTubeToTemp(resolved.id, "audio");
    } catch (err) {
      lastMediaError = err;
      continue;
    }
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
      if (isTimeoutLike(err)) {
        await sleep(1200);
      }
    } finally {
      try {
        await unlink(media.filePath);
      } catch {
        // Temp cleanup best effort.
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

export async function runVideo(gram: BaseContext) {
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
  } catch {
    // Stream path failed; try temp-file path.
  }
  let media: { filePath: string; title?: string };
  try {
    media = await downloadYouTubeToTemp(resolved.id, "video");
  } catch (err) {
    await failProgressMessage(
      gram,
      resolvingId,
      `${buildMediaFailureMessage("video", err)}\nDirect link:\nhttps://www.youtube.com/watch?v=${resolved.id}`,
      replyTo,
    );
    return;
  }
  try {
    await gram.video({
      video: { path: media.filePath },
      caption: media.title ? `video: ${media.title}` : "video",
      ...(replyTo !== undefined ? { replyTo } : {}),
    });
    await clearProgressMessage(gram, resolvingId);
  } catch (err) {
    await failProgressMessage(
      gram,
      resolvingId,
      isTimeoutLike(err)
        ? "Video upload timed out. Please try a shorter video or try again."
        : buildMediaFailureMessage("video", err),
      replyTo,
    );
  } finally {
    try {
      await unlink(media.filePath);
    } catch {
      // Temp cleanup best effort.
    }
  }
}
