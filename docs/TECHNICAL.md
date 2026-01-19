# Technical Development Documentation

## Project: Codex MCP Bridge

MCP server that exposes Codex CLI capabilities to other AI CLIs (Claude, Gemini, Codex).

Status (2026-01-19): scaffolding + MVP wiring in progress. This document is the canonical source for architecture and implementation strategy. Any changes here must be reflected in `STATUS.md`.

---

## Goals

- Provide a local MCP server that calls Codex CLI by default.
- Support API-key fallback for headless or CI environments.
- Work cleanly as a child process of Claude CLI and Gemini CLI (stdio transport).
- Support multiuser setup via a helper script.

Non-goals (for MVP):
- Full Codex session management or GUI integration.
- Replacing Codex CLI itself (we wrap it).

---

## Auth Strategy

Two backends:

1) CLI mode (default)
- Uses Codex CLI credentials stored by `codex login`.
- We only check that the credentials file exists; we do not parse it.
- Tool execution spawns `codex` as a child process.

2) API-key fallback
- Uses `OPENAI_API_KEY` (or an override) to call the OpenAI Responses API.
- Intended for CI/headless use or when Codex CLI auth is missing.

Selection:
- `auth.mode = auto`: prefer CLI auth, fallback to API key when available.
- `auth.mode = cli`: require Codex CLI auth.
- `auth.mode = api_key`: require API key.

---

## Configuration and Precedence

Config sources (lowest to highest precedence):
1) Built-in defaults (`src/config.ts`)
2) Optional JSON config file (default `~/.codex-mcp-bridge/config.json`)
3) Environment variables (`CODEX_MCP_*`)
4) Per-tool request arguments (e.g. `model`, `cwd`, `timeoutMs`)

Model defaults:
- CLI mode: if a `codex_exec` request does not specify `model`, the bridge passes `--model <config.cli.defaultModel>` to Codex CLI by default.
- API-key mode: if a request does not specify `model`, the bridge uses `config.api.model` for the OpenAI Responses API call.
- The setup wizard sets both `cli.defaultModel` and `api.model` together; they can be edited independently later.

Compatibility fallback:
- Some Codex CLI logins (notably ChatGPT-account auth) only support a subset of models.
- If `codex_exec` is invoked without an explicit `model` and Codex CLI reports the chosen model is unsupported for that login, the bridge auto-retries once without a `--model` override so Codex CLI can use its own default.

## Codex CLI Idiosyncrasies (Modeled)

- Config overrides use `-c key=value` and TOML parsing.
- `codex exec` supports:
  - `--output-last-message <file>` (preferred for stable parsing)
  - `--json` for JSONL streaming
  - `--model`, `--profile`, `--sandbox`, `--ask-for-approval`
  - `--cd`, `--add-dir`, `--skip-git-repo-check`
- `codex review` supports:
  - `--uncommitted`, `--base <branch>`, `--commit <sha>`, `--title <text>`

We model these as optional tool arguments and pass them through to the CLI.

---

## Tool Surface (MVP)

- `codex_exec`
  - Runs `codex exec` (CLI) or OpenAI Responses API (fallback).
  - Uses `--output-last-message` when possible.

- `codex_review`
  - CLI mode: runs `codex review`.
  - CLI mode supports `cwd` so callers can target a specific repo even if the MCP server starts elsewhere.
  - API mode: requires a diff payload and runs a review prompt against the API.
  - Enforces max input size for prompt + diff (API mode) and prompt (CLI mode).

Both tools enforce:
- Input size limits
- Rate limits and daily token budgets
- Stderr-only logging

---

## Architecture Overview

```
MCP Clients (Claude/Gemini/Codex)
        |
        v
Codex MCP Bridge (stdio or HTTP)
        |
   +----+-------------------------+
   |                              |
CLI backend (codex exec/review)   API backend (OpenAI Responses)
```

Core components:
- `src/index.ts`: CLI entry + transport selection
- `src/setupWizard.ts`: guided setup flow (writes config; stderr output)
- `src/server.ts`: MCP server + tool/resource registration
- `src/auth/resolveAuth.ts`: backend selection
- `src/services/codexCli.ts`: child-process runner
- `src/services/openaiClient.ts`: API client
- `src/tools/*`: tool handlers
- `src/limits/*`: rate limits + daily budgets

---

## Transport Modes

- Stdio (default): meant for local MCP clients.
- Streamable HTTP (optional): for local HTTP deployments. Bind to 127.0.0.1 by default.

---

## Multiuser Support

Use `scripts/configure-mcp-users.mjs` to register the bridge in:
- Codex CLI config (`~/.codex/config.toml`)
- Claude Desktop config (`~/.config/Claude/claude_desktop_config.json`)
- Claude Code config (`~/.claude.json`)
- Gemini CLI config (`~/.gemini/settings.json`)

The script supports `--all-users` and `--user <name>`.

---

## Setup Wizard

The CLI supports a guided setup flow:
- `codex-mcp-bridge --setup` (interactive)
- `codex-mcp-bridge --setup --non-interactive` (uses defaults/flags)
- From a local clone: `npm run setup` (builds `dist/` then runs `--setup`)

Wizard behavior:
- Writes `~/.codex-mcp-bridge/config.json` (or `--config <path>`).
- Never stores API keys; only env var names are written.
- Outputs to stderr to avoid MCP stdout conflicts.
- Default behavior is merge; `--overwrite` replaces the config, and `--dry-run` prints a summary without writing.

Wizard prompt groups:
- Basic: transport, auth mode, default model.
- Advanced (optional): Codex CLI command/auth path, API key env var names, API fallback settings, limits/timeouts (including optional Redis shared limits).

---

## Error Handling Policy

- Tool failures return `{ isError: true, content: [...] }` with actionable guidance.
- Avoid throwing from tool handlers except for protocol-level failures.
- Redact secrets from logs and error messages.

---

## References

- MCP spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- Codex CLI (local `codex --help`)
- OpenAI Responses API: https://api.openai.com/v1/responses
