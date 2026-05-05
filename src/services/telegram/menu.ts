import type { Gramora } from "@mra1k3r0/gramora";
import { commandRegistry } from "../../commands/registry.js";
import type { CommandDef } from "../../commands/types.js";
import { logger } from "../observability/logger.js";

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
export async function syncBotSlashCommands(bot: Gramora): Promise<void> {
  const defs = commandRegistry.all().filter((c) => !c.admin && (c.perm ?? 0) < 1);
  const commands = menuCommandsFromRegistry(defs);
  if (commands.length === 0) {
    logger.warn("bot.set_my_commands_skipped", { reason: "no commands" });
    return;
  }

  try {
    await bot.api.deleteMyCommands();
    await bot.api.setMyCommands({
      commands,
    });
  } catch (err) {
    logger.warn("bot.set_my_commands_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
