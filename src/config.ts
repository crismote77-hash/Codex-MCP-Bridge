import fs from "node:fs";
import { z } from "zod";
import { expandHome } from "./utils/paths.js";
import { isRecord } from "./utils/typeGuards.js";
import { ConfigError } from "./errors.js";

const transportModeSchema = z.enum(["stdio", "http"]);
const authModeSchema = z.enum(["auto", "cli", "api_key"]);

const configSchema = z
  .object({
    auth: z
      .object({
        mode: authModeSchema.default("auto"),
        apiKey: z.string().optional(),
        apiKeyEnvVar: z.string().default("OPENAI_API_KEY"),
        apiKeyEnvVarAlt: z.string().default("CODEX_API_KEY"),
        apiKeyFileEnvVar: z.string().default("OPENAI_API_KEY_FILE"),
        cliAuthPath: z.string().default("~/.codex/auth.json"),
      })
      .default({}),
    cli: z
      .object({
        command: z.string().default("codex"),
        defaultModel: z.string().default("o3"),
        color: z.enum(["auto", "always", "never"]).default("never"),
      })
      .default({}),
    api: z
      .object({
        baseUrl: z.string().default("https://api.openai.com/v1"),
        model: z.string().default("o3"),
        temperature: z.number().min(0).max(2).default(0.2),
        maxOutputTokens: z.number().int().positive().default(2048),
      })
      .default({}),
    limits: z
      .object({
        maxInputChars: z.number().int().positive().default(20000),
        maxRequestsPerMinute: z.number().int().positive().default(30),
        maxTokensPerDay: z.number().int().positive().default(200000),
        enableCostEstimates: z.boolean().default(false),
        shared: z
          .object({
            enabled: z.boolean().default(false),
            redisUrl: z.string().default("redis://localhost:6379"),
            keyPrefix: z.string().default("codex-mcp-bridge"),
            connectTimeoutMs: z.number().int().positive().default(10000),
          })
          .default({}),
      })
      .default({}),
    logging: z
      .object({
        debug: z.boolean().default(false),
      })
      .default({}),
    transport: z
      .object({
        mode: transportModeSchema.default("stdio"),
        http: z
          .object({
            host: z.string().default("127.0.0.1"),
            port: z.number().int().positive().default(3923),
          })
          .default({}),
      })
      .default({}),
    execution: z
      .object({
        timeoutMs: z.number().int().positive().default(300000),
      })
      .default({}),
  })
  .strict();

export type BridgeConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG_PATH = "~/.codex-mcp-bridge/config.json";

function readJsonFileIfExists(filePath: string): unknown | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `Invalid JSON in config file ${filePath}: ${message}`,
    );
  }
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

function parseBooleanEnv(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseIntEnv(value: string, name: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed))
    throw new ConfigError(`Invalid integer for ${name}`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed))
    throw new ConfigError(`Invalid integer for ${name}`);
  return parsed;
}

export function loadConfig(
  opts: { configPath?: string; env?: NodeJS.ProcessEnv } = {},
): BridgeConfig {
  const env = opts.env ?? process.env;

  const resolvedDefaultPath = expandHome(DEFAULT_CONFIG_PATH);
  const resolvedProvidedPath = opts.configPath
    ? expandHome(opts.configPath)
    : undefined;
  const configPathToUse =
    resolvedProvidedPath ??
    (fs.existsSync(resolvedDefaultPath) ? resolvedDefaultPath : undefined);

  const fileConfigRaw = configPathToUse
    ? readJsonFileIfExists(configPathToUse)
    : undefined;
  const fileConfigObj = isRecord(fileConfigRaw) ? fileConfigRaw : {};

  const merged: Record<string, unknown> = mergeDeep(
    configSchema.parse({}) as Record<string, unknown>,
    fileConfigObj,
  );

  if (env.CODEX_MCP_AUTH_MODE)
    merged.auth = { ...(merged.auth as object), mode: env.CODEX_MCP_AUTH_MODE };
  if (env.CODEX_MCP_API_KEY)
    merged.auth = { ...(merged.auth as object), apiKey: env.CODEX_MCP_API_KEY };
  if (env.CODEX_MCP_API_KEY_ENV_VAR)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyEnvVar: env.CODEX_MCP_API_KEY_ENV_VAR,
    };
  if (env.CODEX_MCP_API_KEY_ENV_VAR_ALT)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyEnvVarAlt: env.CODEX_MCP_API_KEY_ENV_VAR_ALT,
    };
  if (env.CODEX_MCP_API_KEY_FILE_ENV_VAR)
    merged.auth = {
      ...(merged.auth as object),
      apiKeyFileEnvVar: env.CODEX_MCP_API_KEY_FILE_ENV_VAR,
    };
  if (env.CODEX_MCP_CLI_AUTH_PATH)
    merged.auth = {
      ...(merged.auth as object),
      cliAuthPath: env.CODEX_MCP_CLI_AUTH_PATH,
    };

  if (env.CODEX_MCP_CLI_COMMAND)
    merged.cli = {
      ...(merged.cli as object),
      command: env.CODEX_MCP_CLI_COMMAND,
    };

  if (env.CODEX_MCP_MODEL)
    merged.api = { ...(merged.api as object), model: env.CODEX_MCP_MODEL };
  if (env.CODEX_MCP_API_BASE_URL)
    merged.api = {
      ...(merged.api as object),
      baseUrl: env.CODEX_MCP_API_BASE_URL,
    };
  if (env.CODEX_MCP_TEMPERATURE)
    merged.api = {
      ...(merged.api as object),
      temperature: Number.parseFloat(env.CODEX_MCP_TEMPERATURE),
    };
  if (env.CODEX_MCP_MAX_OUTPUT_TOKENS)
    merged.api = {
      ...(merged.api as object),
      maxOutputTokens: parseIntEnv(
        env.CODEX_MCP_MAX_OUTPUT_TOKENS,
        "CODEX_MCP_MAX_OUTPUT_TOKENS",
      ),
    };

  if (env.CODEX_MCP_MAX_INPUT_CHARS)
    merged.limits = {
      ...(merged.limits as object),
      maxInputChars: parseIntEnv(
        env.CODEX_MCP_MAX_INPUT_CHARS,
        "CODEX_MCP_MAX_INPUT_CHARS",
      ),
    };
  if (env.CODEX_MCP_MAX_REQUESTS_PER_MINUTE)
    merged.limits = {
      ...(merged.limits as object),
      maxRequestsPerMinute: parseIntEnv(
        env.CODEX_MCP_MAX_REQUESTS_PER_MINUTE,
        "CODEX_MCP_MAX_REQUESTS_PER_MINUTE",
      ),
    };
  if (env.CODEX_MCP_MAX_TOKENS_PER_DAY)
    merged.limits = {
      ...(merged.limits as object),
      maxTokensPerDay: parseIntEnv(
        env.CODEX_MCP_MAX_TOKENS_PER_DAY,
        "CODEX_MCP_MAX_TOKENS_PER_DAY",
      ),
    };
  if (env.CODEX_MCP_ENABLE_COST_ESTIMATES)
    merged.limits = {
      ...(merged.limits as object),
      enableCostEstimates: parseBooleanEnv(env.CODEX_MCP_ENABLE_COST_ESTIMATES),
    };

  if (env.CODEX_MCP_SHARED_LIMITS_ENABLED)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as { shared?: object }).shared ?? {}),
        enabled: parseBooleanEnv(env.CODEX_MCP_SHARED_LIMITS_ENABLED),
      },
    };
  if (env.CODEX_MCP_REDIS_URL)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as { shared?: object }).shared ?? {}),
        redisUrl: env.CODEX_MCP_REDIS_URL,
      },
    };
  if (env.CODEX_MCP_REDIS_KEY_PREFIX)
    merged.limits = {
      ...(merged.limits as object),
      shared: {
        ...((merged.limits as { shared?: object }).shared ?? {}),
        keyPrefix: env.CODEX_MCP_REDIS_KEY_PREFIX,
      },
    };

  if (env.CODEX_MCP_TRANSPORT_MODE)
    merged.transport = {
      ...(merged.transport as object),
      mode: env.CODEX_MCP_TRANSPORT_MODE,
    };
  if (env.CODEX_MCP_HTTP_HOST)
    merged.transport = {
      ...(merged.transport as object),
      http: {
        ...((merged.transport as { http?: object }).http ?? {}),
        host: env.CODEX_MCP_HTTP_HOST,
      },
    };
  if (env.CODEX_MCP_HTTP_PORT)
    merged.transport = {
      ...(merged.transport as object),
      http: {
        ...((merged.transport as { http?: object }).http ?? {}),
        port: parseIntEnv(env.CODEX_MCP_HTTP_PORT, "CODEX_MCP_HTTP_PORT"),
      },
    };

  if (env.CODEX_MCP_TIMEOUT_MS)
    merged.execution = {
      ...(merged.execution as object),
      timeoutMs: parseIntEnv(env.CODEX_MCP_TIMEOUT_MS, "CODEX_MCP_TIMEOUT_MS"),
    };

  return configSchema.parse(merged);
}

export function getDefaultConfig(): BridgeConfig {
  return configSchema.parse({});
}
