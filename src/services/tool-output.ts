/**
 * Inspired by claude-code's toolResultStorage:
 * - Avoid empty tool outputs (some models can get weird on empty tool_result).
 * - Persist large tool outputs to disk and feed a small preview back to the model.
 *
 * This keeps the agent loop stable even when a tool produces huge output.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { truncate } from "../utils/format.js";

const TOOL_RESULTS_DIR = path.resolve(process.cwd(), "data", "tool-results");
const PREVIEW_CHARS = 2000;
const MAX_INLINE_CHARS = 4000;
const TOOL_RESULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOOL_RESULT_MAX_FILES = 300;
let cleanupInFlight: Promise<void> | null = null;
let lastCleanupAt = 0;

async function ensureDir() {
  await fs.mkdir(TOOL_RESULTS_DIR, { recursive: true });
}

async function cleanupPersistedToolResults() {
  const now = Date.now();
  if (cleanupInFlight) return cleanupInFlight;
  if (now - lastCleanupAt < 60_000) return;

  cleanupInFlight = (async () => {
    try {
      const entries = await fs.readdir(TOOL_RESULTS_DIR, { withFileTypes: true });
      const files: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const fullPath = path.join(TOOL_RESULTS_DIR, ent.name);
        const st = await fs.stat(fullPath).catch(() => null);
        if (!st) continue;
        files.push({ name: ent.name, fullPath, mtimeMs: st.mtimeMs });
      }

      const cutoff = now - TOOL_RESULT_RETENTION_MS;
      for (const f of files) {
        if (f.mtimeMs < cutoff) {
          await fs.unlink(f.fullPath).catch(() => {});
        }
      }

      const fresh = files.filter((f) => f.mtimeMs >= cutoff).sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (fresh.length > TOOL_RESULT_MAX_FILES) {
        for (const f of fresh.slice(TOOL_RESULT_MAX_FILES)) {
          await fs.unlink(f.fullPath).catch(() => {});
        }
      }
    } finally {
      lastCleanupAt = Date.now();
      cleanupInFlight = null;
    }
  })();
  return cleanupInFlight;
}

export async function normalizeToolOutput(toolName: string, raw: string): Promise<string> {
  const text = raw;
  if (text.trim().length === 0) {
    return `(${toolName} completed with no output)`;
  }

  if (text.length <= MAX_INLINE_CHARS) {
    return text;
  }

  await ensureDir();
  void cleanupPersistedToolResults();
  const id = crypto.randomUUID();
  const safeTool = toolName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${safeTool}_${id}.txt`;
  const filepath = path.join(TOOL_RESULTS_DIR, filename);
  await fs.writeFile(filepath, text, "utf8");

  const preview = truncate(text, PREVIEW_CHARS);
  return [
    "<persisted-output>",
    `Output too large (${String(text.length)} chars). Saved to: ${filepath}`,
    "",
    `Preview (first ${String(PREVIEW_CHARS)} chars):`,
    preview,
    "</persisted-output>",
  ].join("\n");
}
