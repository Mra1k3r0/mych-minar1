import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export { commandRegistry } from "./registry.js";
export type { CommandDef } from "./types.js";

const EXCLUDED_FILES = new Set([
  "index.ts",
  "registry.ts",
  "types.ts",
  "suggest.ts",
  "index.js",
  "registry.js",
  "types.js",
  "suggest.js",
]);
let commandsLoaded = false;

function normalizeFileKey(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function collectCommandModuleFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCommandModuleFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".ts")) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    files.push(full);
  }

  return files;
}

export async function loadCommandModules(): Promise<void> {
  if (commandsLoaded) return;
  const root = path.dirname(fileURLToPath(import.meta.url));
  const discovered = collectCommandModuleFiles(root);
  const uniqueByKey = new Map<string, string>();
  for (const file of discovered) {
    const key = normalizeFileKey(file);
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, file);
  }
  const files = [...uniqueByKey.values()].sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }
  commandsLoaded = true;
}
