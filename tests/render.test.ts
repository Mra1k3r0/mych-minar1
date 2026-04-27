import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderTelegramRichText } from '../src/utils/telegram-render.js';

describe('renderTelegramRichText', () => {
  it('should escape HTML and render bold/italic', () => {
    const input = 'Hello **world**, *this* is a _test_ and __bold__ too.';
    const expected = 'Hello <b>world</b>, <i>this</i> is a <i>test</i> and <b>bold</b> too.';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  it('should handle code blocks and escape HTML inside them', () => {
    const input = 'Here is code:\n```typescript\nconsole.log("<test>");\n```';
    const expected = 'Here is code:\n<pre><code>console.log("&lt;test&gt;");</code></pre>';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  it('should handle inline code', () => {
    const input = 'Use `console.log` for debugging.';
    const expected = 'Use <code>console.log</code> for debugging.';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  it('should leave command lists unformatted', () => {
    const input = 'Commands:\n```\n/help - show help\n/start - start bot\n/id - get id\n```';
    const expected = 'Commands:\n\n/help - show help\n/start - start bot\n/id - get id\n';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });

  it('should handle multiple code blocks', () => {
    const input = 'First:\n```\na\n```\nSecond:\n```\nb\n```';
    const expected = 'First:\n<pre><code>a</code></pre>\nSecond:\n<pre><code>b</code></pre>';
    assert.strictEqual(renderTelegramRichText(input), expected);
  });
});
