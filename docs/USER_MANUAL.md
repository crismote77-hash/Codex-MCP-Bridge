# User Manual

## Codex MCP Bridge

Expose Codex CLI capabilities to other AI CLIs via MCP. This runs locally as an MCP server and requires network access to reach OpenAI.

---

## Quick Start

1) Install (choose one):

Note: this project is not published to the npm registry yet. `npm install -g codex-mcp-bridge` will 404; install from GitHub or from a local clone.

**A) Global install (GitHub)**
```bash
npm install -g git+ssh://git@github.com:crismote77-hash/Codex-MCP-Bridge.git
# or: npm install -g git+https://github.com/crismote77-hash/Codex-MCP-Bridge.git
```

If you prefer a user-local install (no sudo), use:
```bash
npm install -g git+ssh://git@github.com:crismote77-hash/Codex-MCP-Bridge.git --prefix ~/.local
```

**B) From source (local clone)**
```bash
git clone git@github.com:crismote77-hash/Codex-MCP-Bridge.git
cd Codex-MCP-Bridge
npm install
npm run setup
```

Verify the CLI is available:
```bash
which codex-mcp-bridge || echo "Not on PATH (try ~/.local/bin/codex-mcp-bridge or add ~/.local/bin to PATH)"
codex-mcp-bridge --version || true
```

2) Authenticate (recommended):
```bash
codex --version
codex login status
codex login
# or: printenv OPENAI_API_KEY | codex login --with-api-key
```

3) Configure your CLI to run `codex-mcp-bridge --stdio` (see below).

4) Restart your CLI and list tools. You should see `codex_exec` and `codex_review`.

---

## Setup Wizard

The setup wizard creates or updates the bridge config file and prints a summary (to stderr).

Run it via whichever command you installed:
- Global install / on PATH: `codex-mcp-bridge --setup`
- User-local prefix install: `~/.local/bin/codex-mcp-bridge --setup`
- From a local clone: `npm run setup` (builds `dist/` then runs `node dist/index.js --setup`)

What it writes:
- Config file: `~/.codex-mcp-bridge/config.json` (or `--config <path>`)
- No secrets: API keys are never stored (only env var names / key-file env var names)

### Basic flow (recommended)

The basic flow asks only for:
1) Transport (`stdio` or `http`)
2) Auth mode (`auto`, `cli`, `api_key`)
3) Default model (used unless overridden)

About the default model:
- The wizard sets both `cli.defaultModel` (Codex CLI execution) and `api.model` (API fallback).
- Model choice can be per-request: pass `model` to `codex_exec` (and to `codex_review` in API mode).
- If your Codex CLI login only supports certain models (common with ChatGPT-account logins), prefer letting Codex CLI pick its own default. If you omit `model` and the bridge’s default model is rejected, `codex_exec` auto-retries once without `--model`.

### Advanced settings (optional)

After the basic questions, the wizard can prompt for advanced settings. It’s safe to answer “No” to all of these unless you have a specific need.

**Customize Codex CLI command or auth path**
- Use when `codex` isn’t on the PATH for the MCP client (GUI apps often have a different PATH), or when credentials are stored in a non-default location.
- Examples: `--cli-command /absolute/path/to/codex`, `--cli-auth-path /absolute/path/to/auth.json`

**Customize API key env var names**
- Use when you already have an API key wired under different env var names.
- Also useful in locked-down environments where you must use a file-based secret: `OPENAI_API_KEY_FILE` (or whatever you configure).

**Customize API settings**
- Only used in API-key mode (or if `auth.mode=auto` falls back to API).
- For proxies/self-hosted gateways: API base URL.
- For behavior/tuning: temperature, max output tokens.

**Configure limits and timeouts**
- Safety rails: request timeout, max input chars, requests/minute, tokens/day.
- Optional shared limits (Redis) are for multi-process/multi-client deployments that should share a single budget.

### Non-interactive / automation

Examples:
```bash
codex-mcp-bridge --setup --non-interactive --auth auto --model o3
codex-mcp-bridge --setup --dry-run
codex-mcp-bridge --setup --overwrite
```

### Mock transcript (defaults, minimal)

```text
Select transport mode: stdio (default)
Select authentication mode: auto (default)
Default model (used unless overridden) [o3] (press enter)

Configure advanced settings (CLI paths, env vars, API settings, limits)? [y/N] n
```

### Doctor / print-config

Use these for debugging your install and config:
```bash
codex-mcp-bridge --doctor
codex-mcp-bridge --print-config
```

---

## Authentication

### Default: Codex CLI auth (CLI mode)
The bridge uses Codex CLI credentials by default. Make sure you have logged in with `codex login`.

### API-key fallback
Use this for headless/CI or if Codex CLI auth is unavailable:
```bash
export CODEX_MCP_AUTH_MODE=api_key
export OPENAI_API_KEY=sk-...
```

Optional file-based key:
```bash
export OPENAI_API_KEY_FILE=/path/to/key.txt
```

### Auto mode (default)
If `CODEX_MCP_AUTH_MODE` is unset, the bridge tries:
1) Codex CLI credentials
2) API key if present

---

## CLI Integration

MCP servers run as child processes of your CLI. Ensure any auth env vars are available where your CLI is launched.

If `codex-mcp-bridge` is not on your `PATH` (for example, you're running from a local clone), use:
- `command`: `node`
- `args`: `["/path/to/Codex-MCP-Bridge/dist/index.js", "--stdio"]`

**Codex CLI** (`~/.codex/config.toml` or `$CODEX_HOME/config.toml`):
```toml
[mcp_servers.codex-bridge]
command = "codex-mcp-bridge"
args = ["--stdio"]
```

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "codex-bridge": {
      "command": "codex-mcp-bridge",
      "args": ["--stdio"]
    }
  }
}
```

**Claude Code** (`~/.claude.json`):
```json
{
  "projects": {
    "/path/to/project": {
      "mcpServers": {
        "codex-bridge": {
          "type": "stdio",
          "command": "codex-mcp-bridge",
          "args": ["--stdio"],
          "env": { "CODEX_MCP_AUTH_MODE": "auto" }
        }
      }
    }
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "codex-bridge": {
      "command": "codex-mcp-bridge",
      "args": ["--stdio"]
    }
  }
}
```

---

## HTTP Transport (Optional)

Use Streamable HTTP when your MCP client expects an HTTP endpoint:
```bash
codex-mcp-bridge --http --http-host 127.0.0.1 --http-port 3923
```

You can also set defaults via env:
- `CODEX_MCP_TRANSPORT_MODE` = stdio | http
- `CODEX_MCP_HTTP_HOST`
- `CODEX_MCP_HTTP_PORT`

---

## Multiuser Setup Script

Configure multiple users at once:
```bash
node scripts/configure-mcp-users.mjs --all-users
```

Or target a single user:
```bash
node scripts/configure-mcp-users.mjs --user alice
```

Additional options:
- `--dry-run` (print changes without writing)
- `--server-name <name>` (override MCP server name)
- `--command <cmd>` (override command)
- `--no-codex` | `--no-claude-desktop` | `--no-claude-code` | `--no-gemini`

---

## Common Tasks

- General execution:
  - "Use codex_exec with prompt 'Explain this module and suggest improvements'"
- Code review:
  - "Use codex_review with prompt 'Review this diff for bugs and regressions'"

---

## Tool Notes

- `codex_review` in API-key mode requires a `diff` payload; CLI mode uses local git state.
- Model selection:
  - The config sets defaults (`cli.defaultModel` for Codex CLI exec, `api.model` for API fallback).
  - You can override per request by passing `model` to `codex_exec` (and to `codex_review` in API mode).
- Working directory:
  - `codex_exec` supports `cwd` to run in a specific directory (recommended for code-related tasks).
  - `codex_review` (CLI mode) must run inside a Git repository; use `cwd` if your MCP client launches servers from a different directory.
- Review prompts:
  - Codex CLI does not accept `prompt` together with `uncommitted`; the bridge ignores `prompt` when `uncommitted: true`.

---

## Configuration

Config file (optional): `~/.codex-mcp-bridge/config.json`

Example:
```json
{
  "auth": { "mode": "auto" },
  "cli": { "command": "codex" },
  "api": { "model": "o3" },
  "limits": { "maxRequestsPerMinute": 30 }
}
```

Env overrides:
- `CODEX_MCP_AUTH_MODE` = auto | cli | api_key
- `CODEX_MCP_API_KEY` (inline key)
- `CODEX_MCP_API_KEY_ENV_VAR` (default OPENAI_API_KEY)
- `CODEX_MCP_API_KEY_ENV_VAR_ALT` (default CODEX_API_KEY)
- `CODEX_MCP_API_KEY_FILE_ENV_VAR` (default OPENAI_API_KEY_FILE)
- `CODEX_MCP_CLI_COMMAND` (default codex)
- `CODEX_MCP_CLI_AUTH_PATH` (default ~/.codex/auth.json)
- `CODEX_MCP_MODEL` (API model override)
- `CODEX_MCP_API_BASE_URL` (default https://api.openai.com/v1)
- `CODEX_MCP_TEMPERATURE`
- `CODEX_MCP_MAX_OUTPUT_TOKENS`
- `CODEX_MCP_TIMEOUT_MS`
- `CODEX_MCP_MAX_INPUT_CHARS`
- `CODEX_MCP_MAX_REQUESTS_PER_MINUTE`
- `CODEX_MCP_MAX_TOKENS_PER_DAY`
- `CODEX_MCP_ENABLE_COST_ESTIMATES`
- `CODEX_MCP_SHARED_LIMITS_ENABLED`
- `CODEX_MCP_REDIS_URL`
- `CODEX_MCP_REDIS_KEY_PREFIX`
- `CODEX_MCP_TRANSPORT_MODE`
- `CODEX_MCP_HTTP_HOST`
- `CODEX_MCP_HTTP_PORT`

---

## Troubleshooting

- Missing Codex CLI auth: run `codex login` or set `OPENAI_API_KEY` and `CODEX_MCP_AUTH_MODE=api_key`.
- CLI not found: ensure `codex` is on PATH or set `CODEX_MCP_CLI_COMMAND`.
- "Not inside a trusted directory": for `codex_exec`, set `cwd` to your project directory or pass `skipGitRepoCheck: true`. For `codex_review`, run inside a git repo (`cwd`).
- "Model is not supported when using Codex with a ChatGPT account" (CLI mode): set a supported `model`/`cli.defaultModel`. If you omit `model`, `codex_exec` auto-retries once without the bridge's default `--model` override and lets Codex CLI choose its default.
- "Codex cannot access session files": ensure the process can write to `~/.codex` (ownership/permissions). If you must avoid Codex CLI files entirely, use API-key mode.
- MCP tools missing: restart the client and verify config path.
