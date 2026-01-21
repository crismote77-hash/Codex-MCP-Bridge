import { redactString } from "../utils/redact.js";

export class OpenAIImageError extends Error {
  name = "OpenAIImageError";
  status?: number;
}

const ALLOWED_SIZES = [
  "256x256",
  "512x512",
  "1024x1024",
  "1024x1792",
  "1792x1024",
];
const ALLOWED_QUALITIES = ["standard", "hd"];
const ALLOWED_STYLES = ["vivid", "natural"];
const ALLOWED_RESPONSE_FORMATS = ["url", "b64_json"];

export type ImageGenerationResult = {
  images: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

export function validateImageGenerationParams(opts: {
  size?: string;
  quality?: string;
  style?: string;
  responseFormat?: string;
  n?: number;
}): void {
  if (opts.size && !ALLOWED_SIZES.includes(opts.size)) {
    throw new OpenAIImageError(
      `Invalid size: ${opts.size}. Allowed: ${ALLOWED_SIZES.join(", ")}`,
    );
  }
  if (opts.quality && !ALLOWED_QUALITIES.includes(opts.quality)) {
    throw new OpenAIImageError(
      `Invalid quality: ${opts.quality}. Allowed: ${ALLOWED_QUALITIES.join(", ")}`,
    );
  }
  if (opts.style && !ALLOWED_STYLES.includes(opts.style)) {
    throw new OpenAIImageError(
      `Invalid style: ${opts.style}. Allowed: ${ALLOWED_STYLES.join(", ")}`,
    );
  }
  if (
    opts.responseFormat &&
    !ALLOWED_RESPONSE_FORMATS.includes(opts.responseFormat)
  ) {
    throw new OpenAIImageError(
      `Invalid response format: ${opts.responseFormat}. Allowed: ${ALLOWED_RESPONSE_FORMATS.join(", ")}`,
    );
  }
  if (opts.n !== undefined && (opts.n < 1 || opts.n > 10)) {
    throw new OpenAIImageError("n must be between 1 and 10");
  }
}

/**
 * Generate images using OpenAI's Images API (DALL-E).
 */
export async function generateImage(opts: {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  n?: number;
  responseFormat?: string;
  timeoutMs: number;
}): Promise<ImageGenerationResult> {
  validateImageGenerationParams({
    size: opts.size,
    quality: opts.quality,
    style: opts.style,
    responseFormat: opts.responseFormat,
    n: opts.n,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model: opts.model ?? "dall-e-3",
      prompt: opts.prompt,
      n: opts.n ?? 1,
      size: opts.size ?? "1024x1024",
      response_format: opts.responseFormat ?? "url",
    };
    if (opts.quality) body.quality = opts.quality;
    if (opts.style) body.style = opts.style;

    const response = await fetch(
      `${opts.baseUrl.replace(/\/$/, "")}/images/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    const text = await response.text();
    let payload: {
      data?: Array<{
        url?: string;
        b64_json?: string;
        revised_prompt?: string;
      }>;
      error?: { message?: string };
    } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errMsg =
        payload?.error?.message ||
        text ||
        `OpenAI API error (${response.status})`;
      const err = new OpenAIImageError(errMsg);
      err.status = response.status;
      throw err;
    }

    if (!payload?.data || payload.data.length === 0) {
      throw new OpenAIImageError("No images in response");
    }

    return { images: payload.data };
  } catch (error) {
    if (error instanceof OpenAIImageError) throw error;
    const err = new OpenAIImageError(
      error instanceof Error ? error.message : String(error),
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatImageError(error: OpenAIImageError): string {
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
  return safeMessage || "Image generation failed.";
}
