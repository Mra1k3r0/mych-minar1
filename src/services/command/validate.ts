import { commandRegistry } from "../../commands/index.js";
import { normalizeCommandIntentMap } from "../../data/command-intent.schema.js";
import { getCommandIntentData } from "./store.js";

export function validateCommandIntentConsistency(): void {
  const normalized = normalizeCommandIntentMap(getCommandIntentData());
  const registryNames = new Set(commandRegistry.all().map((c) => c.name));
  const intentNames = new Set(Object.keys(normalized));

  const missingInIntent = [...registryNames].filter((name) => !intentNames.has(name));
  const unknownInIntent = [...intentNames].filter((name) => !registryNames.has(name));

  const errors: string[] = [];
  if (missingInIntent.length > 0) {
    errors.push(`Missing in command-intent.json: ${missingInIntent.join(", ")}`);
  }
  if (unknownInIntent.length > 0) {
    errors.push(`Unknown keys in command-intent.json: ${unknownInIntent.join(", ")}`);
  }

  if (errors.length > 0) {
    throw new Error(`Command intent metadata mismatch.\n${errors.join("\n")}`);
  }
}
