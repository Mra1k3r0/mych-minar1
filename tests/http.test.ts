import { describe, it } from "node:test";
import assert from "node:assert";
import { HttpRequestError } from "../src/services/http/undici.js";

void describe("HttpRequestError", () => {
  void it("should include url and status in message", () => {
    const err = new HttpRequestError("Failed", {
      url: "https://api.example.com",
      status: 500,
    });
    assert.ok(err.message.includes("https://api.example.com"));
    assert.ok(err.message.includes("500"));
    assert.ok(err.message.includes("Failed"));
  });

  void it("should handle missing status", () => {
    const err = new HttpRequestError("Timeout", {
      url: "https://api.example.com",
    });
    assert.ok(err.message.includes("https://api.example.com"));
    assert.ok(err.message.includes("Timeout"));
    assert.strictEqual(err.status, undefined);
  });
});
