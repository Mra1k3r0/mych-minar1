import "./setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { guardMathExpression } from "../src/utils/security.js";

void test("guardMathExpression should allow safe expressions", () => {
  const result = guardMathExpression("1 + 1");
  assert.equal(result.ok, true);
});

void test("guardMathExpression should block long expressions", () => {
  const longExpr = "1".repeat(201);
  const result = guardMathExpression(longExpr);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /too long/i);
});

void test("guardMathExpression should block suspicious keywords", () => {
  const keywords = [
    "constructor",
    "__proto__",
    "prototype",
    "process",
    "require",
    "function",
    "eval",
    "return",
    "this",
    "fUnCtIoN",
  ];
  for (const kw of keywords) {
    const result = guardMathExpression(`1 + ${kw}`);
    assert.equal(result.ok, false, `Failed to block ${kw}`);
    assert.match(result.error ?? "", /suspicious keywords/i);
  }
});
