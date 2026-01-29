import fs from "node:fs";
import path from "node:path";
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
        defaultModel: z.string().default("gpt-5.2"),
        color: z.enum(["auto", "always", "never"]).default("never"),
      })
      .default({}),
    trust: z
      .object({
        promptOnStart: z.boolean().default(true),
        promptDir: z.string().optional(),
        trustedDirs: z.array(z.string()).default([]),
      })
      .default({}),
    api: z
      .object({
        baseUrl: z.string().default("https://api.openai.com/v1"),
        model: z.string().default("gpt-5.2"),
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
        maxImages: z.number().int().positive().default(5),
        maxImageBytes: z.number().int().positive().default(20000000), // 20MB
        maxAudioBytes: z.number().int().positive().default(25000000), // 25MB (OpenAI limit)
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
    filesystem: z
      .object({
        roots: z.array(z.string()).default([]),
        maxFiles: z.number().int().positive().default(1000),
        maxFileBytes: z.number().int().positive().default(200000),
        maxTotalBytes: z.number().int().positive().default(2000000),
        maxSearchResults: z.number().int().positive().default(200),
        allowWrite: z.boolean().default(false),
      })
      .default({}),
    web: z
      .object({
        searchEnabled: z.boolean().default(false),
        fetchEnabled: z.boolean().default(false),
        provider: z.enum(["tavily"]).default("tavily"),
        tavilyApiKey: z.string().optional(),
        maxResults: z.number().int().positive().default(5),
        maxFetchBytes: z.number().int().positive().default(200000),
        timeoutMs: z.number().int().positive().default(10000),
        userAgent: z.string().default("codex-mcp-bridge"),
        allowLocalhost: z.boolean().default(false),
      })
      .default({}),
    logging: z
      .object({
        debug: z.boolean().default(false),
        errorLogging: z
          .enum(["off", "errors", "debug", "full"])
          .default("errors"),
        directory: z.string().optional(), // override auto-detected path
        maxFileSizeMb: z.number().int().positive().default(50),
        retentionDays: z.number().int().positive().default(7),
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

  if (env.CODEX_MCP_TRUST_PROMPT)
    merged.trust = {
      ...(merged.trust as object),
      promptOnStart: parseBooleanEnv(env.CODEX_MCP_TRUST_PROMPT),
    };
  if (env.CODEX_MCP_TRUST_PROMPT_DIR)
    merged.trust = {
      ...(merged.trust as object),
      promptDir: env.CODEX_MCP_TRUST_PROMPT_DIR,
    };
  if (env.CODEX_MCP_TRUSTED_DIRS)
    merged.trust = {
      ...(merged.trust as object),
      trustedDirs: env.CODEX_MCP_TRUSTED_DIRS.split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean),
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
  if (env.CODEX_MCP_MAX_IMAGES)
    merged.limits = {
      ...(merged.limits as object),
      maxImages: parseIntEnv(env.CODEX_MCP_MAX_IMAGES, "CODEX_MCP_MAX_IMAGES"),
    };
  if (env.CODEX_MCP_MAX_IMAGE_BYTES)
    merged.limits = {
      ...(merged.limits as object),
      maxImageBytes: parseIntEnv(
        env.CODEX_MCP_MAX_IMAGE_BYTES,
        "CODEX_MCP_MAX_IMAGE_BYTES",
      ),
    };
  if (env.CODEX_MCP_MAX_AUDIO_BYTES)
    merged.limits = {
      ...(merged.limits as object),
      maxAudioBytes: parseIntEnv(
        env.CODEX_MCP_MAX_AUDIO_BYTES,
        "CODEX_MCP_MAX_AUDIO_BYTES",
      ),
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

  if (env.CODEX_MCP_FILESYSTEM_ROOTS)
    merged.filesystem = {
      ...(merged.filesystem as object),
      roots: env.CODEX_MCP_FILESYSTEM_ROOTS.split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
  if (env.CODEX_MCP_FILESYSTEM_MAX_FILES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxFiles: parseIntEnv(
        env.CODEX_MCP_FILESYSTEM_MAX_FILES,
        "CODEX_MCP_FILESYSTEM_MAX_FILES",
      ),
    };
  if (env.CODEX_MCP_FILESYSTEM_MAX_FILE_BYTES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxFileBytes: parseIntEnv(
        env.CODEX_MCP_FILESYSTEM_MAX_FILE_BYTES,
        "CODEX_MCP_FILESYSTEM_MAX_FILE_BYTES",
      ),
    };
  if (env.CODEX_MCP_FILESYSTEM_MAX_TOTAL_BYTES)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxTotalBytes: parseIntEnv(
        env.CODEX_MCP_FILESYSTEM_MAX_TOTAL_BYTES,
        "CODEX_MCP_FILESYSTEM_MAX_TOTAL_BYTES",
      ),
    };
  if (env.CODEX_MCP_FILESYSTEM_MAX_SEARCH_RESULTS)
    merged.filesystem = {
      ...(merged.filesystem as object),
      maxSearchResults: parseIntEnv(
        env.CODEX_MCP_FILESYSTEM_MAX_SEARCH_RESULTS,
        "CODEX_MCP_FILESYSTEM_MAX_SEARCH_RESULTS",
      ),
    };
  if (env.CODEX_MCP_FILESYSTEM_ALLOW_WRITE)
    merged.filesystem = {
      ...(merged.filesystem as object),
      allowWrite: parseBooleanEnv(env.CODEX_MCP_FILESYSTEM_ALLOW_WRITE),
    };

  if (env.CODEX_MCP_WEB_SEARCH_ENABLED)
    merged.web = {
      ...(merged.web as object),
      searchEnabled: parseBooleanEnv(env.CODEX_MCP_WEB_SEARCH_ENABLED),
    };
  if (env.CODEX_MCP_WEB_FETCH_ENABLED)
    merged.web = {
      ...(merged.web as object),
      fetchEnabled: parseBooleanEnv(env.CODEX_MCP_WEB_FETCH_ENABLED),
    };
  if (env.CODEX_MCP_WEB_PROVIDER)
    merged.web = {
      ...(merged.web as object),
      provider: env.CODEX_MCP_WEB_PROVIDER,
    };
  if (env.CODEX_MCP_TAVILY_API_KEY)
    merged.web = {
      ...(merged.web as object),
      tavilyApiKey: env.CODEX_MCP_TAVILY_API_KEY,
    };
  if (env.CODEX_MCP_WEB_MAX_RESULTS)
    merged.web = {
      ...(merged.web as object),
      maxResults: parseIntEnv(
        env.CODEX_MCP_WEB_MAX_RESULTS,
        "CODEX_MCP_WEB_MAX_RESULTS",
      ),
    };
  if (env.CODEX_MCP_WEB_MAX_FETCH_BYTES)
    merged.web = {
      ...(merged.web as object),
      maxFetchBytes: parseIntEnv(
        env.CODEX_MCP_WEB_MAX_FETCH_BYTES,
        "CODEX_MCP_WEB_MAX_FETCH_BYTES",
      ),
    };
  if (env.CODEX_MCP_WEB_TIMEOUT_MS)
    merged.web = {
      ...(merged.web as object),
      timeoutMs: parseIntEnv(
        env.CODEX_MCP_WEB_TIMEOUT_MS,
        "CODEX_MCP_WEB_TIMEOUT_MS",
      ),
    };
  if (env.CODEX_MCP_WEB_USER_AGENT)
    merged.web = {
      ...(merged.web as object),
      userAgent: env.CODEX_MCP_WEB_USER_AGENT,
    };
  if (env.CODEX_MCP_WEB_ALLOW_LOCALHOST)
    merged.web = {
      ...(merged.web as object),
      allowLocalhost: parseBooleanEnv(env.CODEX_MCP_WEB_ALLOW_LOCALHOST),
    };

  if (env.CODEX_MCP_LOG_LEVEL)
    merged.logging = {
      ...(merged.logging as object),
      errorLogging: env.CODEX_MCP_LOG_LEVEL,
    };
  if (env.CODEX_MCP_LOG_DIR)
    merged.logging = {
      ...(merged.logging as object),
      directory: env.CODEX_MCP_LOG_DIR,
    };
  if (env.CODEX_MCP_LOG_MAX_SIZE_MB)
    merged.logging = {
      ...(merged.logging as object),
      maxFileSizeMb: parseIntEnv(
        env.CODEX_MCP_LOG_MAX_SIZE_MB,
        "CODEX_MCP_LOG_MAX_SIZE_MB",
      ),
    };
  if (env.CODEX_MCP_LOG_RETENTION_DAYS)
    merged.logging = {
      ...(merged.logging as object),
      retentionDays: parseIntEnv(
        env.CODEX_MCP_LOG_RETENTION_DAYS,
        "CODEX_MCP_LOG_RETENTION_DAYS",
      ),
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
