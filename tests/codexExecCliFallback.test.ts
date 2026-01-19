import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCodexExecTool } from "../src/tools/codexExec.js";
import { loadConfig } from "../src/config.js";
import type { SharedDependencies } from "../src/server.js";
import type { Logger } from "../src/logger.js";
import type { RateLimiter } from "../src/limits/rateLimiter.js";
import type { DailyTokenBudget } from "../src/limits/dailyTokenBudget.js";
import { runCodexCommand } from "../src/services/codexCli.js";

vi.mock("../src/services/codexCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/codexCli.js")>();
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

function createDeps(cliAuthPath: string): {
  deps: SharedDependencies;
  dailyBudget: DailyTokenBudget;
} {
  const env = {
    CODEX_MCP_AUTH_MODE: "cli",
    CODEX_MCP_CLI_AUTH_PATH: cliAuthPath,
  } as NodeJS.ProcessEnv;
  const config = loadConfig({
    configPath: path.join(path.dirname(cliAuthPath), "config.json"),
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

describe("codex_exec (CLI mode)", () => {
  it("auto-retries without default --model when ChatGPT login rejects it", async () => {
    const dir = await makeTempDir();
    const cliAuthPath = path.join(dir, "auth.json");
    await fs.writeFile(cliAuthPath, "{}", "utf8");

    const { deps } = createDeps(cliAuthPath);
    const server = new FakeServer();
    registerCodexExecTool(server as unknown as McpServer, deps);
    const handler = server.tools["codex_exec"];

    const runCodexCommandMock = vi.mocked(runCodexCommand);
    runCodexCommandMock
      .mockResolvedValueOnce({
        stdout: "",
        stderr:
          "Not inside a trusted directory and --skip-git-repo-check was not specified.",
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr:
          "ERROR: {\"detail\":\"The 'o3' model is not supported when using Codex with a ChatGPT account.\"}\n",
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      });

    const result = (await handler({
      prompt: "hello",
      useJson: true,
    })) as { isError?: boolean; content?: Array<{ text?: string }> };

    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toBe("ok");
    expect(runCodexCommandMock).toHaveBeenCalledTimes(3);

    const args1 = runCodexCommandMock.mock.calls[0]?.[0]?.args ?? [];
    const args2 = runCodexCommandMock.mock.calls[1]?.[0]?.args ?? [];
    const args3 = runCodexCommandMock.mock.calls[2]?.[0]?.args ?? [];

    expect(args1).toContain("--model");
    expect(args1[args1.indexOf("--model") + 1]).toBe("o3");
    expect(args1).not.toContain("--skip-git-repo-check");

    expect(args2).toContain("--model");
    expect(args2[args2.indexOf("--model") + 1]).toBe("o3");
    expect(args2).toContain("--skip-git-repo-check");

    expect(args3).toContain("--skip-git-repo-check");
    expect(args3).not.toContain("--model");
  });
});
