import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseImageInput,
  validateFileImage,
  validateBase64Image,
  validateImages,
  ImageValidationError,
} from "../src/utils/imageValidation.js";

describe("Image validation", () => {
  let tmpDir: string;
  let testImagePath: string;
  let largeImagePath: string;
  let invalidExtPath: string;

  beforeAll(() => {
    // Create temp directory and test files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-test-"));

    // Create a small valid PNG (1x1 transparent)
    const smallPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    testImagePath = path.join(tmpDir, "test.png");
    fs.writeFileSync(testImagePath, smallPng);

    // Create a "large" image (just repeat bytes)
    largeImagePath = path.join(tmpDir, "large.png");
    const largeBuffer = Buffer.alloc(1024 * 1024); // 1MB
    fs.writeFileSync(largeImagePath, largeBuffer);

    // Create file with invalid extension
    invalidExtPath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(invalidExtPath, "not an image");
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("parseImageInput", () => {
    it("parses file paths", () => {
      const result = parseImageInput("/path/to/image.png");
      expect(result).toEqual({ type: "file", path: "/path/to/image.png" });
    });

    it("parses relative file paths", () => {
      const result = parseImageInput("./image.jpg");
      expect(result).toEqual({ type: "file", path: "./image.jpg" });
    });

    it("parses http URLs", () => {
      const result = parseImageInput("http://example.com/image.png");
      expect(result).toEqual({ type: "url", url: "http://example.com/image.png" });
    });

    it("parses https URLs", () => {
      const result = parseImageInput("https://example.com/image.png");
      expect(result).toEqual({ type: "url", url: "https://example.com/image.png" });
    });

    it("parses data URLs", () => {
      const result = parseImageInput("data:image/png;base64,abc123");
      expect(result).toEqual({
        type: "base64",
        data: "abc123",
        mimeType: "image/png",
      });
    });

    it("throws on invalid data URL format", () => {
      expect(() => parseImageInput("data:invalid")).toThrow(ImageValidationError);
    });

    it("throws on unsupported MIME type in data URL", () => {
      expect(() => parseImageInput("data:text/plain;base64,abc")).toThrow(
        ImageValidationError,
      );
    });
  });

  describe("validateFileImage", () => {
    it("validates and returns base64 for valid image", () => {
      const result = validateFileImage(testImagePath, 1024 * 1024);
      expect(result.mimeType).toBe("image/png");
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);
    });

    it("throws for non-existent file", () => {
      expect(() => validateFileImage("/nonexistent/image.png", 1024)).toThrow(
        ImageValidationError,
      );
    });

    it("throws for unsupported extension", () => {
      expect(() => validateFileImage(invalidExtPath, 1024 * 1024)).toThrow(
        ImageValidationError,
      );
    });

    it("throws for file exceeding size limit", () => {
      expect(() => validateFileImage(largeImagePath, 1024)).toThrow(
        ImageValidationError,
      );
    });
  });

  describe("validateBase64Image", () => {
    it("validates base64 within size limit", () => {
      expect(() => validateBase64Image("abc123", "image/png", 1024)).not.toThrow();
    });

    it("throws for unsupported MIME type", () => {
      expect(() => validateBase64Image("abc", "text/plain", 1024)).toThrow(
        ImageValidationError,
      );
    });

    it("throws for data exceeding size limit", () => {
      const largeData = "a".repeat(10000);
      expect(() => validateBase64Image(largeData, "image/png", 100)).toThrow(
        ImageValidationError,
      );
    });
  });

  describe("validateImages", () => {
    it("validates multiple images within limits", () => {
      const results = validateImages([testImagePath], 5, 10 * 1024 * 1024);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("base64");
    });

    it("throws when too many images", () => {
      expect(() => validateImages([testImagePath, testImagePath, testImagePath], 2, 10 * 1024 * 1024)).toThrow(
        ImageValidationError,
      );
    });

    it("passes through URL images", () => {
      const results = validateImages(["https://example.com/image.png"], 5, 1024);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("url");
    });

    it("converts files to base64", () => {
      const results = validateImages([testImagePath], 5, 10 * 1024 * 1024);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("base64");
      if (results[0].type === "base64") {
        expect(results[0].mimeType).toBe("image/png");
      }
    });
  });
});
