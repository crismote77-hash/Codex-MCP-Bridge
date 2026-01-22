import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { findGitRoot } from "../src/utils/gitRoot.js";
import { applyAutoGitRootDefaults } from "../src/utils/autoroot.js";
import { isTrustedCwd } from "../src/utils/trustDirs.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-mcp-autoroot-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("autoroot", () => {
  it("findGitRoot returns nearest repo root", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".git"));
      const nested = path.join(dir, "a", "b");
      await fs.mkdir(nested, { recursive: true });

      expect(findGitRoot(nested)).toBe(dir);
    });
  });

  it("applyAutoGitRootDefaults sets filesystem.roots + trustedDirs and disables prompt", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".git"));
      const nested = path.join(dir, "src");
      await fs.mkdir(nested, { recursive: true });

      const config = loadConfig({
        configPath: path.join(dir, "missing-config.json"),
        env: {} as NodeJS.ProcessEnv,
      });
      const logger = createLogger();

      const result = applyAutoGitRootDefaults({
        config,
        logger,
        startDir: nested,
      });

      expect(result.applied).toBe(true);
      expect(result.gitRoot).toBe(dir);
      expect(config.filesystem.roots).toEqual([dir]);
      expect(isTrustedCwd(dir, config.trust.trustedDirs)).toBe(true);
      expect(config.trust.promptOnStart).toBe(false);
    });
  });

  it("applyAutoGitRootDefaults persists a minimal config when no file exists", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".git"));
      const configPath = path.join(dir, "config.json");

      const config = loadConfig({
        configPath,
        env: {} as NodeJS.ProcessEnv,
      });
      const logger = createLogger();

      const result = applyAutoGitRootDefaults({
        config,
        logger,
        startDir: dir,
        configPathForWrite: configPath,
      });

      expect(result.applied).toBe(true);
      expect(result.persisted).toBe(true);

      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      expect(parsed).toMatchObject({
        filesystem: { roots: [dir] },
        trust: { promptOnStart: false, trustedDirs: [dir] },
      });
    });
  });
});

