import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { resolveAuth } from "../auth/resolveAuth.js";
import type { BudgetReservation } from "../limits/dailyTokenBudget.js";
import {
  transcribeAudio,
  OpenAIAudioError,
  formatAudioError,
} from "../services/openaiAudio.js";
import { formatToolError } from "../utils/toolErrors.js";
import { redactString } from "../utils/redact.js";

const inputSchema = {
  audioPath: z.string().min(1).describe("Path to the audio file to transcribe"),
  model: z
    .string()
    .optional()
    .describe("Transcription model (default: whisper-1)"),
  language: z
    .string()
    .optional()
    .describe("Language code (ISO 639-1) to improve accuracy"),
  prompt: z
    .string()
    .optional()
    .describe("Optional prompt to guide transcription style"),
  timeoutMs: z.number().int().positive().optional(),
};

type TranscribeArgs = {
  audioPath: string;
  model?: string;
  language?: string;
  prompt?: string;
  timeoutMs?: number;
};

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function registerCodexTranscribeTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  server.registerTool(
    "codex_transcribe_audio",
    {
      title: "Codex Transcribe Audio",
      description:
        "Transcribe audio to text using OpenAI's Whisper API. API-key auth required; CLI mode is not supported.",
      inputSchema,
    },
    async (args: TranscribeArgs) => {
      let reservation: BudgetReservation | undefined;
      let committed = false;
      try {
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
                text: "Audio transcription requires API-key auth. Codex CLI does not support transcription. Set CODEX_MCP_AUTH_MODE=api_key and provide an API key.",
              },
            ],
          };
        }

        // Reserve tokens for the operation
        reservation = await deps.dailyBudget.reserve(100);

        const result = await transcribeAudio({
          apiKey: auth.apiKey,
          baseUrl: deps.config.api.baseUrl,
          audioPath: args.audioPath,
          model: args.model,
          language: args.language,
          prompt: args.prompt,
          maxBytes: deps.config.limits.maxAudioBytes,
          timeoutMs: args.timeoutMs ?? deps.config.execution.timeoutMs,
        });

        // Estimate tokens from transcribed text
        const tokens = estimateTokensFromChars(result.text.length);
        await deps.dailyBudget.commit(
          "codex_transcribe_audio",
          tokens,
          undefined,
          reservation,
        );
        committed = true;

        const output: Record<string, unknown> = {
          text: result.text,
        };
        if (result.language) output.language = result.language;
        if (result.duration) output.duration = result.duration;

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        if (reservation && !committed) {
          try {
            await deps.dailyBudget.release(reservation);
          } catch (releaseError) {
            deps.logger.error(
              "Failed to release codex_transcribe_audio budget reservation",
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
        if (error instanceof OpenAIAudioError) {
          formatted = { message: formatAudioError(error) };
        } else {
          formatted = formatToolError(error);
        }

        deps.logger.error("codex_transcribe_audio failed", {
          error: redactString(formatted.message),
        });

        deps.errorLogger.logError({
          toolName: "codex_transcribe_audio",
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
