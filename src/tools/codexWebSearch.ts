import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { searchWeb } from "../services/web.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  query: z.string().min(1),
  maxResults: z.number().int().positive().optional(),
};

type CodexWebSearchArgs = {
  query: string;
  maxResults?: number;
};

export function registerCodexWebSearchTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_web_search",
    {
      title: "Codex Web Search",
      description: "Search the web using the configured provider.",
      inputSchema,
    },
    async (args: CodexWebSearchArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        if (!deps.config.web.searchEnabled) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Web search is disabled. Set CODEX_MCP_WEB_SEARCH_ENABLED=true to enable.",
              },
            ],
          };
        }
        const query = args.query.trim();
        if (!query) {
          return {
            isError: true,
            content: [
              { type: "text", text: "query must be a non-empty string." },
            ],
          };
        }
        if (query.length > deps.config.limits.maxInputChars) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Query exceeds max input size (${deps.config.limits.maxInputChars} chars).`,
              },
            ],
          };
        }

        const maxResults = Math.min(
          args.maxResults ?? deps.config.web.maxResults,
          deps.config.web.maxResults,
        );

        const results = await searchWeb({
          query,
          provider: deps.config.web.provider,
          apiKey: deps.config.web.tavilyApiKey,
          maxResults,
          timeoutMs: deps.config.web.timeoutMs,
          userAgent: deps.config.web.userAgent,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ query, results }),
            },
          ],
        };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_web_search failed", {
          error: redactString(formatted.message),
        });
        deps.errorLogger.logError({
          toolName: "codex_web_search",
          toolArgs: args as Record<string, unknown>,
          error,
        });
        return {
          isError: true,
          content: [{ type: "text", text: formatted.message }],
        };
      }
    },
  );
}
