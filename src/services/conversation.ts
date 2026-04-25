import { config } from "../config.js";
import type { ChatMessage } from "./llm.js";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { readdir, stat, unlink } from "node:fs/promises";

interface ConversationEntry {
  messages: ChatMessage[];
  lastActivity: number;
  mode: "chat" | "agent";
}

const CONVERSATION_TTL = 30 * 60_000; // 30 minutes of inactivity => wipe
const PRUNE_INTERVAL = 5 * 60_000;
const JOURNAL_DIR = path.resolve(process.cwd(), "data", "conversations");
const JOURNAL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const JOURNAL_MAX_FILES = 1000;

export class ConversationManager {
  private conversations = new Map<number, ConversationEntry>();
  private pruneTimer: ReturnType<typeof setInterval>;
  private lastJournalCleanupAt = 0;

  constructor() {
    mkdirSync(JOURNAL_DIR, { recursive: true });
    this.pruneTimer = setInterval(() => {
      this.pruneStale();
    }, PRUNE_INTERVAL);
  }

  get(userId: number): ChatMessage[] {
    const entry = this.conversations.get(userId);
    if (!entry) return [];
    entry.lastActivity = Date.now();
    return entry.messages;
  }

  getMode(userId: number): "chat" | "agent" {
    return this.conversations.get(userId)?.mode ?? "chat";
  }

  setMode(userId: number, mode: "chat" | "agent") {
    const entry = this.conversations.get(userId);
    if (entry) {
      entry.mode = mode;
      entry.lastActivity = Date.now();
      this.journal(userId, { type: "mode", mode });
    }
  }

  append(userId: number, message: ChatMessage) {
    let entry = this.conversations.get(userId);
    if (!entry) {
      entry = { messages: [], lastActivity: Date.now(), mode: "chat" };
      this.conversations.set(userId, entry);
    }

    entry.messages.push(message);
    entry.lastActivity = Date.now();

    const max = config.bot.maxConversationHistory;
    if (entry.messages.length > max) {
      const overflow = entry.messages.length - max;
      entry.messages.splice(0, overflow);
    }
    this.journal(userId, { type: "message", mode: entry.mode, message });
  }

  clear(userId: number) {
    this.journal(userId, { type: "clear" });
    this.conversations.delete(userId);
  }

  activeCount(): number {
    return this.conversations.size;
  }

  totalMessages(): number {
    let total = 0;
    for (const entry of this.conversations.values()) {
      total += entry.messages.length;
    }
    return total;
  }

  private pruneStale() {
    const now = Date.now();
    for (const [userId, entry] of this.conversations) {
      if (now - entry.lastActivity > CONVERSATION_TTL) {
        this.journal(userId, { type: "prune_ttl", mode: entry.mode });
        this.conversations.delete(userId);
      }
    }
    void this.cleanupJournalFiles();
  }

  destroy() {
    clearInterval(this.pruneTimer);
  }

  private journal(userId: number, payload: Record<string, unknown>) {
    const file = path.join(JOURNAL_DIR, `user-${String(userId)}.ndjson`);
    const row = {
      ts: new Date().toISOString(),
      userId,
      ...payload,
    };
    void appendFile(file, `${JSON.stringify(row)}\n`, "utf8").catch(() => {});
  }

  private async cleanupJournalFiles() {
    const now = Date.now();
    if (now - this.lastJournalCleanupAt < 5 * 60_000) return;
    this.lastJournalCleanupAt = now;
    try {
      const entries = await readdir(JOURNAL_DIR, { withFileTypes: true });
      const files: Array<{ fullPath: string; mtimeMs: number }> = [];
      for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith(".ndjson")) continue;
        const fullPath = path.join(JOURNAL_DIR, ent.name);
        const st = await stat(fullPath).catch(() => null);
        if (!st) continue;
        files.push({ fullPath, mtimeMs: st.mtimeMs });
      }

      const cutoff = now - JOURNAL_RETENTION_MS;
      for (const f of files) {
        if (f.mtimeMs < cutoff) {
          await unlink(f.fullPath).catch(() => {});
        }
      }

      const fresh = files.filter((f) => f.mtimeMs >= cutoff).sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (fresh.length > JOURNAL_MAX_FILES) {
        for (const f of fresh.slice(JOURNAL_MAX_FILES)) {
          await unlink(f.fullPath).catch(() => {});
        }
      }
    } catch {
      // best-effort cleanup only
    }
  }
}
