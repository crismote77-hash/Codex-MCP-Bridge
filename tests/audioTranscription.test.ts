import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validateAudioFile,
  inferAudioMimeType,
  OpenAIAudioError,
  formatAudioError,
} from "../src/services/openaiAudio.js";

describe("Audio validation", () => {
  let tmpDir: string;
  let validAudioPath: string;
  let largeAudioPath: string;
  let invalidExtPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));

    // Create a small "valid" audio file (just dummy bytes)
    validAudioPath = path.join(tmpDir, "test.mp3");
    fs.writeFileSync(validAudioPath, Buffer.alloc(100));

    // Create a "large" audio file
    largeAudioPath = path.join(tmpDir, "large.mp3");
    fs.writeFileSync(largeAudioPath, Buffer.alloc(1024 * 1024)); // 1MB

    // Create file with invalid extension
    invalidExtPath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(invalidExtPath, "not audio");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("inferAudioMimeType", () => {
    it("infers MIME type for mp3", () => {
      expect(inferAudioMimeType("/path/to/file.mp3")).toBe("audio/mpeg");
    });

    it("infers MIME type for wav", () => {
      expect(inferAudioMimeType("/path/to/file.wav")).toBe("audio/wav");
    });

    it("infers MIME type for flac", () => {
      expect(inferAudioMimeType("/path/to/file.flac")).toBe("audio/flac");
    });

    it("infers MIME type for ogg", () => {
      expect(inferAudioMimeType("/path/to/file.ogg")).toBe("audio/ogg");
    });

    it("infers MIME type for webm", () => {
      expect(inferAudioMimeType("/path/to/file.webm")).toBe("audio/webm");
    });

    it("returns null for unsupported extension", () => {
      expect(inferAudioMimeType("/path/to/file.txt")).toBeNull();
    });

    it("handles uppercase extension", () => {
      expect(inferAudioMimeType("/path/to/file.MP3")).toBe("audio/mpeg");
    });
  });

  describe("validateAudioFile", () => {
    it("validates a valid audio file", () => {
      const result = validateAudioFile(validAudioPath, 10 * 1024 * 1024);
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.filename).toBe("test.mp3");
      expect(result.buffer.length).toBe(100);
    });

    it("throws for non-existent file", () => {
      expect(() =>
        validateAudioFile("/nonexistent/audio.mp3", 1024),
      ).toThrow(OpenAIAudioError);
    });

    it("throws for unsupported extension", () => {
      try {
        validateAudioFile(invalidExtPath, 10 * 1024 * 1024);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIAudioError);
        expect((error as OpenAIAudioError).code).toBe("UNSUPPORTED_EXTENSION");
      }
    });

    it("throws for file exceeding size limit", () => {
      try {
        validateAudioFile(largeAudioPath, 1024);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIAudioError);
        expect((error as OpenAIAudioError).code).toBe("FILE_TOO_LARGE");
      }
    });
  });

  describe("formatAudioError", () => {
    it("formats 401 error", () => {
      const error = new OpenAIAudioError("Unauthorized");
      error.status = 401;
      expect(formatAudioError(error)).toContain("authentication failed");
    });

    it("formats 429 error", () => {
      const error = new OpenAIAudioError("Too many requests");
      error.status = 429;
      expect(formatAudioError(error)).toContain("rate limit");
    });

    it("formats 500 error", () => {
      const error = new OpenAIAudioError("Internal server error");
      error.status = 500;
      expect(formatAudioError(error)).toContain("Try again later");
    });

    it("formats FILE_NOT_FOUND error", () => {
      const error = new OpenAIAudioError("File not found");
      error.code = "FILE_NOT_FOUND";
      expect(formatAudioError(error)).toContain("not found");
    });

    it("formats FILE_TOO_LARGE error", () => {
      const error = new OpenAIAudioError("File too large: 50MB");
      error.code = "FILE_TOO_LARGE";
      expect(formatAudioError(error)).toContain("too large");
    });
  });
});
