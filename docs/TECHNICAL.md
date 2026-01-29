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

Trusted directories:
- On startup, if `trust.promptOnStart` is enabled, the server tries to prompt on `/dev/tty` to trust `trust.promptDir` (or `process.cwd()`).
- Trusted dirs are persisted to the config file and used to auto-apply `--skip-git-repo-check` for `codex_exec` and `codex_review` when `cwd` is within those paths.
- If Codex CLI returns an untrusted-directory error, the bridge retries once with `--skip-git-repo-check` (CLI mode only).
- If no trusted dirs are configured and the server is running inside a git repo, the bridge auto-trusts the repo root (no prompt) and can write a minimal config file on first run.

## Codex CLI Idiosyncrasies (Modeled)

- Config overrides use `-c key=value` and TOML parsing.
- `codex exec` supports:
  - `--output-last-message <file>` (preferred for stable parsing)
  - `--json` for JSONL streaming
  - `--model`, `--profile`, `--sandbox`, `--ask-for-approval`
  - `--cd`, `--add-dir`, `--skip-git-repo-check`
- `codex review` supports:
  - `--uncommitted`, `--base <branch>`, `--commit <sha>`, `--title <text>`, `--skip-git-repo-check`
  - In current Codex CLI versions, `--uncommitted`/`--base`/`--commit` cannot be combined with a custom `[PROMPT]`.
  - Some Codex CLI output may be emitted on stderr; the bridge falls back to stderr when stdout is empty.
  - Some non-fatal conditions may exit with code `1`; the bridge treats exit code `1` as non-fatal unless the output looks like a fatal/usage error.
- `codex exec` can also exit with code `1` even when output is produced; the bridge treats exit code `1` as non-fatal when output exists and no fatal/usage error is detected.

We model these as optional tool arguments and pass them through to the CLI.

---

## Tool Surface (MVP)

- `codex_exec`
  - Runs `codex exec` (CLI) or OpenAI Responses API (fallback).
  - Uses `--output-last-message` when possible (non-streaming mode).
  - Supports `stream: true` for incremental output:
    - CLI mode: uses `--json` for JSONL streaming; parses frames and collects text.
    - API mode: uses SSE streaming; parses delta events and collects text.
    - Output is buffered and returned at the end (MCP tool results are not streamed to clients).
  - Supports `images` array for vision/multimodal input:
    - Accepts file paths, URLs, or data URLs.
    - CLI mode: passes `--image` flags (file paths only).
    - API mode: builds multimodal input with base64 or URL parts.
    - Validates count (`limits.maxImages`) and size (`limits.maxImageBytes`).

- `codex_review`
  - CLI mode: runs `codex review` for repo-based reviews (using git flags like `--uncommitted`, `--base`, `--commit`).
  - CLI mode supports `cwd` so callers can target a specific repo even if the MCP server starts elsewhere.
  - Diff-based reviews (passing a raw `diff` string):
    - Preferred: When an API key is available, calls the OpenAI API directly for faster, more direct review.
    - Fallback: When no API key is available, routes the diff through `codex exec` using CLI auth (including ChatGPT login).
    - This fallback allows diff reviews to work with just `codex login`, without requiring a separate API key.
  - Enforces max input size for prompt + diff (both API and CLI fallback modes) and prompt (CLI review mode).

- `codex_transcribe_audio`
  - Transcribes audio using OpenAI's Whisper API (API-only).
  - Validates file extension and size (`limits.maxAudioBytes`).
  - Returns JSON with `text`, optional `language`, and `duration`.
  - Requires API-key auth; CLI mode unsupported.

- `codex_generate_image`
  - Generates images using OpenAI's DALL-E API (API-only).
  - Supports size, quality, style, count, and response format options.
  - Returns JSON array with URLs or base64 data.
  - Requires API-key auth; CLI mode unsupported.

All tools enforce:
- Input size limits
- Rate limits and daily token budgets
- Stderr-only logging

---

## Filesystem Tools

- `codex_read_file` reads a single file and returns line-numbered output.
- `codex_search_files` searches file contents (`content`/`grep`) or file names
  (`path`/`glob`) via `rg`.
- `codex_code_fix` reads files, asks a model for a unified diff, validates patch
  paths, and optionally applies via `git apply` when `filesystem.allowWrite` is
  enabled.
- Filesystem access is gated by `filesystem.roots`. If empty and the server is running inside a git repo, the bridge auto-sets roots to the repo root; otherwise filesystem tools are skipped.
- Safety limits: `filesystem.maxFileBytes`, `filesystem.maxSearchResults`,
  `filesystem.maxFiles`, and `filesystem.maxTotalBytes` (batch uses).

## Token Counting Tools

- `codex_count_tokens` returns token counts for a single text input.
- `codex_count_tokens_batch` returns token counts per input plus a total.
- Uses the `@dqbd/tiktoken` tokenizer with model-to-encoding mapping and a
  `cl100k_base` fallback for unknown models.

## Web Tools

- `codex_web_search` uses a provider abstraction (Tavily) to return structured
  search results.
- `codex_web_fetch` fetches a URL, caps byte length, strips HTML for text/html,
  and blocks localhost/private URLs unless explicitly allowed.
- Web tools are disabled by default; enable via `web.searchEnabled` and
  `web.fetchEnabled`.

## Async Jobs

- `codex_exec_async` starts a long-running exec in the background and returns a
  job ID immediately. Useful for prompts that may take longer than typical MCP
  timeouts.
- `codex_job_status` returns job progress (0-100%), status, timestamps, and
  metadata.
- `codex_job_result` returns the completed output. Supports `waitMs` to poll
  briefly before returning.
- `codex_job_cancel` cancels a pending or running job.
- `codex_job_list` lists all jobs, optionally filtered by status.
- Jobs are retained for 1 hour; old/excess jobs are automatically cleaned up.

## Filesystem Roots Management

- `codex_filesystem_roots_get` returns current filesystem roots and their status.
- `codex_filesystem_roots_add` adds a root at runtime (validates path existence).
- Useful for MCP clients that cannot modify config but need filesystem access.

## Reliability Features

### Circuit Breaker (`src/services/circuitBreaker.ts`)

- Tracks failures by tool+cwd combination.
- After `failureThreshold` (default 3) failures within `failureWindowMs` (5 min),
  the circuit opens and blocks requests.
- After `resetTimeoutMs` (1 min), the circuit moves to half-open and allows one
  test request.
- Prevents cascading failures and resource waste from repeated failing commands.

### Idle vs Hard Timeout

- `codex_exec` and `codex_review` use idle timeout that resets whenever output
  is received from the CLI.
- This prevents false timeouts during long-running tasks that produce output
  incrementally.
- Hard timeout (`maxRuntimeMs`) still caps total execution time.

### Graceful Process Termination

- On timeout, the bridge sends SIGTERM first, then SIGKILL after a grace period.
- Allows CLI to clean up resources before forced termination.

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
- `src/services/codexCli.ts`: child-process runner with idle/hard timeout and graceful termination
- `src/services/openaiClient.ts`: API client
- `src/services/jobManager.ts`: async job tracking for long-running operations
- `src/services/circuitBreaker.ts`: failure tracking and circuit breaker pattern
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

For per-repo Claude Code setups, use `scripts/configure-mcp-projects.mjs` to
scan a base directory for git repos and add/update project entries.

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

## Centralized Error Logging

The bridge implements centralized error logging for debugging and documentation improvement.

### Architecture

```
src/services/errorLogger.ts   # ErrorLogger class, JSONL writer
src/utils/logPaths.ts         # Platform-specific path resolution, WSL detection
src/utils/redactForLog.ts     # Sensitive data redaction, arg sanitization
```

### Log Entry Structure (JSONL)

Each error is logged as a single JSON line:
```json
{
  "timestamp": "2024-03-15T12:00:00.000Z",
  "level": "ERROR",
  "mcpVersion": "0.1.0",
  "sessionId": "uuid",
  "toolName": "codex_exec",
  "toolArgs": { "promptLength": 100, "promptHash": "abc123...", "model": "gpt-5.2" },
  "osInfo": { "platform": "linux", "release": "...", "arch": "x64", "isWSL": false },
  "errorType": "Error",
  "message": "API request failed",
  "stackTrace": "...",
  "redacted": true
}
```

### Privacy Tiers

- **`errors`** (default): Log sanitized metadata (lengths, hashes, non-sensitive fields)
- **`debug`**: Add truncated previews and stack traces
- **`full`**: Include full content (for debugging only; may contain sensitive data)

### Redaction Patterns

The `redactSensitiveString()` function redacts:
- API keys (OpenAI, Anthropic, Tavily, Google, AWS, GitHub)
- Bearer tokens, passwords, secrets
- Private keys

The `sanitizeToolArgs()` function extracts:
- Lengths and hashes for sensitive fields (`prompt`, `diff`, `content`)
- Array counts instead of full arrays at `errors` level
- Full arrays at `debug`/`full` levels

### Platform-Specific Paths

- Linux/WSL: `$XDG_STATE_HOME/codex-mcp-bridge/logs/` (default `~/.local/state/...`)
- macOS: `~/Library/Logs/codex-mcp-bridge/`
- Windows: `%LOCALAPPDATA%\codex-mcp-bridge\logs\`

### Log Rotation

- **Date-based**: Rotates daily (`mcp-errors-YYYY-MM-DD.log`)
- **Size-based**: Rotates when exceeding `maxFileSizeMb` (default 50MB)
- **Retention**: Deletes logs older than `retentionDays` (default 7)

### WSL Handling

WSL is detected via `/proc/version` or `WSL_DISTRO_NAME` env var. When running in WSL:
- Logs default to Linux XDG paths
- A one-time stderr hint suggests setting `CODEX_MCP_LOG_DIR` for Windows access

---

## Cross-Bridge Capability Research (Feasibility Matrix)

This is a technical feasibility map (not current tool coverage). It answers: could we
implement the capability in each bridge given provider support and typical MCP patterns?

Legend:
- Yes = provider supports it and it can be exposed via MCP.
- Yes* = feasible but needs extra integration, specific models, or local permissions.
- No = no native provider support at time of writing.

| Capability | Codex MCP (OpenAI/Codex) | Claude MCP (Anthropic) | Gemini MCP (Google) |
| --- | --- | --- | --- |
| Text generation | Yes | Yes | Yes |
| JSON/schema output | Yes | Yes* | Yes |
| Streaming responses | Yes* | Yes* | Yes |
| Vision/image input analysis | Yes* | Yes* | Yes |
| Audio input / transcription | Yes* | No | Yes* |
| Image generation | Yes* | No | Yes* |
| Embeddings | Yes | No | Yes |
| Moderation / safety classification | Yes | Yes* | Yes |
| Web search / grounding | Yes* | Yes* | Yes |
| Tool/function calling | Yes | Yes | Yes |
| Token counting | Yes* | Yes | Yes |
| Model listing | Yes | Yes | Yes |
| Code review / analysis | Yes | Yes | Yes |
| Repo-aware patch generation | Yes* | Yes* | Yes* |
| Local file read/search | Yes* | Yes* | Yes* |

Notes:
- JSON/schema output in Claude typically needs local schema validation; strict schemas
  are not guaranteed by the provider without a validator.
- Claude does not offer native embeddings or audio transcription endpoints. Moderation
  can be approximated via prompt-based classification.
- Codex and Gemini support vision/audio/image generation only on specific models and
  may require direct API integration beyond current bridge tools.
- Search/grounding and repo-aware patch generation require additional MCP tools and
  local permissions even when the model supports them.

Research method:
- Derived from current bridge tool surfaces plus a Gemini MCP debate pass.
- Confirm against vendor docs for the latest model-level support before shipping.

---

## Implementation Plans for Yes* Capabilities (Per MCP)

This section provides detailed, per-bridge implementation plans for every
capability marked Yes* in the matrix above. Each plan includes research sources,
a repeatable process (Planner/Critic/Verifier), and step-by-step execution.

### Codex MCP (codex-mcp-bridge)

Research sources:
- This document: "Cross-Bridge Capability Research (Feasibility Matrix)".
- OpenAI Responses API docs (streaming, vision, audio).
- OpenAI Images API docs.
- Codex CLI help: `codex exec --help`, `codex review --help`.
- Code map in this repo:
  - `src/tools/codexExec.ts`, `src/tools/codexReview.ts`
  - `src/services/openaiClient.ts`, `src/services/codexCli.ts`
  - `src/limits/*`, `src/utils/*`
  - `docs/USER_MANUAL.md`, `docs/CHANGELOG.md`

Process per capability (repeat for each Yes* item):
1) Planner: define inputs/outputs, decide new tool vs extension, set limits.
2) Critic: validate security (paths, sandbox), secrets, budgets, and MCP spec fit.
3) Verifier: add tests, run `npm test`/`npm run build`, update docs + changelog.

Yes* capabilities and steps:

1) Streaming responses (Codex CLI + OpenAI API)
   - Research: confirm Codex CLI JSONL streaming output (`--json`) and message
     boundaries; review OpenAI Responses streaming (SSE) format.
   - Design: add `stream: boolean` (or `streamMode`) to `codex_exec` and decide
     whether to emit MCP progress notifications or aggregate output.
   - Implement (CLI): in `src/tools/codexExec.ts`, switch to `--json` when
     streaming; parse JSONL frames and send progress updates; fall back to buffer
     if the client does not support streaming.
   - Implement (API): add streaming support in `src/services/openaiClient.ts`
     (new `runOpenAIStream`), parse SSE, and forward incremental chunks.
   - Budgeting: track tokens from streamed chunks and commit once at end.
   - Tests: add JSONL/SSE parser unit tests in `tests/`; add CLI fixture tests.

2) Vision/image input analysis
   - Research: Codex CLI `--image` and OpenAI multimodal input schema.
   - Design: allow `images` in both CLI and API paths; define accepted formats
     (local file paths, base64, or URL) and size limits.
   - Implement (CLI): validate file exists + size; pass `--image <path>` (already
     present) and add guardrails for count/size.
   - Implement (API): extend `runOpenAI` to accept image content parts and build
     an input array; add sanitization and error mapping.
   - Tests: add unit tests for image validation and API payload construction.

3) Audio input / transcription
   - Research: OpenAI audio/transcription API; confirm Codex CLI support (likely
     none) and required audio formats.
   - Design: add a new `codex_transcribe_audio` tool (API-only) with args:
     `audioPath`, `mimeType`, optional `language`, `model`.
   - Implement: create `src/tools/codexTranscribe.ts`; add a new service wrapper
     in `src/services/openaiAudio.ts`; enforce file size and MIME limits.
   - Error handling: clear messages when CLI mode is selected (unsupported).
   - Tests: add fixture-based tests for payload building and error cases.

4) Image generation
   - Research: OpenAI Images API (model list, sizes, response formats).
   - Design: add `codex_generate_image` tool with prompt, size, count, and
     response format (URL vs base64).
   - Implement: create `src/services/openaiImages.ts`; wire to tool registration
     in `src/tools/index.ts`.
   - Tests: mock API responses and ensure output schema is stable.

5) Web search / grounding
   - Research: confirm preferred search provider (Tavily or custom).
   - Design: add `codex_web_search` and `codex_web_fetch` tools similar to Claude.
   - Implement: create `src/services/webSearchProvider.ts` and tool wrappers;
     add config keys (provider + API key env var) and redaction rules.
   - Tests: stub provider responses; verify input/output schemas and limits.

6) Token counting (accurate)
   - Research: OpenAI tokenizer libraries and model-specific encodings.
   - Design: add `codex_count_tokens` and `codex_count_tokens_batch` tools with
     `model` + `text(s)` inputs.
   - Implement: create `src/services/tokenizer.ts` using `tiktoken` (or fallback
     heuristic); add limits and error handling.
   - Tests: golden tests for known strings; cross-check with API usage samples.

7) Repo-aware patch generation
   - Research: review Gemini `code_fix` patterns and MCP filesystem safety rules.
   - Design: add `codex_code_fix` tool with `paths`, `apply`, and request text.
   - Implement: introduce a `filesystem` helper to read files safely; assemble a
     prompt that requests a unified diff; optionally apply via `git apply`.
   - Safety: enforce repo-root allowlist, file size limits, and patch validation.
   - Tests: unit tests for file collection + patch validation.

8) Local file read/search tools
   - Research: MCP resource patterns and existing `claude_read_file`/`search_files`.
   - Design: add `codex_read_file` and `codex_search_files` tools with explicit
     root configuration and size limits.
   - Implement: use `fs` for reads and `rg` for search; expose `maxResults` and
     path allowlist in config.
   - Tests: filesystem fixtures, path traversal protection, and limit checks.

### Claude MCP (claudeMCPbridge)

Research sources:
- `docs/TECHNICAL.md` and `research/` in `claudeMCPbridge`.
- Anthropic API docs (streaming, vision, JSON guidance).
- Code map in `claudeMCPbridge`:
  - `src/services/anthropicClient.ts`, `src/services/claudeCliClient.ts`
  - `src/services/webSearchProvider.ts`
  - `src/tools/*.ts` (analyze, webSearch, readFile, searchFiles, codeReview)

Process per capability:
1) Planner: define tool shape, payload format, and schema validation.
2) Critic: confirm model capability, safety constraints, and data handling.
3) Verifier: add tests, run `npm test`, update docs and changelog.

Yes* capabilities and steps:

1) JSON/schema output
   - Research: Anthropic guidance for structured outputs and JSON reliability.
   - Design: add `claude_generate_json` (new tool) or extend `claude_synthesize`
     with `jsonSchema` + `strictJson`.
   - Implement: add schema validation via `zod`/`ajv`; on invalid JSON, re-prompt
     with a repair request; cap retries.
   - Tests: invalid JSON repair tests and schema validation coverage.

2) Streaming responses
   - Research: Anthropic streaming API and chunk formats.
   - Design: add `claude_generate_text_stream` or a `stream` flag for key tools.
   - Implement: extend `anthropicClient.ts` with SSE parsing; stream progress to
     MCP clients (or buffer when unsupported).
   - Tests: mocked stream chunks and completion semantics.

3) Vision/image input analysis
   - Research: Anthropic image input format and supported models.
   - Design: add `claude_analyze_image` tool with `imageBase64`/`imageUrl`.
   - Implement: extend `anthropicClient.ts` to send image content blocks; add
     MIME + size validation utilities.
   - Tests: input validation + payload construction tests.

4) Moderation / safety classification
   - Research: Anthropic policy guidance; design categories and thresholds.
   - Design: add `claude_moderate_text` tool with a fixed taxonomy and
     confidence scoring.
   - Implement: prompt-based classification with JSON output; include fallback
     behavior when confidence is low.
   - Tests: snapshot tests for known examples; schema validation.

5) Web search / grounding
   - Research: existing `webSearchProvider.ts` and provider config in repo.
   - Design: validate provider selection logic; add `grounding` flags for tools.
   - Implement: add metadata fields (source URLs, snippets) to tool responses.
   - Tests: provider mock tests and metadata schema checks.

6) Repo-aware patch generation
   - Research: evaluate existing read/search tools and diff generation patterns.
   - Design: add `claude_code_fix` tool that reads files, prompts for a unified
     diff, and optionally applies the patch with explicit approval.
   - Implement: reuse `readFile`/`searchFiles` utilities for context; add patch
     validation and size limits.
   - Tests: patch validation and apply/dry-run tests.

7) Local file read/search (harden + verify)
   - Research: inspect `src/tools/readFile.ts` and `src/tools/searchFiles.ts`.
   - Design: enforce explicit root allowlist and size limits in config.
   - Implement: add path traversal defenses and predictable error messages.
   - Tests: path escaping and limit enforcement tests.

### Gemini MCP (geminiMCPbridge)

Research sources:
- `docs/TECHNICAL.md` (if present) and `README.md` in `geminiMCPbridge`.
- Google Gemini API docs (audio input, Imagen, multimodal constraints).
- Code map in `geminiMCPbridge`:
  - `src/services/geminiClient.ts`
  - `src/tools/codeFix.ts`, `src/tools/codeReview.ts`, `src/tools/analyzeImage.ts`

Process per capability:
1) Planner: confirm model/endpoint and expected response format.
2) Critic: check safety and data handling, filesystem scoping, rate limits.
3) Verifier: add tests, run `npm test`, update docs/changelog.

Yes* capabilities and steps:

1) Audio input / transcription
   - Research: Gemini audio input support or Vertex AI speech endpoints.
   - Design: add `gemini_transcribe_audio` with `audioPath`, `mimeType`, optional
     `language` and `model`.
   - Implement: extend `geminiClient.ts` to accept audio parts; add size/type
     validation and clear errors when unsupported by the chosen model.
   - Tests: payload construction tests and unsupported-model error cases.

2) Image generation
   - Research: Imagen or Gemini image generation models and required params.
   - Design: add `gemini_generate_image` with prompt, size, count, and format.
   - Implement: add client call in `geminiClient.ts`; return base64 or URLs.
   - Tests: mocked responses + schema validation.

3) Repo-aware patch generation (audit + harden)
   - Research: `src/tools/codeFix.ts` behavior and filesystem constraints.
   - Design: confirm `apply` gating by config; add explicit patch validation.
   - Implement: enforce per-file limits and total bytes; add deterministic diff
     formatting for downstream tools.
   - Tests: patch validation and limit enforcement.

4) Local file read/search tools
   - Research: current filesystem utilities (if any) in `geminiMCPbridge`.
   - Design: add `gemini_read_file` and `gemini_search_files` tools with root
     allowlist and `maxResults`.
   - Implement: use `fs` and `rg` with strict path validation and size limits.
   - Tests: path traversal protection and search limit tests.

---

## References

- MCP spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- Codex CLI (local `codex --help`)
- OpenAI Responses API: https://api.openai.com/v1/responses
