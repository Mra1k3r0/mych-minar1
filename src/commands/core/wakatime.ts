import { commandRegistry } from "../registry.js";
import { FetchM } from "../../services/http/undici.js";
import { sendRichText } from "../../services/telegram/rich.js";

type WakaLanguage = {
  name?: string;
  text?: string;
  total_seconds?: number;
};

type WakaProject = {
  name?: string;
  text?: string;
  total_seconds?: number;
};

type WakaStatsData = {
  human_readable_total?: string;
  human_readable_daily_average?: string;
  languages?: WakaLanguage[];
  projects?: WakaProject[];
};

type WakaRes = {
  data?: WakaStatsData;
  error?: string;
};

type WakaRange = "last_7_days" | "last_30_days" | "last_6_months" | "last_year" | "all_time";

const VALID_RANGES = new Set<WakaRange>([
  "last_7_days",
  "last_30_days",
  "last_6_months",
  "last_year",
  "all_time",
]);

const RANGES: readonly WakaRange[] = [
  "last_7_days",
  "last_30_days",
  "last_6_months",
  "last_year",
  "all_time",
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rangeCode(range: string): string {
  return `<code>${escapeHtml(range).replace(/_/g, "&#95;")}</code>`;
}

function msgField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = (value as Record<string, unknown>).message;
  return typeof maybe === "string" ? maybe : undefined;
}

function parseArgs(
  text: string,
):
  | { username: string; range: WakaRange }
  | { error: "missing_username" | "invalid_range"; raw?: string } {
  const args = text.split(/\s+/).slice(1).filter(Boolean);
  let username = args[0]?.trim();
  if (!username) return { error: "missing_username" };

  let rawRange = args.slice(1).join(" ").trim();
  if (username.includes("|")) {
    const [left, right] = username.split("|", 2);
    username = left.trim() || username;
    if (!rawRange && right) rawRange = right.trim();
  }
  rawRange = rawRange
    .replace(/^\|\s*/, "")
    .replace(/\s*\|$/, "")
    .trim();
  if (rawRange.includes("|")) {
    const parts = rawRange
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
    rawRange = parts[0] ?? "";
  }

  if (rawRange.length === 0) {
    return { username, range: "last_7_days" };
  }
  if (!VALID_RANGES.has(rawRange as WakaRange)) {
    return { error: "invalid_range", raw: rawRange };
  }
  const range = rawRange as WakaRange;
  return { username, range };
}

function topList(
  items: Array<{ name?: string; text?: string; total_seconds?: number }> | undefined,
  title: string,
): string[] {
  if (!items?.length) return [];
  const top = [...items]
    .sort((a, b) => (b.total_seconds ?? 0) - (a.total_seconds ?? 0))
    .slice(0, 3);
  const lines = [escapeHtml(title)];
  for (const [idx, item] of top.entries()) {
    const label = escapeHtml(item.name ?? "unknown");
    const spent = escapeHtml(item.text ?? "n/a");
    lines.push(`${String(idx + 1)}. ${label} - ${spent}`);
  }
  return lines;
}

async function fetchStats(
  username: string,
  range: WakaRange,
): Promise<
  | { ok: true; data: WakaStatsData }
  | {
      ok: false;
      reason: "api_error" | "not_found" | "request_failed";
      message: string;
    }
> {
  const url = `https://wakatime.com/api/v1/users/${encodeURIComponent(username)}/stats/${range}`;
  try {
    const resp = await FetchM<WakaRes>(url, {
      method: "GET",
      headers: { accept: "application/json" },
      allowNon2xx: true,
    });
    const parsed = resp.data ?? undefined;

    if (resp.ok && parsed?.data) {
      return { ok: true, data: parsed.data };
    }

    const parsedMessage = msgField(parsed);
    const apiError = typeof parsed?.error === "string" ? parsed.error : (parsedMessage ?? "");

    if (apiError) {
      return { ok: false, reason: "api_error", message: apiError };
    }

    if (resp.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: "No public WakaTime stats found for this user.",
      };
    }

    return {
      ok: false,
      reason: "request_failed",
      message: `WakaTime request failed (HTTP ${String(resp.status)}).`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "request_failed",
      message: err instanceof Error ? err.message : "network error",
    };
  }
}

export const CMD_WAKATIME = commandRegistry.register({
  name: "wakatime",
  description: "WakaTime public stats: /wakatime <username> [range]",
  group: "core",
  cooldownSeconds: 5,
  run: async (gram) => {
    const sendHtml = async (html: string, fallback: string): Promise<void> => {
      if (gram.chatId) {
        try {
          await gram.api.sendMessage({
            chat_id: gram.chatId,
            text: html,
            parse_mode: "HTML",
          });
          return;
        } catch {
          // fallback to generic rich sender
        }
      }
      await sendRichText(gram, fallback);
    };

    const parsed = parseArgs(gram.text ?? "");
    if ("error" in parsed) {
      const usageRanges = RANGES.map((x) => rangeCode(x)).join(" | ");
      if (parsed.error === "missing_username") {
        await sendHtml(
          `usage: /wakatime &lt;username&gt; [${usageRanges}]`,
          "usage: /wakatime <username> [last_7_days | last_30_days | last_6_months | last_year | all_time]",
        );
        return;
      }
      await sendHtml(
        [
          `invalid range: ${escapeHtml(parsed.raw ?? "unknown")}`,
          `use one of: ${usageRanges}`,
          "example: /wakatime mra1k3r0 <code>last&#95;30&#95;days</code>",
        ].join("\n"),
        [
          `invalid range: ${parsed.raw ?? "unknown"}`,
          "use one of: last_7_days | last_30_days | last_6_months | last_year | all_time",
          "example: /wakatime mra1k3r0 last_30_days",
        ].join("\n"),
      );
      return;
    }

    const { username, range } = parsed;
    const response = await fetchStats(username, range);
    if (!response.ok) {
      const usageRanges = RANGES.map((x) => rangeCode(x)).join(" | ");
      if (
        response.reason === "api_error" &&
        response.message.toLowerCase().includes("time range")
      ) {
        await sendHtml(
          [
            `WakaTime error: ${escapeHtml(response.message)}`,
            `try one of: ${usageRanges}`,
            `current request: <code>${escapeHtml(username)}</code> ${rangeCode(range)}`,
          ].join("\n"),
          [
            `WakaTime error: ${response.message}`,
            "try one of: last_7_days | last_30_days | last_6_months | last_year | all_time",
          ].join("\n"),
        );
        return;
      }
      await sendRichText(
        gram,
        `WakaTime request failed for "${username}": ${response.message}\nProfile may be private, username invalid, or selected range unavailable.`,
      );
      return;
    }
    const stats = response.data;

    const lines = [
      `<b>⌚ WakaTime: ${escapeHtml(username)}</b>`,
      `Range: ${rangeCode(range)}`,
      `Total: ${escapeHtml(stats.human_readable_total ?? "n/a")}`,
      `Daily avg: ${escapeHtml(stats.human_readable_daily_average ?? "n/a")}`,
    ];

    lines.push(...topList(stats.languages, "Top languages:"));
    lines.push(...topList(stats.projects, "Top projects:"));
    await sendHtml(lines.join("\n"), lines.join("\n"));
  },
});
