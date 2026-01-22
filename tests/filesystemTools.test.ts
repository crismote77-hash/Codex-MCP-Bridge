import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { registerCodexReadFileTool } from "../src/tools/codexReadFile.js";
import { registerCodexSearchFilesTool } from "../src/tools/codexSearchFiles.js";
import { registerTools } from "../src/tools/index.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";
import type { ErrorLogger } from "../src/services/errorLogger.js";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-files-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("filesystem tools", () => {
  it("skips filesystem tool registration when roots are not configured", async () => {
    const deps = createDeps({} as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerTools(server as unknown as McpServer, deps);

    expect(server.tools["codex_read_file"]).toBeUndefined();
    expect(server.tools["codex_search_files"]).toBeUndefined();
    expect(server.tools["codex_code_fix"]).toBeUndefined();
  });

  it("codex_read_file rejects when roots are not configured", async () => {
    const deps = createDeps({} as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexReadFileTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_read_file"];

    const result = (await handler({ path: "/tmp/nope.txt" })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Filesystem access is disabled");
  });

  it("codex_read_file returns line-numbered output", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "sample.txt");
      await fs.writeFile(filePath, "first\nsecond\nthird\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_FILESYSTEM_ROOTS: root,
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexReadFileTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_read_file"];

      const result = (await handler({
        path: filePath,
        startLine: 2,
        endLine: 3,
      })) as { content?: Array<{ text?: string }> };

      const text = result.content?.[0]?.text ?? "";
      expect(text).toContain("2: second");
      expect(text).toContain("3: third");
    });
  });

  it("codex_read_file rejects paths outside configured roots", async () => {
    await withTempDir(async (root) => {
      const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), "codex-mcp-files-outside-"),
      );
      const filePath = path.join(outside, "outside.txt");
      await fs.writeFile(filePath, "nope\n", "utf-8");

      const deps = createDeps({
        CODEX_MCP_FILESYSTEM_ROOTS: root,
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexReadFileTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_read_file"];

      const result = (await handler({ path: filePath })) as {
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("outside configured");

      await fs.rm(outside, { recursive: true, force: true });
    });
  });

  it("codex_read_file enforces maxFileBytes", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "big.txt");
      await fs.writeFile(filePath, "x".repeat(50), "utf-8");

      const deps = createDeps({
        CODEX_MCP_FILESYSTEM_ROOTS: root,
        CODEX_MCP_FILESYSTEM_MAX_FILE_BYTES: "10",
      } as NodeJS.ProcessEnv);
      const server = new FakeServer();
      registerCodexReadFileTool(server as unknown as McpServer, deps);
      const handler = server.tools["codex_read_file"];

      const result = (await handler({ path: filePath })) as {
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("File exceeds max size");
    });
  });

  const hasRg = spawnSync("rg", ["--version"]).status === 0;

  (hasRg ? it : it.skip)(
    "codex_search_files finds content matches with limits",
    async () => {
      await withTempDir(async (root) => {
        const filePath = path.join(root, "search.txt");
        await fs.writeFile(filePath, "alpha\nalpha\nbeta\n", "utf-8");

        const deps = createDeps({
          CODEX_MCP_FILESYSTEM_ROOTS: root,
        } as NodeJS.ProcessEnv);
        const server = new FakeServer();
        registerCodexSearchFilesTool(server as unknown as McpServer, deps);
        const handler = server.tools["codex_search_files"];

        const result = (await handler({
          pattern: "alpha",
          mode: "content",
          maxResults: 1,
        })) as { content?: Array<{ text?: string }> };

        const text = result.content?.[0]?.text ?? "";
        const lines = text.split("\n").filter(Boolean);
        expect(lines.length).toBe(1);
        expect(text).toContain("alpha");
      });
    },
  );

  (hasRg ? it : it.skip)(
    "codex_search_files finds file names with glob mode",
    async () => {
      await withTempDir(async (root) => {
        const filePath = path.join(root, "sample.txt");
        await fs.writeFile(filePath, "hello\n", "utf-8");

        const deps = createDeps({
          CODEX_MCP_FILESYSTEM_ROOTS: root,
        } as NodeJS.ProcessEnv);
        const server = new FakeServer();
        registerCodexSearchFilesTool(server as unknown as McpServer, deps);
        const handler = server.tools["codex_search_files"];

        const result = (await handler({
          pattern: "*.txt",
          mode: "path",
        })) as { content?: Array<{ text?: string }> };

        const text = result.content?.[0]?.text ?? "";
        expect(text).toContain("sample.txt");
      });
    },
  );

  (hasRg ? it : it.skip)(
    "codex_search_files skips hidden files by default",
    async () => {
      await withTempDir(async (root) => {
        const visible = path.join(root, "visible.txt");
        const hidden = path.join(root, ".hidden.txt");
        await fs.writeFile(visible, "secret\n", "utf-8");
        await fs.writeFile(hidden, "secret\n", "utf-8");

        const deps = createDeps({
          CODEX_MCP_FILESYSTEM_ROOTS: root,
        } as NodeJS.ProcessEnv);
        const server = new FakeServer();
        registerCodexSearchFilesTool(server as unknown as McpServer, deps);
        const handler = server.tools["codex_search_files"];

        const result = (await handler({
          pattern: "secret",
          mode: "content",
        })) as { content?: Array<{ text?: string }> };

        const text = result.content?.[0]?.text ?? "";
        expect(text).toContain("visible.txt");
        expect(text).not.toContain(".hidden.txt");
      });
    },
  );
});
