import { redactString } from "../utils/redact.js";

export class OpenAIError extends Error {
  name = "OpenAIError";
  status?: number;
}

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

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
          input: opts.prompt,
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
