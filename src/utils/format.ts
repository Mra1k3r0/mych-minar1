export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

export function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

export function codeBlock(text: string, lang = ""): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

export function bold(text: string): string {
  return `*${text}*`;
}

export function italic(text: string): string {
  return `_${text}_`;
}

export function mono(text: string): string {
  return `\`${text}\``;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0) parts.push(`${String(minutes)}m`);
  parts.push(`${String(seconds)}s`);
  return parts.join(" ");
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function progressBar(current: number, max: number, width = 10): string {
  const ratio = Math.min(current / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = Math.round(ratio * 100);
  return `${bar} ${String(pct)}%`;
}
