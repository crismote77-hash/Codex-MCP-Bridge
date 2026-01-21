import fs from "node:fs";
import path from "node:path";

export class ImageValidationError extends Error {
  name = "ImageValidationError";
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export type ImageInput =
  | { type: "file"; path: string }
  | { type: "base64"; data: string; mimeType: string }
  | { type: "url"; url: string };

const ALLOWED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
];
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
];

function inferMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
  };
  return mimeMap[ext] ?? null;
}

/**
 * Parse an image input string and determine its type.
 * Supported formats:
 * - File path (absolute or relative)
 * - data:image/...;base64,... data URL
 * - http:// or https:// URL
 */
export function parseImageInput(input: string): ImageInput {
  if (input.startsWith("data:")) {
    // Parse data URL
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new ImageValidationError(
        "Invalid data URL format. Expected: data:<mime>;base64,<data>",
        "INVALID_DATA_URL",
      );
    }
    const mimeType = match[1];
    const data = match[2];
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new ImageValidationError(
        `Unsupported MIME type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
        "UNSUPPORTED_MIME",
      );
    }
    return { type: "base64", data, mimeType };
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    return { type: "url", url: input };
  }

  // Treat as file path
  return { type: "file", path: input };
}

/**
 * Validate a file image and return its content as base64.
 */
export function validateFileImage(
  filePath: string,
  maxBytes: number,
): { base64: string; mimeType: string } {
  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new ImageValidationError(
      `Unsupported image extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
      "UNSUPPORTED_EXTENSION",
    );
  }

  // Check file exists
  if (!fs.existsSync(filePath)) {
    throw new ImageValidationError(
      `Image file not found: ${filePath}`,
      "FILE_NOT_FOUND",
    );
  }

  // Check file size
  const stats = fs.statSync(filePath);
  if (stats.size > maxBytes) {
    throw new ImageValidationError(
      `Image file too large: ${stats.size} bytes (max: ${maxBytes})`,
      "FILE_TOO_LARGE",
    );
  }

  // Read and encode
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");
  const mimeType = inferMimeType(filePath);
  if (!mimeType) {
    throw new ImageValidationError(
      `Could not determine MIME type for: ${filePath}`,
      "UNKNOWN_MIME",
    );
  }

  return { base64, mimeType };
}

/**
 * Validate base64 image data.
 */
export function validateBase64Image(
  data: string,
  mimeType: string,
  maxBytes: number,
): void {
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new ImageValidationError(
      `Unsupported MIME type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      "UNSUPPORTED_MIME",
    );
  }

  // Check size (base64 is ~4/3 of original size)
  const estimatedBytes = Math.ceil((data.length * 3) / 4);
  if (estimatedBytes > maxBytes) {
    throw new ImageValidationError(
      `Image data too large: ~${estimatedBytes} bytes (max: ${maxBytes})`,
      "DATA_TOO_LARGE",
    );
  }
}

/**
 * Validate an array of image inputs and return processed images.
 * For files, reads and converts to base64.
 * For URLs, passes through (API will fetch).
 * For base64, validates and passes through.
 */
export function validateImages(
  inputs: string[],
  maxCount: number,
  maxBytes: number,
): ImageInput[] {
  if (inputs.length > maxCount) {
    throw new ImageValidationError(
      `Too many images: ${inputs.length} (max: ${maxCount})`,
      "TOO_MANY_IMAGES",
    );
  }

  const results: ImageInput[] = [];
  for (const input of inputs) {
    const parsed = parseImageInput(input);

    switch (parsed.type) {
      case "file": {
        // Validate and convert to base64
        const { base64, mimeType } = validateFileImage(parsed.path, maxBytes);
        results.push({ type: "base64", data: base64, mimeType });
        break;
      }
      case "base64": {
        validateBase64Image(parsed.data, parsed.mimeType, maxBytes);
        results.push(parsed);
        break;
      }
      case "url": {
        // URLs are passed through; API will handle validation
        results.push(parsed);
        break;
      }
    }
  }

  return results;
}
