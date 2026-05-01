function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isLikelyRealCode(raw: string): boolean {
  // Signals for actual code snippets
  return /[{};]|=>|\b(class|function|const|let|var|import|export|return|if|for|while)\b/.test(raw);
}

const COMMAND_LINE_RE = /^[-*•]?\s*`?\/[a-zA-Z0-9_]+`?(?:\s*[-:]\s*.+)?$/;
const COMMAND_TOKEN_RE = /\/[a-zA-Z0-9_]+/g;

function isCommandListBlock(raw: string): boolean {
  // optimization: early exit for non-command blocks or actual code
  if (isLikelyRealCode(raw)) return false;

  const tokens = raw.match(COMMAND_TOKEN_RE);
  if (!tokens || tokens.length < 2) return false;

  const lines = raw.split("\n");
  let commandLineCount = 0;
  let totalNonEmptyLines = 0;

  // optimization: line-by-line check only if token count passes
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalNonEmptyLines++;
    if (COMMAND_LINE_RE.test(trimmed)) {
      commandLineCount++;
    }
  }

  if (totalNonEmptyLines === 0) return false;
  const ratio = commandLineCount / totalNonEmptyLines;
  return ratio >= 0.6;
}

/**
 * Convert common markdown to Telegram HTML parse mode.
 * Safer than MarkdownV2 when model output is messy.
 */
export function renderTelegramRichText(input: string): string {
  const codeBlocks: string[] = [];
  let text = input;

  // unique prefix per call to avoid collision with user input or other code blocks
  const callId = Math.random().toString(36).slice(2, 8);

  text = text.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_f, _lang, code) => {
    const raw = String(code).replace(/\n$/, "");

    // If this looks like a command list, keep as normal text so /commands are clickable.
    if (isCommandListBlock(raw)) {
      return `\n${raw}\n`;
    }

    // Use unique marker without underscores to avoid collision with italic regex
    const token = `@@TGCODEBLOCK${callId}X${String(codeBlocks.length)}@@`;
    codeBlocks.push(`<pre><code>${escapeHtml(raw)}</code></pre>`);
    return token;
  });
  text = text.replace(/```+/g, "");
  text = escapeHtml(text);

  // Keep /commands clickable: don't wrap bot commands in <code>.
  text = text.replace(/`([^`\n]+)`/g, (_full, inner) => {
    const raw = String(inner).trim();
    // unwrap only pure command-like inline content, keep real inline code as <code>
    if (/^(?:\/[a-zA-Z0-9_]+(?:\s*[-:]\s*.+)?|[-*•]\s*\/[a-zA-Z0-9_]+.*)$/.test(raw)) return raw;
    return `<code>${raw}</code>`;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/__([^_]+)__/g, "<b>$1</b>");
  text = text.replace(/\*([^\n*]+)\*/g, "<i>$1</i>");
  text = text.replace(/_([^\n_]+)_/g, (match) => {
    // If it looks like our placeholder, don't italicize it yet
    if (match.startsWith(`_@@TGCODEBLOCK${callId}X`) && match.endsWith("_")) return match;
    return `<i>${match.slice(1, -1)}</i>`;
  });
  text = text.replace(/`/g, "");

  // optimization: single pass replacement for all code block placeholders
  const placeholderRegex = new RegExp(`@@TGCODEBLOCK${callId}X(\\d+)@@`, "g");
  text = text.replace(placeholderRegex, (_, index) => codeBlocks[Number(index)] ?? "");

  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}
