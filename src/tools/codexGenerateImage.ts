import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import {
  generateImage,
  OpenAIImageError,
  formatImageError,
} from "../services/openaiImages.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  prompt: z
    .string()
    .min(1)
    .describe("Text description of the image to generate"),
  model: z
    .string()
    .optional()
    .describe("Image generation model (default: dall-e-3)"),
  size: z
    .enum(["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"])
    .optional()
    .describe("Image size (default: 1024x1024)"),
  quality: z
    .enum(["standard", "hd"])
    .optional()
    .describe("Image quality (default: standard, dall-e-3 only)"),
  style: z
    .enum(["vivid", "natural"])
    .optional()
    .describe("Image style (default: vivid, dall-e-3 only)"),
  n: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of images to generate (1-10, default: 1)"),
  responseFormat: z
    .enum(["url", "b64_json"])
    .optional()
    .describe("Response format (default: url)"),
  timeoutMs: z.number().int().positive().optional(),
};

type GenerateImageArgs = {
  prompt: string;
  model?: string;
  size?: "256x256" | "512x512" | "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
  n?: number;
  responseFormat?: "url" | "b64_json";
  timeoutMs?: number;
};

export function registerCodexGenerateImageTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_generate_image",
    {
      title: "Codex Generate Image",
      description:
        "Generate images using OpenAI's DALL-E API. API-key auth required; CLI mode is not supported.",
      inputSchema,
    },
    async (args: GenerateImageArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;
      try {
        if (args.prompt.length > deps.config.limits.maxInputChars) {
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

        const auth = resolveAuth({
          mode: deps.config.auth.mode,
          cliAuthPath: deps.config.auth.cliAuthPath,
          apiKey: deps.config.auth.apiKey,
          apiKeyEnvVar: deps.config.auth.apiKeyEnvVar,
          apiKeyEnvVarAlt: deps.config.auth.apiKeyEnvVarAlt,
          apiKeyFileEnvVar: deps.config.auth.apiKeyFileEnvVar,
          env: process.env,
        });

        if (auth.type === "cli") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Image generation requires API-key auth. Codex CLI does not support image generation. Set CODEX_MCP_AUTH_MODE=api_key and provide an API key.",
              },
            ],
          };
        }

        // Reserve tokens for the operation (image generation can be costly)
        reservation = await deps.dailyBudget.reserve(1000);

        const result = await generateImage({
          apiKey: auth.apiKey,
          baseUrl: deps.config.api.baseUrl,
          prompt: args.prompt,
          model: args.model,
          size: args.size,
          quality: args.quality,
          style: args.style,
          n: args.n,
          responseFormat: args.responseFormat,
          timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
        });

        // Commit tokens (estimate based on number of images)
        const tokens = (args.n ?? 1) * 500; // Rough estimate
        await deps.dailyBudget.commit(
          "codex_generate_image",
          tokens,
          undefined,
          reservation,
        );
        committed = true;

        // Format output
        const output = result.images.map((img, i) => ({
          index: i,
          ...(img.url ? { url: img.url } : {}),
          ...(img.b64_json ? { b64_json: img.b64_json } : {}),
          ...(img.revised_prompt ? { revised_prompt: img.revised_prompt } : {}),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        if (reservation && !committed) {
          try {
            await deps.dailyBudget.release(reservation);
          } catch (releaseError) {
            deps.logger.error(
              "Failed to release codex_generate_image budget reservation",
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

        let formatted: { message: string };
        if (error instanceof OpenAIImageError) {
          formatted = { message: formatImageError(error) };
        } else {
          formatted = formatToolError(error);
        }

        deps.logger.error("codex_generate_image failed", {
          error: redactString(formatted.message),
        });
        deps.errorLogger.logError({
          toolName: "codex_generate_image",
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
