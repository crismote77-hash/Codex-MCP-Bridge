# Runbook (Rotating)

## Runbook Index
- (none yet)


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
## 2026-01-21T17:31:50Z

- Add startup trusted-dir prompt + persisted trust list; auto-apply skip-git-repo-check for trusted cwd in codex_exec/codex_review; add trust util + tests; update docs/changelog; verified: npm test -- tests/trustDirs.test.ts tests/codexReviewArgs.test.ts; next: user retest in Claude/Gemini

## 2026-01-21T17:55:40Z

- codex_exec: treat exit code 1 as non-fatal when output exists (fatal/usage still fail); add test; docs/changelog updated; verified: npm test -- tests/codexExecCliFallback.test.ts; next: user re-test in Claude/Gemini

## 2026-01-21T20:31:26Z

- Documented cross-bridge capability research matrix in docs/TECHNICAL.md; verification: docs only; next: user review

## 2026-01-21T20:36:53Z

- Added per-bridge implementation plans for Yes* capabilities in docs/TECHNICAL.md; verification: docs only; next: user review

## 2026-01-21T20:38:37Z

- Planned Codex MCP Yes* implementation tasks (streaming, vision, audio, image gen, web search, token count, patch, file tools) in STATUS.md; verification: planning only; next: pick first task

## 2026-01-21T20:39:13Z

- Trimmed STATUS.md task list to Codex MCP-only items per request; verification: planning only; next: pick first task

## 2026-01-21T21:07:02Z

- Add filesystem tools (codex_read_file/codex_search_files), config + limits, tests, docs; verification: npm test, npm run build, npm run lint; next: start T09 codex_code_fix

## 2026-01-21T21:22:25Z

- Add codex_code_fix tool with safe file collection, unified diff validation, optional git apply gated by filesystem.allowWrite; add config/env docs and tests; verification: npm test, npm run build, npm run lint; next: start T08 token counting

## 2026-01-21T21:40:04Z

- Add codex_count_tokens and codex_count_tokens_batch using @dqbd/tiktoken with model-aware encodings; update docs/tests; verification: npm test, npm run build, npm run lint; next: start T07 web search/fetch

## 2026-01-21T21:46:58Z

- Add codex_web_search (Tavily) and codex_web_fetch with URL validation, size limits, and config toggles; add tests/docs; verification: npm test, npm run build, npm run lint; next: consider T06 image generation

## 2026-01-21T22:35:23Z

- Completed T03-T06: streaming responses (JSONL/SSE parsing), vision/image input (multimodal API), audio transcription (Whisper API), image generation (DALL-E API); 105 tests pass; all docs updated

