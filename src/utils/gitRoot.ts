import fs from "node:fs";
import path from "node:path";

/**
 * Find the nearest git repository root for a given directory by walking up
 * parent directories and checking for a `.git` entry (directory or file).
 *
 * Returns null when no repository is found.
 */
export function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const gitEntry = path.join(current, ".git");
    if (fs.existsSync(gitEntry)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
