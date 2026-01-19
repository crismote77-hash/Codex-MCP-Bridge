import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DailyTokenBudget } from "../limits/dailyTokenBudget.js";
import type { Logger } from "../logger.js";
import { registerUsageResource } from "./usage.js";

export function registerResources(
  server: McpServer,
  deps: {
    dailyBudget: DailyTokenBudget;
    logger: Logger;
  },
): void {
  registerUsageResource(server, deps.dailyBudget, deps.logger);
}
