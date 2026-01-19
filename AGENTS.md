# AGENTS.md — Codex MCP Bridge

Operational rules for coding agents working in this repository (Codex CLI, Claude Code, Gemini CLI, etc.).

If this repo also contains `CLAUDE.md`, keep both files consistent.

---

## 0) Agent Rules (Read First)

- If the user asks a question, answer it first (with options/trade-offs). Do not turn questions into code changes automatically.
- Prefer small, verifiable changes (tests/lint/build) over large refactors.
- If requirements are unclear, list assumptions and ask for confirmation before implementing.
- Never introduce or expose secrets (API keys, OAuth tokens, `.env` contents) in code, logs, tests, or docs.

**MCP hard rules:**
- When running as an MCP server, stdout is reserved for JSON-RPC. Logs must go to stderr only.
- Tool failures should return `{ isError: true, content: [...] }` (tool-level errors), not protocol-level exceptions.

---

## 1) Project Overview

`codex-mcp-bridge` is an MCP server that exposes Codex CLI capabilities (exec/review) to other AI CLIs via MCP.

Primary targets:
- Claude CLI / Claude Desktop
- Gemini CLI
- Codex CLI (as an MCP client)

Canonical docs:
- Architecture/strategy: `docs/TECHNICAL.md`
- End-user usage/config: `docs/USER_MANUAL.md`
- Progress tracking: `STATUS.md`
- Work log: `runbook.md`

---

## 2) Status + Runbook Discipline (Required)

This repo is run as a resumable project:

- `STATUS.md` is the single source of truth for progress and “Last verified”.
- `runbook.md` is append-only and rotating (use the script below).

Session routine:
1. Read latest `runbook.md` entries.
2. Update `STATUS.md` → mark what you will do as In Progress.
3. Make changes and verify (build/test/lint as applicable).
4. Update `STATUS.md` Verification Snapshot.
5. Append a runbook note:
   - `npm run runbook:note -- "What changed; verification; next step"`

Docs discipline:
- If you change behavior, update `docs/TECHNICAL.md` and/or `docs/USER_MANUAL.md` in the same PR.
- Update `docs/CHANGELOG.md` for user-facing changes.

---

## 3) Commands (Copy/Paste)

Node requirement: Node.js >= 20. Use npm (this repo uses package-lock.json when installed).

```bash
# Install deps
npm install

# Build (TypeScript -> dist/)
npm run build

# Run server (stdio transport)
npm start

# Dev mode (TypeScript watch)
npm run dev

# Tests (Vitest)
npm test

# Lint / format
npm run lint
npm run format

# MCP Inspector (manual validation)
npm run inspect

# Operational utilities
node dist/index.js --doctor
node dist/index.js --print-config
```

---

## 4) Repository Map

```
src/
  index.ts            # CLI entry; stdio/http selection; doctor helpers
  server.ts           # McpServer creation + tool/resource registration
  config.ts           # Zod config schema + env/file merge
  logger.ts           # stderr logger (never stdout in server mode)
  httpServer.ts       # Streamable HTTP transport (opt-in)
  auth/               # CLI vs API-key auth resolution
  limits/             # rate limiting + daily budgets (+ optional Redis store)
  tools/              # codex_* tool implementations
  resources/          # usage://*, discovery resources
  services/           # Codex CLI runner + OpenAI API client
  utils/              # redaction, paths, errors, helpers
scripts/
  prebuild.mjs postbuild.mjs runbook-note.mjs configure-mcp-users.mjs
  (optional) codex-with-bridge.sh
/docs
  TECHNICAL.md USER_MANUAL.md CHANGELOG.md
```

---

## 5) Code Conventions (TypeScript / ESM)

- This repo is ESM ("type": "module"). Follow existing import style.
- Use `.js` extensions in relative imports inside `src/`.
- Validate tool inputs with Zod schemas. Reject invalid input early with clear messages.
- Keep tool handlers thin; push logic into `src/services/` and `src/utils/`.

**Error handling (MCP):**
- Return tool errors with `isError: true` and safe, actionable messages.
- Don’t throw from tool handlers unless you intend a protocol-level failure (rare).

**Logging:**
- Server mode: stderr only. Avoid `console.log` in server execution paths.
- Never log full prompts/responses by default. Keep redaction guarantees.

---

## 6) Adding or Changing Tools/Resources

When adding a tool:
1. Create `src/tools/<tool>.ts`
2. Register in `src/tools/index.ts`
3. Add tests under `tests/` (if present)
4. Update user docs: `docs/USER_MANUAL.md` (tool reference + examples)
5. Update technical docs: `docs/TECHNICAL.md` (internals/architecture)
6. Update `docs/CHANGELOG.md`

When changing public surface area (tool params/results, resources, config keys):
- Update tests and docs in the same PR.
- Re-run `npm run build`, `npm test`, `npm run lint`.

---

## 7) Security & Data Handling

- Treat Codex CLI auth and API keys as secrets (never commit; never print).
- Defend against path traversal, injection, and unsafe subprocess usage.
- Default to least privilege; keep write-capable operations behind explicit user intent.

---

## 8) No-Touch / High-Risk Areas (Confirm Before Big Changes)

- `dist/`: generated build output. Do not edit manually (change `src/` instead).
- `package-lock.json`: do not hand-edit; update via npm install when required.
- Auth and token handling (`src/auth/*`, `src/services/openaiClient.ts`): changes here can cause credential leakage or break auth fallback.
- Transport wiring (`src/index.ts`, `src/httpServer.ts`): mistakes can break MCP protocol compatibility.

---

## 9) References

- MCP spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- MCP TS SDK: https://github.com/modelcontextprotocol/typescript-sdk
