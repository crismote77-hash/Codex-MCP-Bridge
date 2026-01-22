#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SERVER_NAME = "codex-bridge";
const DEFAULT_COMMAND = "codex-mcp-bridge";
const DEFAULT_ARGS = ["--stdio"];
const DEFAULT_MAX_DEPTH = 4;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    dryRun: false,
    base: process.env.HOME || os.homedir(),
    maxDepth: DEFAULT_MAX_DEPTH,
    serverName: DEFAULT_SERVER_NAME,
    command: DEFAULT_COMMAND,
    args: DEFAULT_ARGS,
    claudeCode: true,
    gemini: true,
    bridgeConfig: true,
  };

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (a === "--base") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --base");
      opts.base = value;
      continue;
    }
    if (a === "--max-depth") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --max-depth");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1)
        throw new Error("--max-depth must be a positive integer");
      opts.maxDepth = parsed;
      continue;
    }
    if (a === "--server-name") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --server-name");
      opts.serverName = value;
      continue;
    }
    if (a === "--command") {
      const value = args.shift();
      if (!value) throw new Error("Missing value for --command");
      opts.command = value;
      continue;
    }
    if (a === "--no-claude-code") {
      opts.claudeCode = false;
      continue;
    }
    if (a === "--no-gemini") {
      opts.gemini = false;
      continue;
    }
    if (a === "--no-bridge-config") {
      opts.bridgeConfig = false;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  return opts;
}

function printHelp() {
  process.stdout.write(
    "Configure Codex MCP Bridge for all git repos under a base directory (Claude Code + Gemini).\n\n",
  );
  process.stdout.write("Usage:\n");
  process.stdout.write(
    "  node scripts/configure-mcp-projects.mjs --base /home/you [--dry-run]\n\n",
  );
  process.stdout.write("Options:\n");
  process.stdout.write("  --base <path>         Base directory to scan (default: $HOME)\n");
  process.stdout.write(
    `  --max-depth <n>        Max scan depth (default: ${DEFAULT_MAX_DEPTH})\n`,
  );
  process.stdout.write(
    `  --server-name <name>   MCP server name (default: ${DEFAULT_SERVER_NAME})\n`,
  );
  process.stdout.write(
    `  --command <cmd>        Command (default: ${DEFAULT_COMMAND})\n`,
  );
  process.stdout.write("  --dry-run             Print what would change\n");
  process.stdout.write("  --no-claude-code       Skip Claude Code config\n");
  process.stdout.write("  --no-gemini            Skip Gemini CLI config\n");
  process.stdout.write("  --no-bridge-config     Skip ~/.codex-mcp-bridge/config.json update\n");
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function readJsonObject(filePath) {
  const raw = readTextIfExists(filePath);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return isPlainObject(parsed) ? parsed : {};
}

function writeJsonObject(filePath, obj, { mode, dryRun }) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  if (typeof mode === "number") fs.chmodSync(filePath, mode);
}

function backupFile(filePath, { dryRun }) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak.${stamp}`;
  if (!dryRun) fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function discoverGitRepos(baseDir, maxDepth) {
  const res = spawnSync(
    "find",
    [baseDir, "-maxdepth", String(maxDepth), "-name", ".git", "-print"],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`find failed: ${(res.stderr || "").trim() || "unknown"}`);
  }
  const entries = (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const roots = Array.from(new Set(entries.map((p) => path.dirname(p)))).sort();
  return roots;
}

function detectCodexPath() {
  const res = spawnSync("command", ["-v", "codex"], { encoding: "utf8" });
  if (res.status === 0) {
    const out = (res.stdout || "").trim();
    if (out) return out;
  }
  const which = spawnSync("which", ["codex"], { encoding: "utf8" });
  if (which.status === 0) {
    const out = (which.stdout || "").trim();
    if (out) return out;
  }
  return null;
}

function ensureClaudeProject(projects, projectPath) {
  const existing = projects[projectPath];
  if (!isPlainObject(existing)) {
    projects[projectPath] = { mcpServers: {} };
    return;
  }
  if (!isPlainObject(existing.mcpServers)) {
    existing.mcpServers = {};
  }
}

function upsertClaudeCodeForProjects(
  filePath,
  projectPaths,
  { serverName, command, args, dryRun, env },
) {
  const before = readJsonObject(filePath);
  const out = isPlainObject(before) ? before : {};
  if (!isPlainObject(out.projects)) out.projects = {};

  const projects = out.projects;
  for (const projectPath of projectPaths) {
    ensureClaudeProject(projects, projectPath);
    const project = projects[projectPath];
    const existingServer = isPlainObject(project.mcpServers?.[serverName])
      ? project.mcpServers[serverName]
      : {};
    const existingEnv = isPlainObject(existingServer.env)
      ? existingServer.env
      : {};

    project.mcpServers[serverName] = {
      type: "stdio",
      command,
      args,
      env: { ...existingEnv, ...env },
    };
  }

  const afterText = `${JSON.stringify(out, null, 2)}\n`;
  const beforeText = readTextIfExists(filePath) ?? "";
  if (afterText === beforeText) return { changed: false, backup: null };

  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o600;
  const backup = backupFile(filePath, { dryRun });
  writeJsonObject(filePath, out, { mode, dryRun });
  return { changed: true, backup };
}

function upsertGeminiConfig(filePath, { serverName, command, args, dryRun }) {
  const before = readJsonObject(filePath);
  const out = isPlainObject(before) ? before : {};
  if (!isPlainObject(out.mcpServers)) out.mcpServers = {};

  out.mcpServers[serverName] = { command, args };

  const afterText = `${JSON.stringify(out, null, 2)}\n`;
  const beforeText = readTextIfExists(filePath) ?? "";
  if (afterText === beforeText) return { changed: false, backup: null };

  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o600;
  const backup = backupFile(filePath, { dryRun });
  writeJsonObject(filePath, out, { mode, dryRun });
  return { changed: true, backup };
}

function upsertBridgeConfig(filePath, { dryRun, codexPath }) {
  const before = readJsonObject(filePath);
  const out = isPlainObject(before) ? before : {};

  out.transport = isPlainObject(out.transport) ? out.transport : {};
  out.transport.mode = "stdio";
  out.transport.http = isPlainObject(out.transport.http) ? out.transport.http : {};
  out.transport.http.host = "127.0.0.1";
  out.transport.http.port = 3923;

  out.web = isPlainObject(out.web) ? out.web : {};
  out.web.searchEnabled = true;
  out.web.fetchEnabled = true;
  out.web.allowLocalhost = true;

  out.cli = isPlainObject(out.cli) ? out.cli : {};
  if (codexPath) out.cli.command = codexPath;

  const afterText = `${JSON.stringify(out, null, 2)}\n`;
  const beforeText = readTextIfExists(filePath) ?? "";
  if (afterText === beforeText) return { changed: false, backup: null };

  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o600;
  const backup = backupFile(filePath, { dryRun });
  writeJsonObject(filePath, out, { mode, dryRun });
  return { changed: true, backup };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const baseDir = path.resolve(opts.base);
  const repos = discoverGitRepos(baseDir, opts.maxDepth);
  const codexPath = detectCodexPath();

  const idealEnv = {
    CODEX_MCP_AUTH_MODE: "auto",
    ...(codexPath ? { CODEX_MCP_CLI_COMMAND: codexPath } : {}),
    CODEX_MCP_WEB_SEARCH_ENABLED: "true",
    CODEX_MCP_WEB_FETCH_ENABLED: "true",
    CODEX_MCP_WEB_ALLOW_LOCALHOST: "true",
    CODEX_MCP_TRANSPORT_MODE: "stdio",
    CODEX_MCP_HTTP_HOST: "127.0.0.1",
    CODEX_MCP_HTTP_PORT: "3923",
  };

  const home = process.env.HOME || os.homedir();
  const changes = [];

  if (opts.bridgeConfig) {
    const bridgePath = path.join(home, ".codex-mcp-bridge", "config.json");
    const result = upsertBridgeConfig(bridgePath, { dryRun: opts.dryRun, codexPath });
    if (result.changed) changes.push({ target: "bridgeConfig", path: bridgePath, backup: result.backup });
  }

  if (opts.claudeCode) {
    const claudePath = path.join(home, ".claude.json");
    const result = upsertClaudeCodeForProjects(claudePath, repos, {
      serverName: opts.serverName,
      command: opts.command,
      args: opts.args,
      dryRun: opts.dryRun,
      env: idealEnv,
    });
    if (result.changed)
      changes.push({
        target: "claudeCode",
        path: claudePath,
        backup: result.backup,
        projects: repos.length,
      });
  }

  if (opts.gemini) {
    const geminiPath = path.join(home, ".gemini", "settings.json");
    const result = upsertGeminiConfig(geminiPath, {
      serverName: opts.serverName,
      command: opts.command,
      args: opts.args,
      dryRun: opts.dryRun,
    });
    if (result.changed) changes.push({ target: "gemini", path: geminiPath, backup: result.backup });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        dryRun: opts.dryRun,
        baseDir,
        reposFound: repos.length,
        codexPath: codexPath ?? null,
        changes,
        notes: [
          "Web search requires CODEX_MCP_TAVILY_API_KEY in your environment (not written by this script).",
          "Filesystem tools are enabled automatically when the server runs inside a git repo (no filesystem roots needed).",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

