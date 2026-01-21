import { AuthError } from "../auth/resolveAuth.js";
import {
  ConfigError,
  FilesystemError,
  PatchError,
  WebError,
} from "../errors.js";
import { BudgetError } from "../limits/dailyTokenBudget.js";
import { RateLimitError as LocalRateLimitError } from "../limits/rateLimiter.js";
import { CodexCliError } from "../services/codexCli.js";
import { OpenAIError, formatOpenAIError } from "../services/openaiClient.js";
import { redactString } from "./redact.js";

export type ToolErrorInfo = { message: string };

export function formatToolError(error: unknown): ToolErrorInfo {
  if (error instanceof ConfigError) {
    return { message: error.message || "Configuration error." };
  }

  if (error instanceof FilesystemError) {
    return { message: error.message || "Filesystem access error." };
  }

  if (error instanceof PatchError) {
    return { message: error.message || "Patch validation error." };
  }

  if (error instanceof WebError) {
    return { message: error.message || "Web request error." };
  }

  if (error instanceof AuthError) {
    return { message: error.message || "Authentication failed." };
  }

  if (error instanceof LocalRateLimitError) {
    return { message: "Rate limit exceeded. Wait a minute and retry." };
  }

  if (error instanceof BudgetError) {
    return {
      message:
        "Daily token budget exceeded. Reduce usage or increase CODEX_MCP_MAX_TOKENS_PER_DAY.",
    };
  }

  if (error instanceof OpenAIError) {
    return { message: formatOpenAIError(error) };
  }

  if (error instanceof CodexCliError) {
    const detail = error.stderr ? `\n${redactString(error.stderr)}` : "";
    return {
      message: `Codex CLI failed${detail}`,
    };
  }

  if (error instanceof Error) {
    return { message: "Unexpected error. Check server logs for details." };
  }

  return { message: "Unexpected error. Check server logs for details." };
}
