import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PatchError } from "../errors.js";
import { isWithinRoot, type FileSnapshot } from "./filesystem.js";

export function buildCodeFixPrompt(
  request: string,
  files: FileSnapshot[],
): string {
  const header = [
    "You are a code assistant.",
    "Return a unified diff only. Do not include explanations or code fences.",
    `Request: ${request.trim()}`,
    "Context files:",
  ].join("\n");

  const fileBlocks = files
    .map((file) => {
      return [
        `--- BEGIN FILE: ${file.path} ---`,
        file.content,
        `--- END FILE: ${file.path} ---`,
      ].join("\n");
    })
    .join("\n\n");

  return [header, fileBlocks].join("\n\n");
}

function extractDiffFromFence(lines: string[]): string | null {
  const fenceStart = lines.findIndex((line) => line.trim().startsWith("```"));
  if (fenceStart === -1) return null;
  const fenceEnd = lines.findIndex(
    (line, index) => index > fenceStart && line.trim().startsWith("```"),
  );
  if (fenceEnd === -1) return null;
  const fenced = lines.slice(fenceStart + 1, fenceEnd);
  const hasDiffMarker = fenced.some(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- "),
  );
  return hasDiffMarker ? fenced.join("\n").trim() : null;
}

export function extractUnifiedDiff(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new PatchError("Model returned empty output.");
  }

  const lines = trimmed.split(/\r?\n/);
  const fenced = extractDiffFromFence(lines);
  if (fenced) return fenced;

  const startIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- "),
  );
  if (startIndex === -1) {
    throw new PatchError("Model did not return a unified diff.");
  }
  return lines.slice(startIndex).join("\n").trim();
}

export function validateUnifiedDiff(diff: string, root: string): string[] {
  const lines = diff.split(/\r?\n/);
  const touched = new Set<string>();
  let hasHunk = false;
  let hasFileMarker = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      hasFileMarker = true;
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        touched.add(match[1]);
        touched.add(match[2]);
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      if (raw === "/dev/null") continue;
      hasFileMarker = true;
      const cleaned = raw.replace(/^a\//, "").replace(/^b\//, "");
      if (cleaned) touched.add(cleaned);
      continue;
    }
    if (line.startsWith("@@")) {
      hasHunk = true;
    }
  }

  if (!hasFileMarker || !hasHunk) {
    throw new PatchError("Patch output is not a valid unified diff.");
  }

  const invalidPaths: string[] = [];
  for (const filePath of touched) {
    if (path.isAbsolute(filePath)) {
      invalidPaths.push(filePath);
      continue;
    }
    const resolved = path.resolve(root, filePath);
    if (!isWithinRoot(root, resolved)) {
      invalidPaths.push(filePath);
    }
  }
  if (invalidPaths.length > 0) {
    throw new PatchError(
      `Patch references paths outside the filesystem root: ${invalidPaths.join(
        ", ",
      )}`,
    );
  }

  return Array.from(touched);
}

async function runGitCommand(opts: {
  cwd: string;
  args: string[];
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        reject(new PatchError("git is required to apply patches."));
        return;
      }
      reject(
        new PatchError(
          error instanceof Error ? error.message : "Failed to run git.",
        ),
      );
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

export async function applyPatch(opts: {
  diff: string;
  cwd: string;
}): Promise<void> {
  const patchPath = path.join(os.tmpdir(), `codex-patch-${randomUUID()}.diff`);
  await fs.writeFile(patchPath, `${opts.diff}\n`, "utf-8");

  try {
    const check = await runGitCommand({
      cwd: opts.cwd,
      args: ["apply", "--check", "--whitespace=nowarn", patchPath],
    });
    if (check.exitCode !== 0) {
      const detail = check.stderr.trim();
      throw new PatchError(
        detail ? `Patch failed precheck: ${detail}` : "Patch failed precheck.",
      );
    }

    const result = await runGitCommand({
      cwd: opts.cwd,
      args: ["apply", "--whitespace=nowarn", patchPath],
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim();
      throw new PatchError(
        detail ? `Patch apply failed: ${detail}` : "Patch apply failed.",
      );
    }
  } finally {
    await fs.unlink(patchPath).catch(() => undefined);
  }
}
