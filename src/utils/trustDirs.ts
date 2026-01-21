import path from "node:path";
import { expandHome } from "./paths.js";

function normalizeDir(input: string): string {
  return path.resolve(expandHome(input));
}

function isWithinDir(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolveTrustedDirs(entries: string[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const normalized = normalizeDir(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    resolved.push(normalized);
  }
  return resolved;
}

export function isTrustedCwd(
  cwd: string | undefined,
  trustedDirs: string[],
): boolean {
  if (!cwd || trustedDirs.length === 0) return false;
  const normalizedCwd = normalizeDir(cwd);
  for (const dir of resolveTrustedDirs(trustedDirs)) {
    if (isWithinDir(normalizedCwd, dir)) return true;
  }
  return false;
}

export function addTrustedDir(trustedDirs: string[], dir: string): string[] {
  return resolveTrustedDirs([...trustedDirs, dir]);
}
