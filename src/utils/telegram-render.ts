function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isLikelyRealCode(raw: string): boolean {
  // Signals for actual code snippets
  return /[{};]|=>|\b(class|function|const|let|var|import|export|return|if|for|while)\b/.test(raw);
}

function isCommandListBlock(raw: string): boolean {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  // command-like line: "/id - desc", "- /help", "`/ask`"
  const commandLineCount = lines.filter((l) =>
    /^[-*•]?\s*`?\/[a-zA-Z0-9_]+`?(?:\s*[-:]\s*.+)?$/.test(l),
  ).length;

  const commandTokenCount = (raw.match(/\/[a-zA-Z0-9_]+/g) ?? []).length;
  const ratio = commandLineCount / lines.length;
  return commandTokenCount >= 2 && ratio >= 0.6 && !isLikelyRealCode(raw);
}

/**
 * Convert common markdown to Telegram HTML parse mode.
 * Safer than MarkdownV2 when model output is messy.
 */
export function renderTelegramRichText(input: string): string {
  const codeBlocks: string[] = [];
  let text = input;

  text = text.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_f, _lang, code) => {
    const raw = String(code).replace(/\n$/, "");

    // If this looks like a command list, keep as normal text so /commands are clickable.
    if (isCommandListBlock(raw)) {
      return `\n${raw}\n`;
    }

    // Avoid `_` in tokens; markdown italics transforms can corrupt token text.
    const token = `@@TGCODEBLOCK${String(codeBlocks.length)}@@`;
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
  text = text.replace(/_([^\n_]+)_/g, "<i>$1</i>");
  text = text.replace(/`/g, "");

  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`@@TGCODEBLOCK${String(i)}@@`, codeBlocks[i]);
  }
  // Safety: never leak unresolved placeholder tokens to end users.
  text = text.replace(/@@TG[A-Z0-9_]+@@/g, "");

  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}
