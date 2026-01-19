import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import { runCodexCommand, CodexCliError } from "../services/codexCli.js";
import { runOpenAI } from "../services/openaiClient.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  prompt: z.string().optional(),
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

function buildCodexReviewArgs(args: CodexReviewArgs): {
  args: string[];
  input: string;
} {
  const out: string[] = ["review", "-"];
  if (args.uncommitted) out.push("--uncommitted");
  if (args.base) out.push("--base", args.base);
  if (args.commit) out.push("--commit", args.commit);
  if (args.title) out.push("--title", args.title);
  if (args.configOverrides) {
    for (const entry of args.configOverrides) out.push("-c", entry);
  }

  const input = args.prompt ? args.prompt.trim() : "";
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
      description: "Run Codex review (CLI-first, API fallback).",
      inputSchema,
    },
    async (args: CodexReviewArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;
      try {
        await deps.rateLimiter.checkOrThrow();
        await deps.dailyBudget.checkOrThrow();

        const auth = resolveAuth({
          mode: deps.config.auth.mode,
          cliAuthPath: deps.config.auth.cliAuthPath,
          apiKey: deps.config.auth.apiKey,
          apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
          apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
          apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
          env: process.env,
        });

        let text = "";
        let inputTokens = 0;
        let outputTokens = 0;

        if (auth.type === "cli") {
          const { args: cliArgs, input } = buildCodexReviewArgs(args);
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
            timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
          });

          if (result.exitCode !== 0) {
            const err = new CodexCliError(
              `Codex CLI exited with ${result.exitCode}`,
            );
            err.exitCode = result.exitCode ?? undefined;
            err.stderr = result.stderr;
            throw err;
          }

          text = result.stdout.trim();
          inputTokens = estimateTokensFromChars(inputPrompt.length || 1);
          outputTokens = estimateTokensFromChars(text.length);

          await deps.dailyBudget.commit(
            "codex_review",
            inputTokens + outputTokens,
            undefined,
            reservation,
          );
          committed = true;
        } else {
          const diff = args.diff?.trim();
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
