import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { fetchWeb } from "../services/web.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  url: z.string().min(1),
  maxBytes: z.number().int().positive().optional(),
};

type CodexWebFetchArgs = {
  url: string;
  maxBytes?: number;
};

export function registerCodexWebFetchTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_web_fetch",
    {
      title: "Codex Web Fetch",
      description: "Fetch a URL and return its text content.",
      inputSchema,
    },
    async (args: CodexWebFetchArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        if (!deps.config.web.fetchEnabled) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Web fetch is disabled. Set CODEX_MCP_WEB_FETCH_ENABLED=true to enable.",
              },
            ],
          };
        }
        const url = args.url.trim();
        if (!url) {
          return {
            isError: true,
            content: [
              { type: "text", text: "url must be a non-empty string." },
            ],
          };
        }
        if (url.length > deps.config.limits.maxInputChars) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `URL exceeds max input size (${deps.config.limits.maxInputChars} chars).`,
              },
            ],
          };
        }

        const maxBytes = Math.min(
          args.maxBytes ?? deps.config.web.maxFetchBytes,
          deps.config.web.maxFetchBytes,
        );

        const result = await fetchWeb({
          url,
          maxBytes,
          timeoutMs: deps.config.web.timeoutMs,
          userAgent: deps.config.web.userAgent,
          allowLocalhost: deps.config.web.allowLocalhost,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_web_fetch failed", {
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
