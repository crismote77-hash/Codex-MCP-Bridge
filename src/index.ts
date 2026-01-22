#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_CONFIG_PATH, loadConfig } from "./config.js";
import { createStderrLogger, type Logger } from "./logger.js";
import { RateLimiter } from "./limits/rateLimiter.js";
import { DailyTokenBudget } from "./limits/dailyTokenBudget.js";
import { createSharedLimitStore } from "./limits/sharedStore.js";
import { resolveAuth } from "./auth/resolveAuth.js";
import { createMcpServer } from "./server.js";
import { startHttpServer } from "./httpServer.js";
import { runSetupWizard, type SetupWizardOptions } from "./setupWizard.js";
import { redactMeta, redactString } from "./utils/redact.js";
import { expandHome } from "./utils/paths.js";
import { isRecord } from "./utils/typeGuards.js";
import { addTrustedDir, isTrustedCwd } from "./utils/trustDirs.js";
import { applyAutoGitRootDefaults } from "./utils/autoroot.js";
import { runOpenAI } from "./services/openaiClient.js";
import { createErrorLogger, setMcpVersion } from "./services/errorLogger.js";

type CliCommand =
  | {
      kind: "serve";
      configPath?: string;
      transportOverride?: "stdio" | "http";
      httpHost?: string;
      httpPort?: number;
    }
  | { kind: "print-config"; configPath?: string }
  | { kind: "doctor"; configPath?: string; checkApi: boolean }
  | { kind: "setup"; configPath?: string; options: SetupWizardOptions }
  | { kind: "help" }
  | { kind: "version" };

const PROJECT_NAME = "Codex MCP Bridge";
const VERSION_FALLBACK = "0.1.0";

function readPackageInfo(): { name: string; version: string } {
  try {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(distDir, "..", "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return { name: PROJECT_NAME, version: VERSION_FALLBACK };
    }
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return { name: PROJECT_NAME, version: parsed.version ?? VERSION_FALLBACK };
  } catch {
    return { name: PROJECT_NAME, version: VERSION_FALLBACK };
  }
}

function parseArgs(argv: string[]): CliCommand {
  const args = [...argv];
  let configPath: string | undefined;
  let checkApi = false;
  let kind: CliCommand["kind"] = "serve";
  let transportOverride: "stdio" | "http" | undefined;
  let httpHost: string | undefined;
  let httpPort: number | undefined;
  const setupOptions: SetupWizardOptions = {};

  const parseIntArg = (value: string, name: string): number | null => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      process.stderr.write(`Invalid integer for ${name}\n`);
      return null;
    }
    return parsed;
  };

  const parseFloatArg = (
    value: string,
    name: string,
    min: number,
    max: number,
  ): number | null => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      process.stderr.write(`Invalid ${name} (expected ${min}-${max}).\n`);
      return null;
    }
    return parsed;
  };

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--config") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      configPath = value;
      continue;
    }
    if (a === "--check-api") {
      checkApi = true;
      continue;
    }
    if (a === "--print-config") {
      if (kind !== "serve") return { kind: "help" };
      kind = "print-config";
      continue;
    }
    if (a === "--http") {
      if (transportOverride && transportOverride !== "http")
        return { kind: "help" };
      transportOverride = "http";
      continue;
    }
    if (a === "--http-host") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      httpHost = value;
      continue;
    }
    if (a === "--http-port") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535)
        return { kind: "help" };
      httpPort = parsed;
      continue;
    }
    if (a === "--doctor") {
      if (kind !== "serve") return { kind: "help" };
      kind = "doctor";
      continue;
    }
    if (a === "--setup") {
      if (kind !== "serve") return { kind: "help" };
      kind = "setup";
      continue;
    }
    if (a === "--non-interactive") {
      setupOptions.nonInteractive = true;
      continue;
    }
    if (a === "--yes" || a === "-y") {
      setupOptions.acceptDefaults = true;
      continue;
    }
    if (a === "--overwrite") {
      setupOptions.overwrite = true;
      continue;
    }
    if (a === "--merge") {
      setupOptions.merge = true;
      continue;
    }
    if (a === "--dry-run") {
      setupOptions.dryRun = true;
      continue;
    }
    if (a === "--auth") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      if (!["auto", "cli", "api_key"].includes(value)) return { kind: "help" };
      setupOptions.authMode = value as SetupWizardOptions["authMode"];
      continue;
    }
    if (a === "--cli-command") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.cliCommand = value;
      continue;
    }
    if (a === "--cli-auth-path") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.cliAuthPath = value;
      continue;
    }
    if (a === "--model") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.model = value;
      continue;
    }
    if (a === "--api-base-url") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.apiBaseUrl = value;
      continue;
    }
    if (a === "--temperature") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseFloatArg(value, "temperature", 0, 2);
      if (parsed === null) return { kind: "help" };
      setupOptions.temperature = parsed;
      continue;
    }
    if (a === "--max-output-tokens") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseIntArg(value, "max-output-tokens");
      if (parsed === null) return { kind: "help" };
      setupOptions.maxOutputTokens = parsed;
      continue;
    }
    if (a === "--timeout-ms") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseIntArg(value, "timeout-ms");
      if (parsed === null) return { kind: "help" };
      setupOptions.timeoutMs = parsed;
      continue;
    }
    if (a === "--max-input-chars") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseIntArg(value, "max-input-chars");
      if (parsed === null) return { kind: "help" };
      setupOptions.maxInputChars = parsed;
      continue;
    }
    if (a === "--max-requests-per-minute") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseIntArg(value, "max-requests-per-minute");
      if (parsed === null) return { kind: "help" };
      setupOptions.maxRequestsPerMinute = parsed;
      continue;
    }
    if (a === "--max-tokens-per-day") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      const parsed = parseIntArg(value, "max-tokens-per-day");
      if (parsed === null) return { kind: "help" };
      setupOptions.maxTokensPerDay = parsed;
      continue;
    }
    if (a === "--shared-limits-enabled") {
      setupOptions.sharedLimitsEnabled = true;
      continue;
    }
    if (a === "--redis-url") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.redisUrl = value;
      continue;
    }
    if (a === "--redis-key-prefix") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.redisKeyPrefix = value;
      continue;
    }
    if (a === "--api-key-env-var") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.apiKeyEnvVar = value;
      continue;
    }
    if (a === "--api-key-env-var-alt") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.apiKeyEnvVarAlt = value;
      continue;
    }
    if (a === "--api-key-file-env-var") {
      const value = args.shift();
      if (!value) return { kind: "help" };
      setupOptions.apiKeyFileEnvVar = value;
      continue;
    }
    if (a === "--help" || a === "-h") {
      if (kind !== "serve") return { kind: "help" };
      kind = "help";
      continue;
    }
    if (a === "--version" || a === "-v") {
      if (kind !== "serve") return { kind: "help" };
      kind = "version";
      continue;
    }
    if (a === "--stdio") {
      if (transportOverride && transportOverride !== "stdio")
        return { kind: "help" };
      transportOverride = "stdio";
      continue;
    }

    process.stderr.write(`Unknown argument: ${a}\n`);
    process.exit(1);
  }

  if (kind === "doctor") return { kind, configPath, checkApi };
  if (kind === "print-config") return { kind, configPath };
  if (kind === "setup") {
    setupOptions.transport = transportOverride ?? setupOptions.transport;
    if (httpHost) setupOptions.httpHost = httpHost;
    if (httpPort) setupOptions.httpPort = httpPort;
    return { kind, configPath, options: setupOptions };
  }
  if (kind === "help") return { kind };
  if (kind === "version") return { kind };
  return { kind: "serve", configPath, transportOverride, httpHost, httpPort };
}

function printHelp(info: { name: string; version: string }): void {
  process.stdout.write(`${info.name} ${info.version}\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  codex-mcp-bridge --stdio [--config path]\n`);
  process.stdout.write(
    `  codex-mcp-bridge --http [--http-host host] [--http-port port] [--config path]\n`,
  );
  process.stdout.write(
    `  codex-mcp-bridge --setup [--config path] [--non-interactive] [--yes]\n`,
  );
  process.stdout.write(`  codex-mcp-bridge --print-config [--config path]\n`);
  process.stdout.write(
    `  codex-mcp-bridge --doctor [--config path] [--check-api]\n`,
  );
  process.stdout.write(`\nSetup options:\n`);
  process.stdout.write(`  --auth <auto|cli|api_key>\n`);
  process.stdout.write(`  --model <model>\n`);
  process.stdout.write(`  --cli-command <cmd>\n`);
  process.stdout.write(`  --cli-auth-path <path>\n`);
  process.stdout.write(`  --api-base-url <url>\n`);
  process.stdout.write(`  --temperature <0-2>\n`);
  process.stdout.write(`  --max-output-tokens <n>\n`);
  process.stdout.write(`  --timeout-ms <n>\n`);
  process.stdout.write(`  --max-input-chars <n>\n`);
  process.stdout.write(`  --max-requests-per-minute <n>\n`);
  process.stdout.write(`  --max-tokens-per-day <n>\n`);
  process.stdout.write(`  --shared-limits-enabled\n`);
  process.stdout.write(`  --redis-url <url>\n`);
  process.stdout.write(`  --redis-key-prefix <prefix>\n`);
  process.stdout.write(`  --api-key-env-var <name>\n`);
  process.stdout.write(`  --api-key-env-var-alt <name>\n`);
  process.stdout.write(`  --api-key-file-env-var <name>\n`);
  process.stdout.write(`  --overwrite | --merge | --dry-run\n`);
  process.stdout.write(`\n`);
}

const YES_VALUES = new Set(["y", "yes"]);

function resolveConfigPathForWrite(configPath?: string): string {
  return expandHome(configPath ?? DEFAULT_CONFIG_PATH);
}

function openTty(): { input: fs.ReadStream; output: fs.WriteStream } | null {
  const ttyPath = process.platform === "win32" ? "\\\\.\\CON" : "/dev/tty";
  let input: fs.ReadStream | null = null;
  let output: fs.WriteStream | null = null;
  try {
    input = fs.createReadStream(ttyPath, { encoding: "utf8" });
    output = fs.createWriteStream(ttyPath, { encoding: "utf8" });
    return { input, output };
  } catch {
    input?.destroy();
    output?.end();
    return null;
  }
}

async function promptYesNo(message: string): Promise<boolean | null> {
  const tty = openTty();
  if (!tty) return null;
  const rl = createInterface({ input: tty.input, output: tty.output });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return YES_VALUES.has(answer);
  } finally {
    rl.close();
    tty.input.destroy();
    tty.output.end();
  }
}

function writeTrustedDirs(
  logger: Logger,
  configPath: string,
  trustedDirs: string[],
): void {
  const resolvedPath = expandHome(configPath);
  let rawConfig: unknown = {};
  if (fs.existsSync(resolvedPath)) {
    try {
      rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
    } catch (error) {
      logger.error("Failed to parse config file for trusted dirs update", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  const configObj: Record<string, unknown> = isRecord(rawConfig)
    ? { ...rawConfig }
    : {};
  const trustObj: Record<string, unknown> = isRecord(configObj.trust)
    ? { ...(configObj.trust as Record<string, unknown>) }
    : {};

  trustObj.trustedDirs = trustedDirs;
  configObj.trust = trustObj;

  try {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(
      resolvedPath,
      `${JSON.stringify(configObj, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    logger.error("Failed to write trusted dirs to config file", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function maybePromptTrustedDir(
  logger: Logger,
  configPath: string | undefined,
  promptDir: string | undefined,
  trustedDirs: string[],
): Promise<string[] | null> {
  const dir = promptDir?.trim() || process.cwd();
  if (!dir) return null;
  const resolvedDir = path.resolve(expandHome(dir));
  if (isTrustedCwd(resolvedDir, trustedDirs)) return null;

  if (!fs.existsSync(resolvedDir)) {
    logger.warn("Trust prompt skipped (path missing)", { dir: resolvedDir });
    return null;
  }

  const answer = await promptYesNo(
    `Trust directory for Codex CLI git repo checks? ${resolvedDir} (auto --skip-git-repo-check) [y/N] `,
  );
  if (answer === null) {
    logger.info("Trust prompt skipped (no TTY available)", {
      dir: resolvedDir,
    });
    return null;
  }
  if (!answer) {
    logger.info("Trust prompt declined", { dir: resolvedDir });
    return null;
  }

  const updated = addTrustedDir(trustedDirs, resolvedDir);
  if (configPath) {
    writeTrustedDirs(logger, configPath, updated);
  }
  return updated;
}

async function runDoctor(
  configPath?: string,
  checkApi = false,
): Promise<number> {
  const config = loadConfig({ configPath });

  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const nextSteps: string[] = [];
  const timestamp = new Date().toISOString();

  checks.push({
    name: "config_loaded",
    ok: true,
    message: configPath ? `loaded ${configPath}` : "loaded default config",
  });
  checks.push({
    name: "auth_mode",
    ok: true,
    message: config.auth.mode,
  });

  const authPath = expandHome(config.auth.cliAuthPath);
  const hasAuth = fs.existsSync(authPath);
  checks.push({
    name: "codex_auth_path",
    ok: hasAuth,
    message: hasAuth ? authPath : `missing (${authPath})`,
  });

  const cliResult = spawnSync(config.cli.command, ["--version"], {
    encoding: "utf8",
  });
  const cliOk = cliResult.status === 0;
  checks.push({
    name: "codex_cli",
    ok: cliOk,
    message: cliOk ? (cliResult.stdout || "").trim() : "missing on PATH",
  });

  const apiKeyEnv =
    config.auth.apiKey ||
    process.env[config.auth.apiKeyEnvVar] ||
    process.env[config.auth.apiKeyEnvVarAlt];
  const apiKeyFile = process.env[config.auth.apiKeyFileEnvVar];
  let apiKeyForCheck: string | null = apiKeyEnv ?? null;
  let apiKeyCheckError: string | null = null;
  checks.push({
    name: "api_key_present",
    ok: Boolean(apiKeyEnv || apiKeyFile),
    message: apiKeyEnv
      ? `set (${config.auth.apiKeyEnvVar})`
      : apiKeyFile
        ? `set (${config.auth.apiKeyFileEnvVar})`
        : "missing",
  });

  let resolvedOk = true;
  try {
    resolveAuth({
      mode: config.auth.mode,
      cliAuthPath: config.auth.cliAuthPath,
      apiKey: config.auth.apiKey,
      apiKeyEnvVar: config.auth.apiKeyEnvVar,
      apiKeyEnvVarAlt: config.auth.apiKeyEnvVarAlt,
      apiKeyFileEnvVar: config.auth.apiKeyFileEnvVar,
      env: process.env,
    });
  } catch (error) {
    resolvedOk = false;
    checks.push({
      name: "auth_resolution",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (resolvedOk) {
    checks.push({
      name: "auth_resolution",
      ok: true,
      message: "resolved",
    });
  }

  if (checkApi) {
    if (!apiKeyForCheck && apiKeyFile) {
      try {
        const resolved = resolveAuth({
          mode: "api_key",
          cliAuthPath: config.auth.cliAuthPath,
          apiKey: config.auth.apiKey,
          apiKeyEnvVar: config.auth.apiKeyEnvVar,
          apiKeyEnvVarAlt: config.auth.apiKeyEnvVarAlt,
          apiKeyFileEnvVar: config.auth.apiKeyFileEnvVar,
          env: process.env,
        });
        if (resolved.type === "api_key") apiKeyForCheck = resolved.apiKey;
      } catch (error) {
        apiKeyCheckError =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (apiKeyCheckError) {
      checks.push({
        name: "api_check",
        ok: false,
        message: apiKeyCheckError,
      });
      nextSteps.push("Check API key file and permissions.");
    } else if (!apiKeyForCheck) {
      checks.push({
        name: "api_check",
        ok: false,
        message: "skipped (no API key provided)",
      });
    } else {
      try {
        const result = await runOpenAI({
          apiKey: apiKeyForCheck,
          baseUrl: config.api.baseUrl,
          model: config.api.model,
          prompt: "ping",
          temperature: 0,
          maxOutputTokens: 1,
          timeoutMs: 10_000,
        });
        checks.push({
          name: "api_check",
          ok: true,
          message: result.text ? "ok" : "ok (empty response)",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push({
          name: "api_check",
          ok: false,
          message,
        });
        nextSteps.push("Check OPENAI_API_KEY and network connectivity.");
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  const report = {
    ok,
    timestamp,
    checks,
    nextSteps,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return ok ? 0 : 1;
}

async function main(): Promise<void> {
  const cmd = parseArgs(process.argv.slice(2));
  const pkg = readPackageInfo();

  if (cmd.kind === "help") {
    printHelp(pkg);
    process.exit(0);
  }
  if (cmd.kind === "version") {
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    process.exit(0);
  }
  if (cmd.kind === "doctor") {
    const code = await runDoctor(cmd.configPath, cmd.checkApi);
    process.exit(code);
  }
  if (cmd.kind === "setup") {
    await runSetupWizard({ ...cmd.options, configPath: cmd.configPath });
    process.exit(0);
  }
  if (cmd.kind === "print-config") {
    const config = loadConfig({ configPath: cmd.configPath });
    const safe = redactMeta(config as unknown as Record<string, unknown>) ?? {};
    process.stdout.write(JSON.stringify(safe, null, 2) + "\n");
    process.exit(0);
  }

  const config = loadConfig({ configPath: cmd.configPath });
  const transportMode = cmd.transportOverride ?? config.transport.mode;
  const httpHost = cmd.httpHost ?? config.transport.http.host;
  const httpPort = cmd.httpPort ?? config.transport.http.port;
  const logger = createStderrLogger({ debugEnabled: config.logging.debug });

  const configPathForWrite = resolveConfigPathForWrite(cmd.configPath);
  const autoRootStartDir = path.resolve(
    expandHome(config.trust.promptDir?.trim() || process.cwd()),
  );
  applyAutoGitRootDefaults({
    config,
    logger,
    startDir: autoRootStartDir,
    configPathForWrite,
  });

  if (config.trust.promptOnStart) {
    const updatedTrustedDirs = await maybePromptTrustedDir(
      logger,
      configPathForWrite,
      config.trust.promptDir,
      config.trust.trustedDirs,
    );
    if (updatedTrustedDirs) {
      config.trust.trustedDirs = updatedTrustedDirs;
    }
  }

  const sharedLimitStore = await createSharedLimitStore({
    enabled: config.limits.shared.enabled,
    redisUrl: config.limits.shared.redisUrl,
    keyPrefix: config.limits.shared.keyPrefix,
    connectTimeoutMs: config.limits.shared.connectTimeoutMs,
    logger,
  });
  const rateLimiter = new RateLimiter({
    maxPerMinute: config.limits.maxRequestsPerMinute,
    sharedStore: sharedLimitStore ?? undefined,
  });
  const dailyBudget = new DailyTokenBudget({
    maxTokensPerDay: config.limits.maxTokensPerDay,
    sharedStore: sharedLimitStore ?? undefined,
  });

  // Initialize error logger for centralized error tracking
  setMcpVersion(pkg.version);
  const errorLogger = createErrorLogger(
    {
      errorLogging: config.logging.errorLogging,
      directory: config.logging.directory,
      maxFileSizeMb: config.logging.maxFileSizeMb,
      retentionDays: config.logging.retentionDays,
    },
    logger,
  );
  errorLogger.initialize();

  const sharedDeps = { config, logger, rateLimiter, dailyBudget, errorLogger };

  let closeServer: (() => Promise<void>) | null = null;

  if (transportMode === "http") {
    const httpHandle = await startHttpServer(sharedDeps, pkg, {
      host: httpHost,
      port: httpPort,
    });
    closeServer = httpHandle.close;
  } else {
    const server = createMcpServer(sharedDeps, pkg);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Server running on stdio", {
      name: pkg.name,
      version: pkg.version,
    });
    process.stdin.resume();
    closeServer = async () => {
      await server.close();
    };
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    try {
      if (closeServer) await closeServer();
      if (sharedLimitStore) await sharedLimitStore.close();
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  const message = redactString(
    err instanceof Error ? err.message : String(err),
  );
  process.stderr.write(`[fatal] ${message}\n`);
  process.exit(1);
});
