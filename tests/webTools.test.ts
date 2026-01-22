import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCodexWebSearchTool } from "../src/tools/codexWebSearch.js";
import { registerCodexWebFetchTool } from "../src/tools/codexWebFetch.js";
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web tools", () => {
  it("rejects web search when disabled", async () => {
    const deps = createDeps({} as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebSearchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_search"];

    const result = (await handler({
      query: "test",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Web search is disabled");
  });

  it("rejects web search without Tavily API key", async () => {
    const deps = createDeps({
      CODEX_MCP_WEB_SEARCH_ENABLED: "true",
      CODEX_MCP_WEB_PROVIDER: "tavily",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebSearchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_search"];

    const result = (await handler({
      query: "test",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Tavily API key");
  });

  it("returns search results from provider", async () => {
    const deps = createDeps({
      CODEX_MCP_WEB_SEARCH_ENABLED: "true",
      CODEX_MCP_WEB_PROVIDER: "tavily",
      CODEX_MCP_TAVILY_API_KEY: "tvly-test",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebSearchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_search"];

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { title: "Example", url: "https://example.com", content: "Hello" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = (await handler({
      query: "example",
    })) as { content?: Array<{ text?: string }> };

    const payload = JSON.parse(result.content?.[0]?.text ?? "{}") as {
      results?: Array<{ title: string; url: string }>;
    };
    expect(payload.results?.length).toBe(1);
    expect(payload.results?.[0]?.url).toBe("https://example.com");
  });

  it("rejects web fetch when disabled", async () => {
    const deps = createDeps({} as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebFetchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_fetch"];

    const result = (await handler({
      url: "https://example.com",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Web fetch is disabled");
  });

  it("blocks localhost fetches by default", async () => {
    const deps = createDeps({
      CODEX_MCP_WEB_FETCH_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebFetchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_fetch"];

    const result = (await handler({
      url: "http://localhost:3000",
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Localhost/private URLs");
  });

  it("returns fetched content", async () => {
    const deps = createDeps({
      CODEX_MCP_WEB_FETCH_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const server = new FakeServer();
    registerCodexWebFetchTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_web_fetch"];

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response("hello world", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = (await handler({
      url: "https://example.com",
    })) as { content?: Array<{ text?: string }> };

    const payload = JSON.parse(result.content?.[0]?.text ?? "{}") as {
      content?: string;
      truncated?: boolean;
    };

    expect(payload.content).toContain("hello world");
    expect(payload.truncated).toBe(false);
  });
});
