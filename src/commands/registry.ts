import type { CommandDef } from "./types.js";

export class CommandRegistry {
  private map = new Map<string, CommandDef>();

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
}

export const commandRegistry = new CommandRegistry();
