# Project Status

Last updated (UTC): 2026-01-21T22:35:23Z

## Status Discipline (Always)

- `STATUS.md` is the single source of truth for progress. Keep it updated continuously.
- At the start of a session: review `runbook.md` + set one or more tasks to In Progress.
- At the end of a session: update checkboxes, update “Verification Snapshot”, and append a short runbook entry:
  - `npm run runbook:note -- "What changed; verification; next step"`
- Keep docs aligned with behavior:
  - User-facing: `docs/USER_MANUAL.md`
  - Implementation/architecture: `docs/TECHNICAL.md`

## Quick View

### In Progress

- None (all Yes* tasks completed)

### Next Up

- None

## Task Tracker

| ID | Task | Status | DoD |
| --- | --- | --- | --- |
| T03 | Codex MCP: Streaming responses support (CLI JSONL + OpenAI SSE) | completed | `codex_exec` supports streaming; tests for JSONL/SSE parsing; docs updated; build/test pass |
| T04 | Codex MCP: Vision/image input analysis in API path | completed | Image input accepted in CLI+API; validation + tests; docs updated |
| T05 | Codex MCP: Audio transcription tool (API-only) | completed | New tool + service; validation + tests; docs updated |
| T06 | Codex MCP: Image generation tool (API-only) | completed | New tool + service; tests; docs updated |
| T07 | Codex MCP: Web search + fetch tools | completed | Provider abstraction + tools; tests; docs updated |
| T08 | Codex MCP: Token counting tools (accurate) | completed | Tokenizer integration; batch support; tests; docs updated |
| T09 | Codex MCP: Repo-aware patch generation tool | completed | Safe file read + diff generation; patch validation; tests; docs updated |
| T10 | Codex MCP: Local file read/search tools | completed | Read/search tools with path limits; tests; docs updated |

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

Last verified (UTC): 2026-01-21T22:35:23Z

- `npm test` — 105 tests passed (3 skipped)
- `npm run build` — success
- `npm run lint` — clean
