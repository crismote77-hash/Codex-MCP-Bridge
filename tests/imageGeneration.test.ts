import { describe, it, expect } from "vitest";
import {
  validateImageGenerationParams,
  OpenAIImageError,
  formatImageError,
} from "../src/services/openaiImages.js";

describe("Image generation validation", () => {
  describe("validateImageGenerationParams", () => {
    it("accepts valid parameters", () => {
      expect(() =>
        validateImageGenerationParams({
          size: "1024x1024",
          quality: "standard",
          style: "vivid",
          responseFormat: "url",
          n: 1,
        }),
      ).not.toThrow();
    });

    it("accepts all valid sizes", () => {
      for (const size of ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"]) {
        expect(() => validateImageGenerationParams({ size })).not.toThrow();
      }
    });

    it("throws for invalid size", () => {
      expect(() => validateImageGenerationParams({ size: "999x999" })).toThrow(
        OpenAIImageError,
      );
    });

    it("accepts valid qualities", () => {
      for (const quality of ["standard", "hd"]) {
        expect(() => validateImageGenerationParams({ quality })).not.toThrow();
      }
    });

    it("throws for invalid quality", () => {
      expect(() => validateImageGenerationParams({ quality: "ultra" })).toThrow(
        OpenAIImageError,
      );
    });

    it("accepts valid styles", () => {
      for (const style of ["vivid", "natural"]) {
        expect(() => validateImageGenerationParams({ style })).not.toThrow();
      }
    });

    it("throws for invalid style", () => {
      expect(() => validateImageGenerationParams({ style: "abstract" })).toThrow(
        OpenAIImageError,
      );
    });

    it("accepts valid response formats", () => {
      for (const responseFormat of ["url", "b64_json"]) {
        expect(() =>
          validateImageGenerationParams({ responseFormat }),
        ).not.toThrow();
      }
    });

    it("throws for invalid response format", () => {
      expect(() =>
        validateImageGenerationParams({ responseFormat: "png" }),
      ).toThrow(OpenAIImageError);
    });

    it("accepts valid n values", () => {
      for (const n of [1, 5, 10]) {
        expect(() => validateImageGenerationParams({ n })).not.toThrow();
      }
    });

    it("throws for n < 1", () => {
      expect(() => validateImageGenerationParams({ n: 0 })).toThrow(
        OpenAIImageError,
      );
    });

    it("throws for n > 10", () => {
      expect(() => validateImageGenerationParams({ n: 11 })).toThrow(
        OpenAIImageError,
      );
    });

    it("accepts empty parameters", () => {
      expect(() => validateImageGenerationParams({})).not.toThrow();
    });
  });

  describe("formatImageError", () => {
    it("formats 401 error", () => {
      const error = new OpenAIImageError("Unauthorized");
      error.status = 401;
      expect(formatImageError(error)).toContain("authentication failed");
    });

    it("formats 403 error", () => {
      const error = new OpenAIImageError("Forbidden");
      error.status = 403;
      expect(formatImageError(error)).toContain("authentication failed");
    });

    it("formats 429 error", () => {
      const error = new OpenAIImageError("Too many requests");
      error.status = 429;
      expect(formatImageError(error)).toContain("rate limit");
    });

    it("formats 500 error", () => {
      const error = new OpenAIImageError("Internal server error");
      error.status = 500;
      expect(formatImageError(error)).toContain("Try again later");
    });

    it("formats generic error", () => {
      const error = new OpenAIImageError("Something went wrong");
      expect(formatImageError(error)).toBe("Something went wrong");
    });
  });
});
