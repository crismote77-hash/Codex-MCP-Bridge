import fs from "node:fs";
import path from "node:path";
import { redactString } from "../utils/redact.js";

export class OpenAIAudioError extends Error {
  name = "OpenAIAudioError";
  status?: number;
  code?: string;
}

const ALLOWED_AUDIO_EXTENSIONS = [
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".oga",
  ".ogg",
  ".wav",
  ".webm",
];

const EXTENSION_TO_MIME: Record<string, string> = {
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export function inferAudioMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? null;
}

export function validateAudioFile(
  filePath: string,
  maxBytes: number,
): { buffer: Buffer; mimeType: string; filename: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
    const err = new OpenAIAudioError(
      `Unsupported audio extension: ${ext}. Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}`,
    );
    err.code = "UNSUPPORTED_EXTENSION";
    throw err;
  }

  if (!fs.existsSync(filePath)) {
    const err = new OpenAIAudioError(`Audio file not found: ${filePath}`);
    err.code = "FILE_NOT_FOUND";
    throw err;
  }

  const stats = fs.statSync(filePath);
  if (stats.size > maxBytes) {
    const err = new OpenAIAudioError(
      `Audio file too large: ${stats.size} bytes (max: ${maxBytes})`,
    );
    err.code = "FILE_TOO_LARGE";
    throw err;
  }

  const buffer = fs.readFileSync(filePath);
  const mimeType = inferAudioMimeType(filePath);
  if (!mimeType) {
    const err = new OpenAIAudioError(
      `Could not determine MIME type for: ${filePath}`,
    );
    err.code = "UNKNOWN_MIME";
    throw err;
  }

  return { buffer, mimeType, filename: path.basename(filePath) };
}

export type TranscriptionResult = {
  text: string;
  language?: string;
  duration?: number;
};

/**
 * Transcribe an audio file using OpenAI's Whisper API.
 */
export async function transcribeAudio(opts: {
  apiKey: string;
  baseUrl: string;
  audioPath: string;
  model?: string;
  language?: string;
  prompt?: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<TranscriptionResult> {
  const { buffer, mimeType, filename } = validateAudioFile(
    opts.audioPath,
    opts.maxBytes,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mimeType }), filename);
    formData.append("model", opts.model ?? "whisper-1");
    if (opts.language) {
      formData.append("language", opts.language);
    }
    if (opts.prompt) {
      formData.append("prompt", opts.prompt);
    }
    formData.append("response_format", "verbose_json");

    const response = await fetch(
      `${opts.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      },
    );

    const text = await response.text();
    let payload: {
      text?: string;
      language?: string;
      duration?: number;
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
      const err = new OpenAIAudioError(errMsg);
      err.status = response.status;
      throw err;
    }

    if (!payload?.text) {
      throw new OpenAIAudioError("No transcription text in response");
    }

    return {
      text: payload.text,
      language: payload.language,
      duration: payload.duration,
    };
  } catch (error) {
    if (error instanceof OpenAIAudioError) throw error;
    const err = new OpenAIAudioError(
      error instanceof Error ? error.message : String(error),
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatAudioError(error: OpenAIAudioError): string {
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
  if (error.code === "FILE_NOT_FOUND") {
    return `Audio file not found: ${safeMessage}`;
  }
  if (error.code === "FILE_TOO_LARGE") {
    return safeMessage;
  }
  if (error.code === "UNSUPPORTED_EXTENSION") {
    return safeMessage;
  }
  return safeMessage || "Audio transcription failed.";
}
