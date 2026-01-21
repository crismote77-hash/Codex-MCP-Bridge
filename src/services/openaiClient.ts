import { EventEmitter } from "node:events";
import { redactString } from "../utils/redact.js";
import type { ImageInput } from "../utils/imageValidation.js";

export class OpenAIError extends Error {
  name = "OpenAIError";
  status?: number;
}

/**
 * SSE event from OpenAI streaming response.
 */
export type OpenAISseEvent = {
  type: "response.output_text.delta" | "response.done" | string;
  delta?: string;
  response?: OpenAIResponse;
  [key: string]: unknown;
};

export interface OpenAIStreamEvents {
  text: (delta: string) => void;
  event: (event: OpenAISseEvent) => void;
  error: (error: Error) => void;
  end: (result: {
    text: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }) => void;
}

export class OpenAIStreamEmitter extends EventEmitter {
  emit<K extends keyof OpenAIStreamEvents>(
    event: K,
    ...args: Parameters<OpenAIStreamEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof OpenAIStreamEvents>(
    event: K,
    listener: OpenAIStreamEvents[K],
  ): this {
    return super.on(event, listener);
  }
  once<K extends keyof OpenAIStreamEvents>(
    event: K,
    listener: OpenAIStreamEvents[K],
  ): this {
    return super.once(event, listener);
  }
}

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type OpenAIInputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | {
      type: "input_image";
      source: { type: "base64"; media_type: string; data: string };
    };

/**
 * Build OpenAI input array from text and optional images.
 * When images are present, uses multimodal content parts.
 */
function buildInput(
  prompt: string,
  images?: ImageInput[],
): string | OpenAIInputPart[] {
  if (!images || images.length === 0) {
    return prompt;
  }

  const parts: OpenAIInputPart[] = [{ type: "input_text", text: prompt }];
  for (const image of images) {
    switch (image.type) {
      case "base64":
        parts.push({
          type: "input_image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: image.data,
          },
        });
        break;
      case "url":
        parts.push({
          type: "input_image",
          image_url: image.url,
        });
        break;
      case "file":
        // Files should be converted to base64 before reaching here
        throw new Error(
          "File images must be converted to base64 before API call",
        );
    }
  }
  return parts;
}

function extractText(payload: OpenAIResponse): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output)) {
    const parts: string[] = [];
    for (const item of payload.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (content?.text) parts.push(content.text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  if (Array.isArray(payload.choices)) {
    const parts = payload.choices
      .map((choice) => choice.message?.content)
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

export async function runOpenAI(opts: {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const input = buildInput(opts.prompt, opts.images);
    const response = await fetch(
      `${opts.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          input,
          temperature: opts.temperature,
          max_output_tokens: opts.maxOutputTokens,
        }),
        signal: controller.signal,
      },
    );

    const text = await response.text();
    let payload: OpenAIResponse | null = null;
    try {
      payload = text ? (JSON.parse(text) as OpenAIResponse) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const err = new OpenAIError(
        payload?.output_text || text || `OpenAI API error (${response.status})`,
      );
      err.status = response.status;
      throw err;
    }

    const extracted = payload ? extractText(payload) : "";
    const usage = payload?.usage
      ? {
          inputTokens: payload.usage.input_tokens,
          outputTokens: payload.usage.output_tokens,
        }
      : undefined;

    return { text: extracted, usage };
  } catch (error) {
    if (error instanceof OpenAIError) throw error;
    const err = new OpenAIError(
      error instanceof Error ? error.message : String(error),
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatOpenAIError(error: OpenAIError): string {
  const status = error.status;
  const safeMessage = redactString(error.message || "");
  if (status === 401 || status === 403) {
    return "OpenAI API authentication failed. Check your API key and permissions.";
  }
  if (status === 429) {
    return "OpenAI API rate limit exceeded. Try again later.";
  }
  if (status && status >= 500) {
    return `OpenAI API error (${status}). Try again later.`;
  }
  return safeMessage || "OpenAI API request failed.";
}

/**
 * Parse a single SSE line from OpenAI streaming response.
 * Returns null if the line is not a data event or is empty.
 */
export function parseSseLine(line: string): OpenAISseEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return { type: "done" };
  try {
    return JSON.parse(data) as OpenAISseEvent;
  } catch {
    return null;
  }
}

/**
 * Run OpenAI API with streaming SSE response.
 * Emits 'text' events for each text delta,
 * 'event' for raw SSE events,
 * 'error' on failures, and 'end' with the aggregated result.
 */
export function runOpenAIStream(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  images?: ImageInput[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): OpenAIStreamEmitter {
  const emitter = new OpenAIStreamEmitter();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const collectedText: string[] = [];
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  const input = buildInput(opts.prompt, opts.images);

  (async () => {
    try {
      const response = await fetch(
        `${opts.baseUrl.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: opts.model,
            input,
            temperature: opts.temperature,
            max_output_tokens: opts.maxOutputTokens,
            stream: true,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        const err = new OpenAIError(
          text || `OpenAI API error (${response.status})`,
        );
        err.status = response.status;
        throw err;
      }

      if (!response.body) {
        throw new OpenAIError("No response body for streaming");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const event = parseSseLine(line);
          if (!event) continue;

          emitter.emit("event", event);

          // Extract text deltas from response.output_text.delta events
          if (event.type === "response.output_text.delta" && event.delta) {
            collectedText.push(event.delta);
            emitter.emit("text", event.delta);
          }

          // Extract usage from response.done events
          if (event.type === "response.done" && event.response?.usage) {
            usage = {
              inputTokens: event.response.usage.input_tokens,
              outputTokens: event.response.usage.output_tokens,
            };
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const event = parseSseLine(buffer);
        if (event) {
          emitter.emit("event", event);
          if (event.type === "response.output_text.delta" && event.delta) {
            collectedText.push(event.delta);
            emitter.emit("text", event.delta);
          }
        }
      }

      emitter.emit("end", { text: collectedText.join(""), usage });
    } catch (error) {
      if (error instanceof OpenAIError) {
        emitter.emit("error", error);
      } else {
        const err = new OpenAIError(
          error instanceof Error ? error.message : String(error),
        );
        emitter.emit("error", err);
      }
    } finally {
      clearTimeout(timeout);
    }
  })();

  return emitter;
}
