import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  redactSensitiveString,
  sanitizeToolArgs,
  generateStableHash,
} from "../src/utils/redactForLog.js";
import {
  getDefaultLogDirectory,
  resolveLogDirectory,
  getCurrentLogPath,
  getRotatedLogPath,
} from "../src/utils/logPaths.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactSensitiveString", () => {
  it("redacts OpenAI API keys", () => {
    const input = "key is sk-1234567890abcdef1234567890abcdef";
    const result = redactSensitiveString(input);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).not.toContain("1234567890abcdef1234567890abcdef");
  });

  it("redacts sk-proj- keys", () => {
    const input = "using sk-proj-abc123def456ghi789012345"; // 20+ chars after sk-proj-
    const result = redactSensitiveString(input);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).not.toContain("abc123def456ghi789012345");
  });

  it("redacts Anthropic keys", () => {
    const input = "anthropic: sk-ant-api03-xyz123";
    const result = redactSensitiveString(input);
    expect(result).toContain("sk-ant-***REDACTED***");
    expect(result).not.toContain("api03-xyz123");
  });

  it("redacts Tavily keys", () => {
    const input = "tavily key tvly-abc123def";
    const result = redactSensitiveString(input);
    expect(result).toContain("tvly-***REDACTED***");
    expect(result).not.toContain("abc123def");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIs";
    const result = redactSensitiveString(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIs");
  });

  it("redacts password fields", () => {
    const input = 'password="mysecretpassword123"';
    const result = redactSensitiveString(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("mysecretpassword123");
  });

  it("redacts Google API keys", () => {
    const input = "google key AIzaSyAbc123xyz456def789012345678901234";
    const result = redactSensitiveString(input);
    expect(result).toContain("AIza***REDACTED***");
  });

  it("redacts AWS access keys", () => {
    const input = "aws key AKIAIOSFODNN7EXAMPLE";
    const result = redactSensitiveString(input);
    expect(result).toContain("AKIA***REDACTED***");
  });

  it("redacts GitHub tokens", () => {
    const input = "github token ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const result = redactSensitiveString(input);
    expect(result).toContain("gh*_***REDACTED***");
  });

  it("handles multiple keys in same string", () => {
    const input = "keys: sk-abc1234567890123456789012 and tvly-def456";
    const result = redactSensitiveString(input);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).toContain("tvly-***REDACTED***");
    expect(result).not.toContain("abc1234567890123456789012");
    expect(result).not.toContain("def456");
  });
});

describe("generateStableHash", () => {
  it("generates a 16-character hex string", () => {
    const result = generateStableHash("test input");
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });

  it("generates same hash for same input", () => {
    const result1 = generateStableHash("test input");
    const result2 = generateStableHash("test input");
    expect(result1).toBe(result2);
  });

  it("generates different hash for different input", () => {
    const result1 = generateStableHash("test input 1");
    const result2 = generateStableHash("test input 2");
    expect(result1).not.toBe(result2);
  });
});

describe("sanitizeToolArgs", () => {
  it("extracts metadata for prompt fields at errors level", () => {
    const args = { prompt: "test prompt content", other: "value" };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.promptLength).toBe(19);
    expect(result.promptHash).toBeDefined();
    expect(result.prompt).toBeUndefined(); // Not included at errors level
    expect(result.other).toBe("value");
  });

  it("includes redacted prompt at full level", () => {
    const args = { prompt: "test prompt content" };
    const result = sanitizeToolArgs(args, "full");

    expect(result.promptLength).toBe(19);
    expect(result.prompt).toBe("test prompt content"); // Included at full level
  });

  it("includes prompt preview at debug level", () => {
    const args = { prompt: "test prompt content" };
    const result = sanitizeToolArgs(args, "debug");

    expect(result.promptLength).toBe(19);
    expect(result.promptPreview).toBe("test prompt content"); // Truncated preview
    expect(result.prompt).toBeUndefined(); // Not full content
  });

  it("sanitizes diff fields", () => {
    const args = { diff: "--- a/file\n+++ b/file" };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.diffLength).toBe(21);
    expect(result.diffHash).toBeDefined();
    expect(result.diff).toBeUndefined();
  });

  it("sanitizes content fields", () => {
    const args = { content: "file contents here" };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.contentLength).toBe(18);
    expect(result.contentHash).toBeDefined();
    expect(result.content).toBeUndefined();
  });

  it("preserves non-sensitive fields", () => {
    const args = {
      model: "gpt-4",
      timeout: 5000,
    };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.model).toBe("gpt-4");
    expect(result.timeout).toBe(5000);
  });

  it("redacts apiKey field", () => {
    const args = { apiKey: "sk-secret123" };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.apiKey).toBe("***REDACTED***");
  });

  it("handles arrays with count", () => {
    const args = { paths: ["/a", "/b", "/c"] };
    const result = sanitizeToolArgs(args, "errors");

    expect(result.pathsCount).toBe(3);
    expect(result.paths).toBeUndefined(); // Not included at errors level
  });

  it("includes arrays at debug level", () => {
    const args = { paths: ["/a", "/b", "/c"] };
    const result = sanitizeToolArgs(args, "debug");

    expect(result.pathsCount).toBe(3);
    expect(result.paths).toEqual(["/a", "/b", "/c"]);
  });
});

describe("getDefaultLogDirectory", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("uses Library/Logs on macOS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const home = os.homedir();
    const result = getDefaultLogDirectory();
    expect(result).toBe(path.join(home, "Library", "Logs", "codex-mcp-bridge"));
  });

  it("uses .local/state on Linux by default", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const home = os.homedir();
    const result = getDefaultLogDirectory();
    expect(result).toContain("codex-mcp-bridge");
  });
});

describe("resolveLogDirectory", () => {
  it("uses override when provided", () => {
    const result = resolveLogDirectory("/custom/log/path");
    expect(result).toBe("/custom/log/path");
  });

  it("falls back to default when no override", () => {
    const result = resolveLogDirectory(undefined);
    expect(result).toBeTruthy();
    expect(result).toContain("codex-mcp-bridge");
  });

  it("expands ~ to home directory", () => {
    const result = resolveLogDirectory("~/logs/custom");
    expect(result).toBe(path.join(os.homedir(), "/logs/custom"));
  });
});

describe("getCurrentLogPath", () => {
  it("returns path with correct filename format", () => {
    const result = getCurrentLogPath("/logs");
    expect(result).toBe(path.join("/logs", "mcp-errors.log"));
  });
});

describe("getRotatedLogPath", () => {
  it("includes date in rotated filename", () => {
    const date = new Date("2024-03-15T12:00:00Z");
    const result = getRotatedLogPath("/logs", date);
    expect(result).toBe(path.join("/logs", "mcp-errors-2024-03-15.log"));
  });
});

describe("ErrorLogger integration", async () => {
  const { createErrorLogger, setMcpVersion } = await import("../src/services/errorLogger.js");

  async function withTempLogDir<T>(
    fn: (logDir: string) => Promise<T>,
  ): Promise<T> {
    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-errlog-"));
    try {
      return await fn(logDir);
    } finally {
      await fs.rm(logDir, { recursive: true, force: true });
    }
  }

  it("creates log file when logging errors", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "errors",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      setMcpVersion("0.1.0-test");
      logger.initialize();

      logger.logError({
        toolName: "test_tool",
        toolArgs: { model: "gpt-4" },
        error: new Error("Test error"),
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.toolName).toBe("test_tool");
      expect(entry.errorType).toBe("Error");
      expect(entry.message).toBe("Test error");
      expect(entry.mcpVersion).toBe("0.1.0-test");
      expect(entry.osInfo.platform).toBe(process.platform);
    });
  });

  it("sanitizes prompt in tool args", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "errors",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      logger.logError({
        toolName: "codex_exec",
        toolArgs: { prompt: "secret prompt content" },
        error: new Error("API error"),
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      const content = await fs.readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolArgs.promptLength).toBe(21);
      expect(entry.toolArgs.promptHash).toBeDefined();
      expect(entry.toolArgs.prompt).toBeUndefined();
      expect(content).not.toContain("secret prompt content");
    });
  });

  it("includes redacted prompt at full level", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "full",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      logger.logError({
        toolName: "codex_exec",
        toolArgs: { prompt: "full prompt content" },
        error: new Error("API error"),
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      const content = await fs.readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolArgs.prompt).toBe("full prompt content");
    });
  });

  it("does nothing when logging is off", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "off",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      logger.logError({
        toolName: "test_tool",
        toolArgs: {},
        error: new Error("Test error"),
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      await expect(fs.access(logPath)).rejects.toThrow();
    });
  });

  it("includes stack trace in debug mode", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "debug",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      const error = new Error("Test error");
      logger.logError({
        toolName: "test_tool",
        toolArgs: {},
        error,
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      const content = await fs.readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.stackTrace).toBeDefined();
      expect(entry.stackTrace).toContain("Error: Test error");
    });
  });

  it("handles non-Error objects", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "errors",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      logger.logError({
        toolName: "test_tool",
        toolArgs: {},
        error: "String error message",
      });

      const logPath = path.join(logDir, "mcp-errors.log");
      const content = await fs.readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.errorType).toBe("Error");
      expect(entry.message).toBe("String error message");
    });
  });

  it("prints error hint to stderr", async () => {
    await withTempLogDir(async (logDir) => {
      const mockStderrLogger = { info: vi.fn(), error: vi.fn() };
      const logger = createErrorLogger(
        {
          errorLogging: "errors",
          directory: logDir,
          maxFileSizeMb: 50,
          retentionDays: 7,
        },
        mockStderrLogger,
      );

      logger.initialize();

      logger.logError({
        toolName: "test_tool",
        toolArgs: {},
        error: new Error("Test error"),
      });

      expect(mockStderrLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("[MCP-ERROR] test_tool: Test error"),
      );
    });
  });
});
