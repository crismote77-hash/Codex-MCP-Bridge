import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SharedDependencies } from "../server.js";
import { registerCodexExecTool } from "./codexExec.js";
import { registerCodexReviewTool } from "./codexReview.js";
import { registerCodexReadFileTool } from "./codexReadFile.js";
import { registerCodexSearchFilesTool } from "./codexSearchFiles.js";
import { registerCodexCodeFixTool } from "./codexCodeFix.js";
import { registerCodexCountTokensTool } from "./codexCountTokens.js";
import { registerCodexCountTokensBatchTool } from "./codexCountTokensBatch.js";
import { registerCodexWebSearchTool } from "./codexWebSearch.js";
import { registerCodexWebFetchTool } from "./codexWebFetch.js";
import { registerCodexTranscribeTool } from "./codexTranscribe.js";
import { registerCodexGenerateImageTool } from "./codexGenerateImage.js";

export function registerTools(
  server: McpServer,
  deps: SharedDependencies,
): void {
  registerCodexExecTool(server, deps);
  registerCodexReviewTool(server, deps);
  registerCodexReadFileTool(server, deps);
  registerCodexSearchFilesTool(server, deps);
  registerCodexCodeFixTool(server, deps);
  registerCodexCountTokensTool(server, deps);
  registerCodexCountTokensBatchTool(server, deps);
  registerCodexWebSearchTool(server, deps);
  registerCodexWebFetchTool(server, deps);
  registerCodexTranscribeTool(server, deps);
  registerCodexGenerateImageTool(server, deps);
}
