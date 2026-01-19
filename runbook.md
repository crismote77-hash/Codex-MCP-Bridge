# Runbook (Rotating)

## 2026-01-19T13:22:27Z

- Initialized codexMCPbridge scaffold and baseline docs.

## 2026-01-19T14:48:28Z

- Added MCP server scaffold, Codex CLI tools, auth config, docs, and multiuser setup script.
## 2026-01-19T15:54:56Z

- Fix budget release and review input limits; doctor API key file check; docs + tests; npm test; next: npm run build && npm run lint

## 2026-01-19T16:51:57Z

- Add setup wizard CLI + docs and tests; npm test; next: npm run build && npm run lint

## 2026-01-19T17:24:53Z

- Run npm run build and npm run lint; fix lint/build issues (wizard typing, httpServer error type, codexCli exitCode); status updated

## 2026-01-19T18:39:21Z

- Improve setup wizard defaults + safety + next-step commands; fix install docs + add prepare/setup/doctor scripts; verified: npm test, npm run build, npm run lint; next: user re-test setup flow

## 2026-01-19T19:07:34Z

- Wizard UX: default model in basic flow; advanced settings gated; summary reflects effective config; docs clarify per-request model override; verified: npm test, npm run build, npm run lint; next: user try interactive wizard

## 2026-01-19T19:15:45Z

- Fix configure-mcp-users TOML header regex; verified: npm test, npm run build, npm run lint; used script to configure Claude+Gemini for user crismote

## 2026-01-19T19:36:01Z

- Fix Codex CLI tool UX: codex_review uncommitted now omits prompt; add cwd support; codex_exec ask-for-approval ordering + auto-retry skip-git-repo-check; docs+tests; verified: npm test, npm run build, npm run lint

## 2026-01-19T19:49:56Z

- codex_exec: auto-retry without default --model when ChatGPT-account login rejects model; add CLI-mode test; docs+status updated; verified: npm test, npm run build, npm run lint; next: reinstall + re-test in Claude/Gemini

## 2026-01-19T19:58:41Z

- Docs: expand USER_MANUAL and TECHNICAL (wizard walkthrough, advanced option explanations, model selection guidance, doctor/print-config); verified: npm test, npm run build, npm run lint; next: user re-test setup + Claude/Gemini tools

## 2026-01-19T21:07:37Z

- codex_review fixes: ignore prompt with uncommitted/base/commit; use stderr fallback output; treat exit code 1 as non-fatal unless fatal/usage; diff reviews require API key; add tests+docs; verified: npm test, npm run build, npm run lint; next: user re-test in Claude/Gemini

