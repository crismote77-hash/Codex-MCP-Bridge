import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { countTokensForText } from "../services/tokenizer.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  text: z.string().min(1),
  model: z.string().optional(),
};

type CodexCountTokensArgs = {
  text: string;
  model?: string;
};

export function registerCodexCountTokensTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_count_tokens",
    {
      title: "Codex Count Tokens",
      description:
        "Count tokens for a text input using the OpenAI tokenizer (model-aware).",
      inputSchema,
    },
    async (args: CodexCountTokensArgs) => {
      try {
        await deps.rateLimiter.checkOrThrow();
        const text = args.text.trim();
        if (!text) {
          return {
            isError: true,
            content: [
              { type: "text", text: "text must be a non-empty string." },
            ],
          };
        }
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
        const model = args.model?.trim() || deps.config.api.model;
        const result = countTokensForText(text, model);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                tokens: result.tokens,
                encoding: result.encoding,
                model,
              }),
            },
          ],
        };
      } catch (error) {
        const formatted = formatToolError(error);
        deps.logger.error("codex_count_tokens failed", {
          error: redactString(formatted.message),
        });
        deps.errorLogger.logError({
          toolName: "codex_count_tokens",
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
