import fs from "node:fs";
import path from "node:path";
import type { BridgeConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { expandHome } from "./paths.js";
import { addTrustedDir, isTrustedCwd } from "./trustDirs.js";
import { findGitRoot } from "./gitRoot.js";

export type AutoRootResult = {
  applied: boolean;
  gitRoot: string | null;
  persisted: boolean;
};

function writeAutoConfigPatch(
  logger: Logger,
  configPath: string,
  patch: Record<string, unknown>,
): boolean {
  const resolvedPath = path.resolve(expandHome(configPath));
  const alreadyExists = fs.existsSync(resolvedPath);
  if (alreadyExists) return false;

  try {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(resolvedPath, `${JSON.stringify(patch, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    logger.error("Failed to write auto config file", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Apply automatic defaults when no explicit config is provided:
 * - If `filesystem.roots` is empty, set it to the git repo root of `startDir`.
 * - If `trust.trustedDirs` is empty, set it to include that same git root and
 *   disable the trust prompt.
 *
 * If `configPathForWrite` is provided and no config file exists yet, a minimal
 * config file is created containing these auto settings (no secrets).
 */
export function applyAutoGitRootDefaults(opts: {
  config: BridgeConfig;
  logger: Logger;
  startDir: string;
  configPathForWrite?: string;
}): AutoRootResult {
  const gitRoot = findGitRoot(opts.startDir);
  if (!gitRoot) return { applied: false, gitRoot: null, persisted: false };

  let applied = false;

  if (opts.config.filesystem.roots.length === 0) {
    opts.config.filesystem.roots = [gitRoot];
    applied = true;
  }

  if (
    opts.config.trust.trustedDirs.length === 0 ||
    !isTrustedCwd(gitRoot, opts.config.trust.trustedDirs)
  ) {
    opts.config.trust.trustedDirs = addTrustedDir(
      opts.config.trust.trustedDirs,
      gitRoot,
    );
    opts.config.trust.promptOnStart = false;
    applied = true;
  }

  let persisted = false;
  if (opts.configPathForWrite && applied) {
    // Only persist when no config file exists. This keeps behavior automatic
    // without mutating existing user configs.
    const patch: Record<string, unknown> = {};
    patch.filesystem = { roots: [gitRoot] };
    patch.trust = {
      promptOnStart: false,
      trustedDirs: [gitRoot],
    };
    persisted = writeAutoConfigPatch(
      opts.logger,
      opts.configPathForWrite,
      patch,
    );
    if (persisted) {
      opts.logger.info("Wrote auto config file with git-root defaults", {
        configPath: opts.configPathForWrite,
        gitRoot,
      });
    }
  }

  return { applied, gitRoot, persisted };
}
