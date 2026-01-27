# Project Status

Last updated (UTC): 2026-01-27T13:40:00Z

## Status Discipline (Always)

- `STATUS.md` is the single source of truth for progress. Keep it updated continuously.
- At the start of a session: review `runbook.md` + set one or more tasks to In Progress.
- At the end of a session: update checkboxes, update “Verification Snapshot”, and append a short runbook entry:
  - `npm run runbook:note -- "What changed; verification; next step"`
- Keep docs aligned with behavior:
  - User-facing: `docs/USER_MANUAL.md`
  - Implementation/architecture: `docs/TECHNICAL.md`

## Quick View

### Completed (Recent)

- T15: 9 Error-Reduction Improvements (preflight validation, async jobs, circuit breaker, etc.)
- T11: Centralized Error Logging System
- T12: Reduce tool errors for disabled filesystem + untrusted CLI review paths
- T13: Auto git-root defaults (filesystem + trust)
- T14: Project auto-config script + docs

### Next Up

- Update documentation for T15 improvements

## Task Tracker

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T15 | Codex MCP: 9 Error-Reduction Improvements | completed | Preflight validation; default uncommitted:true; better error msgs; idle/hard timeout; runtime roots; file-based review; graceful kill; async jobs; circuit breaker; tests pass |
| T11 | Codex MCP: Centralized Error Logging System | completed | Global JSONL error logs; platform paths; rotation; privacy levels; WSL support; tests; docs |
| T12 | Codex MCP: Reduce tool errors for disabled filesystem + untrusted CLI review paths | completed | Filesystem tools gated by roots; codex_review trust retry; tests + docs + changelog |
| T13 | Codex MCP: Auto git-root defaults (filesystem + trust) | completed | Auto-set `filesystem.roots` + `trust.trustedDirs` to git repo root on startup; optional first-run config write; tests + docs |
| T14 | Codex MCP: Project auto-config script + docs | completed | Add script to configure Claude Code per-git-repo + Gemini; docs updated; build/test/lint pass |
| T03 | Codex MCP: Streaming responses support (CLI JSONL + OpenAI SSE) | completed | `codex_exec` supports streaming; tests for JSONL/SSE parsing; docs updated; build/test pass |
| T04 | Codex MCP: Vision/image input analysis in API path | completed | Image input accepted in CLI+API; validation + tests; docs updated |
| T05 | Codex MCP: Audio transcription tool (API-only) | completed | New tool + service; validation + tests; docs updated |
| T06 | Codex MCP: Image generation tool (API-only) | completed | New tool + service; tests; docs updated |
| T07 | Codex MCP: Web search + fetch tools | completed | Provider abstraction + tools; tests; docs updated |
| T08 | Codex MCP: Token counting tools (accurate) | completed | Tokenizer integration; batch support; tests; docs updated |
| T09 | Codex MCP: Repo-aware patch generation tool | completed | Safe file read + diff generation; patch validation; tests; docs updated |
| T10 | Codex MCP: Local file read/search tools | completed | Read/search tools with path limits; tests; docs updated |

### Active Subtasks (T13)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T13.a | Detect git root + autoroot helper | completed | `findGitRoot` + startup autoroot applied; tests added |
| T13.b | Update docs + changelog + runbook | completed | USER_MANUAL/TECHNICAL/CHANGELOG updated; runbook note appended |
| T13.c | Verification snapshot | completed | `npm test`, `npm run build`, `npm run lint` recorded |

### Active Subtasks (T14)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T14.a | Add project auto-config script | completed | `scripts/configure-mcp-projects.mjs` added; dry-run works |
| T14.b | Update docs + changelog + runbook | completed | USER_MANUAL/TECHNICAL/CHANGELOG updated; runbook note appended |
| T14.c | Verification snapshot | completed | `npm test`, `npm run build`, `npm run lint` recorded |

### Active Subtasks (T03)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T03.a | Add `stream` parameter to codex_exec input schema + config | completed | Schema updated; config docs updated |
| T03.b | Implement CLI streaming with JSONL parsing | completed | codexCli.ts has streaming runner; parses JSONL frames |
| T03.c | Implement API streaming with SSE parsing | completed | openaiClient.ts has streaming runner; parses SSE events |
| T03.d | Wire up streaming in codex_exec tool | completed | Tool uses stream flag; returns incremental or buffered output |
| T03.e | Add tests for JSONL/SSE parsing | completed | Unit tests for parsers cover edge cases |
| T03.f | Update docs and changelog | completed | USER_MANUAL + TECHNICAL + CHANGELOG updated |

Planner/Critic/Verifier pass (T03):
- Planner: add stream param; implement JSONL + SSE parsers; wire to tool.
- Critic: handle malformed frames; buffer when client doesn't support progress.
- Verifier: tests for parser edge cases and streaming tool output.

### Active Subtasks (T04)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T04.a | Add image validation utility (file exists, size, MIME) | completed | Utility validates images; clear error messages |
| T04.b | Add config for image limits (max count, max size) | completed | Config schema + env vars + docs |
| T04.c | Extend API path to support multimodal input | completed | openaiClient.ts sends image content parts |
| T04.d | Wire validation in codex_exec for CLI and API paths | completed | Images validated before execution |
| T04.e | Add tests for image validation | completed | Unit tests cover edge cases |
| T04.f | Update docs and changelog | completed | USER_MANUAL + TECHNICAL + CHANGELOG updated |

Planner/Critic/Verifier pass (T04):
- Planner: add validation util; extend API client; wire to tool.
- Critic: validate file exists, size, MIME; clear errors for missing/large files.
- Verifier: tests for validation and API payload construction.

### Completed Subtasks (T11) — Centralized Error Logging

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T11.a | Define logging config schema + env vars | completed | Config in `src/config.ts`; env overrides; docs updated |
| T11.b | Implement platform-specific log path resolver | completed | Correct paths for Linux/macOS/Windows/WSL; WSL detection |
| T11.c | Implement JSONL error log writer service | completed | Structured entries; atomic writes; directory creation |
| T11.d | Implement smart redaction utility | completed | Mask API keys, tokens, secrets; preserve structure |
| T11.e | Implement log rotation (time + size based) | completed | 7-day retention; 50MB size cap; cleanup old files |
| T11.f | Implement tiered logging levels | completed | `off`/`errors`/`debug`/`full` with appropriate context |
| T11.g | Integrate error logging into all tools | completed | All tool errors logged with context; stderr hint |
| T11.h | Add WSL detection + one-time hint | completed | Detect WSL; print config hint on first run |
| T11.i | Add tests for logging system | completed | Unit tests for paths, rotation, redaction, levels |
| T11.j | Update docs (USER_MANUAL + TECHNICAL + CHANGELOG) | completed | Document config, paths, privacy, WSL |
| T11.k | Verification + runbook note | completed | `npm test`, `npm run build`, `npm run lint` pass |

### Active Subtasks (T12)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T12.a | Gate filesystem tools on configured roots | completed | registerTools skips filesystem tools when roots empty; test coverage |
| T12.b | Add codex_review trust retry | completed | Retry on untrusted-dir error with --skip-git-repo-check; tests cover |
| T12.c | Update docs + changelog + runbook | completed | USER_MANUAL/TECHNICAL/CHANGELOG updated; runbook note appended |

Planner/Critic/Verifier pass (T12):
- Planner: gate filesystem tools by roots; add trust retry; update tests/docs.
- Critic: avoid widening filesystem access; keep trust retry limited to CLI hint.
- Verifier: run targeted tests; update STATUS + runbook.

#### T11 Detailed Instructions

**T11.a: Define logging config schema + env vars**
- Add to `src/config.ts`:
  ```typescript
  logging: z.object({
    errorLogging: z.enum(["off", "errors", "debug", "full"]).default("errors"),
    directory: z.string().optional(),  // override auto-detected path
    maxFileSizeMb: z.number().default(50),
    retentionDays: z.number().default(7),
  }).default({})
  ```
- Env vars: `CODEX_MCP_LOG_LEVEL`, `CODEX_MCP_LOG_DIR`

**T11.b: Implement platform-specific log path resolver**
- Create `src/utils/logPaths.ts`:
  - Linux: `$XDG_STATE_HOME/codex-mcp-bridge/logs/` (fallback `~/.local/state/...`)
  - macOS: `~/Library/Logs/codex-mcp-bridge/`
  - Windows: `%LOCALAPPDATA%\codex-mcp-bridge\logs\`
  - WSL detection: check `/proc/version` for "microsoft" or `WSL_DISTRO_NAME` env
- Priority: config > env var > auto-detect

**T11.c: Implement JSONL error log writer service**
- Create `src/services/errorLogger.ts`:
  - JSONL format (one JSON object per line)
  - Fields: timestamp, level, mcpVersion, sessionId, requestId, toolName, toolArgs (metadata only), clientName, aiModel, osInfo, errorType, message, stackTrace, redacted flag
  - Atomic writes (write to temp, rename)
  - Auto-create directory with secure permissions (0o700)
  - File: `mcp-errors.log` (current), `mcp-errors-YYYY-MM-DD.log` (rotated)

**T11.d: Implement smart redaction utility**
- Create `src/utils/redactForLog.ts`:
  - Mask patterns: `sk-...`, `Bearer ...`, `api_key=...`, `password=...`, `token=...`
  - For tool args: log metadata (lengths, hashes) not raw content
  - `promptLength`, `promptHash` (SHA256 truncated), `diffLength`
  - Return `{ redacted: true, data: {...} }` wrapper

**T11.e: Implement log rotation (time + size based)**
- On startup and periodically:
  - If `mcp-errors.log` is from previous day → rotate to `mcp-errors-YYYY-MM-DD.log`
  - If current file > `maxFileSizeMb` → rotate immediately
  - Delete files older than `retentionDays`
  - Optional: gzip rotated files

**T11.f: Implement tiered logging levels**
- `off`: No file logging (stderr only for fatal)
- `errors` (default): Log errors with metadata (lengths, hashes, no raw content)
- `debug`: Add truncated prompt prefix (first 100 chars after redaction)
- `full`: Log full prompts/diffs (still redact secrets); print warning; consider time-box

**T11.g: Integrate error logging into all tools**
- In each tool's catch block, call `errorLogger.logError({ toolName, args, error, ... })`
- Print stderr hint: `[MCP-ERROR] See <log_path> for details`
- Capture: tool name, sanitized args, error type, message, stack

**T11.h: Add WSL detection + one-time hint**
- On first startup in WSL, log info message:
  ```
  Running in WSL. Logs at ~/.local/state/codex-mcp-bridge/logs/
  For Windows access, set CODEX_MCP_LOG_DIR=/mnt/c/Users/<user>/AppData/Local/codex-mcp-bridge/logs
  ```
- Store "hint shown" flag in config directory to avoid repeating

**T11.i: Add tests for logging system**
- Test path resolution for each platform (mock `process.platform`)
- Test rotation logic (mock file dates/sizes)
- Test redaction patterns (API keys, tokens, prompts)
- Test tiered levels produce correct output
- Test WSL detection

**T11.j: Update docs**
- USER_MANUAL.md: Add "Error Logging" section with config options, paths, privacy
- TECHNICAL.md: Add architecture notes for logging service
- CHANGELOG.md: Add entry for new feature

Planner/Critic/Verifier pass (T11):
- Planner: layered privacy approach; platform-aware paths; rotation for disk safety.
- Critic: never log raw secrets; default to privacy-preserving; WSL perf concerns with /mnt/c.
- Verifier: tests for all platforms; redaction coverage; rotation edge cases.

Consensus: Gemini + Codex agree on layered approach with opt-in full logging and smart redaction.

---

### Active Subtasks (T10)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T10.a | Define filesystem config + limits for read/search tools | completed | Config schema + env vars + docs updated |
| T10.b | Implement safe filesystem helper + `codex_read_file` | completed | Tests cover traversal + size limit + read output |
| T10.c | Implement `codex_search_files` (rg) + tests | completed | Tests for search limits + hidden skip |
| T10.d | Verification + runbook note | completed | `npm test`, `npm run build`, `npm run lint` recorded |

Planner/Critic/Verifier pass (T10):
- Planner: align with TECHNICAL.md plan and tool naming.
- Critic: enforce path allowlist, size limits, and hidden/binary skips.
- Verifier: add tests for traversal, limits, and output formatting.

### Active Subtasks (T09)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T09.a | Define tool shape + config limits for patch generation | completed | Schema + config + docs updated |
| T09.b | Implement safe file collection + patch prompt/validation | completed | Unit tests for limits + patch validation |
| T09.c | Implement optional apply flow with explicit gating | completed | Apply uses `git apply` with clear errors |
| T09.d | Verification + runbook note | completed | `npm test`, `npm run build`, `npm run lint` recorded |

Planner/Critic/Verifier pass (T09):
- Planner: align with TECHNICAL.md tool definition and MCP safety model.
- Critic: enforce root allowlist, byte limits, and patch validation before apply.
- Verifier: tests for traversal, size limits, and patch rejection.

### Active Subtasks (T08)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T08.a | Add tokenizer service + dependency | completed | Tokenizer module works with model fallback |
| T08.b | Implement codex_count_tokens + batch tools | completed | Schema + output format + error handling |
| T08.c | Tests + docs/changelog | completed | Tests pass; docs updated |
| T08.d | Verification + runbook note | completed | `npm test`, `npm run build`, `npm run lint` recorded |

Planner/Critic/Verifier pass (T08):
- Planner: choose tokenizer library and model mapping strategy.
- Critic: enforce input size limits and safe fallbacks.
- Verifier: tests for batch counts and invalid inputs.

### Active Subtasks (T07)

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T07.a | Define web config + provider abstraction | completed | Config + env + service skeleton |
| T07.b | Implement codex_web_search + codex_web_fetch | completed | Tools wired with validation + limits |
| T07.c | Tests + docs/changelog | completed | Tests pass; docs updated |
| T07.d | Verification + runbook note | completed | `npm test`, `npm run build`, `npm run lint` recorded |

Planner/Critic/Verifier pass (T07):
- Planner: finalize provider (Tavily) and fetch behavior.
- Critic: validate URLs and block localhost/private by default.
- Verifier: tests for disabled mode, missing API key, and URL validation.

Reason: user request to plan Codex MCP Yes* implementation tasks.

## Implementation Strategy (Phases)

### Phase 0 — Scaffold / MVP (CLI exec + review)

- [x] P0.1 Project skeleton + docs
- [x] P0.2 MCP server over stdio (`src/index.ts`)
- [x] P0.3 Config loader + env overrides (`src/config.ts`)
- [x] P0.4 stderr-only logging (`src/logger.ts`)
- [x] P0.5 CLI vs API-key auth resolver (`src/auth/resolveAuth.ts`)
- [x] P0.6 CLI runner + core tools (`codex_exec`, `codex_review`)
- [x] P0.7 Usage stats resource (`usage://stats`)
- [x] P0.8 Docs update (manual + technical + changelog)
- [x] P0.9 Multiuser config script (`scripts/configure-mcp-users.mjs`)

### Phase 1 — Hardening

- [x] P1.1 Optional Streamable HTTP transport
- [x] P1.2 Shared limits via Redis
- [x] P1.3 Error-path tests + docs alignment
- [x] P1.4 Setup wizard + docs

## Verification Snapshot

Last verified (UTC): 2026-01-27T13:39:00Z

- `npm test` — 147 tests passed (3 skipped)
- `npm run build` — success
- `npm run lint` — clean
