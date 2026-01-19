import { spawn } from "node:child_process";
import { redactString } from "../utils/redact.js";

export class CodexCliError extends Error {
  name = "CodexCliError";
  exitCode?: number;
  stderr?: string;
}

export type CodexCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function runCodexCommand(opts: {
  command: string;
  args: string[];
  input?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      const err = new CodexCliError(
        `Failed to run Codex CLI: ${error instanceof Error ? error.message : String(error)}`,
      );
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const err = new CodexCliError(
          `Codex CLI timed out after ${opts.timeoutMs}ms.`,
        );
        err.exitCode = code ?? undefined;
        err.stderr = redactString(stderr);
        reject(err);
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });

    if (opts.input) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}
