export interface CommandMetric {
  name: string;
  total: number;
  ok: number;
  failed: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  lastError?: string;
}

interface CommandMetricState {
  total: number;
  ok: number;
  failed: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  lastError?: string;
}

export class CommandMetrics {
  private startedAt = Date.now();
  private byCommand = new Map<string, CommandMetricState>();

  record(name: string, latencyMs: number, ok: boolean, error?: unknown): void {
    const key = name.trim().toLowerCase();
    const prev = this.byCommand.get(key) ?? {
      total: 0,
      ok: 0,
      failed: 0,
      totalLatencyMs: 0,
      lastLatencyMs: 0,
    };
    prev.total += 1;
    prev.totalLatencyMs += latencyMs;
    prev.lastLatencyMs = latencyMs;
    if (ok) {
      prev.ok += 1;
      prev.lastError = undefined;
    } else {
      prev.failed += 1;
      if (error instanceof Error) {
        prev.lastError = error.message;
      } else if (typeof error === "string") {
        prev.lastError = error;
      } else if (
        typeof error === "number" ||
        typeof error === "boolean" ||
        typeof error === "bigint"
      ) {
        prev.lastError = String(error);
      } else {
        prev.lastError = "unknown";
      }
    }
    this.byCommand.set(key, prev);
  }

  snapshot(): {
    uptimeMs: number;
    totalCalls: number;
    totalFailed: number;
    commands: CommandMetric[];
  } {
    const commands: CommandMetric[] = [];
    let totalCalls = 0;
    let totalFailed = 0;
    for (const [name, st] of this.byCommand.entries()) {
      totalCalls += st.total;
      totalFailed += st.failed;
      commands.push({
        name,
        total: st.total,
        ok: st.ok,
        failed: st.failed,
        avgLatencyMs: st.total > 0 ? Math.round(st.totalLatencyMs / st.total) : 0,
        lastLatencyMs: st.lastLatencyMs,
        ...(st.lastError ? { lastError: st.lastError } : {}),
      });
    }
    commands.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return {
      uptimeMs: Date.now() - this.startedAt,
      totalCalls,
      totalFailed,
      commands,
    };
  }
}
