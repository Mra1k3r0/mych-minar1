import { commandRegistry } from "../../commands/index.js";
import { normalizeCommandIntentMap } from "../../data/cmd-intent.schema.js";
import { getCommandIntentData } from "./store.js";

export function validateCommandIntentMapConsistency(
  normalized: ReturnType<typeof normalizeCommandIntentMap>,
  registryNames: Set<string>,
): string[] {
  const intentNames = new Set(Object.keys(normalized));
  const missingInIntent = [...registryNames].filter((name) => !intentNames.has(name));
  const unknownInIntent = [...intentNames].filter((name) => !registryNames.has(name));

  const errors: string[] = [];
  if (missingInIntent.length > 0) {
    errors.push(`Missing in cmd-intent.json: ${missingInIntent.join(", ")}`);
  }
  if (unknownInIntent.length > 0) {
    errors.push(`Unknown keys in cmd-intent.json: ${unknownInIntent.join(", ")}`);
  }

  const aliasOwners = new Map<string, string>();
  for (const [commandName, meta] of Object.entries(normalized)) {
    for (const alias of meta.aliases) {
      const prev = aliasOwners.get(alias);
      if (prev && prev !== commandName) {
        errors.push(`Alias collision: '${alias}' used by '${prev}' and '${commandName}'`);
        continue;
      }
      aliasOwners.set(alias, commandName);

      if (registryNames.has(alias) && alias !== commandName) {
        errors.push(
          `Alias shadows command name: '${alias}' is a real command (in '${commandName}')`,
        );
      }
    }
  }

  return errors;
}

export function validateCommandIntentConsistency(): void {
  const normalized = normalizeCommandIntentMap(getCommandIntentData());
  const registryNames = new Set(commandRegistry.all().map((c) => c.name));
  const errors = validateCommandIntentMapConsistency(normalized, registryNames);

  if (errors.length > 0) {
    throw new Error(`Command intent metadata mismatch.\n${errors.join("\n")}`);
  }
}
