/**
 * Prompt layering inspired by claude-code's buildEffectiveSystemPrompt.
 * We keep it simple: override replaces base, append is always added.
 */

export function buildEffectiveSystemPrompt(opts: {
  defaultPrompt: string;
  overridePrompt?: string;
  appendPrompt?: string;
}): string {
  const base = (
    opts.overridePrompt && opts.overridePrompt.trim().length > 0
      ? opts.overridePrompt
      : opts.defaultPrompt
  ).trim();

  const append = opts.appendPrompt?.trim();
  if (!append) return base;
  return `${base}\n\n${append}`;
}
