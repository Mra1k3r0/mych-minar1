import { config } from "../../config.js";
import { sendRichText } from "../../services/telegram/rich.js";
import { commandRegistry } from "../registry.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${String(h)}h ${String(m)}m`;
  if (m > 0) return `${String(m)}m ${String(r)}s`;
  return `${String(r)}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "n/a";
  const abs = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let u = 0;
  let v = abs;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const sign = bytes < 0 ? "-" : "";
  const fixed = u === 0 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2);
  return `${sign}${fixed} ${units[u]}`;
}

function diskStatsForCwd(): { total: number; free: number } | null {
  const anyFs = fs as unknown as {
    statfsSync?: (p: string) => { bsize: number; blocks: number; bfree: number };
  };
  if (typeof anyFs.statfsSync !== "function") return null;
  try {
    const cwd = process.cwd();
    const root = path.parse(cwd).root || cwd;
    const s = anyFs.statfsSync(root);
    const total = s.bsize * s.blocks;
    const free = s.bsize * s.bfree;
    if (!Number.isFinite(total) || !Number.isFinite(free)) return null;
    return { total, free };
  } catch {
    return null;
  }
}

function safeWebhookUrl(configUrl: string | undefined): string | null {
  const v = configUrl?.trim();
  if (!v) return null;
  return v;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function providerDocsUrl(): string | null {
  if (config.llm.provider === "anthropic") return "https://docs.anthropic.com/";
  const base = config.llm.baseUrl.toLowerCase();
  if (base.includes("groq.com")) return "https://console.groq.com/docs";
  if (base.includes("openai.com")) return "https://platform.openai.com/docs";
  return null;
}

function modelRefUrl(): string | null {
  const providerDocs = providerDocsUrl();
  if (!providerDocs) return null;
  const model = config.llm.model.toLowerCase();
  if (providerDocs.includes("groq.com")) return "https://console.groq.com/docs/models";
  if (providerDocs.includes("openai.com") && model.startsWith("gpt")) {
    return "https://platform.openai.com/docs/models";
  }
  if (providerDocs.includes("anthropic.com") && model.includes("claude")) {
    return "https://docs.anthropic.com/en/docs/models-overview";
  }
  return providerDocs;
}

export const CMD_BOTINFO = commandRegistry.register({
  name: "botinfo",
  description: "Show bot runtime information",
  group: "core",
  cooldownSeconds: 3,
  run: async (gram) => {
    const started = Date.now();
    const startedUptime = process.uptime();
    const me = await gram.api.getMe();

    let webhookUrl: string | null = null;
    if (config.bot.transport === "webhook") {
      try {
        const info = await gram.api.getWebhookInfo();
        const urlValue = info["url"];
        const url = typeof urlValue === "string" ? urlValue : undefined;
        webhookUrl = safeWebhookUrl(url);
      } catch {
        webhookUrl = null;
      }
    }

    const transportLabel =
      config.bot.transport === "webhook"
        ? webhookUrl
          ? `webhook`
          : `webhook (domain not set) / dynamic`
        : "polling";

    const cmdCount = commandRegistry.all().length;
    const osLine = `${os.platform()} ${os.release()} (${process.arch})`;
    const uptimeLine = formatUptime(startedUptime);
    const elapsedMs = Date.now() - started;
    const botHandle = me.username ? `@${me.username}` : "unknown";
    const cpu0 = os.cpus()[0];
    const cpuModel = cpu0.model.trim() || "unknown";
    const cores = os.cpus().length;
    const load = os.loadavg();

    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const procMem = process.memoryUsage();

    const disk = diskStatsForCwd();
    const diskTotal = disk ? disk.total : null;
    const diskFree = disk ? disk.free : null;
    const diskUsed = diskTotal !== null && diskFree !== null ? diskTotal - diskFree : null;

    const botLink = me.username
      ? `<a href="https://t.me/${encodeURIComponent(me.username)}">@${escapeHtml(me.username)}</a>`
      : escapeHtml(botHandle);
    const webhookLink = webhookUrl
      ? `<a href="${escapeHtml(webhookUrl)}">${escapeHtml(webhookUrl)}</a>`
      : "unset";
    const diskLine =
      diskTotal !== null && diskFree !== null && diskUsed !== null
        ? `${formatBytes(diskUsed)} used / ${formatBytes(diskTotal)} total (${formatBytes(diskFree)} available)`
        : "n/a";
    const providerUrl = providerDocsUrl();
    const modelUrl = modelRefUrl();
    const providerLabel = escapeHtml(config.llm.provider);
    const modelLabel = escapeHtml(config.llm.model);
    const providerHtml = providerUrl
      ? `<a href="${escapeHtml(providerUrl)}"><code>${providerLabel}</code></a>`
      : `<code>${providerLabel}</code>`;
    const modelHtml = modelUrl
      ? `<a href="${escapeHtml(modelUrl)}"><code>${modelLabel}</code></a>`
      : `<code>${modelLabel}</code>`;

    const html = [
      "<b>🤖 Bot Info</b>",
      "",
      "<b>Identity</b>",
      "• name: minar1",
      `• bot: ${botLink}`,
      `• id: <code>${String(me.id)}</code>`,
      "",
      "<b>Runtime</b>",
      `• node: <code>${escapeHtml(process.version)}</code>`,
      `• os: ${escapeHtml(osLine)}`,
      `• uptime: ${escapeHtml(uptimeLine)}`,
      `• cmd count: ${String(cmdCount)}`,
      `• cpu: <code>${escapeHtml(cpuModel)}</code>`,
      `• cores: ${String(cores)}`,
      `• load: ${escapeHtml(load.map((v) => v.toFixed(2)).join(" / "))}`,
      `• ram: ${escapeHtml(formatBytes(memUsed))} used / ${escapeHtml(formatBytes(memTotal))} total (${escapeHtml(formatBytes(memFree))} available)`,
      `• proc mem: rss ${escapeHtml(formatBytes(procMem.rss))} | heap ${escapeHtml(formatBytes(procMem.heapUsed))} / ${escapeHtml(formatBytes(procMem.heapTotal))}`,
      `• rom: ${escapeHtml(diskLine)}`,
      "• gpu: n/a",
      "",
      "<b>LLM</b>",
      `• provider: ${providerHtml}`,
      `• model: ${modelHtml}`,
      `• low token: ${escapeHtml(config.bot.lowTokenMode)}`,
      "",
      "<b>Transport</b>",
      `• mode: ${escapeHtml(transportLabel)}`,
      `• webhook url: ${webhookLink}`,
      `• request latency (botinfo): ~${String(elapsedMs)}ms`,
    ].join("\n");

    const fallback = [
      "🤖 **Bot Info**",
      "",
      "**Identity**",
      "• name: minar1",
      `• bot: ${botHandle}`,
      `• id: ${String(me.id)}`,
      "",
      "**Runtime**",
      `• node: ${process.version}`,
      `• os: ${osLine}`,
      `• uptime: ${uptimeLine}`,
      `• cmd count: ${String(cmdCount)}`,
      `• cpu: ${cpuModel}`,
      `• cores: ${String(cores)}`,
      `• load: ${load.map((v) => v.toFixed(2)).join(" / ")}`,
      `• ram: ${formatBytes(memUsed)} used / ${formatBytes(memTotal)} total (${formatBytes(memFree)} available)`,
      `• proc mem: rss ${formatBytes(procMem.rss)} | heap ${formatBytes(procMem.heapUsed)} / ${formatBytes(procMem.heapTotal)}`,
      `• rom: ${diskLine}`,
      "• gpu: n/a",
      "",
      "**LLM**",
      `• provider: ${config.llm.provider}`,
      `• model: ${config.llm.model}`,
      `• low token: ${config.bot.lowTokenMode}`,
      "",
      "**Transport**",
      `• mode: ${transportLabel}`,
      `• webhook url: ${webhookUrl ?? "unset"}`,
      `• request latency (botinfo): ~${String(elapsedMs)}ms`,
    ].join("\n");

    if (gram.chatId) {
      try {
        await gram.api.sendMessage({
          chat_id: gram.chatId,
          text: html,
          parse_mode: "HTML",
          ...(gram.message?.message_id !== undefined
            ? { reply_to_message_id: gram.message.message_id }
            : {}),
        });
        return;
      } catch {
        // fallback below
      }
    }

    await sendRichText(gram, fallback);
  },
});
