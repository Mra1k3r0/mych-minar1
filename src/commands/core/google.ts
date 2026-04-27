import { commandRegistry } from "../registry.js";
import type { CommandDef } from "../types.js";
import { GOOGLE_RESULT_LIMIT, searchGoogle } from "../../services/search/google-search.js";
import { Fetch } from "../../services/http/undici.js";

type Gram = Parameters<NonNullable<CommandDef["run"]>>[0];
type GooglePickResult = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  thumbnail?: string;
};
type GooglePickHighlight = {
  title: string;
  description: string;
  sourceName?: string;
  sourceLink?: string;
  image?: string;
};
type GooglePickState = {
  query: string;
  results: GooglePickResult[];
  highlights: GooglePickHighlight[];
  localPlaces: Array<{
    title: string;
    type?: string;
    rating?: number;
    reviews?: number;
    address?: string;
    thumbnail?: string;
  }>;
  relatedQuestions: Array<{
    question: string;
    snippet?: string;
    title?: string;
    link?: string;
  }>;
  expiresAt: number;
};

const PICK_TTL_MS = 5 * 60_000;
const googlePickState = new Map<string, GooglePickState>();

function makePickToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupGooglePickState(): void {
  const now = Date.now();
  for (const [key, value] of googlePickState.entries()) {
    if (value.expiresAt <= now) googlePickState.delete(key);
  }
}

function buildPickKeyboard(token: string, results: GooglePickResult[]) {
  const items = results.map((item, idx) => ({
    text: `${String(idx + 1)} ${item.source ? `· ${item.source}` : ""}`.slice(0, 24),
    callback_data: `gsel:${token}:${String(idx)}`,
  }));
  const rowSize = 4;
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < items.length; i += rowSize) {
    rows.push(items.slice(i, i + rowSize));
  }
  return { inline_keyboard: rows };
}

function buildFullKeyboard(token: string, state: GooglePickState) {
  const rows = [...buildPickKeyboard(token, state.results).inline_keyboard];
  const sectionRow: Array<{ text: string; callback_data: string }> = [];
  if (state.highlights.length > 0) {
    sectionRow.push({ text: "Wiki", callback_data: `gsec:${token}:wiki` });
  }
  if (state.localPlaces.length > 0) {
    sectionRow.push({ text: "Local", callback_data: `gsec:${token}:local` });
  }
  if (state.relatedQuestions.length > 0) {
    sectionRow.push({ text: "Q&A", callback_data: `gsec:${token}:qa` });
  }
  if (sectionRow.length > 0) {
    rows.push(sectionRow);
  }
  return { inline_keyboard: rows };
}

function buildQaKeyboard(token: string, state: GooglePickState) {
  const items = state.relatedQuestions.map((_, idx) => ({
    text: String(idx + 1),
    callback_data: `gqa:${token}:${String(idx)}`,
  }));
  const rowSize = 5;
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < items.length; i += rowSize) {
    rows.push(items.slice(i, i + rowSize));
  }
  return { inline_keyboard: rows };
}

function isWikipediaUrl(url: string): boolean {
  return /wikipedia\.org\/wiki\//i.test(url);
}

function extractWikipediaTitle(url: string): string | null {
  const m = /wikipedia\.org\/wiki\/([^#?]+)/i.exec(url);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, " ");
  } catch {
    return m[1].replace(/_/g, " ");
  }
}

type WikiExtractResponse = { extract?: string };

async function maybeGetWikipediaSummary(url: string): Promise<string | null> {
  const title = extractWikipediaTitle(url);
  if (!title) return null;
  const api = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const data = await Fetch<WikiExtractResponse>(api);
  return data?.extract?.trim() || null;
}

function shortText(input: string, max = 180): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function safeSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "source";
  }
}

async function sendGoogleText(
  gram: Gram,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
) {
  const replyTo = gram.message?.message_id;
  if (gram.chatId) {
    try {
      await gram.api.sendMessage({
        chat_id: gram.chatId,
        text,
        parse_mode: "Markdown",
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } catch {
      // Fallback: raw text avoids Telegram markdown parse failures on snippets.
      await gram.api.sendMessage({
        chat_id: gram.chatId,
        text,
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
    return;
  }
  await gram.send(text, replyMarkup);
}

async function sendGooglePhoto(
  gram: Gram,
  photo: string,
  caption: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
) {
  const replyTo = gram.message?.message_id;
  if (gram.chatId) {
    try {
      await gram.api.sendPhoto({
        chat_id: gram.chatId,
        photo,
        caption,
        parse_mode: "Markdown",
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } catch {
      // Fallback: raw caption avoids Telegram markdown parse failures.
      await gram.api.sendPhoto({
        chat_id: gram.chatId,
        photo,
        caption,
        ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
    return;
  }
  await gram.photo({ photo, caption, ...(replyTo !== undefined ? { replyTo } : {}) });
  if (replyMarkup) {
    await gram.send("tap a button to open details:", replyMarkup);
  }
}

export async function handleGooglePick(gram: Gram): Promise<void> {
  const encoded = gram.match?.[0];
  if (!encoded) return;
  const [token, idxRaw] = encoded.split(":");
  const idx = Number.parseInt(idxRaw, 10);
  if (!token || !Number.isFinite(idx) || idx < 0) {
    await gram.answer("invalid pick");
    return;
  }

  cleanupGooglePickState();
  const state = googlePickState.get(token);
  if (!state || state.expiresAt <= Date.now()) {
    await gram.answer("expired, run /google again");
    return;
  }
  if (idx >= state.results.length) {
    await gram.answer("invalid choice");
    return;
  }
  const picked = state.results[idx];
  await gram.answer("opening");

  if (isWikipediaUrl(picked.url)) {
    const summary = await maybeGetWikipediaSummary(picked.url);
    if (summary) {
      await sendGoogleText(gram, [`📚 *${picked.title}*`, summary, picked.url].join("\n\n"));
      return;
    }
  }
  if (picked.thumbnail) {
    try {
      await sendGooglePhoto(
        gram,
        picked.thumbnail,
        [`🔗 *${picked.title}*`, picked.source ? `source: ${picked.source}` : "", picked.url]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    } catch {
      // fallback to text if thumbnail fails
    }
  }
  await sendGoogleText(
    gram,
    [
      `🔗 *${picked.title}*`,
      picked.source ? `source: ${picked.source}` : "",
      picked.snippet ?? "",
      picked.url,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

export async function handleGoogleSection(gram: Gram): Promise<void> {
  const encoded = gram.match?.[0];
  if (!encoded) return;
  const parts = encoded.split(":");
  const token = parts[0] ?? "";
  const kind = parts[1] ?? "";
  if (token.length === 0 || kind.length === 0) {
    await gram.answer("invalid section");
    return;
  }
  cleanupGooglePickState();
  const state = googlePickState.get(token);
  if (!state || state.expiresAt <= Date.now()) {
    await gram.answer("expired, run /google again");
    return;
  }
  if (kind === "wiki") {
    const top = state.highlights.at(0);
    if (!top) {
      await gram.answer("not available");
      return;
    }
    await gram.answer("wiki");
    const body = [`✨ ${top.title}`, top.description];
    if (top.sourceName || top.sourceLink) {
      body.push(`source: ${top.sourceName ?? safeSource(top.sourceLink ?? "")}`);
    }
    if (top.sourceLink) body.push(top.sourceLink);
    if (top.image) {
      try {
        await sendGooglePhoto(gram, top.image, body.join("\n\n"));
        return;
      } catch {
        // fallback below
      }
    }
    await sendGoogleText(gram, body.join("\n\n"));
    return;
  }
  if (kind === "local") {
    if (state.localPlaces.length === 0) {
      await gram.answer("not available");
      return;
    }
    await gram.answer("local");
    const lines = ["📍 *Local spots*"];
    for (const [idx, place] of state.localPlaces.entries()) {
      const meta = [
        place.type,
        place.rating ? `⭐ ${String(place.rating)}` : "",
        place.reviews ? `(${String(place.reviews)})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`${String(idx + 1)}. *${place.title}*`);
      if (meta) lines.push(`   ${meta}`);
      if (place.address) lines.push(`   ${place.address}`);
    }
    const firstImage = state.localPlaces[0]?.thumbnail;
    if (firstImage) {
      try {
        await sendGooglePhoto(gram, firstImage, lines.join("\n"));
        return;
      } catch {
        // fallback below
      }
    }
    await sendGoogleText(gram, lines.join("\n"));
    return;
  }
  if (kind === "qa") {
    if (state.relatedQuestions.length === 0) {
      await gram.answer("not available");
      return;
    }
    await gram.answer("q&a");
    const lines = ["❓ Related questions"];
    for (const [idx, qa] of state.relatedQuestions.entries()) {
      lines.push(`${String(idx + 1)}. ${qa.question}`);
      if (qa.snippet) lines.push(`   ${shortText(qa.snippet, 100)}`);
    }
    lines.push("", "pick a question button:");
    await sendGoogleText(gram, lines.join("\n"), buildQaKeyboard(token, state));
    return;
  }
  await gram.answer("invalid section");
}

export async function handleGoogleQaPick(gram: Gram): Promise<void> {
  const encoded = gram.match?.[0];
  if (!encoded) return;
  const [token, idxRaw] = encoded.split(":");
  const idx = Number.parseInt(idxRaw, 10);
  if (!token || !Number.isFinite(idx) || idx < 0) {
    await gram.answer("invalid question");
    return;
  }
  cleanupGooglePickState();
  const state = googlePickState.get(token);
  if (!state || state.expiresAt <= Date.now()) {
    await gram.answer("expired, run /google again");
    return;
  }
  if (idx >= state.relatedQuestions.length) {
    await gram.answer("invalid choice");
    return;
  }
  const qa = state.relatedQuestions[idx];
  await gram.answer("searching");
  await runGoogleSearch(gram, qa.question);
}

async function runGoogleSearch(gram: Gram, query: string): Promise<void> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    await sendGoogleText(gram, "usage: /google <query>");
    return;
  }
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`;
  try {
    const { results, highlights, localPlaces, relatedQuestions, didYouMean, error } =
      await searchGoogle(trimmedQuery);
    if (error === "missing_serpapi_key") {
      await sendGoogleText(gram, "SERPAPI_KEY is missing. Add it to your env to enable /google.");
      return;
    }
    if (results.length === 0) {
      const suggestionLine = didYouMean ? `did you mean: ${didYouMean}\n` : "";
      const errorLine = error ? `source error: ${error}\n` : "";
      await sendGoogleText(
        gram,
        `No direct search results right now.\n${errorLine}${suggestionLine}open in browser:\n${googleUrl}`.trim(),
      );
      return;
    }
    cleanupGooglePickState();
    const token = makePickToken();
    googlePickState.set(token, {
      query: trimmedQuery,
      results,
      highlights,
      localPlaces,
      relatedQuestions,
      expiresAt: Date.now() + PICK_TTL_MS,
    });
    const state = googlePickState.get(token);
    if (!state) {
      await sendGoogleText(gram, "google state error; please run /google again.");
      return;
    }
    const lines = [
      "🔎 *Google results*",
      `query: ${trimmedQuery}`,
      `results: ${String(results.length)}/${String(GOOGLE_RESULT_LIMIT)}`,
      "",
    ];
    if (highlights.length > 0) {
      const top = highlights[0];
      lines.push(`✨ *${top.title}*`);
      lines.push(shortText(top.description, 220));
      if (top.sourceName || top.sourceLink) {
        lines.push(`source: ${top.sourceName ?? safeSource(top.sourceLink ?? "")}`);
      }
      lines.push("");
    }
    for (const [idx, item] of results.entries()) {
      lines.push(`${String(idx + 1)}. *${item.title}*`);
      lines.push(`   source: ${item.source ?? safeSource(item.url)}`);
      if (item.snippet) {
        lines.push(`   highlight: ${shortText(item.snippet, 120)}`);
      }
    }
    lines.push("", "tap a button to open details:");
    const previewImage = highlights[0]?.image ?? results[0]?.thumbnail;
    if (previewImage) {
      try {
        await sendGooglePhoto(
          gram,
          previewImage,
          lines.join("\n"),
          buildFullKeyboard(token, state),
        );
        return;
      } catch {
        // fallback to text if media blocked/fails
      }
    }
    await sendGoogleText(gram, lines.join("\n"), buildFullKeyboard(token, state));
  } catch {
    await sendGoogleText(gram, `Google search failed right now.\nopen in browser:\n${googleUrl}`);
  }
}

export const CMD_GOOGLE = commandRegistry.register({
  name: "google",
  description: "Google search: /google <query>",
  group: "core",
  cooldownSeconds: 3,
  run: async (gram) => {
    const query = (gram.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    await runGoogleSearch(gram, query);
  },
});
