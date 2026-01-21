import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import {
  runCodexCommand,
  runCodexCommandStream,
  CodexCliError,
} from "../services/codexCli.js";
import { runOpenAI, runOpenAIStream } from "../services/openaiClient.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";
import { isTrustedCwd } from "../utils/trustDirs.js";
import {
  validateImages,
  ImageValidationError,
  type ImageInput,
} from "../utils/imageValidation.js";

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
  stream: z.boolean().default(false),
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
  stream?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

function buildCodexExecArgs(
  args: CodexExecArgs,
  config: SharedDependencies["config"],
  opts: { disableDefaultModel?: boolean } = {},
): string[] {
  const out: string[] = [];

  if (args.askForApproval) out.push("--ask-for-approval", args.askForApproval);
  out.push("exec", "-");

  if (args.useJson) out.push("--json");
  if (args.model) out.push("--model", args.model);
  else if (!opts.disableDefaultModel && config.cli.defaultModel)
    out.push("--model", config.cli.defaultModel);
  if (args.profile) out.push("--profile", args.profile);
  if (args.skipGitRepoCheck) out.push("--skip-git-repo-check");
  if (args.sandbox) out.push("--sandbox", args.sandbox);
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

/**
 * Run Codex CLI with streaming JSONL output.
 * Returns a promise that resolves with the collected text and result.
 */
async function runCliStreaming(opts: {
  command: string;
  args: string[];
  input: string;
  cwd?: string;
  timeoutMs: number;
}): Promise<{ text: string; exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const emitter = runCodexCommandStream({
      command: opts.command,
      args: opts.args,
      input: opts.input,
      cwd: opts.cwd,
      env: process.env,
      timeoutMs: opts.timeoutMs,
    });

    const collectedText: string[] = [];

    emitter.on("text", (text) => {
      collectedText.push(text);
    });

    emitter.on("error", (error) => {
      reject(error);
    });

    emitter.on("end", (result) => {
      resolve({
        text: collectedText.join("") || result.stdout,
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    });
  });
}

/**
 * Run OpenAI API with streaming SSE output.
 * Returns a promise that resolves with the collected text and usage.
 */
async function runApiStreaming(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  images?: ImageInput[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<{
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}> {
  return new Promise((resolve, reject) => {
    const emitter = runOpenAIStream(opts);

    emitter.on("error", (error) => {
      reject(error);
    });

    emitter.on("end", (result) => {
      resolve(result);
    });
  });
}

export function registerCodexExecTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_exec",
    {
      title: "Codex Exec",
      description:
        "Run Codex exec (CLI-first, API fallback). Use cwd for code-related tasks; use skipGitRepoCheck when running outside a git repo.",
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

        // Validate images if provided
        let validatedImages: ImageInput[] | undefined;
        if (args.images && args.images.length > 0) {
          try {
            validatedImages = validateImages(
              args.images,
              deps.config.limits.maxImages,
              deps.config.limits.maxImageBytes,
            );
          } catch (error) {
            if (error instanceof ImageValidationError) {
              return {
                isError: true,
                content: [{ type: "text", text: error.message }],
              };
            }
            throw error;
          }
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
          const baseArgs: CodexExecArgs = {
            ...args,
            skipGitRepoCheck:
              args.skipGitRepoCheck ||
              isTrustedCwd(args.cwd, deps.config.trust.trustedDirs),
          };

          // Streaming mode: use JSONL streaming
          if (args.stream) {
            const streamArgs = buildCodexExecArgs(
              { ...baseArgs, useJson: true },
              deps.config,
            );
            const streamResult = await runCliStreaming({
              command: deps.config.cli.command,
              args: streamArgs,
              input: prompt,
              cwd: baseArgs.cwd,
              timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
            });
            text = streamResult.text.trim();
            const stderr = streamResult.stderr.trim();
            const combined = [text, stderr].filter(Boolean).join("\n");
            const combinedLower = combined.toLowerCase();
            const fatal =
              combinedLower.includes("fatal error") ||
              (combinedLower.includes("error:") &&
                combinedLower.includes("usage:")) ||
              combined.includes("Not inside a trusted directory");

            if (streamResult.exitCode !== 0) {
              const allowNonFatal =
                streamResult.exitCode === 1 && !fatal && text;
              if (!allowNonFatal) {
                const err = new CodexCliError(
                  `Codex CLI exited with ${streamResult.exitCode}`,
                );
                err.exitCode = streamResult.exitCode ?? undefined;
                err.stderr = streamResult.stderr;
                throw err;
              }
            }
          } else {
            // Non-streaming mode: use output file or buffered output
            const outputFile = args.useJson
              ? null
              : path.join(os.tmpdir(), `codex-output-${randomUUID()}.txt`);

            const buildArgs = (
              override?: Partial<CodexExecArgs>,
              buildOpts?: { disableDefaultModel?: boolean },
            ): string[] => {
              const merged: CodexExecArgs = {
                ...baseArgs,
                ...(override ?? {}),
              };
              const cliArgs = buildCodexExecArgs(
                merged,
                deps.config,
                buildOpts ?? {},
              );
              if (outputFile) cliArgs.push("--output-last-message", outputFile);
              return cliArgs;
            };

            const runOnce = async (
              override?: Partial<CodexExecArgs>,
              buildOpts?: { disableDefaultModel?: boolean },
            ): Promise<Awaited<ReturnType<typeof runCodexCommand>>> => {
              return runCodexCommand({
                command: deps.config.cli.command,
                args: buildArgs(override, buildOpts),
                input: prompt,
                cwd: baseArgs.cwd,
                env: process.env,
                timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
              });
            };

            let result = await runOnce();
            const retryOverride: Partial<CodexExecArgs> = {};
            const retryBuildOpts: { disableDefaultModel?: boolean } = {};
            if (
              result.exitCode !== 0 &&
              !baseArgs.skipGitRepoCheck &&
              result.stderr.includes("Not inside a trusted directory") &&
              result.stderr.includes("skip-git-repo-check")
            ) {
              retryOverride.skipGitRepoCheck = true;
              result = await runOnce(retryOverride);
            }

            if (
              result.exitCode !== 0 &&
              args.model === undefined &&
              result.stderr
                .toLowerCase()
                .includes(
                  "not supported when using codex with a chatgpt account",
                )
            ) {
              retryBuildOpts.disableDefaultModel = true;
              result = await runOnce(retryOverride, retryBuildOpts);
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

            if (args.useJson) {
              text = stdout;
            } else if (outputFile) {
              text = (await readOutputFile(outputFile)) ?? stdout;
            } else {
              text = stdout;
            }

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
          }
        } else {
          // API path: use streaming or non-streaming based on args.stream
          if (args.stream) {
            const apiResult = await runApiStreaming({
              apiKey: auth.apiKey,
              baseUrl: deps.config.api.baseUrl,
              model: args.model ?? deps.config.api.model,
              prompt,
              images: validatedImages,
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
          } else {
            const apiResult = await runOpenAI({
              apiKey: auth.apiKey,
              baseUrl: deps.config.api.baseUrl,
              model: args.model ?? deps.config.api.model,
              prompt,
              images: validatedImages,
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
