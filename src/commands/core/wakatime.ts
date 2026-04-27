import { commandRegistry } from "../registry.js";
import { Fetch } from "../../services/http/undici.js";

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

type WakaStatsResponse = {
  data?: WakaStatsData;
};

type WakaRange = "last_7_days" | "last_30_days" | "last_6_months" | "last_year" | "all_time";

const VALID_RANGES = new Set<WakaRange>([
  "last_7_days",
  "last_30_days",
  "last_6_months",
  "last_year",
  "all_time",
]);

function parseArgs(text: string): { username: string; range: WakaRange } | null {
  const args = text.split(/\s+/).slice(1).filter(Boolean);
  const username = args[0]?.trim();
  if (!username) return null;
  const rawRange = args[1]?.trim().toLowerCase();
  const range = (
    rawRange && VALID_RANGES.has(rawRange as WakaRange) ? rawRange : "last_7_days"
  ) as WakaRange;
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
  const lines = [title];
  for (const [idx, item] of top.entries()) {
    const label = item.name ?? "unknown";
    const spent = item.text ?? "n/a";
    lines.push(`${String(idx + 1)}. ${label} - ${spent}`);
  }
  return lines;
}

export const CMD_WAKATIME = commandRegistry.register({
  name: "wakatime",
  description: "WakaTime public stats: /wakatime <username> [range]",
  group: "core",
  cooldownSeconds: 5,
  run: async (gram) => {
    const parsed = parseArgs(gram.text ?? "");
    if (!parsed) {
      await gram.send(
        "usage: /wakatime <username> [last_7_days|last_30_days|last_6_months|last_year|all_time]",
      );
      return;
    }

    const { username, range } = parsed;
    const url = `https://wakatime.com/api/v1/users/${encodeURIComponent(username)}/stats/${range}`;
    const response = await Fetch<WakaStatsResponse>(url);
    const stats = response?.data;

    if (!stats) {
      await gram.send(
        `No public WakaTime stats found for "${username}".\nProfile may be private or username is invalid.`,
      );
      return;
    }

    const lines = [
      `⌚ *WakaTime: ${username}*`,
      `Range: ${range}`,
      `Total: ${stats.human_readable_total ?? "n/a"}`,
      `Daily avg: ${stats.human_readable_daily_average ?? "n/a"}`,
    ];

    lines.push(...topList(stats.languages, "Top languages:"));
    lines.push(...topList(stats.projects, "Top projects:"));
    await gram.send(lines.join("\n"));
  },
});
