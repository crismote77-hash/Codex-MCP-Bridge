import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SharedDependencies } from "../server.js";
import { registerCodexExecTool } from "./codexExec.js";
import { registerCodexReviewTool } from "./codexReview.js";

export function registerTools(
  server: McpServer,
  deps: SharedDependencies,
): void {
  registerCodexExecTool(server, deps);
  registerCodexReviewTool(server, deps);
}
