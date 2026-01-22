import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerCodexCodeFixTool } from "../src/tools/codexCodeFix.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";
import type { ErrorLogger } from "../src/services/errorLogger.js";
import { runOpenAI } from "../src/services/openaiClient.js";

vi.mock("../src/services/openaiClient.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/services/openaiClient.js")>();
  return {
    ...actual,
    runOpenAI: vi.fn(),
  };
});

class FakeServer {
  tools: Record<string, (args: unknown) => Promise<unknown>> = {};

  registerTool(
    name: string,
    _meta: unknown,
    handler: (args: unknown) => Promise<unknown>,
  ) {
    this.tools[name] = handler;
  }
}

function createDeps(env: NodeJS.ProcessEnv): SharedDependencies {
  const config = loadConfig({
    configPath: "/tmp/codex-mcp-bridge-test.json",
    env,
  });
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const rateLimiter = {
    checkOrThrow: vi.fn().mockResolvedValue(undefined),
  } as unknown as RateLimiter;
  const dailyBudget = {
    checkOrThrow: vi.fn().mockResolvedValue(undefined),
    reserve: vi.fn().mockResolvedValue({ tokens: 5 }),
    commit: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as DailyTokenBudget;
  const errorLogger = {
    logError: vi.fn(),
    initialize: vi.fn(),
  } as unknown as ErrorLogger;
  return { config, logger, rateLimiter, dailyBudget, errorLogger };
}

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-fix-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("codex_code_fix", () => {
  it("rejects when filesystem roots are not configured", async () => {
    const deps = createDeps({
      CODEX_MCP_AUTH_MODE: "api_key",
      CODEX_MCP_API_KEY: "sk-test-key-1234567890",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexCodeFixTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_code_fix"];

    const result = (await handler({
      request: "Fix it",
      paths: ["."],
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Filesystem access is disabled");
  });

  it("generates a diff using API mode", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "example.txt");
      await fs.writeFile(filePath, "hello\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_AUTH_MODE: "api_key",
        CODEX_MCP_API_KEY: "sk-test-key-1234567890",
        CODEX_MCP_FILESYSTEM_ROOTS: root,
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexCodeFixTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_code_fix"];
      const runOpenAIMock = vi.mocked(runOpenAI);
      runOpenAIMock.mockResolvedValueOnce({
        text: [
          "diff --git a/example.txt b/example.txt",
          "--- a/example.txt",
          "+++ b/example.txt",
          "@@ -1 +1 @@",
          "-hello",
          "+hello world",
        ].join("\n"),
      });

      const result = (await handler({
        request: "Update greeting",
        paths: [filePath],
      })) as { isError?: boolean; content?: Array<{ text?: string }> };

      expect(result.isError).toBeUndefined();
      expect(result.content?.[0]?.text).toContain("diff --git");
    });
  });

  it("rejects diffs with path traversal", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "safe.txt");
      await fs.writeFile(filePath, "hello\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_AUTH_MODE: "api_key",
        CODEX_MCP_API_KEY: "sk-test-key-1234567890",
        CODEX_MCP_FILESYSTEM_ROOTS: root,
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexCodeFixTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_code_fix"];
      const runOpenAIMock = vi.mocked(runOpenAI);
      runOpenAIMock.mockResolvedValueOnce({
        text: [
          "diff --git a/../evil.txt b/../evil.txt",
          "--- a/../evil.txt",
          "+++ b/../evil.txt",
          "@@ -0,0 +1 @@",
          "+oops",
        ].join("\n"),
      });

      const result = (await handler({
        request: "Do bad thing",
        paths: [filePath],
      })) as { isError?: boolean; content?: Array<{ text?: string }> };

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("outside the filesystem root");
    });
  });

  it("rejects apply when filesystem writes are disabled", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "example.txt");
      await fs.writeFile(filePath, "hello\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_AUTH_MODE: "api_key",
        CODEX_MCP_API_KEY: "sk-test-key-1234567890",
        CODEX_MCP_FILESYSTEM_ROOTS: root,
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexCodeFixTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_code_fix"];
      const runOpenAIMock = vi.mocked(runOpenAI);
      runOpenAIMock.mockResolvedValueOnce({
        text: [
          "diff --git a/example.txt b/example.txt",
          "--- a/example.txt",
          "+++ b/example.txt",
          "@@ -1 +1 @@",
          "-hello",
          "+hello world",
        ].join("\n"),
      });

      const result = (await handler({
        request: "Update greeting",
        paths: [filePath],
        apply: true,
      })) as { isError?: boolean; content?: Array<{ text?: string }> };

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("Filesystem writes are disabled");
    });
  });

  it("enforces maxFiles limits when collecting files", async () => {
    await withTempDir(async (root) => {
      const fileA = path.join(root, "a.txt");
      const fileB = path.join(root, "b.txt");
      await fs.writeFile(fileA, "a\n", "utf-8");
      await fs.writeFile(fileB, "b\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_AUTH_MODE: "api_key",
        CODEX_MCP_API_KEY: "sk-test-key-1234567890",
        CODEX_MCP_FILESYSTEM_ROOTS: root,
        CODEX_MCP_FILESYSTEM_MAX_FILES: "1",
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexCodeFixTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_code_fix"];

      const result = (await handler({
        request: "Update files",
        paths: [root],
      })) as { isError?: boolean; content?: Array<{ text?: string }> };

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("File limit exceeded");
    });
  });
});
