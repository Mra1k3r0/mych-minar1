import "./setup.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTelegramRichText } from "@mra1k3r0/gramora";

void describe("renderTelegramRichText", () => {
  void it("should escape HTML and render bold/italic", () => {
    const input = "Hello **world**, *this* is a _test_ and __bold__ too.";
    const expected = "Hello <b>world</b>, <i>this</i> is a <i>test</i> and <b>bold</b> too.";
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  void it("should handle code blocks and escape HTML inside them", () => {
    const input = 'Here is code:\n```typescript\nconsole.log("<test>");\n```';
    const expected = 'Here is code:\n<pre><code>console.log("&lt;test&gt;");</code></pre>';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  void it("should handle inline code", () => {
    const input = "Use `console.log` for debugging.";
    const expected = "Use <code>console.log</code> for debugging.";
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  void it("should leave command lists unformatted", () => {
    const input = "Commands:\n```\n/help - show help\n/start - start bot\n/id - get id\n```";
    const expected = "Commands:\n\n/help - show help\n/start - start bot\n/id - get id\n";
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  void it("should handle multiple code blocks", () => {
    const input = "First:\n```\na\n```\nSecond:\n```\nb\n```";
    const expected = "First:\n<pre><code>a</code></pre>\nSecond:\n<pre><code>b</code></pre>";
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  void it("should not leak placeholder artifacts", () => {
    const input = "User said: @@TGCODEBLOCK0@@ and then code:\n```\nreal code\n```";
    const result = renderTelegramRichText(input);
    assert.ok(!result.includes("@@TG"), "Should not contain placeholder artifacts");
    assert.ok(
      result.includes("<pre><code>real code</code></pre>"),
      "Should contain rendered code block",
    );
  });

  void it("should handle many code blocks (stress test)", () => {
    const count = 60;
    const input = Array.from({ length: count }, (_, i) => {
      const idx = String(i);
      return `Block ${idx}:\n\`\`\`\ncode ${idx}\n\`\`\``;
    }).join("\n");
    const result = renderTelegramRichText(input);
    for (let i = 0; i < count; i++) {
      const idx = String(i);
      assert.ok(result.includes(`Block ${idx}:`), `Should contain label for block ${idx}`);
      assert.ok(
        result.includes(`<pre><code>code ${idx}</code></pre>`),
        `Should contain rendered code for block ${idx}`,
      );
    }
  });
});
