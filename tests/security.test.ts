import "./setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { guardMathExpression, sanitizeUrl } from "../src/utils/security.js";

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
    "toString",
    "valueOf",
  ];
  for (const kw of keywords) {
    const result = guardMathExpression(`1 + ${kw}`);
    assert.equal(result.ok, false, `Failed to block ${kw}`);
    assert.match(result.error ?? "", /suspicious keywords/i);
  }
});

void test("guardMathExpression should block brackets", () => {
  const cases = ['1["constructor"]', "2[0]", "a[b]"];
  for (const c of cases) {
    const result = guardMathExpression(c);
    assert.equal(result.ok, false, `Failed to block ${c}`);
    assert.match(result.error ?? "", /brackets/i);
  }
});

void test("sanitizeUrl should mask sensitive query parameters", () => {
  const urls = [
    "https://api.example.com/data?api_key=secret123",
    "https://api.example.com/data?apikey=secret123",
    "https://api.example.com/data?key=secret123",
    "https://api.example.com/data?token=secret123",
    "https://api.example.com/data?auth=secret123",
    "https://api.example.com/data?secret=secret123",
    "https://api.example.com/data?API_KEY=secret123",
    "https://api.example.com/data?access_token=secret123",
    "https://api.example.com/data?session=secret123",
    "https://api.example.com/data?sid=secret123",
    "https://api.example.com/data?password=secret123",
    "https://api.example.com/data?pwd=secret123",
    "https://api.example.com/data?passwd=secret123",
  ];

  for (const url of urls) {
    const sanitized = sanitizeUrl(url);
    assert.ok(
      sanitized.includes("[redacted]") || sanitized.includes("%5Bredacted%5D"),
      `Failed to mask ${url}`,
    );
    assert.ok(!sanitized.includes("secret123"), `Failed to remove secret from ${url}`);
  }
});

void test("sanitizeUrl should mask Telegram bot tokens", () => {
  const url = "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage";
  const sanitized = sanitizeUrl(url);
  assert.ok(sanitized.includes("/bot[redacted]/"), `Failed to mask Telegram token in ${url}`);
  assert.ok(!sanitized.includes("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"), "Failed to remove token");
});

void test("sanitizeUrl should mask Basic Auth credentials", () => {
  const url = "https://user:password@example.com/api";
  const sanitized = sanitizeUrl(url);
  assert.ok(
    sanitized.includes("[redacted]:[redacted]") ||
      sanitized.includes("%5Bredacted%5D:%5Bredacted%5D"),
    "Should mask user and password in authority",
  );
  assert.ok(!sanitized.includes("user:password"), "Should remove raw credentials");
});

void test("sanitizeUrl should preserve non-sensitive parameters", () => {
  const url = "https://api.example.com/data?query=hello&api_key=secret";
  const sanitized = sanitizeUrl(url);
  assert.ok(sanitized.includes("query=hello"), "Should preserve query parameter");
  assert.ok(
    sanitized.includes("api_key=[redacted]") || sanitized.includes("api_key=%5Bredacted%5D"),
    "Should mask api_key parameter",
  );
});

void test("sanitizeUrl should handle relative or non-parseable URLs", () => {
  const relative = "/bot123:abc/sendMessage?api_key=secret";
  const sanitized = sanitizeUrl(relative);
  assert.ok(sanitized.includes("/bot[redacted]/"), "Should mask bot token in relative path");
  assert.ok(sanitized.includes("api_key=[redacted]"), "Should mask api_key in relative path");
});

void test("sanitizeUrl should use exact key matching for parameters", () => {
  const url = "https://api.example.com/data?monkey=true&key=secret";
  const sanitized = sanitizeUrl(url);
  assert.ok(sanitized.includes("monkey=true"), "Should not mask unrelated 'monkey' parameter");
  assert.ok(
    sanitized.includes("key=[redacted]") || sanitized.includes("key=%5Bredacted%5D"),
    "Should mask exact 'key' parameter",
  );
});
