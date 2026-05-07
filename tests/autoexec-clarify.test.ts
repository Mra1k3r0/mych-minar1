import assert from "node:assert/strict";
import test from "node:test";
import { shouldClarifyCommandExec } from "../src/services/ai/autoexec.js";
import { commandCatalogJson } from "../src/services/ai/catalog.js";
import { getAutoExecutableCommands } from "../src/services/ai/intent.js";

const catalogJson = commandCatalogJson(getAutoExecutableCommands());

void test("shouldClarifyCommandExec asks when required-args command has empty args (budget tight)", async () => {
  const res = await shouldClarifyCommandExec({
    command: "google",
    userText: "can you google linus torvalds",
    args: "",
    llmBudgetTight: true,
    catalogJson,
    llmChat: () => Promise.resolve({ message: { content: "" } }),
  });

  assert.equal(res.ask, true);
  assert.ok(res.prompt.length > 0);
});

void test("shouldClarifyCommandExec asks when required-args command has empty args on llm failure", async () => {
  const res = await shouldClarifyCommandExec({
    command: "wiki",
    userText: "give me wiki info",
    args: "",
    llmBudgetTight: false,
    catalogJson,
    llmChat: () => Promise.reject(new Error("llm offline")),
  });

  assert.equal(res.ask, true);
  assert.ok(res.prompt.length > 0);
});

void test("shouldClarifyCommandExec does not ask when non-required command has empty args", async () => {
  const res = await shouldClarifyCommandExec({
    command: "help",
    userText: "help me",
    args: "",
    llmBudgetTight: true,
    catalogJson,
    llmChat: () => Promise.resolve({ message: { content: "" } }),
  });

  assert.equal(res.ask, false);
});
