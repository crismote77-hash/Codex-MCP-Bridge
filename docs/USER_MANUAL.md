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

4) Restart your CLI and list tools. You should see `codex_exec`, `codex_review`, `codex_read_file`, `codex_search_files`, `codex_code_fix`, `codex_count_tokens`, `codex_count_tokens_batch`, `codex_web_search`, `codex_web_fetch`, `codex_transcribe_audio`, and `codex_generate_image`.

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
  - With streaming: "Use codex_exec with prompt '...' and stream=true" (uses JSONL for CLI, SSE for API)
  - With images: "Use codex_exec with prompt '...' and images=['/path/to/image.png']" (file paths, URLs, or data URLs)
- Code review:
  - Repo-based review (CLI mode): "Use codex_review with uncommitted=true and cwd=/path/to/repo"
  - Diff review: "Use codex_review with a diff payload and prompt 'Review this diff for bugs and regressions'" (uses API key if available, falls back to CLI otherwise)
- File read:
  - "Use codex_read_file with path=/path/to/file and startLine=1 endLine=200"
- File search:
  - "Use codex_search_files with pattern='TODO' and directory=/path/to/repo"
- Patch generation:
  - "Use codex_code_fix with request='Fix the TODOs in src/' and paths=['src']"
- Token counting:
  - "Use codex_count_tokens with text='Hello world' and model='o3'"
  - "Use codex_count_tokens_batch with texts=['one','two']"
- Audio transcription:
  - "Use codex_transcribe_audio with audioPath='/path/to/audio.mp3'" (API-only, requires API key)
- Image generation:
  - "Use codex_generate_image with prompt='A sunset over mountains'" (API-only, requires API key)
- Web search/fetch:
  - "Use codex_web_search with query='latest MCP spec'"
  - "Use codex_web_fetch with url='https://modelcontextprotocol.io/specification/2025-11-25'"

---

## Tool Notes

- `codex_review` has two review approaches:
  - **Repo-based reviews** (CLI mode): uses local git state with flags like `uncommitted`, `base`, `commit`. Requires `cwd` inside a git repo. Works with `codex login` (no API key needed).
  - **Diff-based reviews** (passing a `diff` string): Can work two ways:
    - With API key (preferred): Direct API call for faster response.
    - Without API key (fallback): Routes through `codex exec`, using your CLI auth (including ChatGPT login via `codex login`).
- Model selection:
  - The config sets defaults (`cli.defaultModel` for Codex CLI exec, `api.model` for API fallback).
  - You can override per request by passing `model` to `codex_exec` (and to `codex_review` in API mode).
- Working directory:
  - `codex_exec` supports `cwd` to run in a specific directory (recommended for code-related tasks).
  - `codex_review` (CLI mode) must run inside a Git repository; use `cwd` if your MCP client launches servers from a different directory.
- Trusted directories:
  - On startup, if no trusted dirs are configured and the server is running inside a git repo, the bridge auto-trusts the repo root (no prompt) and auto-applies `--skip-git-repo-check` for `codex_exec` and `codex_review`.
  - If Codex CLI reports an untrusted directory, the bridge retries once with `--skip-git-repo-check`.
- Review prompts:
  - Codex CLI does not accept `prompt` together with `uncommitted`, `base`, or `commit`; the bridge ignores `prompt` when any of those are set.
- Exit codes:
  - `codex_exec` treats exit code `1` as non-fatal when output exists and no fatal/usage error is detected.
- Streaming:
  - `codex_exec` supports `stream: true` for incremental output. CLI mode uses JSONL (`--json`), API mode uses SSE.
  - Output is buffered and returned at the end (MCP tool results are not streamed).
- Image input:
  - `codex_exec` supports `images` array with file paths, URLs, or data URLs.
  - CLI mode passes `--image` flags; API mode uses multimodal input.
  - Limits: `limits.maxImages` (default 5), `limits.maxImageBytes` (default 20MB).
- Filesystem access:
  - `codex_read_file` and `codex_search_files` only operate inside configured `filesystem.roots`.
  - If `filesystem.roots` is empty and the server is running inside a git repo, the bridge auto-sets `filesystem.roots` to the repo root so filesystem tools are available. If no git repo is detected, filesystem tools remain disabled.
  - `codex_search_files` uses regex search in `content`/`grep` mode and glob path search in `path`/`glob` mode.
  - When multiple roots are configured, `codex_search_files` requires `directory` to choose one.
  - `codex_code_fix` reads files from configured roots and can optionally apply patches when `filesystem.allowWrite` is enabled.
- Token counting:
  - `codex_count_tokens` and `codex_count_tokens_batch` return JSON strings with `tokens` and `encoding`.
- Audio transcription:
  - `codex_transcribe_audio` requires API-key auth (CLI mode unsupported).
  - Returns JSON with `text`, optional `language`, and `duration`.
  - Limits: `limits.maxAudioBytes` (default 25MB, OpenAI limit).
- Image generation:
  - `codex_generate_image` requires API-key auth (CLI mode unsupported).
  - Uses DALL-E 3 by default; supports size, quality, style, and count options.
  - Returns JSON array with URLs or base64 data depending on `responseFormat`.
- Web tools:
  - `codex_web_search` and `codex_web_fetch` are disabled by default; enable them via config/env.
  - `codex_web_search` requires a Tavily API key (`web.tavilyApiKey`).

---

## Configuration

Config file (optional): `~/.codex-mcp-bridge/config.json` (may be created automatically on first run with git-root defaults)

Example:
```json
{
  "auth": { "mode": "auto" },
  "cli": { "command": "codex" },
  "api": { "model": "o3" },
  "limits": { "maxRequestsPerMinute": 30 },
  "filesystem": {
    "roots": ["/path/to/repo"],
    "maxFileBytes": 200000,
    "maxSearchResults": 200,
    "allowWrite": false
  },
  "web": {
    "searchEnabled": false,
    "fetchEnabled": false,
    "provider": "tavily",
    "tavilyApiKey": "tvly-***",
    "maxResults": 5,
    "maxFetchBytes": 200000,
    "timeoutMs": 10000
  },
  "trust": {
    "promptOnStart": true,
    "promptDir": "/path/to/project",
    "trustedDirs": ["/path/to/project"]
  }
}
```

Trusted directory settings:
- `trust.promptOnStart`: prompt on startup (TTY required, default true).
- `trust.promptDir`: directory to prompt for (defaults to `process.cwd()`).
- `trust.trustedDirs`: persisted allowlist used to auto-apply `--skip-git-repo-check`.

Filesystem settings:
- `filesystem.roots`: allowlist for local file access (empty disables file tools).
- `filesystem.maxFiles`: maximum files read in batch operations (e.g., patch tool).
- `filesystem.maxFileBytes`: maximum size per file read.
- `filesystem.maxTotalBytes`: total bytes allowed across a batch read.
- `filesystem.maxSearchResults`: cap on search results returned.
- `filesystem.allowWrite`: allow patch apply operations (default false).

Web settings:
- `web.searchEnabled`: enable `codex_web_search`.
- `web.fetchEnabled`: enable `codex_web_fetch`.
- `web.provider`: search provider (`tavily`).
- `web.tavilyApiKey`: API key for Tavily search.
- `web.maxResults`: cap on search results returned.
- `web.maxFetchBytes`: maximum bytes returned from `codex_web_fetch`.
- `web.timeoutMs`: timeout for web requests.
- `web.userAgent`: user agent for web requests.
- `web.allowLocalhost`: allow localhost/private fetches (default false).

Logging settings:
- `logging.errorLogging`: level of error logging (`off`, `errors`, `debug`, `full`). Default `errors`.
- `logging.directory`: override the default log directory.
- `logging.maxFileSizeMb`: max size before rotation (default 50).
- `logging.retentionDays`: days to keep old logs (default 7).

Error logs are written to platform-specific directories:
- **Linux/WSL**: `$XDG_STATE_HOME/codex-mcp-bridge/logs/` or `~/.local/state/codex-mcp-bridge/logs/`
- **macOS**: `~/Library/Logs/codex-mcp-bridge/`
- **Windows**: `%LOCALAPPDATA%\codex-mcp-bridge\logs\`

Log levels:
- `off`: disable logging
- `errors`: log tool errors with sanitized metadata (default)
- `debug`: include truncated previews and stack traces
- `full`: include full context (for debugging only; may contain sensitive data)

Env overrides:
- `CODEX_MCP_AUTH_MODE` = auto | cli | api_key
- `CODEX_MCP_API_KEY` (inline key)
- `CODEX_MCP_API_KEY_ENV_VAR` (default OPENAI_API_KEY)
- `CODEX_MCP_API_KEY_ENV_VAR_ALT` (default CODEX_API_KEY)
- `CODEX_MCP_API_KEY_FILE_ENV_VAR` (default OPENAI_API_KEY_FILE)
- `CODEX_MCP_CLI_COMMAND` (default codex)
- `CODEX_MCP_CLI_AUTH_PATH` (default ~/.codex/auth.json)
- `CODEX_MCP_TRUST_PROMPT` (true/false)
- `CODEX_MCP_TRUST_PROMPT_DIR`
- `CODEX_MCP_TRUSTED_DIRS` (path-delimited list)
- `CODEX_MCP_MODEL` (API model override)
- `CODEX_MCP_API_BASE_URL` (default https://api.openai.com/v1)
- `CODEX_MCP_TEMPERATURE`
- `CODEX_MCP_MAX_OUTPUT_TOKENS`
- `CODEX_MCP_TIMEOUT_MS`
- `CODEX_MCP_MAX_INPUT_CHARS`
- `CODEX_MCP_MAX_REQUESTS_PER_MINUTE`
- `CODEX_MCP_MAX_TOKENS_PER_DAY`
- `CODEX_MCP_ENABLE_COST_ESTIMATES`
- `CODEX_MCP_MAX_IMAGES` (default 5)
- `CODEX_MCP_MAX_IMAGE_BYTES` (default 20000000)
- `CODEX_MCP_MAX_AUDIO_BYTES` (default 25000000)
- `CODEX_MCP_SHARED_LIMITS_ENABLED`
- `CODEX_MCP_REDIS_URL`
- `CODEX_MCP_REDIS_KEY_PREFIX`
- `CODEX_MCP_FILESYSTEM_ROOTS`
- `CODEX_MCP_FILESYSTEM_MAX_FILES`
- `CODEX_MCP_FILESYSTEM_MAX_FILE_BYTES`
- `CODEX_MCP_FILESYSTEM_MAX_TOTAL_BYTES`
- `CODEX_MCP_FILESYSTEM_MAX_SEARCH_RESULTS`
- `CODEX_MCP_FILESYSTEM_ALLOW_WRITE`
- `CODEX_MCP_WEB_SEARCH_ENABLED`
- `CODEX_MCP_WEB_FETCH_ENABLED`
- `CODEX_MCP_WEB_PROVIDER`
- `CODEX_MCP_TAVILY_API_KEY`
- `CODEX_MCP_WEB_MAX_RESULTS`
- `CODEX_MCP_WEB_MAX_FETCH_BYTES`
- `CODEX_MCP_WEB_TIMEOUT_MS`
- `CODEX_MCP_WEB_USER_AGENT`
- `CODEX_MCP_WEB_ALLOW_LOCALHOST`
- `CODEX_MCP_LOG_LEVEL` (off | errors | debug | full)
- `CODEX_MCP_LOG_DIR`
- `CODEX_MCP_LOG_MAX_SIZE_MB`
- `CODEX_MCP_LOG_RETENTION_DAYS`
- `CODEX_MCP_TRANSPORT_MODE`
- `CODEX_MCP_HTTP_HOST`
- `CODEX_MCP_HTTP_PORT`

---

## Troubleshooting

- Missing Codex CLI auth: run `codex login` or set `OPENAI_API_KEY` and `CODEX_MCP_AUTH_MODE=api_key`.
- CLI not found: ensure `codex` is on PATH or set `CODEX_MCP_CLI_COMMAND`.
- "Not inside a trusted directory": accept the startup trust prompt (TTY) or add the path to `trust.trustedDirs` / `CODEX_MCP_TRUSTED_DIRS` so the bridge auto-adds `--skip-git-repo-check`. You can also pass `skipGitRepoCheck: true` directly; `codex_review` still expects a git repo for repo-based diffs.
- Diff review performance: With an API key (`OPENAI_API_KEY`), diff reviews call the API directly. Without one, the bridge falls back to `codex exec` which may be slower but works with `codex login` auth.
- "codex_review ignores prompt": Codex CLI does not accept `prompt` with `uncommitted`/`base`/`commit`, so the bridge ignores it.
- "Model is not supported when using Codex with a ChatGPT account" (CLI mode): set a supported `model`/`cli.defaultModel`. If you omit `model`, `codex_exec` auto-retries once without the bridge's default `--model` override and lets Codex CLI choose its default.
- "Codex cannot access session files": ensure the process can write to `~/.codex` (ownership/permissions). If you must avoid Codex CLI files entirely, use API-key mode.
- MCP tools missing: restart the client and verify config path.
- Error logs: check platform-specific log directory (see Logging settings). Each error is logged with context including tool name, sanitized args, OS info, and stack trace. In WSL, logs default to Linux paths; set `CODEX_MCP_LOG_DIR=/mnt/c/Users/<user>/AppData/Local/codex-mcp-bridge/logs` for Windows access.
