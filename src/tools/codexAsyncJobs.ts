import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { jobManager, type JobStatus } from "../services/jobManager.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import { runCodexCommand } from "../services/codexCli.js";
import { runOpenAI } from "../services/openaiClient.js";
import { isTrustedCwd } from "../utils/trustDirs.js";

const execAsyncSchema = {
  prompt: z.string().min(1),
  model: z.string().optional(),
  cwd: z.string().optional(),
  skipGitRepoCheck: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
};

const jobStatusSchema = {
  jobId: z.string().min(1).describe("The job ID to check"),
};

const jobCancelSchema = {
  jobId: z.string().min(1).describe("The job ID to cancel"),
};

const jobResultSchema = {
  jobId: z.string().min(1).describe("The job ID to get results for"),
  waitMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional time to wait for completion (max 30000ms)"),
};

type ExecAsyncArgs = {
  prompt: string;
  model?: string;
  cwd?: string;
  skipGitRepoCheck?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

/**
 * Register async job tools for long-running operations.
 * These tools allow clients to start jobs and poll for results.
 */
export function registerCodexAsyncJobsTools(
  server: McpServer,
  deps: SharedDependencies,
): void {
  // Tool: Start async exec
  server.registerTool(
    "codex_exec_async",
    {
      title: "Codex Exec (Async)",
      description:
        "Start a long-running Codex exec as a background job. Returns a job ID immediately. Use codex_job_status to check progress and codex_job_result to get the output.",
      inputSchema: execAsyncSchema,
    },
    async (args: ExecAsyncArgs) => {
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

      const jobId = jobManager.createJob(
        async (job, updateProgress) => {
          updateProgress(10);

          const auth = resolveAuth({
            mode: deps.config.auth.mode,
            cliAuthPath: deps.config.auth.cliAuthPath,
            apiKey: deps.config.auth.apiKey,
            apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
            apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
            apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
            env: process.env,
          });

          updateProgress(20);

          let text = "";

          if (auth.type === "cli") {
            const cwdForTrust = args.cwd ?? process.cwd();
            const skipGitRepoCheck =
              args.skipGitRepoCheck ||
              isTrustedCwd(cwdForTrust, deps.config.trust.trustedDirs);

            const cliArgs = ["exec", "-"];
            if (args.model) cliArgs.push("--model", args.model);
            else if (deps.config.cli.defaultModel)
              cliArgs.push("--model", deps.config.cli.defaultModel);
            if (skipGitRepoCheck) cliArgs.push("--skip-git-repo-check");
            if (args.cwd) cliArgs.push("--cd", args.cwd);

            updateProgress(30);

            const result = await runCodexCommand({
              command: deps.config.cli.command,
              args: cliArgs,
              input: prompt,
              cwd: args.cwd,
              env: process.env,
              timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
            });

            updateProgress(90);
            text = result.stdout.trim() || result.stderr.trim();
          } else {
            updateProgress(30);

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

            updateProgress(90);
            text = apiResult.text;
          }

          // Commit tokens to budget
          const inputTokens = estimateTokensFromChars(prompt.length);
          const outputTokens = estimateTokensFromChars(text.length || 1);
          await deps.dailyBudget.commit(
            "codex_exec_async",
            inputTokens + outputTokens,
          );

          return text;
        },
        { prompt: prompt.substring(0, 100), cwd: args.cwd },
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                jobId,
                status: "pending",
                message:
                  "Job started. Use codex_job_status to check progress or codex_job_result to get the output.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool: Check job status
  server.registerTool(
    "codex_job_status",
    {
      title: "Check Job Status",
      description:
        "Check the status of an async job. Returns status, progress, and completion time if finished.",
      inputSchema: jobStatusSchema,
    },
    async (args: { jobId: string }) => {
      const job = jobManager.getJob(args.jobId);
      if (!job) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Job not found: ${args.jobId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                error: job.error,
                metadata: job.metadata,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool: Get job result
  server.registerTool(
    "codex_job_result",
    {
      title: "Get Job Result",
      description:
        "Get the result of a completed async job. Optionally wait for completion.",
      inputSchema: jobResultSchema,
    },
    async (args: { jobId: string; waitMs?: number }) => {
      const waitMs = Math.min(args.waitMs ?? 0, 30000);

      let job = jobManager.getJob(args.jobId);
      if (!job) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Job not found: ${args.jobId}`,
            },
          ],
        };
      }

      // Wait if requested and job is not complete
      if (
        waitMs > 0 &&
        job.status !== "completed" &&
        job.status !== "failed" &&
        job.status !== "cancelled"
      ) {
        job = await jobManager.waitForJob(args.jobId, waitMs);
        if (!job) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Job not found: ${args.jobId}`,
              },
            ],
          };
        }
      }

      if (job.status === "pending" || job.status === "running") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  jobId: job.id,
                  status: job.status,
                  progress: job.progress,
                  message:
                    "Job is still running. Check back later or use waitMs parameter.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (job.status === "failed") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  jobId: job.id,
                  status: "failed",
                  error: job.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (job.status === "cancelled") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  jobId: job.id,
                  status: "cancelled",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: String(job.result ?? ""),
          },
        ],
      };
    },
  );

  // Tool: Cancel job
  server.registerTool(
    "codex_job_cancel",
    {
      title: "Cancel Job",
      description: "Cancel a running or pending async job.",
      inputSchema: jobCancelSchema,
    },
    async (args: { jobId: string }) => {
      const cancelled = jobManager.cancelJob(args.jobId);
      if (!cancelled) {
        const job = jobManager.getJob(args.jobId);
        if (!job) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Job not found: ${args.jobId}`,
              },
            ],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Cannot cancel job in ${job.status} state.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                jobId: args.jobId,
                cancelled: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool: List jobs
  server.registerTool(
    "codex_job_list",
    {
      title: "List Jobs",
      description: "List all async jobs, optionally filtered by status.",
      inputSchema: {
        status: z
          .enum(["pending", "running", "completed", "failed", "cancelled"])
          .optional()
          .describe("Filter by job status"),
      },
    },
    async (args: { status?: JobStatus }) => {
      const jobs = jobManager.listJobs(args.status);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: jobs.length,
                jobs,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
