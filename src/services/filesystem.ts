import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { FilesystemError } from "../errors.js";
import { expandHome } from "../utils/paths.js";

export type FilesystemLimits = {
  roots: string[];
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxSearchResults: number;
};

export type SearchMode = "content" | "path";

export type FileSnapshot = {
  path: string;
  content: string;
  size: number;
};

type ResolvedPath = {
  resolvedPath: string;
  root: string;
  stat: Awaited<ReturnType<typeof fs.stat>>;
};

export function normalizeRoots(roots: string[]): string[] {
  const resolved = roots
    .map((entry) => path.resolve(expandHome(entry)))
    .filter(Boolean);
  return Array.from(new Set(resolved));
}

export function requireRoots(roots: string[]): string[] {
  if (roots.length === 0) {
    throw new FilesystemError(
      "Filesystem access is disabled. Configure filesystem.roots or CODEX_MCP_FILESYSTEM_ROOTS.",
    );
  }
  return roots;
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function resolvePathWithinRoots(opts: {
  inputPath: string;
  roots: string[];
  expect?: "file" | "dir" | "any";
}): Promise<ResolvedPath> {
  const roots = requireRoots(normalizeRoots(opts.roots));
  const expanded = expandHome(opts.inputPath);
  const isAbsolute = path.isAbsolute(expanded);
  const candidates = isAbsolute
    ? roots.map((root) => ({ root, candidate: path.resolve(expanded) }))
    : roots.map((root) => ({
        root,
        candidate: path.resolve(root, expanded),
      }));

  let foundWithinRoot = false;
  for (const { root, candidate } of candidates) {
    if (!isWithinRoot(root, candidate)) continue;
    foundWithinRoot = true;
    try {
      const stat = await fs.stat(candidate);
      const realRoot = await fs.realpath(root).catch(() => root);
      const realCandidate = await fs.realpath(candidate).catch(() => candidate);
      if (!isWithinRoot(realRoot, realCandidate)) continue;
      const expect = opts.expect ?? "any";
      if (expect === "file" && !stat.isFile()) continue;
      if (expect === "dir" && !stat.isDirectory()) continue;
      if (expect === "any" && !(stat.isFile() || stat.isDirectory())) {
        continue;
      }
      return { resolvedPath: realCandidate, root: realRoot, stat };
    } catch {
      continue;
    }
  }

  if (!foundWithinRoot) {
    throw new FilesystemError("Path is outside configured filesystem roots.");
  }
  const expect = opts.expect ?? "any";
  if (expect === "file") {
    throw new FilesystemError("File not found.");
  }
  if (expect === "dir") {
    throw new FilesystemError("Directory not found.");
  }
  throw new FilesystemError("Path not found.");
}

export async function readFileWithLimits(opts: {
  inputPath: string;
  roots: string[];
  maxFileBytes: number;
  startLine?: number;
  endLine?: number;
}): Promise<string> {
  const resolved = await resolvePathWithinRoots({
    inputPath: opts.inputPath,
    roots: opts.roots,
    expect: "file",
  });

  if (resolved.stat.size > opts.maxFileBytes) {
    throw new FilesystemError(
      `File exceeds max size (${opts.maxFileBytes} bytes).`,
    );
  }

  const raw = await fs.readFile(resolved.resolvedPath, "utf-8");
  if (raw.includes("\u0000")) {
    throw new FilesystemError("Binary files are not supported.");
  }

  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = opts.startLine ?? 1;
  const endLine = opts.endLine ?? totalLines;

  if (startLine < 1 || endLine < 1) {
    throw new FilesystemError("startLine and endLine must be >= 1.");
  }
  if (startLine > endLine) {
    throw new FilesystemError("startLine must be <= endLine.");
  }
  if (startLine > totalLines) {
    throw new FilesystemError("startLine is beyond end of file.");
  }

  const safeEnd = Math.min(endLine, totalLines);
  const slice = lines.slice(startLine - 1, safeEnd);
  return slice.map((line, idx) => `${startLine + idx}: ${line}`).join("\n");
}

export async function collectFiles(opts: {
  paths: string[];
  roots: string[];
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}): Promise<{ root: string; files: FileSnapshot[]; totalBytes: number }> {
  const roots = requireRoots(normalizeRoots(opts.roots));
  const inputPaths = opts.paths.length ? opts.paths : ["."];
  let selectedRoot: string | null = null;
  let totalBytes = 0;
  const files: FileSnapshot[] = [];
  const seen = new Set<string>();

  const ensureRoot = (root: string) => {
    if (!selectedRoot) {
      selectedRoot = root;
      return;
    }
    if (selectedRoot !== root) {
      throw new FilesystemError(
        "All paths must be within a single filesystem root.",
      );
    }
  };

  const addFile = async (filePath: string, root: string) => {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new FilesystemError("Symlinks are not supported.");
    }
    if (!stat.isFile()) return;
    if (stat.size > opts.maxFileBytes) {
      throw new FilesystemError(
        `File exceeds max size (${opts.maxFileBytes} bytes).`,
      );
    }
    const nextTotal = totalBytes + stat.size;
    if (nextTotal > opts.maxTotalBytes) {
      throw new FilesystemError(
        `Total file size exceeds max (${opts.maxTotalBytes} bytes).`,
      );
    }
    if (files.length >= opts.maxFiles) {
      throw new FilesystemError(`File limit exceeded (${opts.maxFiles}).`);
    }
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath === ".") {
      return;
    }
    if (seen.has(relativePath)) return;
    const content = await fs.readFile(filePath, "utf-8");
    if (content.includes("\u0000")) {
      throw new FilesystemError("Binary files are not supported.");
    }
    seen.add(relativePath);
    totalBytes = nextTotal;
    files.push({ path: relativePath, content, size: stat.size });
  };

  const walkDir = async (dirPath: string, root: string) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walkDir(entryPath, root);
        continue;
      }
      if (entry.isFile()) {
        await addFile(entryPath, root);
      }
    }
  };

  for (const inputPath of inputPaths) {
    const resolved = await resolvePathWithinRoots({
      inputPath,
      roots,
      expect: "any",
    });
    ensureRoot(resolved.root);

    const stat = await fs.lstat(resolved.resolvedPath);
    if (stat.isSymbolicLink()) {
      throw new FilesystemError("Symlinks are not supported.");
    }
    if (stat.isDirectory()) {
      await walkDir(resolved.resolvedPath, resolved.root);
      continue;
    }
    if (stat.isFile()) {
      await addFile(resolved.resolvedPath, resolved.root);
    }
  }

  if (!selectedRoot) {
    throw new FilesystemError("No files found within provided paths.");
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root: selectedRoot, files, totalBytes };
}

function normalizeSearchMode(mode: string): SearchMode {
  if (mode === "content" || mode === "grep") return "content";
  if (mode === "path" || mode === "glob") return "path";
  throw new FilesystemError(
    "Invalid search mode. Use content/grep or path/glob.",
  );
}

async function assertDirectory(opts: {
  inputPath?: string;
  roots: string[];
}): Promise<string> {
  const roots = requireRoots(normalizeRoots(opts.roots));
  if (!opts.inputPath) {
    if (roots.length !== 1) {
      throw new FilesystemError(
        "directory is required when multiple filesystem roots are configured.",
      );
    }
    const root = roots[0];
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw new FilesystemError(
        "Configured filesystem root is not a directory.",
      );
    }
    return root;
  }

  const resolved = await resolvePathWithinRoots({
    inputPath: opts.inputPath,
    roots,
    expect: "dir",
  });
  return resolved.resolvedPath;
}

export async function searchFiles(opts: {
  roots: string[];
  directory?: string;
  pattern: string;
  mode: string;
  filePattern?: string;
  maxResults: number;
}): Promise<string[]> {
  const mode = normalizeSearchMode(opts.mode);
  const rootDir = await assertDirectory({
    inputPath: opts.directory,
    roots: opts.roots,
  });

  const maxResults = Math.max(1, opts.maxResults);
  const args: string[] = ["--color", "never"];
  const skipGlobs = ["!**/node_modules/**", "!**/.git/**"];

  if (mode === "content") {
    args.push("--line-number", "--with-filename", "--no-heading");
    for (const glob of skipGlobs) {
      args.push("--glob", glob);
    }
    if (opts.filePattern) {
      args.push("-g", opts.filePattern);
    }
    args.push("--", opts.pattern);
    args.push(".");
  } else {
    args.push("--files");
    for (const glob of skipGlobs) {
      args.push("--glob", glob);
    }
    args.push("-g", opts.pattern);
  }

  return runRipgrep({
    cwd: rootDir,
    args,
    maxResults,
  });
}

async function runRipgrep(opts: {
  cwd: string;
  args: string[];
  maxResults: number;
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const results: string[] = [];
    let killedEarly = false;

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new FilesystemError(
            "ripgrep (rg) is required for search. Install rg and retry.",
          ),
        );
        return;
      }
      reject(
        new FilesystemError(
          error instanceof Error ? error.message : "Failed to run rg.",
        ),
      );
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line) return;
      results.push(line);
      if (results.length >= opts.maxResults) {
        killedEarly = true;
        rl.close();
        child.kill("SIGKILL");
      }
    });

    child.on("close", (code) => {
      if (killedEarly) {
        resolve(results.slice(0, opts.maxResults));
        return;
      }
      if (code === 0 || code === 1) {
        resolve(results);
        return;
      }
      const detail = stderr.trim();
      reject(
        new FilesystemError(
          detail ? `rg failed: ${detail}` : "rg failed to search files.",
        ),
      );
    });
  });
}
