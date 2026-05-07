import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import net, { type Socket } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import tls from "node:tls";
import { FetchBytes } from "./http/undici.js";
import { logger } from "./observability/logger.js";

type Artifact = { name: string; needsChmod: boolean };
type ArchiveArtifact = { archiveName: string; binName: string; needsChmod: boolean };

const CLOUDFLARED_VERSION_PATH = "latest";
const GITHUB_BASE = `https://github.com/cloudflare/cloudflared/releases/${CLOUDFLARED_VERSION_PATH}/download`;
const NGROK_BASE = "https://bin.equinox.io/c/bNyj1mQVY4c";
const LOCALEXPOSE_DEFAULT_BASES = [
  "https://api.localxpose.io/api/v2/downloads",
  "https://api.localxpose.io/api/downloads",
] as const;
const URL_WAIT_TIMEOUT_MS = 30_000;
const LOCALTUNNEL_INFO_RETRY_MS = 1_000;
const LOCALTUNNEL_TCP_KEEPALIVE_INITIAL_DELAY_MS = 15_000;

export type TunnelProvider = "localtunnel" | "cloudflared" | "ngrok" | "localexpose";
export type TunnelOptions = {
  localtunnel?: {
    host?: string;
    subdomain?: string;
    localHttps?: boolean;
  };
  cloudflared?: {
    binaryPath?: string;
  };
  ngrok?: {
    authtoken?: string;
    binaryPath?: string;
  };
  localexpose?: {
    authToken?: string;
    binaryPath?: string;
    region?: string;
    subdomain?: string;
    reservedDomain?: string;
  };
};
export type ManagedTunnel = {
  provider: TunnelProvider;
  getURL: () => Promise<string>;
  close: () => Promise<void>;
};

function resolveBinaryPathOverride(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.toLowerCase() === "auto") return undefined;
  return value;
}

function artifactForPlatform(): Artifact | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32") {
    if (a === "x64") return { name: "cloudflared-windows-amd64.exe", needsChmod: false };
    if (a === "arm64") return { name: "cloudflared-windows-arm64.exe", needsChmod: false };
    return null;
  }
  if (p === "darwin") {
    if (a === "arm64") return { name: "cloudflared-darwin-arm64", needsChmod: true };
    if (a === "x64") return { name: "cloudflared-darwin-amd64", needsChmod: true };
    return null;
  }
  if (p === "linux") {
    if (a === "x64") return { name: "cloudflared-linux-amd64", needsChmod: true };
    if (a === "arm64") return { name: "cloudflared-linux-arm64", needsChmod: true };
    return null;
  }
  return null;
}

function ngrokArtifactForPlatform(): ArchiveArtifact | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32") {
    if (a === "x64") {
      return {
        archiveName: "ngrok-v3-stable-windows-amd64.zip",
        binName: "ngrok.exe",
        needsChmod: false,
      };
    }
    if (a === "arm64") {
      return {
        archiveName: "ngrok-v3-stable-windows-arm64.zip",
        binName: "ngrok.exe",
        needsChmod: false,
      };
    }
    return null;
  }
  if (p === "darwin") {
    if (a === "x64")
      return {
        archiveName: "ngrok-v3-stable-darwin-amd64.zip",
        binName: "ngrok",
        needsChmod: true,
      };
    if (a === "arm64")
      return {
        archiveName: "ngrok-v3-stable-darwin-arm64.zip",
        binName: "ngrok",
        needsChmod: true,
      };
    return null;
  }
  if (p === "linux") {
    if (a === "x64")
      return {
        archiveName: "ngrok-v3-stable-linux-amd64.zip",
        binName: "ngrok",
        needsChmod: true,
      };
    if (a === "arm64")
      return {
        archiveName: "ngrok-v3-stable-linux-arm64.zip",
        binName: "ngrok",
        needsChmod: true,
      };
    return null;
  }
  return null;
}

function localexposeArtifactForPlatform(): ArchiveArtifact | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32") {
    if (a === "x64") {
      return {
        archiveName: "loclx-windows-amd64.zip",
        binName: "loclx.exe",
        needsChmod: false,
      };
    }
    if (a === "arm64") {
      return {
        archiveName: "loclx-windows-arm64.zip",
        binName: "loclx.exe",
        needsChmod: false,
      };
    }
    return null;
  }
  if (p === "darwin") {
    if (a === "x64") {
      return {
        archiveName: "loclx-darwin-amd64.zip",
        binName: "loclx",
        needsChmod: true,
      };
    }
    if (a === "arm64") {
      return {
        archiveName: "loclx-darwin-arm64.zip",
        binName: "loclx",
        needsChmod: true,
      };
    }
    return null;
  }
  if (p === "linux") {
    if (a === "x64") {
      return {
        archiveName: "loclx-linux-amd64.zip",
        binName: "loclx",
        needsChmod: true,
      };
    }
    if (a === "arm64") {
      return {
        archiveName: "loclx-linux-arm64.zip",
        binName: "loclx",
        needsChmod: true,
      };
    }
    return null;
  }
  return null;
}

function cacheDir(): string {
  return path.join(os.homedir(), ".tgbot", "bin");
}

function cachedCloudflaredPath(artifactName: string): string {
  return path.join(cacheDir(), artifactName);
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  const payload = await FetchBytes(url, {
    method: "GET",
    mode: "strict",
    timeoutMs: 60_000,
  });
  await fs.writeFile(tmp, Buffer.from(payload));
  await fs.rename(tmp, dest);
}

async function ensureCloudflaredBinary(options?: TunnelOptions): Promise<string> {
  const explicit = resolveBinaryPathOverride(options?.cloudflared?.binaryPath);
  if (explicit) return explicit;
  const art = artifactForPlatform();
  if (!art) {
    throw new Error(
      `Unsupported OS/arch: ${process.platform} ${process.arch}. Install cloudflared manually and add it to PATH.`,
    );
  }
  const dest = cachedCloudflaredPath(art.name);
  try {
    const st = await fs.stat(dest);
    if (st.size > 1_000_000) {
      if (art.needsChmod) await fs.chmod(dest, 0o755);
      return dest;
    }
  } catch {
    // missing cache file, continue to download
  }
  const url = `${GITHUB_BASE}/${art.name}`;
  logger.info("telegram.webhook_cloudflared_download", {
    artifact: art.name,
    url,
  });
  await downloadToFile(url, dest);
  if (art.needsChmod) await fs.chmod(dest, 0o755);
  return dest;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true, env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

async function extractZipArchive(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (process.platform === "win32") {
    await runCommand("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destDir.replaceAll("'", "''")}' -Force`,
    ]);
    return;
  }
  await runCommand("unzip", ["-o", zipPath, "-d", destDir]);
}

function cachedNgrokPath(binName: string): string {
  return path.join(cacheDir(), binName);
}

async function ensureNgrokBinary(options?: TunnelOptions): Promise<string> {
  const explicit = resolveBinaryPathOverride(options?.ngrok?.binaryPath);
  if (explicit) return explicit;
  const art = ngrokArtifactForPlatform();
  if (!art) {
    throw new Error(
      `Unsupported OS/arch: ${process.platform} ${process.arch}. Install ngrok manually and add it to PATH.`,
    );
  }
  const dest = cachedNgrokPath(art.binName);
  try {
    const st = await fs.stat(dest);
    if (st.size > 1_000_000) {
      if (art.needsChmod) await fs.chmod(dest, 0o755);
      return dest;
    }
  } catch {
    // cache miss, continue download
  }

  const archivePath = path.join(cacheDir(), art.archiveName);
  const url = `${NGROK_BASE}/${art.archiveName}`;
  logger.info("telegram.webhook_ngrok_download", {
    artifact: art.archiveName,
    url,
  });
  await downloadToFile(url, archivePath);
  await extractZipArchive(archivePath, cacheDir());
  if (art.needsChmod) await fs.chmod(dest, 0o755);
  return dest;
}

function cachedLocalexposePath(binName: string): string {
  return path.join(cacheDir(), binName);
}

async function downloadToFileFromCandidates(urls: string[], dest: string): Promise<string> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      await downloadToFile(url, dest);
      return url;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to download from all candidate URLs");
}

async function ensureLocalexposeBinary(options?: TunnelOptions): Promise<string> {
  const explicitBin = resolveBinaryPathOverride(
    process.env.LOCALEXPOSE_BIN?.trim() || process.env.LOCALXPOSE_BIN?.trim(),
  );
  if (explicitBin) return explicitBin;
  const explicitFromConfig = resolveBinaryPathOverride(options?.localexpose?.binaryPath);
  if (explicitFromConfig) return explicitFromConfig;

  const art = localexposeArtifactForPlatform();
  if (!art) {
    throw new Error(
      `Unsupported OS/arch: ${process.platform} ${process.arch}. Install localexpose manually and set LOCALEXPOSE_BIN.`,
    );
  }
  const dest = cachedLocalexposePath(art.binName);
  try {
    const st = await fs.stat(dest);
    if (st.size > 1_000_000) {
      if (art.needsChmod) await fs.chmod(dest, 0o755);
      return dest;
    }
  } catch {
    // cache miss
  }

  const customBase = process.env.LOCALEXPOSE_DOWNLOAD_BASE?.trim();
  const bases = customBase ? [customBase] : [...LOCALEXPOSE_DEFAULT_BASES];
  const candidates = bases.map((base) => `${base.replace(/\/+$/, "")}/${art.archiveName}`);
  const archivePath = path.join(cacheDir(), art.archiveName);

  logger.info("telegram.webhook_localexpose_download", {
    artifact: art.archiveName,
    candidates,
  });

  const selected = await downloadToFileFromCandidates(candidates, archivePath);
  logger.info("telegram.webhook_localexpose_download_ok", {
    artifact: art.archiveName,
    url: selected,
  });

  await extractZipArchive(archivePath, cacheDir());
  if (art.needsChmod) await fs.chmod(dest, 0o755);
  return dest;
}

function stripAnsi(s: string): string {
  return s.replaceAll("\u001b", "");
}

function extractTryCloudflareUrl(line: string): string | null {
  const cleaned = stripAnsi(line);
  const m = cleaned.match(/https:\/\/[^\s"'<>]+\.trycloudflare\.com[^\s"'<>]*/i);
  return m ? m[0] : null;
}

export type CloudflaredTunnel = {
  getURL: () => Promise<string>;
  close: () => Promise<void>;
};

export async function startCloudflaredQuickTunnel(
  localUrl: string,
  options?: TunnelOptions,
): Promise<CloudflaredTunnel> {
  const bin = await ensureCloudflaredBinary(options);
  const child: ChildProcess = spawn(
    bin,
    ["tunnel", "--url", localUrl, "--no-autoupdate", "--transport-loglevel", "fatal"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    },
  );

  let resolvedUrl: string | null = null;
  let resolveUrl: ((value: string) => void) | null = null;
  let rejectUrl: ((reason?: unknown) => void) | null = null;
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });

  const resolveIfFound = (line: string): void => {
    if (resolvedUrl) return;
    const url = extractTryCloudflareUrl(line);
    if (!url) return;
    resolvedUrl = url;
    resolveUrl?.(url);
    resolveUrl = null;
    rejectUrl = null;
  };

  const maybeErrorLog = (line: string): void => {
    resolveIfFound(line);
    const cleaned = stripAnsi(line).trim();
    if (!cleaned) return;
    if (
      /Cannot determine default configuration path/i.test(cleaned) &&
      /config\.ya?ml/i.test(cleaned)
    ) {
      return;
    }
    if (
      /INF Settings:/i.test(cleaned) &&
      !/(failed|unable|cannot|denied|refused|panic|crash|error)/i.test(cleaned)
    ) {
      return;
    }
    if (/(critical|panic|crash|failed|unable|cannot|denied|refused|fatal\b|error)/i.test(cleaned)) {
      logger.warn("telegram.webhook_cloudflared_log", { line: cleaned });
    }
  };

  if (child.stdout) {
    const rlOut = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rlOut.on("line", resolveIfFound);
  }
  if (child.stderr) {
    const rlErr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    rlErr.on("line", maybeErrorLog);
  }

  child.on("error", (err) => {
    if (rejectUrl) rejectUrl(err);
    resolveUrl = null;
    rejectUrl = null;
  });
  child.on("exit", (code, sig) => {
    if (!resolvedUrl) {
      if (rejectUrl) {
        rejectUrl(
          new Error(`cloudflared exited before URL (code=${String(code)} signal=${String(sig)})`),
        );
      }
      resolveUrl = null;
      rejectUrl = null;
    }
  });

  const getURL = async (): Promise<string> => {
    if (resolvedUrl) return resolvedUrl;
    return await Promise.race([
      urlPromise,
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("Timed out waiting for cloudflared tunnel URL."));
        }, URL_WAIT_TIMEOUT_MS);
      }),
    ]);
  };

  const close = (): Promise<void> => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore close errors
    }
    return Promise.resolve();
  };

  return { getURL, close };
}

function extractNgrokUrl(line: string): string | null {
  const cleaned = stripAnsi(line);
  const m = cleaned.match(/https:\/\/[^\s"'<>]+\.ngrok(?:-free)?\.(?:app|dev)[^\s"'<>]*/i);
  return m ? m[0] : null;
}

function extractLocalexposeUrl(line: string): string | null {
  const cleaned = stripAnsi(line);
  const full = cleaned.match(/https:\/\/[^\s"'<>]+\.(?:loclx\.io|localxpose\.io)[^\s"'<>]*/i);
  if (full) return full[0];
  const hostOnly = cleaned.match(/\b([a-z0-9-]+\.(?:loclx\.io|localxpose\.io))\b/i);
  if (hostOnly) return `https://${hostOnly[1]}`;
  return null;
}

async function startNgrokTunnel(localUrl: string, options?: TunnelOptions): Promise<ManagedTunnel> {
  const ngrokBin = await ensureNgrokBinary(options);
  const args = ["http", localUrl, "--log", "stdout"];
  const auth = process.env.NGROK_AUTHTOKEN?.trim() || options?.ngrok?.authtoken?.trim();
  if (auth) {
    args.push("--authtoken", auth);
  }
  const child: ChildProcess = spawn(ngrokBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });

  let resolvedUrl: string | null = null;
  let resolveUrl: ((value: string) => void) | null = null;
  let rejectUrl: ((reason?: unknown) => void) | null = null;
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });

  const resolveIfFound = (line: string): void => {
    if (resolvedUrl) return;
    const url = extractNgrokUrl(line);
    if (!url) return;
    resolvedUrl = url;
    resolveUrl?.(url);
    resolveUrl = null;
    rejectUrl = null;
  };

  if (child.stdout) {
    const rlOut = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rlOut.on("line", resolveIfFound);
  }
  if (child.stderr) {
    const rlErr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    rlErr.on("line", (line) => {
      resolveIfFound(line);
      const cleaned = stripAnsi(line).trim();
      if (/(failed|error|panic|fatal|refused|denied|unable|cannot)/i.test(cleaned)) {
        logger.warn("telegram.webhook_ngrok_log", { line: cleaned });
      }
    });
  }

  child.on("error", (err) => {
    if (rejectUrl) rejectUrl(err);
    resolveUrl = null;
    rejectUrl = null;
  });
  child.on("exit", (code, sig) => {
    if (!resolvedUrl) {
      if (rejectUrl) {
        rejectUrl(
          new Error(`ngrok exited before URL (code=${String(code)} signal=${String(sig)})`),
        );
      }
      resolveUrl = null;
      rejectUrl = null;
    }
  });

  const getURL = async (): Promise<string> => {
    if (resolvedUrl) return resolvedUrl;
    return Promise.race([
      urlPromise,
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("Timed out waiting for ngrok tunnel URL."));
        }, URL_WAIT_TIMEOUT_MS);
      }),
    ]);
  };

  return {
    provider: "ngrok",
    getURL,
    close: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore close errors
      }
      return Promise.resolve();
    },
  };
}

function startLocalexposeTunnel(
  localTarget: string,
  options?: TunnelOptions,
): Promise<ManagedTunnel> {
  return ensureLocalexposeBinary(options).then((bin) => {
    const args = ["tunnel", "--raw-mode", "http", "--to", localTarget];
    const region = options?.localexpose?.region?.trim();
    const subdomain = options?.localexpose?.subdomain?.trim();
    const reservedDomain = options?.localexpose?.reservedDomain?.trim();
    if (region) args.push("--region", region);
    if (subdomain) args.push("--subdomain", subdomain);
    if (reservedDomain) args.push("--reserved-domain", reservedDomain);
    const token =
      process.env.LOCALEXPOSE_AUTH_TOKEN?.trim() ||
      process.env.LOCALXPOSE_AUTH_TOKEN?.trim() ||
      process.env.ACCESS_TOKEN?.trim() ||
      options?.localexpose?.authToken?.trim();
    const childEnv = { ...process.env };
    if (token && token.length > 0) {
      childEnv.ACCESS_TOKEN = token;
    }

    const child: ChildProcess = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: childEnv,
    });

    let resolvedUrl: string | null = null;
    let resolveUrl: ((value: string) => void) | null = null;
    let rejectUrl: ((reason?: unknown) => void) | null = null;
    const recentLines: string[] = [];
    const urlPromise = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });

    const resolveIfFound = (line: string): void => {
      const cleaned = stripAnsi(line).trim();
      if (cleaned) {
        recentLines.push(cleaned);
        if (recentLines.length > 12) recentLines.shift();
      }
      if (resolvedUrl) return;
      const url = extractLocalexposeUrl(line);
      if (!url) return;
      resolvedUrl = url;
      resolveUrl?.(url);
      resolveUrl = null;
      rejectUrl = null;
    };

    if (child.stdout) {
      const rlOut = createInterface({ input: child.stdout, crlfDelay: Infinity });
      rlOut.on("line", resolveIfFound);
    }
    if (child.stderr) {
      const rlErr = createInterface({ input: child.stderr, crlfDelay: Infinity });
      rlErr.on("line", (line) => {
        resolveIfFound(line);
        const cleaned = stripAnsi(line).trim();
        if (/(failed|error|panic|fatal|refused|denied|unable|cannot|auth)/i.test(cleaned)) {
          logger.warn("telegram.webhook_localexpose_log", { line: cleaned });
        }
      });
    }

    child.on("error", (err) => {
      if (rejectUrl) rejectUrl(err);
      resolveUrl = null;
      rejectUrl = null;
    });
    child.on("exit", (code, sig) => {
      if (!resolvedUrl) {
        if (rejectUrl) {
          const hint =
            recentLines.find((line) => /access[_\s-]?token|login|auth/i.test(line)) ??
            (token
              ? null
              : "ACCESS_TOKEN is missing (set LOCALEXPOSE_AUTH_TOKEN or ACCESS_TOKEN).");
          rejectUrl(
            new Error(
              `localexpose exited before URL (code=${String(code)} signal=${String(sig)})${
                hint ? `: ${hint}` : ""
              }`,
            ),
          );
        }
        resolveUrl = null;
        rejectUrl = null;
      }
    });

    const getURL = async (): Promise<string> => {
      if (resolvedUrl) return resolvedUrl;
      return Promise.race([
        urlPromise,
        new Promise<string>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error("Timed out waiting for localexpose tunnel URL."));
          }, URL_WAIT_TIMEOUT_MS);
        }),
      ]);
    };

    return {
      provider: "localexpose",
      getURL,
      close: () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore close errors
        }
        return Promise.resolve();
      },
    };
  });
}

type LocaltunnelInfo = {
  id: string;
  ip?: string;
  port: number;
  url: string;
  max_conn_count?: number;
};

async function requestLocaltunnelInfoOnce(endpoint: string): Promise<LocaltunnelInfo> {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint);
    const client = target.protocol === "https:" ? https : http;
    const req = client.get(
      target,
      {
        headers: { accept: "application/json" },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += String(chunk);
        });
        res.on("end", () => {
          if ((res.statusCode ?? 0) !== 200) {
            reject(new Error(`HTTP ${String(res.statusCode ?? 0)} from ${endpoint}`));
            return;
          }
          try {
            const parsed = JSON.parse(raw) as LocaltunnelInfo;
            resolve(parsed);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on("error", reject);
  });
}

function localtunnelHost(options?: TunnelOptions): URL {
  const raw =
    process.env.WEBHOOK_LOCALTUNNEL_HOST?.trim() ||
    options?.localtunnel?.host?.trim() ||
    "https://localtunnel.me";
  return new URL(raw);
}

async function requestLocaltunnelInfo(
  subdomain?: string,
  options?: TunnelOptions,
): Promise<{
  info: LocaltunnelInfo;
  host: URL;
}> {
  const host = localtunnelHost(options);
  const pathPart = subdomain ? `/${encodeURIComponent(subdomain)}` : "/?new";
  const endpoint = new URL(pathPart, host).toString();
  for (;;) {
    try {
      const data = await requestLocaltunnelInfoOnce(endpoint);
      if (!data.url || typeof data.port !== "number") {
        throw new Error(`localtunnel info response missing fields at ${host.toString()}`);
      }
      return { info: data, host };
    } catch {
      // mirror upstream behavior: keep retrying until server responds
    }
    await new Promise((resolve) => setTimeout(resolve, LOCALTUNNEL_INFO_RETRY_MS));
  }
}

function startLocaltunnel(runtime: {
  port: number;
  tunnelOptions?: TunnelOptions;
}): Promise<ManagedTunnel> {
  const configuredSubdomain = runtime.tunnelOptions?.localtunnel?.subdomain;
  return requestLocaltunnelInfo(
    process.env.WEBHOOK_LOCALTUNNEL_SUBDOMAIN || configuredSubdomain,
    runtime.tunnelOptions,
  ).then((info) => {
    const remoteHost = info.info.ip || info.host.hostname;
    const remotePort = info.info.port;
    const localHost = "127.0.0.1";
    const localPort = runtime.port;
    const maxConn = Math.max(1, info.info.max_conn_count ?? 1);
    const localHttps =
      process.env.WEBHOOK_LOCAL_HTTPS === "true" ||
      runtime.tunnelOptions?.localtunnel?.localHttps === true;
    let closed = false;
    const remotes = new Set<Socket>();
    const locals = new Set<Socket>();
    const lifecycle = new EventEmitter();

    lifecycle.on("error", (err: unknown) => {
      logger.warn("telegram.webhook_localtunnel_socket_error", {
        error: err instanceof Error ? err.message : String(err),
        remoteHost,
        remotePort,
      });
    });

    const connLocal = (remote: Socket): void => {
      if (remote.destroyed) {
        lifecycle.emit("dead");
        return;
      }
      remote.pause();

      const local = localHttps
        ? tls.connect({ host: localHost, port: localPort, rejectUnauthorized: false })
        : net.connect({ host: localHost, port: localPort });

      local.setKeepAlive(true, LOCALTUNNEL_TCP_KEEPALIVE_INITIAL_DELAY_MS);
      local.setNoDelay(true);
      locals.add(local);

      const remoteClose = () => {
        remotes.delete(remote);
        locals.delete(local);
        lifecycle.emit("dead");
        local.end();
      };
      remote.once("close", remoteClose);

      local.once("error", (err: NodeJS.ErrnoException) => {
        locals.delete(local);
        local.end();
        remote.removeListener("close", remoteClose);
        if (err.code !== "ECONNREFUSED") {
          remote.end();
          return;
        }
        setTimeout(() => {
          connLocal(remote);
        }, 1_000);
      });

      local.once("connect", () => {
        lifecycle.emit("open");
        remote.resume();
        remote.pipe(local).pipe(remote);
      });
    };

    const open = () => {
      if (closed) return;
      const remote = net.connect({ host: remoteHost, port: remotePort });
      remotes.add(remote);
      remote.setKeepAlive(true, LOCALTUNNEL_TCP_KEEPALIVE_INITIAL_DELAY_MS);
      remote.setNoDelay(true);
      remote.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ECONNREFUSED") {
          lifecycle.emit(
            "error",
            new Error(
              `connection refused: ${remoteHost}:${String(remotePort)} (check your firewall settings)`,
            ),
          );
        }
        remote.end();
      });
      remote.once("connect", () => {
        connLocal(remote);
      });
      remote.on("data", (chunk: Buffer) => {
        const line = chunk.toString("utf8");
        const match = line.match(/^(\w+)\s+(\S+)/);
        if (!match) return;
        lifecycle.emit("request", { method: match[1], path: match[2] });
      });
    };

    lifecycle.on("dead", () => {
      if (closed) return;
      open();
    });

    for (let i = 0; i < maxConn; i += 1) {
      open();
    }

    return {
      provider: "localtunnel",
      getURL: () => Promise.resolve(info.info.url),
      close: () => {
        closed = true;
        lifecycle.emit("close");
        for (const s of remotes) {
          try {
            s.destroy();
          } catch {
            // ignore socket shutdown errors
          }
        }
        for (const s of locals) {
          try {
            s.destroy();
          } catch {
            // ignore socket shutdown errors
          }
        }
        remotes.clear();
        locals.clear();
        return Promise.resolve();
      },
    };
  });
}

export async function startManagedTunnel(runtime: {
  port: number;
  tunnelProvider?: TunnelProvider;
  tunnelOptions?: TunnelOptions;
}): Promise<ManagedTunnel> {
  const provider = runtime.tunnelProvider ?? "localtunnel";
  switch (provider) {
    case "localtunnel":
      return startLocaltunnel(runtime);
    case "cloudflared": {
      const localUrl = `http://127.0.0.1:${String(runtime.port)}`;
      const t = await startCloudflaredQuickTunnel(localUrl, runtime.tunnelOptions);
      return {
        provider: "cloudflared",
        getURL: t.getURL,
        close: t.close,
      };
    }
    case "ngrok":
      return startNgrokTunnel(`http://127.0.0.1:${String(runtime.port)}`, runtime.tunnelOptions);
    case "localexpose":
      return startLocalexposeTunnel(`127.0.0.1:${String(runtime.port)}`, runtime.tunnelOptions);
  }
}
