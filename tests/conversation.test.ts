import "./setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { ConversationManager } from "../src/services/conversation.js";
import { config } from "../src/config.js";

void test("ConversationManager.totalMessages should track messages accurately", () => {
  const cm = new ConversationManager();

  // Initial state
  assert.equal(cm.totalMessages(), 0);

  // Add messages
  cm.append(1, { role: "user", content: "hello" });
  assert.equal(cm.totalMessages(), 1);

  cm.append(1, { role: "assistant", content: "hi" });
  assert.equal(cm.totalMessages(), 2);

  cm.append(2, { role: "user", content: "hey" });
  assert.equal(cm.totalMessages(), 3);

  // Clear user 1
  cm.clear(1);
  assert.equal(cm.totalMessages(), 1);

  // Clear user 2
  cm.clear(2);
  assert.equal(cm.totalMessages(), 0);

  cm.destroy();
});

void test("ConversationManager.totalMessages should handle history overflow", () => {
  const cm = new ConversationManager();
  const max = config.bot.maxConversationHistory;

  for (let i = 0; i < max + 5; i++) {
    cm.append(1, { role: "user", content: `msg ${String(i)}` });
  }

  assert.equal(cm.get(1).length, max);
  assert.equal(cm.totalMessages(), max);

  cm.destroy();
});

void test("ConversationManager should track messages correctly during pruning", () => {
  const cm = new ConversationManager();

  cm.append(1, { role: "user", content: "staying" });
  cm.append(2, { role: "user", content: "expiring" });
  cm.append(2, { role: "assistant", content: "bye" });

  assert.equal(cm.totalMessages(), 3);

  // Access private to force expiration
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
  const c = cm as any;
  const entries = c.conversations;
  const entry2 = entries.get(2);
  entry2.lastActivity = Date.now() - 40 * 60_000; // Over 30 min TTL

  c.pruneStale();
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */

  assert.equal(cm.totalMessages(), 1);
  assert.equal(cm.get(1).length, 1);
  assert.equal(cm.get(2).length, 0);

  cm.destroy();
});
