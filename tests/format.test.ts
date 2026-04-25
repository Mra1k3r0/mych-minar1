import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, truncate } from "../src/utils/format.js";

void test("truncate should keep short text unchanged", () => {
  assert.equal(truncate("hello", 10), "hello");
});

void test("truncate should shorten long text with ellipsis", () => {
  assert.equal(truncate("hello world", 8), "hello...");
});

void test("formatDuration should produce compact uptime text", () => {
  assert.equal(formatDuration(3_661_000), "1h 1m 1s");
});
