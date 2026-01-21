import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { readFileWithLimits } from "../services/filesystem.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
};

type CodexReadFileArgs = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export function registerCodexReadFileTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_read_file",
    {
      title: "Codex Read File",
      description:
        "Read a local file within configured filesystem roots. Returns line-numbered output.",
      inputSchema,
    },
    async (args: CodexReadFileArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        const text = await readFileWithLimits({
          inputPath: args.path,
          roots: deps.config.filesystem.roots,
          maxFileBytes: deps.config.filesystem.maxFileBytes,
          startLine: args.startLine,
          endLine: args.endLine,
        });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_read_file failed", {
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
