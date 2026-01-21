import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import { runCodexCommand, CodexCliError } from "../services/codexCli.js";
import { runOpenAI } from "../services/openaiClient.js";
import { collectFiles } from "../services/filesystem.js";
import {
  applyPatch,
  buildCodeFixPrompt,
  extractUnifiedDiff,
  validateUnifiedDiff,
} from "../services/codeFix.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";
import { isTrustedCwd } from "../utils/trustDirs.js";

const inputSchema = {
  request: z.string().min(1),
  paths: z.array(z.string()).optional(),
  apply: z.boolean().default(false),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  skipGitRepoCheck: z.boolean().default(false),
};

type CodexCodeFixArgs = {
  request: string;
  paths?: string[];
  apply?: boolean;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  skipGitRepoCheck?: boolean;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

async function readOutputFile(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw.trim();
  } catch {
    return null;
  } finally {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }
}

export function registerCodexCodeFixTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_code_fix",
    {
      title: "Codex Code Fix",
      description:
        "Generate a unified diff for requested changes using local files (repo-aware). Optional apply uses git apply.",
      inputSchema,
    },
    async (args: CodexCodeFixArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;

      try {
        await deps.rateLimiter.checkOrThrow();
        await deps.dailyBudget.checkOrThrow();

        const paths = args.paths ?? ["."];
        if (paths.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: "paths must not be empty." }],
          };
        }

        const { root, files } = await collectFiles({
          paths,
          roots: deps.config.filesystem.roots,
          maxFiles: deps.config.filesystem.maxFiles,
          maxFileBytes: deps.config.filesystem.maxFileBytes,
          maxTotalBytes: deps.config.filesystem.maxTotalBytes,
        });

        const prompt = buildCodeFixPrompt(args.request, files);
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
        let inputTokens = estimateTokensFromChars(prompt.length);
        let outputTokens = 0;

        if (auth.type === "cli") {
          const baseSkipGitRepoCheck =
            args.skipGitRepoCheck ||
            isTrustedCwd(root, deps.config.trust.trustedDirs);
          const outputFile = path.join(
            os.tmpdir(),
            `codex-code-fix-${randomUUID()}.txt`,
          );

          const buildArgs = (opts?: {
            disableDefaultModel?: boolean;
            skipGitRepoCheck?: boolean;
          }): string[] => {
            const cliArgs: string[] = ["exec", "-"];
            const disableDefaultModel = opts?.disableDefaultModel ?? false;
            const skipGitRepoCheck =
              opts?.skipGitRepoCheck ?? baseSkipGitRepoCheck;
            if (args.model) cliArgs.push("--model", args.model);
            else if (!disableDefaultModel && deps.config.cli.defaultModel)
              cliArgs.push("--model", deps.config.cli.defaultModel);
            if (skipGitRepoCheck) cliArgs.push("--skip-git-repo-check");
            if (deps.config.cli.color)
              cliArgs.push("--color", deps.config.cli.color);
            cliArgs.push("--output-last-message", outputFile);
            return cliArgs;
          };

          const runOnce = async (opts?: {
            disableDefaultModel?: boolean;
            skipGitRepoCheck?: boolean;
          }): Promise<Awaited<ReturnType<typeof runCodexCommand>>> => {
            return runCodexCommand({
              command: deps.config.cli.command,
              args: buildArgs(opts),
              input: prompt,
              cwd: root,
              env: process.env,
              timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
            });
          };

          let result = await runOnce();
          if (
            result.exitCode !== 0 &&
            !baseSkipGitRepoCheck &&
            result.stderr.includes("Not inside a trusted directory") &&
            result.stderr.includes("skip-git-repo-check")
          ) {
            result = await runOnce({ skipGitRepoCheck: true });
          }

          if (
            result.exitCode !== 0 &&
            args.model === undefined &&
            result.stderr
              .toLowerCase()
              .includes("not supported when using codex with a chatgpt account")
          ) {
            result = await runOnce({ disableDefaultModel: true });
          }

          const stdout = result.stdout.trim();
          const stderr = result.stderr.trim();
          const combined = [stdout, stderr].filter(Boolean).join("\n");
          const combinedLower = combined.toLowerCase();
          const fatal =
            combinedLower.includes("fatal error") ||
            (combinedLower.includes("error:") &&
              combinedLower.includes("usage:")) ||
            combined.includes("Not inside a trusted directory");

          text = (await readOutputFile(outputFile)) ?? stdout;

          if (result.exitCode !== 0) {
            const allowNonFatal = result.exitCode === 1 && !fatal && text;
            if (!allowNonFatal) {
              const err = new CodexCliError(
                `Codex CLI exited with ${result.exitCode}`,
              );
              err.exitCode = result.exitCode ?? undefined;
              err.stderr = result.stderr;
              throw err;
            }
          }
        } else {
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
          if (apiResult.usage?.inputTokens)
            inputTokens = apiResult.usage.inputTokens;
          if (apiResult.usage?.outputTokens)
            outputTokens = apiResult.usage.outputTokens;
        }

        if (!text) {
          throw new Error("Codex produced no output.");
        }

        const diff = extractUnifiedDiff(text);
        validateUnifiedDiff(diff, root);

        if (args.apply) {
          if (!deps.config.filesystem.allowWrite) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Filesystem writes are disabled. Set filesystem.allowWrite or CODEX_MCP_FILESYSTEM_ALLOW_WRITE to enable apply.",
                },
              ],
            };
          }
          await applyPatch({ diff, cwd: root });
        }

        if (outputTokens === 0) {
          outputTokens = estimateTokensFromChars(text.length);
        }
        await deps.dailyBudget.commit(
          "codex_code_fix",
          inputTokens + outputTokens,
          undefined,
          reservation,
        );
        committed = true;

        const responseText = args.apply
          ? `Applied patch successfully.\n\n${diff}`
          : diff;
        return { content: [{ type: "text", text: responseText }] };
      } catch (error) {
        if (reservation && !committed) {
          try {
            await deps.dailyBudget.release(reservation);
          } catch (releaseError) {
            deps.logger.error(
              "Failed to release codex_code_fix budget reservation",
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
        deps.logger.error("codex_code_fix failed", {
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
