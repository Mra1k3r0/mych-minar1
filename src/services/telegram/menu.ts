import { config } from "../../config.js";
import { commandRegistry } from "../../commands/registry.js";
import type { CommandDef } from "../../commands/types.js";
import { Fetch } from "../http/undici.js";
import { logger } from "../observability/logger.js";

const TG_API = "https://api.telegram.org";

function normalizeBotCommandDescription(raw: string, fallback: string): string {
  let d = raw.trim().replace(/\s+/g, " ");
  if (!d) d = fallback;
  if (d.length < 3) d = `${d} ··`.slice(0, 3);
  if (d.length > 256) d = `${d.slice(0, 252).trimEnd()}…`;
  return d;
}

function menuCommandsFromRegistry(
  defs: CommandDef[],
): Array<{ command: string; description: string }> {
  const out: Array<{ command: string; description: string }> = [];
  for (const c of defs) {
    const name = c.name.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(name)) continue;
    out.push({
      command: name,
      description: normalizeBotCommandDescription(c.description, name),
    });
  }
  return out.slice(0, 100);
}

/** Sync default slash commands to Telegram menu (`setMyCommands`). */
export async function syncBotSlashCommands(): Promise<void> {
  const defs = commandRegistry.all().filter((c) => !c.admin && (c.perm ?? 0) < 1);
  const commands = menuCommandsFromRegistry(defs);
  if (commands.length === 0) {
    logger.warn("bot.set_my_commands_skipped", { reason: "no commands" });
    return;
  }

  const url = `${TG_API}/bot${config.telegram.token}/setMyCommands`;
  try {
    const data = await Fetch<{ ok?: boolean; description?: string }>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands }),
      mode: "strict",
    });
    if (!data.ok) {
      logger.warn("bot.set_my_commands", { ok: data.ok, description: data.description });
    }
  } catch (err) {
    logger.warn("bot.set_my_commands_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
