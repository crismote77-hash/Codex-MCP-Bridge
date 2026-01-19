import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCodexReviewTool } from "../src/tools/codexReview.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";
import { runCodexCommand } from "../src/services/codexCli.js";

vi.mock("../src/services/codexCli.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/services/codexCli.js")>();
  return {
    ...actual,
    runCodexCommand: vi.fn(),
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

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-bridge-"));
}

async function createDeps(opts: { authMode?: "auto" | "cli" | "api_key" }): Promise<{
  deps: SharedDependencies;
  dailyBudget: DailyTokenBudget;
}> {
  const dir = await makeTempDir();
  const cliAuthPath = path.join(dir, "auth.json");
  await fs.writeFile(cliAuthPath, "{}", "utf8");

  const env: NodeJS.ProcessEnv = {
    CODEX_MCP_CLI_AUTH_PATH: cliAuthPath,
    CODEX_MCP_API_KEY_ENV_VAR: "CODEX_MCP_TEST_OPENAI_API_KEY",
    CODEX_MCP_API_KEY_ENV_VAR_ALT: "CODEX_MCP_TEST_CODEX_API_KEY",
    CODEX_MCP_API_KEY_FILE_ENV_VAR: "CODEX_MCP_TEST_OPENAI_API_KEY_FILE",
  };
  if (opts.authMode) env.CODEX_MCP_AUTH_MODE = opts.authMode;

  const config = loadConfig({
    configPath: path.join(dir, "config.json"),
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

  const deps: SharedDependencies = {
    config,
    logger,
    rateLimiter,
    dailyBudget,
  };

  return { deps, dailyBudget };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("codex_review (CLI mode)", () => {
  it("returns stderr output when stdout is empty", async () => {
    const { deps } = await createDeps({ authMode: "cli" });
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];

    vi.mocked(runCodexCommand).mockResolvedValueOnce({
      stdout: "",
      stderr: "review output",
      exitCode: 0,
    });

    const result = (await handler({
      uncommitted: true,
      cwd: "/tmp",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toBe("review output");
  });

  it("treats exit code 1 as non-fatal when output exists", async () => {
    const { deps } = await createDeps({ authMode: "cli" });
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];

    vi.mocked(runCodexCommand).mockResolvedValueOnce({
      stdout: "",
      stderr: "review output",
      exitCode: 1,
    });

    const result = (await handler({
      commit: "deadbeef",
      cwd: "/tmp",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toBe("review output");
  });

  it("still fails on exit code 1 when output looks fatal", async () => {
    const { deps } = await createDeps({ authMode: "cli" });
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];

    vi.mocked(runCodexCommand).mockResolvedValueOnce({
      stdout: "",
      stderr: "Error: Fatal error: Codex cannot access session files",
      exitCode: 1,
    });

    const result = (await handler({
      uncommitted: true,
      cwd: "/tmp",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Codex CLI failed");
  });
});

describe("codex_review (diff review)", () => {
  it("requires API-key auth even when CLI auth exists", async () => {
    const { deps } = await createDeps({ authMode: "auto" });
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];

    const result = (await handler({
      diff: "--- a/a.txt\n+++ b/a.txt\n@@\n+hi\n",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Diff reviews require API-key auth");
    expect(vi.mocked(runCodexCommand)).not.toHaveBeenCalled();
  });
});
