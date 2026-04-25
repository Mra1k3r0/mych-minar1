import assert from "node:assert/strict";
import test from "node:test";
import { GroqRateLimiter } from "../src/services/rate-limiter.js";

void test("GroqRateLimiter should track requests and tokens correctly", () => {
  const limiter = new GroqRateLimiter({
    requestsPerMinute: 10,
    requestsPerDay: 100,
    tokensPerMinute: 1000,
    tokensPerDay: 10000,
  });

  assert.equal(limiter.acquire(), true);
  limiter.record(100);

  const status = limiter.status();
  assert.equal(status.minuteRequests.used, 1);
  assert.equal(status.minuteTokens.used, 100);
  assert.equal(status.dailyRequests.used, 1);
  assert.equal(status.dailyTokens.used, 100);
  assert.equal(status.canProceed, true);
});

void test("GroqRateLimiter should hit rate limits", () => {
  const limiter = new GroqRateLimiter({
    requestsPerMinute: 2,
    requestsPerDay: 100,
    tokensPerMinute: 1000,
    tokensPerDay: 10000,
  });

  assert.equal(limiter.acquire(), true);
  limiter.record(100);
  assert.equal(limiter.acquire(), true);
  limiter.record(100);

  // Third request should hit RPM limit
  assert.equal(limiter.acquire(), false);
  const status = limiter.status();
  assert.equal(status.canProceed, false);
  assert.equal(status.minuteRequests.used, 2);
});

void test("GroqRateLimiter should correctly update running totals when pruning", () => {
  const limiter = new GroqRateLimiter({
    requestsPerMinute: 10,
    requestsPerDay: 100,
    tokensPerMinute: 1000,
    tokensPerDay: 10000,
  });

  // Accessing private members for testing pruning logic without waiting
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
  const l = limiter as any;
  const now = Date.now();

  l.record(100);
  l.minute.entries[0].timestamp = now - 61_000; // Force expire in minute window
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */

  const status = limiter.status();
  assert.equal(status.minuteRequests.used, 0, "Minute requests should be pruned");
  assert.equal(status.minuteTokens.used, 0, "Minute tokens should be pruned");
  assert.equal(status.dailyRequests.used, 1, "Daily requests should NOT be pruned");
  assert.equal(status.dailyTokens.used, 100, "Daily tokens should NOT be pruned");
});
