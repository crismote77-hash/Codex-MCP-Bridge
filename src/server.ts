import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { RateLimiter } from "./limits/rateLimiter.js";
import { DailyTokenBudget } from "./limits/dailyTokenBudget.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";

export type SharedDependencies = {
  config: BridgeConfig;
  logger: Logger;
  rateLimiter: RateLimiter;
  dailyBudget: DailyTokenBudget;
};

export function createMcpServer(
  deps: SharedDependencies,
  info: { name: string; version: string },
): McpServer {
  const server = new McpServer({ name: info.name, version: info.version });
  registerTools(server, deps);
  registerResources(server, {
    dailyBudget: deps.dailyBudget,
    logger: deps.logger,
  });
  return server;
}
