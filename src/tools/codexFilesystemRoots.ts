import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SharedDependencies } from "../server.js";
import { expandHome } from "../utils/paths.js";
import { findGitRoot } from "../utils/gitRoot.js";

const getRootsSchema = {};

const addRootSchema = {
  path: z.string().min(1).describe("Path to add to filesystem roots"),
  autoDetectGit: z
    .boolean()
    .default(true)
    .describe("If true and path is in a git repo, add the git root instead"),
};

type AddRootArgs = {
  path: string;
  autoDetectGit?: boolean;
};

/**
 * Register tools for managing filesystem roots at runtime.
 * These tools allow clients to configure filesystem access without restarting the server.
 */
export function registerCodexFilesystemRootsTool(
  server: McpServer,
  deps: SharedDependencies,
): void {
  // Tool: Get current filesystem roots
  server.registerTool(
    "codex_filesystem_roots_get",
    {
      title: "Get Filesystem Roots",
      description:
        "Get the current filesystem roots configuration. Returns the list of directories where filesystem tools can operate.",
      inputSchema: getRootsSchema,
    },
    async () => {
      const roots = deps.config.filesystem.roots;
      const status =
        roots.length === 0
          ? "disabled (no roots configured)"
          : `enabled (${roots.length} root${roots.length === 1 ? "" : "s"})`;

      const response = {
        status,
        roots,
        configHint:
          roots.length === 0
            ? "Use codex_filesystem_roots_add to enable filesystem tools, or set CODEX_MCP_FILESYSTEM_ROOTS environment variable."
            : undefined,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool: Add a filesystem root
  server.registerTool(
    "codex_filesystem_roots_add",
    {
      title: "Add Filesystem Root",
      description:
        "Add a directory to the filesystem roots, enabling filesystem tools to operate in that directory. If autoDetectGit is true (default), the git repository root is used instead.",
      inputSchema: addRootSchema,
    },
    async (args: AddRootArgs) => {
      const inputPath = expandHome(args.path);
      const resolvedPath = path.resolve(inputPath);

      // Check if we should use git root instead
      let pathToAdd = resolvedPath;
      if (args.autoDetectGit !== false) {
        const gitRoot = findGitRoot(resolvedPath);
        if (gitRoot) {
          pathToAdd = gitRoot;
        }
      }

      // Check if already present
      const normalizedRoots = deps.config.filesystem.roots.map((r) =>
        path.resolve(expandHome(r)),
      );
      if (normalizedRoots.includes(pathToAdd)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Path already in filesystem roots",
                  path: pathToAdd,
                  roots: deps.config.filesystem.roots,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Add the new root
      deps.config.filesystem.roots.push(pathToAdd);

      deps.logger.info("Added filesystem root", { path: pathToAdd });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: "Added filesystem root",
                path: pathToAdd,
                usedGitRoot: pathToAdd !== resolvedPath,
                roots: deps.config.filesystem.roots,
                note: "Filesystem tools are now enabled. This change is session-only and will not persist across restarts.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
