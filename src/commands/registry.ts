import type { BaseContext } from "@mra1k3r0/gramora";
import { config } from "../config.js";
import { sendRichText } from "../services/telegram/rich.js";
import type { CommandDef } from "./types.js";

export class CommandRegistry {
  private map = new Map<string, CommandDef>();
  private cooldownByUserAndCommand = new Map<string, number>();

  register(def: CommandDef) {
    this.map.set(def.name, def);
    return def;
  }

  all(): CommandDef[] {
    return [...this.map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  byGroup(group: CommandDef["group"]): CommandDef[] {
    return this.all().filter((c) => c.group === group);
  }

  get(name: string): CommandDef | undefined {
    return this.map.get(name);
  }

  private userPermLevel(gram: BaseContext): number {
    const userId = gram.fromId;
    if (!userId) return 0;
    return config.bot.adminIds.includes(userId) ? 1 : 0;
  }

  private requiredPerm(cmd: CommandDef): number {
    const permFromAdminFlag = cmd.admin ? 1 : 0;
    return Math.max(permFromAdminFlag, cmd.perm ?? 0);
  }

  private cooldownKey(commandName: string, gram: BaseContext): string | null {
    const userId = gram.fromId;
    if (!userId) return null;
    return `${commandName}:${String(userId)}`;
  }

  async run(name: string, gram: BaseContext): Promise<boolean> {
    const cmd = this.map.get(name);
    if (!cmd?.run) return false;
    const requiredPerm = this.requiredPerm(cmd);
    const currentPerm = this.userPermLevel(gram);
    if (currentPerm < requiredPerm) {
      await sendRichText(
        gram,
        `🔒 You need permission level ${String(requiredPerm)} to use /${name}.`,
      );
      return true;
    }

    const cooldownSeconds = Math.max(0, cmd.cooldownSeconds ?? 0);
    const key = this.cooldownKey(name, gram);
    if (cooldownSeconds > 0 && key) {
      const now = Date.now();
      const readyAt = this.cooldownByUserAndCommand.get(key) ?? 0;
      if (readyAt > now) {
        const remainingSec = Math.ceil((readyAt - now) / 1000);
        await sendRichText(
          gram,
          `⏳ /${name} is on cooldown. Try again in ${String(remainingSec)}s.`,
        );
        return true;
      }
      this.cooldownByUserAndCommand.set(key, now + cooldownSeconds * 1000);
    }

    await cmd.run(gram);
    return true;
  }
}

export const commandRegistry = new CommandRegistry();
