import test from "node:test";
import assert from "node:assert/strict";
import { validateCommandIntentMapConsistency } from "../src/services/command/validate.js";

void test("validateCommandIntentMapConsistency: detects alias collisions", () => {
  const registry = new Set(["ping", "help"]);
  const normalized = {
    ping: {
      autoExecutable: true,
      matchCommandName: true,
      requiresArgs: false,
      argsHint: "optional",
      examples: ["/ping"],
      aliases: ["latency"],
      keywords: [],
      neverNeedsClarify: false,
      clarifyPrompt: "ok",
    },
    help: {
      autoExecutable: true,
      matchCommandName: true,
      requiresArgs: false,
      argsHint: "optional",
      examples: ["/help"],
      aliases: ["latency"],
      keywords: [],
      neverNeedsClarify: false,
      clarifyPrompt: "ok",
    },
  };

  const errors = validateCommandIntentMapConsistency(normalized, registry);
  assert.ok(errors.some((e) => e.includes("Alias collision")));
});

void test("validateCommandIntentMapConsistency: detects alias shadowing a real command", () => {
  const registry = new Set(["ping", "help"]);
  const normalized = {
    help: {
      autoExecutable: true,
      matchCommandName: true,
      requiresArgs: false,
      argsHint: "optional",
      examples: ["/help"],
      aliases: ["ping"],
      keywords: [],
      neverNeedsClarify: false,
      clarifyPrompt: "ok",
    },
  };

  const errors = validateCommandIntentMapConsistency(normalized, registry);
  assert.ok(errors.some((e) => e.includes("Alias shadows command name")));
});

