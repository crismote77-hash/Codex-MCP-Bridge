# User Manual

## Codex MCP Bridge

Expose Codex CLI capabilities to other AI CLIs via MCP. This runs locally as an MCP server and requires network access to reach OpenAI.

---

## Quick Start

1) Install (choose one):

**A) Global install (GitHub)**
```bash
npm install -g git+ssh://git@github.com:crismote77-hash/Codex-MCP-Bridge.git
# or: npm install -g git+https://github.com/crismote77-hash/Codex-MCP-Bridge.git
```

**B) From source (local clone)**
```bash
git clone git@github.com:crismote77-hash/Codex-MCP-Bridge.git
cd Codex-MCP-Bridge
npm install
npm run setup
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

Use the guided wizard to create or update your config:
```bash
codex-mcp-bridge --setup
```

If you're running from a local clone (no global install), use:
```bash
npm run setup
# or: npm run build && node dist/index.js --setup
```

Non-interactive example (accept defaults, set auth mode + model):
```bash
codex-mcp-bridge --setup --non-interactive --auth auto --model o3
```

HTTP transport example:
```bash
codex-mcp-bridge --setup --http --http-host 127.0.0.1 --http-port 3923
```

Notes:
- The wizard writes `~/.codex-mcp-bridge/config.json` (or `--config <path>`).
- API keys are never stored; use env vars or a key file.
- `--overwrite` replaces the config; default behavior is merge.
- Use `--dry-run` to preview the summary without writing.

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
- MCP tools missing: restart the client and verify config path.
