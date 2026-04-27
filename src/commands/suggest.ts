import type { CommandDef } from "./types.js";

export function extractCommandName(raw: string): string {
  return raw.trim().replace(/^\//, "").split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export function findClosestCommandName(input: string, commands: CommandDef[]): string | null {
  const target = input.trim().toLowerCase();
  if (!target) return null;

  const directPrefix =
    commands.find((c) => c.name.startsWith(target)) ??
    commands.find((c) => target.startsWith(c.name)) ??
    null;
  if (directPrefix) return directPrefix.name;

  let best: { name: string; dist: number } | null = null;
  for (const c of commands) {
    const dist = levenshtein(target, c.name.toLowerCase());
    if (!best || dist < best.dist) {
      best = { name: c.name, dist };
    }
  }
  if (!best) return null;
  const maxAllowed = Math.max(2, Math.floor(target.length * 0.4));
  return best.dist <= maxAllowed ? best.name : null;
}
