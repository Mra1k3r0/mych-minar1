import type { BaseContext } from "@mra1k3r0/gramora";
import { commandRegistry } from "../../commands/index.js";
import { metaForCommand } from "./intent.js";

export type CommandGroup = "core" | "ai" | "admin" | "fun";

export function formatCommandListHuman(gram: BaseContext): string {
  const from = gram.message?.from;
  const username = from?.username ? `@${from.username}` : "bro";
  const lines = commandRegistry.all().map((c) => `/${c.name} - ${c.description}`);
  return [`Sure ${username}, here are my real commands:`, "", ...lines].join("\n");
}

export function localCommandListHeader(gram: BaseContext): string {
  const from = gram.message?.from;
  const username = from?.username ? `@${from.username}` : "bro";
  const headers = [
    `Here ${username}, full command list is ready:`,
    `Sure ${username} — here’s your live command board:`,
    `Aight ${username}, I got you. Full list below:`,
    `Yo ${username}, here are all commands I can run right now:`,
    `Done ${username} ✅ full feature/command list below:`,
  ];
  return headers[Math.floor(Math.random() * headers.length)];
}

export function detectCommandGroupPreference(text: string): CommandGroup | undefined {
  if (!text) return undefined;
  if (/\b(fun|funny|game|games|meme|random|entertainment|playful)\b/.test(text)) return "fun";
  if (/\b(admin|owner|ops|status|stats|budget)\b/.test(text)) return "admin";
  if (/\b(ai|agent|chat|llm)\b/.test(text)) return "ai";
  if (/\b(core|basic|utility|utilities)\b/.test(text)) return "core";
  return undefined;
}

export function renderCommandCatalog(grouped: boolean, preferredGroup?: CommandGroup): string[] {
  const all = commandRegistry.all();
  const filtered = preferredGroup ? all.filter((c) => c.group === preferredGroup) : all;
  if (!grouped) return filtered.map((c) => `/${c.name} - ${c.description}`);

  const order: CommandGroup[] = ["core", "ai", "admin", "fun"];
  const title: Record<CommandGroup, string> = {
    core: "Core",
    ai: "AI",
    admin: "Admin",
    fun: "Fun",
  };
  const lines: string[] = [];
  for (const group of order) {
    if (preferredGroup && group !== preferredGroup) continue;
    const items = filtered.filter((c) => c.group === group);
    if (!items.length) continue;
    lines.push(`${title[group]}:`);
    lines.push(...items.map((c) => `/${c.name} - ${c.description}`));
    lines.push("");
  }
  return lines.length > 0 ? lines.slice(0, -1) : [];
}

export function commandListCompact(): string {
  return commandRegistry
    .all()
    .map((c) => `/${c.name}`)
    .join(", ");
}

export function commandCatalogJson(autoExecutableCommands: ReadonlySet<string>): string {
  const catalog = commandRegistry.all().map((command) => {
    const meta = metaForCommand(command.name);
    return {
      name: command.name,
      slash: `/${command.name}`,
      group: command.group,
      description: command.description,
      autoExecutable: autoExecutableCommands.has(command.name),
      requiresArgs: meta.requiresArgs,
      argsHint: meta.argsHint,
      examples: meta.examples,
    };
  });
  return JSON.stringify(catalog, null, 2);
}

export function commandCatalogText(): string {
  const lines = commandRegistry.all().map((c) => `/${c.name} - ${c.description}`);
  return ["Available bot commands (source of truth):", ...lines].join("\n");
}
