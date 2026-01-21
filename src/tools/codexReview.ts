import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import { runCodexCommand, CodexCliError } from "../services/codexCli.js";
import { runOpenAI } from "../services/openaiClient.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";
import { isTrustedCwd } from "../utils/trustDirs.js";

const inputSchema = {
  prompt: z.string().optional(),
  cwd: z.string().optional(),
  skipGitRepoCheck: z.boolean().default(false),
  base: z.string().optional(),
  commit: z.string().optional(),
  uncommitted: z.boolean().default(false),
  title: z.string().optional(),
  diff: z.string().optional(),
  configOverrides: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  model: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
};

type CodexReviewArgs = {
  prompt?: string;
  cwd?: string;
  skipGitRepoCheck?: boolean;
  base?: string;
  commit?: string;
  uncommitted?: boolean;
  title?: string;
  diff?: string;
  configOverrides?: string[];
  timeoutMs?: number;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function buildCodexReviewArgs(args: CodexReviewArgs): {
  args: string[];
  input: string;
} {
  const out: string[] = ["review"];
  if (args.skipGitRepoCheck) out.push("--skip-git-repo-check");
  if (args.uncommitted) out.push("--uncommitted");
  if (args.base) out.push("--base", args.base);
  if (args.commit) out.push("--commit", args.commit);
  if (args.title) out.push("--title", args.title);
  if (args.configOverrides) {
    for (const entry of args.configOverrides) out.push("-c", entry);
  }

  const ignorePrompt = Boolean(args.uncommitted || args.base || args.commit);
  const input = ignorePrompt ? "" : args.prompt ? args.prompt.trim() : "";
  if (input) {
    out.push("-");
  }
  return { args: out, input };
}

export function registerCodexReviewTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_review",
    {
      title: "Codex Review",
      description:
        "Run Codex review (CLI-first, API fallback). CLI mode must run inside a git repo (use cwd); use skipGitRepoCheck for trusted paths if needed. Note: Codex CLI does not accept prompt with uncommitted/base/commit; prompt is ignored when those flags are used. Diff-only reviews require API-key mode.",
      inputSchema,
    },
    async (args: CodexReviewArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;
      try {
        await deps.rateLimiter.checkOrThrow();
        await deps.dailyBudget.checkOrThrow();

        const diff = args.diff?.trim();
        const wantsDiffReview = Boolean(diff);

        if (wantsDiffReview && deps.config.auth.mode === "cli") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Diff reviews require API-key auth. Set CODEX_MCP_AUTH_MODE=api_key and provide an API key (OPENAI_API_KEY / OPENAI_API_KEY_FILE), or omit diff and run a repo-based review (uncommitted/base/commit) in CLI mode.",
              },
            ],
          };
        }

        let auth: ReturnType<typeof resolveAuth>;
        if (wantsDiffReview) {
          try {
            auth = resolveAuth({
              mode: "api_key",
              cliAuthPath: deps.config.auth.cliAuthPath,
              apiKey: deps.config.auth.apiKey,
              apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
              apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
              apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
              env: process.env,
            });
          } catch (resolveError) {
            const formatted = formatToolError(resolveError);
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Diff reviews require API-key auth.\n${formatted.message}`,
                },
              ],
            };
          }
        } else {
          auth = resolveAuth({
            mode: deps.config.auth.mode,
            cliAuthPath: deps.config.auth.cliAuthPath,
            apiKey: deps.config.auth.apiKey,
            apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
            apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
            apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
            env: process.env,
          });
        }

        let text = "";
        let inputTokens = 0;
        let outputTokens = 0;

        if (auth.type === "cli") {
          const effectiveArgs = {
            ...args,
            skipGitRepoCheck:
              args.skipGitRepoCheck ||
              isTrustedCwd(args.cwd, deps.config.trust.trustedDirs),
          };
          const { args: cliArgs, input } = buildCodexReviewArgs(effectiveArgs);
          const inputPrompt = input || "";
          if (inputPrompt.length > deps.config.limits.maxInputChars) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Prompt exceeds max input size (${deps.config.limits.maxInputChars} chars).`,
                },
              ],
            };
          }

          reservation = await deps.dailyBudget.reserve(
            estimateTokensFromChars(inputPrompt.length || 1),
          );

          const result = await runCodexCommand({
            command: deps.config.cli.command,
            args: cliArgs,
            input: inputPrompt || "",
            cwd: args.cwd,
            env: process.env,
            timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
          });

          const stdout = result.stdout.trim();
          const stderr = result.stderr.trim();
          const combined = [stdout, stderr].filter(Boolean).join("\n");
          const output = stdout || stderr;

          const fatal =
            combined.toLowerCase().includes("fatal error") ||
            (combined.toLowerCase().includes("error:") &&
              combined.toLowerCase().includes("usage:")) ||
            combined.includes("Not inside a trusted directory");

          if (result.exitCode !== 0 && !(result.exitCode === 1 && !fatal)) {
            const err = new CodexCliError(
              `Codex CLI exited with ${result.exitCode}`,
            );
            err.exitCode = result.exitCode ?? undefined;
            err.stderr = result.stderr;
            throw err;
          }

          text = output;
          inputTokens = estimateTokensFromChars(inputPrompt.length || 1);
          outputTokens = estimateTokensFromChars(text.length || 1);

          await deps.dailyBudget.commit(
            "codex_review",
            inputTokens + outputTokens,
            undefined,
            reservation,
          );
          committed = true;
        } else {
          if (!diff) {
            throw new Error("API mode requires a diff payload.");
          }
          const prompt = [
            args.prompt?.trim() ||
              "Review the following diff for bugs, regressions, and risks.",
            "",
            diff,
          ].join("\n");

          if (prompt.length > deps.config.limits.maxInputChars) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Prompt exceeds max input size (${deps.config.limits.maxInputChars} chars).`,
                },
              ],
            };
          }

          reservation = await deps.dailyBudget.reserve(
            estimateTokensFromChars(prompt.length),
          );

          const apiResult = await runOpenAI({
            apiKey: auth.apiKey,
            baseUrl: deps.config.api.baseUrl,
            model: args.model ?? deps.config.api.model,
            prompt,
            temperature: args.temperature ?? deps.config.api.temperature,
            maxOutputTokens:
              args.maxOutputTokens ?? deps.config.api.maxOutputTokens,
            timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
          });

          text = apiResult.text;
          inputTokens =
            apiResult.usage?.inputTokens ??
            estimateTokensFromChars(prompt.length);
          outputTokens =
            apiResult.usage?.outputTokens ??
            estimateTokensFromChars(text.length);

          await deps.dailyBudget.commit(
            "codex_review",
            inputTokens + outputTokens,
            undefined,
            reservation,
          );
          committed = true;
        }

        if (!text) {
          throw new Error("Codex produced no output.");
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        if (reservation && !committed) {
          try {
            await deps.dailyBudget.release(reservation);
          } catch (releaseError) {
            deps.logger.error(
              "Failed to release codex_review budget reservation",
              {
                error: redactString(
                  releaseError instanceof Error
                    ? releaseError.message
                    : String(releaseError),
                ),
              },
            );
          }
        }
        const formatted = formatToolError(error);
        deps.logger.error("codex_review failed", {
          error: redactString(formatted.message),
        });
        return {
          isError: true,
          content: [{ type: "text", text: formatted.message }],
        };
      }
    },
  );
}
