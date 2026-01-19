import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { DEFAULT_CONFIG_PATH, getDefaultConfig } from "./config.js";
import { expandHome } from "./utils/paths.js";
import { isRecord } from "./utils/typeGuards.js";

type TransportMode = "stdio" | "http";
type AuthMode = "auto" | "cli" | "api_key";

export type SetupWizardOptions = {
  configPath?: string;
  nonInteractive?: boolean;
  acceptDefaults?: boolean;
  overwrite?: boolean;
  merge?: boolean;
  dryRun?: boolean;
  transport?: TransportMode;
  httpHost?: string;
  httpPort?: number;
  authMode?: AuthMode;
  cliCommand?: string;
  cliAuthPath?: string;
  model?: string;
  apiBaseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxInputChars?: number;
  maxRequestsPerMinute?: number;
  maxTokensPerDay?: number;
  sharedLimitsEnabled?: boolean;
  redisUrl?: string;
  redisKeyPrefix?: string;
  apiKeyEnvVar?: string;
  apiKeyEnvVarAlt?: string;
  apiKeyFileEnvVar?: string;
};

type MergeStrategy = "merge" | "overwrite" | "cancel";

type WizardAnswers = {
  transportMode: TransportMode;
  httpHost?: string;
  httpPort?: number;
  authMode: AuthMode;
  cliCommand?: string;
  cliAuthPath?: string;
  apiKeyEnvVar?: string;
  apiKeyEnvVarAlt?: string;
  apiKeyFileEnvVar?: string;
  model?: string;
  apiBaseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxInputChars?: number;
  maxRequestsPerMinute?: number;
  maxTokensPerDay?: number;
  sharedLimitsEnabled?: boolean;
  redisUrl?: string;
  redisKeyPrefix?: string;
};

const YES_VALUES = new Set(["y", "yes"]);
const NO_VALUES = new Set(["n", "no"]);

function writeLine(message = ""): void {
  stderr.write(`${message}\n`);
}

function getNestedValue(
  target: Record<string, unknown> | null | undefined,
  pathParts: string[],
): unknown {
  let cursor: unknown = target;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function getNestedString(
  target: Record<string, unknown> | null | undefined,
  pathParts: string[],
): string | undefined {
  const value = getNestedValue(target, pathParts);
  return typeof value === "string" ? value : undefined;
}

function getNestedNumber(
  target: Record<string, unknown> | null | undefined,
  pathParts: string[],
): number | undefined {
  const value = getNestedValue(target, pathParts);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getNestedBoolean(
  target: Record<string, unknown> | null | undefined,
  pathParts: string[],
): boolean | undefined {
  const value = getNestedValue(target, pathParts);
  return typeof value === "boolean" ? value : undefined;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function formatDefault(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  return ` [${value}]`;
}

function normalizeTransport(value: string | undefined): TransportMode | null {
  if (value === "stdio" || value === "http") return value;
  return null;
}

function normalizeAuth(value: string | undefined): AuthMode | null {
  if (value === "auto" || value === "cli" || value === "api_key") return value;
  return null;
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePort(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

function parseFloatRange(
  value: string,
  min: number,
  max: number,
): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function mergeDeep(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = mergeDeep(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function setNested(
  target: Record<string, unknown>,
  pathParts: string[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i];
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[pathParts[pathParts.length - 1]] = value;
}

async function readJsonFile(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runSetupWizard(
  opts: SetupWizardOptions = {},
): Promise<void> {
  const defaults = getDefaultConfig();
  const configPathInput = opts.configPath ?? DEFAULT_CONFIG_PATH;
  const configPathResolved = path.resolve(expandHome(configPathInput));
  const nonInteractive = Boolean(opts.nonInteractive);
  const acceptDefaults = Boolean(opts.acceptDefaults);
  const shouldPrompt = !nonInteractive && !acceptDefaults;
  const explicitTransport =
    shouldPrompt ||
    opts.transport !== undefined ||
    opts.httpHost !== undefined ||
    opts.httpPort !== undefined;
  const explicitAuth =
    shouldPrompt ||
    opts.authMode !== undefined ||
    opts.cliCommand !== undefined ||
    opts.cliAuthPath !== undefined ||
    opts.apiKeyEnvVar !== undefined ||
    opts.apiKeyEnvVarAlt !== undefined ||
    opts.apiKeyFileEnvVar !== undefined;
  const explicitModel = shouldPrompt || opts.model !== undefined;

  const rl = shouldPrompt
    ? readline.createInterface({ input: stdin, output: stderr })
    : null;

  const ask = async (prompt: string): Promise<string> => {
    if (!rl) return "";
    return rl.question(prompt);
  };

  const askConfirm = async (
    prompt: string,
    defaultYes: boolean,
  ): Promise<boolean> => {
    if (!shouldPrompt) return defaultYes;
    const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
    while (true) {
      const answer = (await ask(`${prompt}${suffix}`)).trim().toLowerCase();
      if (!answer) return defaultYes;
      if (YES_VALUES.has(answer)) return true;
      if (NO_VALUES.has(answer)) return false;
      writeLine("Please answer y or n.");
    }
  };

  const askChoice = async <T extends string>(
    prompt: string,
    options: Array<{ value: T; label: string }>,
    defaultValue: T,
  ): Promise<T> => {
    if (!shouldPrompt) return defaultValue;
    writeLine(prompt);
    options.forEach((option, index) => {
      const suffix = option.value === defaultValue ? " (default)" : "";
      writeLine(`  ${index + 1}) ${option.label}${suffix}`);
    });
    while (true) {
      const answer = (await ask("Select an option: ")).trim();
      if (!answer) return defaultValue;
      const asNumber = Number.parseInt(answer, 10);
      if (
        Number.isFinite(asNumber) &&
        asNumber >= 1 &&
        asNumber <= options.length
      ) {
        return options[asNumber - 1].value;
      }
      const match = options.find((option) => option.value === answer);
      if (match) return match.value;
      writeLine("Invalid selection.");
    }
  };

  const askText = async (
    prompt: string,
    defaultValue?: string,
    allowEmpty = true,
  ): Promise<string | undefined> => {
    if (!shouldPrompt) return defaultValue;
    const suffix = formatDefault(defaultValue);
    while (true) {
      const answer = (await ask(`${prompt}${suffix} `)).trim();
      if (!answer) return defaultValue ?? (allowEmpty ? undefined : "");
      if (answer || allowEmpty) return answer;
      writeLine("Value cannot be empty.");
    }
  };

  const askInt = async (
    prompt: string,
    defaultValue?: number,
  ): Promise<number | undefined> => {
    if (!shouldPrompt) return defaultValue;
    const suffix = formatDefault(defaultValue);
    while (true) {
      const answer = (await ask(`${prompt}${suffix} `)).trim();
      if (!answer) return defaultValue;
      const parsed = parsePositiveInt(answer);
      if (parsed !== null) return parsed;
      writeLine("Enter a positive integer.");
    }
  };

  const askPort = async (
    prompt: string,
    defaultValue?: number,
  ): Promise<number | undefined> => {
    if (!shouldPrompt) return defaultValue;
    const suffix = formatDefault(defaultValue);
    while (true) {
      const answer = (await ask(`${prompt}${suffix} `)).trim();
      if (!answer) return defaultValue;
      const parsed = parsePort(answer);
      if (parsed !== null) return parsed;
      writeLine("Enter a valid port (1-65535).");
    }
  };

  const askFloat = async (
    prompt: string,
    defaultValue: number,
    min: number,
    max: number,
  ): Promise<number> => {
    if (!shouldPrompt) return defaultValue;
    const suffix = formatDefault(defaultValue);
    while (true) {
      const answer = (await ask(`${prompt}${suffix} `)).trim();
      if (!answer) return defaultValue;
      const parsed = parseFloatRange(answer, min, max);
      if (parsed !== null) return parsed;
      writeLine(`Enter a number between ${min} and ${max}.`);
    }
  };

  try {
    writeLine("Codex MCP Bridge setup wizard");
    writeLine("This will create or update your local config file.");
    writeLine("No API keys are stored; set env vars or a key file separately.");
    writeLine();

    const exists = await fileExists(configPathResolved);
    let mergeStrategy: MergeStrategy = "merge";
    let existingConfig: Record<string, unknown> | null = null;

    if (exists) {
      if (opts.overwrite) {
        mergeStrategy = "overwrite";
      } else if (opts.merge) {
        mergeStrategy = "merge";
      } else if (shouldPrompt) {
        mergeStrategy = await askChoice(
          `Config already exists at ${configPathResolved}. Choose an action:`,
          [
            { value: "merge", label: "Merge (recommended)" },
            { value: "overwrite", label: "Overwrite" },
            { value: "cancel", label: "Cancel" },
          ],
          "merge",
        );
      }

      if (mergeStrategy === "cancel") {
        writeLine("Setup canceled.");
        return;
      }

      if (mergeStrategy === "merge") {
        existingConfig = await readJsonFile(configPathResolved);
        if (!existingConfig) {
          if (shouldPrompt) {
            writeLine("Existing config is not valid JSON.");
            const overwrite = await askConfirm("Overwrite instead?", false);
            if (!overwrite) {
              writeLine("Setup canceled.");
              return;
            }
            mergeStrategy = "overwrite";
          } else {
            throw new Error(
              "Existing config is invalid JSON; use --overwrite.",
            );
          }
        }
      }
    }

    const effectiveExistingConfig = existingConfig ?? {};

    const existingTransportMode = normalizeTransport(
      getNestedString(effectiveExistingConfig, ["transport", "mode"]),
    );
    const transportPromptDefault =
      opts.transport ?? existingTransportMode ?? defaults.transport.mode;
    const transportMode = shouldPrompt
      ? await askChoice<TransportMode>(
          "Select transport mode:",
          [
            { value: "stdio", label: "stdio (recommended for MCP clients)" },
            { value: "http", label: "http (Streamable HTTP server)" },
          ],
          transportPromptDefault,
        )
      : transportPromptDefault;

    let httpHost: string | undefined;
    let httpPort: number | undefined;
    if (transportMode === "http") {
      const existingHost = getNestedString(effectiveExistingConfig, [
        "transport",
        "http",
        "host",
      ]);
      const defaultHost = existingHost ?? defaults.transport.http.host;
      httpHost =
        opts.httpHost ?? (await askText("HTTP host", defaultHost, false));

      const existingPort = getNestedNumber(effectiveExistingConfig, [
        "transport",
        "http",
        "port",
      ]);
      const defaultPort = existingPort ?? defaults.transport.http.port;
      if (
        typeof opts.httpPort === "number" &&
        (opts.httpPort < 1 || opts.httpPort > 65535)
      ) {
        throw new Error("HTTP port must be between 1 and 65535.");
      }
      httpPort = opts.httpPort ?? (await askPort("HTTP port", defaultPort));
    }

    const existingAuthMode = normalizeAuth(
      getNestedString(effectiveExistingConfig, ["auth", "mode"]),
    );
    const authPromptDefault =
      opts.authMode ?? existingAuthMode ?? defaults.auth.mode;
    const authMode = shouldPrompt
      ? await askChoice<AuthMode>(
          "Select authentication mode:",
          [
            { value: "auto", label: "auto (CLI first, API key fallback)" },
            { value: "cli", label: "cli (requires Codex CLI login)" },
            { value: "api_key", label: "api_key (env var or key file)" },
          ],
          authPromptDefault,
        )
      : authPromptDefault;

    const existingModel =
      getNestedString(effectiveExistingConfig, ["api", "model"]) ??
      getNestedString(effectiveExistingConfig, ["cli", "defaultModel"]);
    const modelPromptDefault = existingModel ?? defaults.api.model;
    const model =
      opts.model ??
      (await askText(
        "Default model (used unless overridden)",
        modelPromptDefault,
        false,
      ));

    let wantsAdvanced = false;
    if (shouldPrompt) {
      writeLine();
      wantsAdvanced = await askConfirm(
        "Configure advanced settings (CLI paths, env vars, API settings, limits)?",
        false,
      );
    }
    if (wantsAdvanced) {
      writeLine();
      writeLine("Advanced settings");
    }

    let cliCommand = opts.cliCommand;
    let cliAuthPath = opts.cliAuthPath;
    const hasCliOverrides =
      opts.cliCommand !== undefined || opts.cliAuthPath !== undefined;
    let customizeCli = hasCliOverrides;
    if (authMode !== "api_key" && wantsAdvanced && !hasCliOverrides) {
      customizeCli = await askConfirm(
        "Customize Codex CLI command or auth path?",
        false,
      );
      if (customizeCli) {
        const existingCliCommand = getNestedString(effectiveExistingConfig, [
          "cli",
          "command",
        ]);
        const existingCliAuthPath = getNestedString(effectiveExistingConfig, [
          "auth",
          "cliAuthPath",
        ]);
        cliCommand = await askText(
          "Codex CLI command",
          existingCliCommand ?? defaults.cli.command,
          false,
        );
        cliAuthPath = await askText(
          "Codex CLI auth path",
          existingCliAuthPath ?? defaults.auth.cliAuthPath,
          false,
        );
      }
    }

    let apiKeyEnvVar = opts.apiKeyEnvVar;
    let apiKeyEnvVarAlt = opts.apiKeyEnvVarAlt;
    let apiKeyFileEnvVar = opts.apiKeyFileEnvVar;
    const hasApiKeyEnvOverrides =
      opts.apiKeyEnvVar !== undefined ||
      opts.apiKeyEnvVarAlt !== undefined ||
      opts.apiKeyFileEnvVar !== undefined;
    let customizeApiKeyEnv = hasApiKeyEnvOverrides;
    if (authMode !== "cli" && wantsAdvanced && !hasApiKeyEnvOverrides) {
      customizeApiKeyEnv = await askConfirm(
        "Customize API key env var names?",
        false,
      );
      if (customizeApiKeyEnv) {
        const existingApiKeyEnvVar = getNestedString(effectiveExistingConfig, [
          "auth",
          "apiKeyEnvVar",
        ]);
        const existingApiKeyEnvVarAlt = getNestedString(
          effectiveExistingConfig,
          ["auth", "apiKeyEnvVarAlt"],
        );
        const existingApiKeyFileEnvVar = getNestedString(
          effectiveExistingConfig,
          ["auth", "apiKeyFileEnvVar"],
        );
        apiKeyEnvVar = await askText(
          "Primary API key env var",
          existingApiKeyEnvVar ?? defaults.auth.apiKeyEnvVar,
          false,
        );
        apiKeyEnvVarAlt = await askText(
          "Alternate API key env var (optional)",
          existingApiKeyEnvVarAlt ?? defaults.auth.apiKeyEnvVarAlt,
          true,
        );
        apiKeyFileEnvVar = await askText(
          "API key file env var",
          existingApiKeyFileEnvVar ?? defaults.auth.apiKeyFileEnvVar,
          false,
        );
      }
    }

    if (transportMode === "http") {
      const hostValue =
        httpHost ??
        getNestedString(effectiveExistingConfig, ["transport", "http", "host"]);
      if (hostValue && !isLoopbackHost(hostValue)) {
        writeLine();
        writeLine(
          `Warning: HTTP host "${hostValue}" is not loopback. This may expose the MCP server on your network.`,
        );
        writeLine(
          "Recommended: use 127.0.0.1 unless you understand the risks.",
        );
        if (shouldPrompt) {
          const proceed = await askConfirm("Continue with this host?", false);
          if (!proceed) {
            writeLine("Setup canceled.");
            return;
          }
        }
      }
    }

    let apiBaseUrl = opts.apiBaseUrl;
    let temperature = opts.temperature;
    let maxOutputTokens = opts.maxOutputTokens;
    const hasApiOverrides =
      opts.apiBaseUrl !== undefined ||
      opts.temperature !== undefined ||
      opts.maxOutputTokens !== undefined;
    let customizeApiSettings = hasApiOverrides;
    if (authMode !== "cli" && wantsAdvanced && !hasApiOverrides) {
      customizeApiSettings = await askConfirm("Customize API settings?", false);
      if (customizeApiSettings) {
        const existingApiBaseUrl = getNestedString(effectiveExistingConfig, [
          "api",
          "baseUrl",
        ]);
        const existingTemperature = getNestedNumber(effectiveExistingConfig, [
          "api",
          "temperature",
        ]);
        const existingMaxOutputTokens = getNestedNumber(
          effectiveExistingConfig,
          ["api", "maxOutputTokens"],
        );
        apiBaseUrl = await askText(
          "API base URL",
          existingApiBaseUrl ?? defaults.api.baseUrl,
          false,
        );
        temperature = await askFloat(
          "Temperature (0-2)",
          existingTemperature ?? defaults.api.temperature,
          0,
          2,
        );
        maxOutputTokens = await askInt(
          "Max output tokens",
          existingMaxOutputTokens ?? defaults.api.maxOutputTokens,
        );
      }
    }

    let timeoutMs = opts.timeoutMs;
    let maxInputChars = opts.maxInputChars;
    let maxRequestsPerMinute = opts.maxRequestsPerMinute;
    let maxTokensPerDay = opts.maxTokensPerDay;
    let sharedLimitsEnabled = opts.sharedLimitsEnabled;
    let redisUrl = opts.redisUrl;
    let redisKeyPrefix = opts.redisKeyPrefix;
    const hasLimitsOverrides =
      opts.timeoutMs !== undefined ||
      opts.maxInputChars !== undefined ||
      opts.maxRequestsPerMinute !== undefined ||
      opts.maxTokensPerDay !== undefined ||
      opts.sharedLimitsEnabled !== undefined ||
      opts.redisUrl !== undefined ||
      opts.redisKeyPrefix !== undefined;
    let customizeLimits = hasLimitsOverrides;
    if (wantsAdvanced && !hasLimitsOverrides) {
      customizeLimits = await askConfirm(
        "Configure limits and timeouts?",
        false,
      );
      if (customizeLimits) {
        const existingTimeoutMs = getNestedNumber(effectiveExistingConfig, [
          "execution",
          "timeoutMs",
        ]);
        const existingMaxInputChars = getNestedNumber(effectiveExistingConfig, [
          "limits",
          "maxInputChars",
        ]);
        const existingMaxRequestsPerMinute = getNestedNumber(
          effectiveExistingConfig,
          ["limits", "maxRequestsPerMinute"],
        );
        const existingMaxTokensPerDay = getNestedNumber(
          effectiveExistingConfig,
          ["limits", "maxTokensPerDay"],
        );
        const existingSharedLimitsEnabled = getNestedBoolean(
          effectiveExistingConfig,
          ["limits", "shared", "enabled"],
        );
        const existingRedisUrl = getNestedString(effectiveExistingConfig, [
          "limits",
          "shared",
          "redisUrl",
        ]);
        const existingRedisKeyPrefix = getNestedString(
          effectiveExistingConfig,
          ["limits", "shared", "keyPrefix"],
        );

        timeoutMs = await askInt(
          "Request timeout (ms)",
          existingTimeoutMs ?? defaults.execution.timeoutMs,
        );
        maxInputChars = await askInt(
          "Max input chars",
          existingMaxInputChars ?? defaults.limits.maxInputChars,
        );
        maxRequestsPerMinute = await askInt(
          "Max requests per minute",
          existingMaxRequestsPerMinute ?? defaults.limits.maxRequestsPerMinute,
        );
        maxTokensPerDay = await askInt(
          "Max tokens per day",
          existingMaxTokensPerDay ?? defaults.limits.maxTokensPerDay,
        );
        sharedLimitsEnabled = await askConfirm(
          "Enable shared limits (Redis)?",
          Boolean(existingSharedLimitsEnabled),
        );
        if (sharedLimitsEnabled) {
          redisUrl = await askText(
            "Redis URL",
            existingRedisUrl ?? defaults.limits.shared.redisUrl,
            false,
          );
          redisKeyPrefix = await askText(
            "Redis key prefix",
            existingRedisKeyPrefix ?? defaults.limits.shared.keyPrefix,
            false,
          );
        }
      }
    }

    const answers: WizardAnswers = {
      transportMode,
      httpHost,
      httpPort,
      authMode,
      cliCommand,
      cliAuthPath,
      apiKeyEnvVar,
      apiKeyEnvVarAlt,
      apiKeyFileEnvVar,
      model,
      apiBaseUrl,
      temperature,
      maxOutputTokens,
      timeoutMs,
      maxInputChars,
      maxRequestsPerMinute,
      maxTokensPerDay,
      sharedLimitsEnabled,
      redisUrl,
      redisKeyPrefix,
    };

    const configPatch: Record<string, unknown> = {};
    if (explicitAuth || !exists || mergeStrategy === "overwrite") {
      setNested(configPatch, ["auth", "mode"], answers.authMode);
    }
    if (explicitTransport || !exists || mergeStrategy === "overwrite") {
      setNested(configPatch, ["transport", "mode"], answers.transportMode);
    }

    if (
      answers.transportMode === "http" &&
      (explicitTransport || shouldPrompt)
    ) {
      if (
        answers.httpHost &&
        answers.httpHost !== defaults.transport.http.host
      ) {
        setNested(configPatch, ["transport", "http", "host"], answers.httpHost);
      }
      if (
        typeof answers.httpPort === "number" &&
        answers.httpPort !== defaults.transport.http.port
      ) {
        setNested(configPatch, ["transport", "http", "port"], answers.httpPort);
      }
    }

    if (
      answers.model &&
      (explicitModel || !exists || mergeStrategy === "overwrite")
    ) {
      setNested(configPatch, ["api", "model"], answers.model);
      setNested(configPatch, ["cli", "defaultModel"], answers.model);
    }

    if (customizeCli && answers.cliCommand) {
      setNested(configPatch, ["cli", "command"], answers.cliCommand);
    }
    if (customizeCli && answers.cliAuthPath) {
      setNested(configPatch, ["auth", "cliAuthPath"], answers.cliAuthPath);
    }

    if (customizeApiKeyEnv && answers.apiKeyEnvVar) {
      setNested(configPatch, ["auth", "apiKeyEnvVar"], answers.apiKeyEnvVar);
    }
    if (customizeApiKeyEnv && answers.apiKeyEnvVarAlt) {
      setNested(
        configPatch,
        ["auth", "apiKeyEnvVarAlt"],
        answers.apiKeyEnvVarAlt,
      );
    }
    if (customizeApiKeyEnv && answers.apiKeyFileEnvVar) {
      setNested(
        configPatch,
        ["auth", "apiKeyFileEnvVar"],
        answers.apiKeyFileEnvVar,
      );
    }

    if (customizeApiSettings && answers.apiBaseUrl) {
      setNested(configPatch, ["api", "baseUrl"], answers.apiBaseUrl);
    }
    if (customizeApiSettings && typeof answers.temperature === "number") {
      setNested(configPatch, ["api", "temperature"], answers.temperature);
    }
    if (customizeApiSettings && typeof answers.maxOutputTokens === "number") {
      setNested(
        configPatch,
        ["api", "maxOutputTokens"],
        answers.maxOutputTokens,
      );
    }

    if (customizeLimits && typeof answers.timeoutMs === "number") {
      setNested(configPatch, ["execution", "timeoutMs"], answers.timeoutMs);
    }
    if (customizeLimits && typeof answers.maxInputChars === "number") {
      setNested(
        configPatch,
        ["limits", "maxInputChars"],
        answers.maxInputChars,
      );
    }
    if (customizeLimits && typeof answers.maxRequestsPerMinute === "number") {
      setNested(
        configPatch,
        ["limits", "maxRequestsPerMinute"],
        answers.maxRequestsPerMinute,
      );
    }
    if (customizeLimits && typeof answers.maxTokensPerDay === "number") {
      setNested(
        configPatch,
        ["limits", "maxTokensPerDay"],
        answers.maxTokensPerDay,
      );
    }
    if (customizeLimits && typeof answers.sharedLimitsEnabled === "boolean") {
      setNested(
        configPatch,
        ["limits", "shared", "enabled"],
        answers.sharedLimitsEnabled,
      );
      if (answers.sharedLimitsEnabled) {
        if (answers.redisUrl) {
          setNested(
            configPatch,
            ["limits", "shared", "redisUrl"],
            answers.redisUrl,
          );
        }
        if (answers.redisKeyPrefix) {
          setNested(
            configPatch,
            ["limits", "shared", "keyPrefix"],
            answers.redisKeyPrefix,
          );
        }
      }
    }

    const configToWrite =
      mergeStrategy === "merge" && existingConfig
        ? mergeDeep(existingConfig, configPatch)
        : configPatch;

    if (!opts.dryRun) {
      await fs.mkdir(path.dirname(configPathResolved), {
        recursive: true,
        mode: 0o700,
      });
      const writeOptions = (await fileExists(configPathResolved))
        ? "utf8"
        : ({ encoding: "utf8", mode: 0o600 } as const);
      await fs.writeFile(
        configPathResolved,
        JSON.stringify(configToWrite, null, 2) + "\n",
        writeOptions,
      );
    }

    writeLine();
    writeLine("Setup summary");
    const summaryTransportMode =
      normalizeTransport(
        getNestedString(configToWrite, ["transport", "mode"]),
      ) ?? defaults.transport.mode;
    const summaryHttpHost =
      getNestedString(configToWrite, ["transport", "http", "host"]) ??
      defaults.transport.http.host;
    const summaryHttpPort =
      getNestedNumber(configToWrite, ["transport", "http", "port"]) ??
      defaults.transport.http.port;
    const summaryAuthMode =
      normalizeAuth(getNestedString(configToWrite, ["auth", "mode"])) ??
      defaults.auth.mode;
    const summaryCliCommand =
      getNestedString(configToWrite, ["cli", "command"]) ??
      defaults.cli.command;
    const summaryCliAuthPath =
      getNestedString(configToWrite, ["auth", "cliAuthPath"]) ??
      defaults.auth.cliAuthPath;
    const summaryApiKeyEnvVar =
      getNestedString(configToWrite, ["auth", "apiKeyEnvVar"]) ??
      defaults.auth.apiKeyEnvVar;
    const summaryApiKeyFileEnvVar =
      getNestedString(configToWrite, ["auth", "apiKeyFileEnvVar"]) ??
      defaults.auth.apiKeyFileEnvVar;
    const summaryModel =
      getNestedString(configToWrite, ["api", "model"]) ??
      getNestedString(configToWrite, ["cli", "defaultModel"]) ??
      defaults.api.model;

    writeLine(
      `- Config file: ${configPathResolved}${opts.dryRun ? " (dry run)" : ""}`,
    );
    writeLine(`- Transport: ${summaryTransportMode}`);
    if (summaryTransportMode === "http") {
      writeLine(`- HTTP host: ${summaryHttpHost}`);
      writeLine(`- HTTP port: ${summaryHttpPort}`);
    }
    writeLine(`- Auth mode: ${summaryAuthMode}`);
    if (summaryAuthMode !== "api_key") {
      writeLine(`- Codex CLI command: ${summaryCliCommand}`);
      writeLine(`- Codex CLI auth path: ${summaryCliAuthPath}`);
    }
    if (summaryAuthMode !== "cli") {
      writeLine(`- API key env var: ${summaryApiKeyEnvVar}`);
      writeLine(`- API key file env var: ${summaryApiKeyFileEnvVar}`);
    }
    writeLine(`- Default model: ${summaryModel}`);

    writeLine();
    writeLine("Next steps");
    const scriptPath = process.argv[1]
      ? path.resolve(process.argv[1])
      : path.resolve("dist/index.js");
    const nodeInvoke = `node ${JSON.stringify(scriptPath)}`;
    if (summaryAuthMode !== "cli") {
      writeLine(`- Set your API key (env var or file): ${summaryApiKeyEnvVar}`);
    } else {
      writeLine("- Ensure Codex CLI is logged in: codex login status");
    }
    writeLine("- Validate config:");
    writeLine("  - If installed globally: codex-mcp-bridge --doctor");
    writeLine(`  - If running from source: ${nodeInvoke} --doctor`);
    writeLine("- Start server:");
    writeLine("  - If installed globally: codex-mcp-bridge --stdio");
    writeLine(`  - If running from source: ${nodeInvoke} --stdio`);
    writeLine("- For client setup, see docs/USER_MANUAL.md");
    writeLine();
  } finally {
    if (rl) rl.close();
  }
}
