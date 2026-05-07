export type PlannerJsonResult = {
  command: string | null;
  args: string;
  confidence: number;
};

export type PlannerActionDecision = {
  mode: "execute" | "chat";
  command?: string;
  args?: string;
  confidence: number;
};

export function parsePlannerIntentJson(raw: string): PlannerJsonResult | null {
  const cleaned = raw.trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as {
      command?: string | null;
      args?: string;
      confidence?: number;
    };
    const command =
      typeof data.command === "string" ? data.command.toLowerCase().replace(/^\//, "") : null;
    const args = typeof data.args === "string" ? data.args.trim() : "";
    const confidence = typeof data.confidence === "number" ? data.confidence : 0;
    return { command, args, confidence };
  } catch {
    return null;
  }
}

export function normalizePlannerActionDecision(
  parsed: PlannerJsonResult | null,
  isKnownCommand: (name: string) => boolean,
): PlannerActionDecision {
  if (!parsed) return { mode: "chat", confidence: 0 };
  if (!parsed.command) return { mode: "chat", confidence: parsed.confidence };
  if (!isKnownCommand(parsed.command)) return { mode: "chat", confidence: parsed.confidence };
  return {
    mode: parsed.confidence >= 0.58 ? "execute" : "chat",
    command: parsed.command,
    args: parsed.args,
    confidence: parsed.confidence,
  };
}

export function pickBestVotedIntent(
  results: Array<PlannerJsonResult | null>,
  isKnownCommand: (name: string) => boolean,
): { command: string; args: string } | null {
  const valid = results.filter((r): r is PlannerJsonResult => !!r);
  if (!valid.length) return null;

  const votes = new Map<string, { count: number; bestConfidence: number; args: string }>();
  for (const result of valid) {
    if (!result.command) continue;
    if (!isKnownCommand(result.command)) continue;
    const prev = votes.get(result.command);
    if (!prev) {
      votes.set(result.command, { count: 1, bestConfidence: result.confidence, args: result.args });
      continue;
    }
    votes.set(result.command, {
      count: prev.count + 1,
      bestConfidence: Math.max(prev.bestConfidence, result.confidence),
      args: result.confidence >= prev.bestConfidence ? result.args : prev.args,
    });
  }

  let best: { command: string; count: number; bestConfidence: number; args: string } | null = null;
  for (const [command, score] of votes.entries()) {
    const candidate = { command, ...score };
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.bestConfidence > best.bestConfidence)
    ) {
      best = candidate;
    }
  }
  if (!best) return null;
  if (best.count < 2 && best.bestConfidence < 0.8) return null;
  if (best.bestConfidence < 0.55) return null;
  return { command: best.command, args: best.args };
}
