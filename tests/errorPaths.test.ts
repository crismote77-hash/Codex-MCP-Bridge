import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCodexExecTool } from "../src/tools/codexExec.js";
import { registerCodexReviewTool } from "../src/tools/codexReview.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";
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

function createDeps(maxInputChars = 20000): {
  deps: SharedDependencies;
  dailyBudget: DailyTokenBudget;
  logger: Logger;
} {
  const env = {
    CODEX_MCP_AUTH_MODE: "api_key",
    CODEX_MCP_API_KEY: "sk-test-key-1234567890",
    CODEX_MCP_MAX_INPUT_CHARS: String(maxInputChars),
  } as NodeJS.ProcessEnv;
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
  const deps: SharedDependencies = {
    config,
    logger,
    rateLimiter,
    dailyBudget,
  };
  return { deps, dailyBudget, logger };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool error paths", () => {
  it("releases budget reservation when codex_exec fails", async () => {
    const { deps, dailyBudget } = createDeps();
    const server = new FakeServer();
    registerCodexExecTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_exec"];
    const runOpenAIMock = vi.mocked(runOpenAI);
    runOpenAIMock.mockRejectedValueOnce(new Error("boom"));

    const result = (await handler({ prompt: "hello" })) as {
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(dailyBudget.reserve).toHaveBeenCalledTimes(1);
    expect(dailyBudget.release).toHaveBeenCalledTimes(1);
  });

  it("releases budget reservation when codex_review fails in API mode", async () => {
    const { deps, dailyBudget } = createDeps();
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];
    const runOpenAIMock = vi.mocked(runOpenAI);
    runOpenAIMock.mockRejectedValueOnce(new Error("boom"));

    const result = (await handler({ diff: "diff" })) as {
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(dailyBudget.reserve).toHaveBeenCalledTimes(1);
    expect(dailyBudget.release).toHaveBeenCalledTimes(1);
  });

  it("rejects codex_review API input that exceeds maxInputChars", async () => {
    const { deps, dailyBudget } = createDeps(10);
    const server = new FakeServer();
    registerCodexReviewTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_review"];

    const result = (await handler({
      diff: "x".repeat(50),
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(dailyBudget.reserve).not.toHaveBeenCalled();
    expect(result.content?.[0]?.text).toContain("max input size");
  });
});
