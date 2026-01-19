import fs from "node:fs";
import { expandHome } from "../utils/paths.js";

export type ResolvedAuth =
  | { type: "cli"; authPath: string }
  | { type: "api_key"; apiKey: string };

export class AuthError extends Error {
  name = "AuthError";
}

function readApiKeyFromFile(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.trim();
  } catch (err) {
    throw new AuthError(
      `Unable to read API key file at ${filePath}. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateApiKeyLike(value: string, sourceLabel: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 20) {
    throw new AuthError(`Invalid API key from ${sourceLabel} (too short)`);
  }
  return trimmed;
}

export function resolveAuth(opts: {
  mode: "auto" | "cli" | "api_key";
  cliAuthPath: string;
  apiKey?: string;
  apiKeyEnvVar: string;
  apiKeyEnvVarAlt?: string;
  apiKeyFileEnvVar: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedAuth {
  const env = opts.env ?? process.env;
  const authPath = expandHome(opts.cliAuthPath);

  const tryApiKey = (): string | undefined => {
    if (opts.apiKey) {
      return validateApiKeyLike(opts.apiKey, "config.auth.apiKey");
    }

    const apiKeyFile = env[opts.apiKeyFileEnvVar];
    if (apiKeyFile) {
      const apiKeyPath = expandHome(apiKeyFile);
      const key = readApiKeyFromFile(apiKeyPath);
      return validateApiKeyLike(key, opts.apiKeyFileEnvVar);
    }

    const envKey = env[opts.apiKeyEnvVar];
    if (envKey) {
      return validateApiKeyLike(envKey, opts.apiKeyEnvVar);
    }

    if (opts.apiKeyEnvVarAlt) {
      const envKeyAlt = env[opts.apiKeyEnvVarAlt];
      if (envKeyAlt) {
        return validateApiKeyLike(envKeyAlt, opts.apiKeyEnvVarAlt);
      }
    }

    return undefined;
  };

  const hasCliAuth = fs.existsSync(authPath);

  if (opts.mode === "api_key") {
    const apiKey = tryApiKey();
    if (!apiKey) {
      throw new AuthError(
        `Missing API key. Set ${opts.apiKeyEnvVar} (or ${opts.apiKeyEnvVarAlt}) or ${opts.apiKeyFileEnvVar}.`,
      );
    }
    return { type: "api_key", apiKey };
  }

  if (opts.mode === "cli") {
    if (!hasCliAuth) {
      throw new AuthError(
        `No Codex CLI credentials found at ${authPath}. Run "codex login" or set CODEX_MCP_AUTH_MODE=api_key with an API key.`,
      );
    }
    return { type: "cli", authPath };
  }

  if (hasCliAuth) {
    return { type: "cli", authPath };
  }

  const apiKey = tryApiKey();
  if (apiKey) return { type: "api_key", apiKey };

  throw new AuthError(
    `No Codex CLI credentials found at ${authPath} and no API key provided. Run "codex login" or set CODEX_MCP_AUTH_MODE=api_key with ${opts.apiKeyEnvVar}.`,
  );
}
