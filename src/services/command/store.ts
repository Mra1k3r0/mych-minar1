import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let cached: Record<string, unknown> | null = null;

export function resetCommandIntentDataCache(): void {
  cached = null;
}

export function getCommandIntentData(): Record<string, unknown> {
  if (cached) return cached;

  const candidates = [
    path.resolve(process.cwd(), "dist", "data", "cmd-intent.json"),
    path.resolve(process.cwd(), "src", "data", "cmd-intent.json"),
  ];
  const filePath = candidates.find((p) => existsSync(p));
  if (!filePath) {
    throw new Error(`cmd-intent.json not found. Checked:\n${candidates.join("\n")}`);
  }
  const raw = readFileSync(filePath, "utf8");
  cached = JSON.parse(raw) as Record<string, unknown>;
  return cached;
}
