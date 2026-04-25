export type CommandGroup = "core" | "ai" | "admin" | "fun";

export type CommandIntentMetaInput = {
  group?: CommandGroup;
  autoExecutable?: boolean;
  matchCommandName?: boolean;
  requiresArgs?: boolean;
  argsHint?: string;
  examples?: string[];
  aliases?: string[];
  keywords?: string[];
  neverNeedsClarify?: boolean;
  clarifyPrompt?: string;
};

export type NormalizedCommandIntentMeta = {
  group?: CommandGroup;
  autoExecutable: boolean;
  matchCommandName: boolean;
  requiresArgs: boolean;
  argsHint: string;
  examples: string[];
  aliases: string[];
  keywords: string[];
  neverNeedsClarify: boolean;
  clarifyPrompt: string;
};

function cleanTokens(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const token = v.trim().toLowerCase();
    if (!token) continue;
    out.add(token);
  }
  return [...out];
}

export function normalizeCommandIntentMap(
  raw: unknown,
): Record<string, NormalizedCommandIntentMeta> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid command-intent.json: expected object map");
  }
  const src = raw as Record<string, CommandIntentMetaInput>;
  const out: Record<string, NormalizedCommandIntentMeta> = {};
  for (const [name, meta] of Object.entries(src)) {
    if (!name || typeof name !== "string") continue;
    const key = name.trim().toLowerCase();
    if (!key) continue;
    out[key] = {
      group: meta.group,
      autoExecutable: Boolean(meta.autoExecutable),
      matchCommandName: meta.matchCommandName !== false,
      requiresArgs: Boolean(meta.requiresArgs),
      argsHint:
        typeof meta.argsHint === "string" && meta.argsHint.trim()
          ? meta.argsHint.trim()
          : "optional",
      examples: cleanTokens(meta.examples?.length ? meta.examples : [`/${key}`]),
      aliases: cleanTokens(meta.aliases),
      keywords: cleanTokens(meta.keywords),
      neverNeedsClarify: Boolean(meta.neverNeedsClarify),
      clarifyPrompt:
        typeof meta.clarifyPrompt === "string" && meta.clarifyPrompt.trim()
          ? meta.clarifyPrompt.trim()
          : "Can you give a bit more detail?",
    };
  }
  return out;
}
