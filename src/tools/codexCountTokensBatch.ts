import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { countTokensForBatch } from "../services/tokenizer.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  texts: z.array(z.string().min(1)).min(1),
  model: z.string().optional(),
};

type CodexCountTokensBatchArgs = {
  texts: string[];
  model?: string;
};

export function registerCodexCountTokensBatchTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_count_tokens_batch",
    {
      title: "Codex Count Tokens Batch",
      description:
        "Count tokens for multiple text inputs using the OpenAI tokenizer (model-aware).",
      inputSchema,
    },
    async (args: CodexCountTokensBatchArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        const texts = args.texts.map((text) => text.trim());
        if (texts.some((text) => !text)) {
          return {
            isError: true,
            content: [
              { type: "text", text: "texts must be non-empty strings." },
            ],
          };
        }
        for (const text of texts) {
          if (text.length > deps.config.limits.maxInputChars) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Text exceeds max input size (${deps.config.limits.maxInputChars} chars).`,
                },
              ],
            };
          }
        }
        const model = args.model?.trim() || deps.config.api.model;
        const result = countTokensForBatch(texts, model);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                tokens: result.tokens,
                total: result.total,
                encoding: result.encoding,
                model,
              }),
            },
          ],
        };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_count_tokens_batch failed", {
          error: redactString(formatted.message),
        });
        deps.errorLogger.logError({
          toolName: "codex_count_tokens_batch",
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
