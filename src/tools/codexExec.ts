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
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  prompt: z.string().min(1),
  model: z.string().optional(),
  profile: z.string().optional(),
  cwd: z.string().optional(),
  addDirs: z.array(z.string()).optional(),
  configOverrides: z.array(z.string()).optional(),
  skipGitRepoCheck: z.boolean().default(false),
  sandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .optional(),
  askForApproval: z
    .enum(["untrusted", "on-failure", "on-request", "never"])
    .optional(),
  images: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  useJson: z.boolean().default(false),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
};

type CodexExecArgs = {
  prompt: string;
  model?: string;
  profile?: string;
  cwd?: string;
  addDirs?: string[];
  configOverrides?: string[];
  skipGitRepoCheck?: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  askForApproval?: "untrusted" | "on-failure" | "on-request" | "never";
  images?: string[];
  timeoutMs?: number;
  useJson?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

function buildCodexExecArgs(
  args: CodexExecArgs,
  config: SharedDependencies["config"],
): string[] {
  const out: string[] = ["exec", "-"];

  if (args.useJson) out.push("--json");
  if (args.model) out.push("--model", args.model);
  else if (config.cli.defaultModel)
    out.push("--model", config.cli.defaultModel);
  if (args.profile) out.push("--profile", args.profile);
  if (args.skipGitRepoCheck) out.push("--skip-git-repo-check");
  if (args.sandbox) out.push("--sandbox", args.sandbox);
  if (args.askForApproval) out.push("--ask-for-approval", args.askForApproval);
  if (config.cli.color) out.push("--color", config.cli.color);

  if (args.cwd) out.push("--cd", args.cwd);
  if (args.addDirs) {
    for (const dir of args.addDirs) out.push("--add-dir", dir);
  }
  if (args.images) {
    for (const img of args.images) out.push("--image", img);
  }
  if (args.configOverrides) {
    for (const entry of args.configOverrides) out.push("-c", entry);
  }

  return out;
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

export function registerCodexExecTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_exec",
    {
      title: "Codex Exec",
      description: "Run Codex exec (CLI-first, API fallback).",
      inputSchema,
    },
    async (args: CodexExecArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;
      try {
        const prompt = args.prompt.trim();
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

        await deps.rateLimiter.checkOrThrow();
        await deps.dailyBudget.checkOrThrow();

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
          const outputFile = args.useJson
            ? null
            : path.join(os.tmpdir(), `codex-output-${randomUUID()}.txt`);

          const cliArgs = buildCodexExecArgs(args, deps.config);
          if (outputFile) {
            cliArgs.push("--output-last-message", outputFile);
          }

          const result = await runCodexCommand({
            command: deps.config.cli.command,
            args: cliArgs,
            input: prompt,
            cwd: args.cwd,
            env: process.env,
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

          if (args.useJson) {
            text = result.stdout.trim();
          } else if (outputFile) {
            text = (await readOutputFile(outputFile)) ?? result.stdout.trim();
          } else {
            text = result.stdout.trim();
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

        if (outputTokens === 0) {
          outputTokens = estimateTokensFromChars(text.length);
        }
        await deps.dailyBudget.commit(
          "codex_exec",
          inputTokens + outputTokens,
          undefined,
          reservation,
        );
        committed = true;

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        if (reservation && !committed) {
          try {
            await deps.dailyBudget.release(reservation);
          } catch (releaseError) {
            deps.logger.error(
              "Failed to release codex_exec budget reservation",
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
        deps.logger.error("codex_exec failed", {
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
