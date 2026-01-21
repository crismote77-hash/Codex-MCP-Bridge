import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encoding_for_model } from "@dqbd/tiktoken";
import modelToEncoding from "@dqbd/tiktoken/model_to_encoding.json";
import { registerCodexCountTokensTool } from "../src/tools/codexCountTokens.js";
import { registerCodexCountTokensBatchTool } from "../src/tools/codexCountTokensBatch.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";

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
  return { config, logger, rateLimiter, dailyBudget };
}

describe("token count tools", () => {
  it("counts tokens for a single text", async () => {
    const deps = createDeps({
      CODEX_MCP_MODEL: "o3",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexCountTokensTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_count_tokens"];

    const encoding = encoding_for_model("o3");
    const expected = encoding.encode("hello world").length;
    encoding.free();

    const result = (await handler({
      text: "hello world",
    })) as { content?: Array<{ text?: string }> };

    const payload = JSON.parse(result.content?.[0]?.text ?? "{}") as {
      tokens?: number;
      model?: string;
      encoding?: string;
    };

    const mapping = modelToEncoding as Record<string, string>;
    expect(payload.tokens).toBe(expected);
    expect(payload.model).toBe("o3");
    expect(payload.encoding).toBe(mapping["o3"]);
  });

  it("counts tokens in batch with totals", async () => {
    const deps = createDeps({
      CODEX_MCP_MODEL: "o3",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexCountTokensBatchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_count_tokens_batch"];

    const encoding = encoding_for_model("o3");
    const expected = [
      encoding.encode("hello").length,
      encoding.encode("world").length,
    ];
    encoding.free();

    const result = (await handler({
      texts: ["hello", "world"],
    })) as { content?: Array<{ text?: string }> };

    const payload = JSON.parse(result.content?.[0]?.text ?? "{}") as {
      tokens?: number[];
      total?: number;
    };

    expect(payload.tokens).toEqual(expected);
    expect(payload.total).toBe(expected[0] + expected[1]);
  });

  it("rejects oversized text input", async () => {
    const deps = createDeps({
      CODEX_MCP_MODEL: "o3",
      CODEX_MCP_MAX_INPUT_CHARS: "3",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexCountTokensTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_count_tokens"];

    const result = (await handler({
      text: "toolong",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("max input size");
  });
});
