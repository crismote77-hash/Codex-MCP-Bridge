import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { redactString } from "../utils/redact.js";

export class CodexCliError extends Error {
  name = "CodexCliError";
  exitCode?: number;
  stderr?: string;
}

/**
 * JSONL frame types from Codex CLI --json output.
 * The CLI emits various event types during execution.
 */
export type CodexJsonlFrame =
  | { type: "message"; role: "assistant" | "user" | "system"; content: string }
  | { type: "function_call"; name: string; arguments?: string }
  | { type: "function_result"; name: string; result?: string }
  | { type: "error"; message: string }
  | { type: "done"; content?: string }
  | { type: string; [key: string]: unknown };

export interface CodexStreamEvents {
  frame: (frame: CodexJsonlFrame) => void;
  text: (text: string) => void;
  error: (error: Error) => void;
  end: (result: CodexCommandResult) => void;
}

export class CodexStreamEmitter extends EventEmitter {
  emit<K extends keyof CodexStreamEvents>(
    event: K,
    ...args: Parameters<CodexStreamEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof CodexStreamEvents>(
    event: K,
    listener: CodexStreamEvents[K],
  ): this {
    return super.on(event, listener);
  }
  once<K extends keyof CodexStreamEvents>(
    event: K,
    listener: CodexStreamEvents[K],
  ): this {
    return super.once(event, listener);
  }
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

/**
 * Parse a line of JSONL output from Codex CLI.
 * Returns null if the line is empty or invalid JSON.
 */
export function parseJsonlLine(line: string): CodexJsonlFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as CodexJsonlFrame;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Run Codex CLI with streaming JSONL output.
 * Emits 'frame' events for each parsed JSONL line,
 * 'text' events for assistant message content,
 * 'error' on process errors, and 'end' with the final result.
 */
export function runCodexCommandStream(opts: {
  command: string;
  args: string[];
  input?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): CodexStreamEmitter {
  const emitter = new CodexStreamEmitter();

  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: "pipe",
  });

  let stderr = "";
  let timedOut = false;
  const collectedText: string[] = [];

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, opts.timeoutMs);

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    const frame = parseJsonlLine(line);
    if (frame) {
      emitter.emit("frame", frame);
      // Extract text from assistant messages
      if (
        frame.type === "message" &&
        "role" in frame &&
        frame.role === "assistant" &&
        "content" in frame &&
        typeof frame.content === "string"
      ) {
        collectedText.push(frame.content);
        emitter.emit("text", frame.content);
      } else if (
        frame.type === "done" &&
        "content" in frame &&
        typeof frame.content === "string"
      ) {
        collectedText.push(frame.content);
        emitter.emit("text", frame.content);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    rl.close();
    const err = new CodexCliError(
      `Failed to run Codex CLI: ${error instanceof Error ? error.message : String(error)}`,
    );
    emitter.emit("error", err);
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    rl.close();
    if (timedOut) {
      const err = new CodexCliError(
        `Codex CLI timed out after ${opts.timeoutMs}ms.`,
      );
      err.exitCode = code ?? undefined;
      err.stderr = redactString(stderr);
      emitter.emit("error", err);
      return;
    }
    const result: CodexCommandResult = {
      stdout: collectedText.join(""),
      stderr,
      exitCode: code,
    };
    emitter.emit("end", result);
  });

  if (opts.input) {
    child.stdin.write(opts.input);
  }
  child.stdin.end();

  return emitter;
}
