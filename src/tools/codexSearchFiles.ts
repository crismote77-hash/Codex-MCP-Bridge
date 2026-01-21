import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { searchFiles } from "../services/filesystem.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  pattern: z.string().min(1),
  mode: z.enum(["content", "path", "grep", "glob"]).default("content"),
  directory: z.string().optional(),
  filePattern: z.string().optional(),
  maxResults: z.number().int().positive().optional(),
};

type CodexSearchFilesArgs = {
  pattern: string;
  mode?: "content" | "path" | "grep" | "glob";
  directory?: string;
  filePattern?: string;
  maxResults?: number;
};

export function registerCodexSearchFilesTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_search_files",
    {
      title: "Codex Search Files",
      description:
        "Search files within configured filesystem roots (content or path glob).",
      inputSchema,
    },
    async (args: CodexSearchFilesArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        const pattern = args.pattern.trim();
        if (!pattern) {
          return {
            isError: true,
            content: [
              { type: "text", text: "pattern must be a non-empty string." },
            ],
          };
        }
        const maxResults = Math.min(
          args.maxResults ?? deps.config.filesystem.maxSearchResults,
          deps.config.filesystem.maxSearchResults,
        );
        const results = await searchFiles({
          roots: deps.config.filesystem.roots,
          directory: args.directory,
          pattern,
          mode: args.mode ?? "content",
          filePattern: args.filePattern,
          maxResults,
        });
        const text = results.length ? results.join("\n") : "No matches found.";
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_search_files failed", {
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
