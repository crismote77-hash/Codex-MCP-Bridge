# Changelog

## Unreleased

- Error Reduction: Add preflight validation to `codex_review` for git root detection with actionable remediation hints.
- Tools: `codex_review` defaults to `uncommitted: true` when no review mode is specified (smoother first-time experience).
- Tools: Improved error messages for filesystem operations include config snippets and remediation options.
- Reliability: Idle timeout (resets on output) vs hard timeout for CLI operations; prevents false timeouts during long-running tasks.
- Tools: Add `codex_filesystem_roots_get` and `codex_filesystem_roots_add` for runtime filesystem roots management.
- Tools: `codex_review` supports `paths` parameter for file-based review without git.
- Reliability: Graceful process termination (SIGTERM before SIGKILL) with configurable grace period.
- Tools: Add async job pattern with `codex_exec_async`, `codex_job_status`, `codex_job_result`, `codex_job_cancel`, `codex_job_list` for long-running operations.
- Reliability: Add circuit breaker to prevent repeated failures; tracks failure patterns by tool+cwd combination.
- Logging: Add centralized error logging system with JSONL format, platform-specific paths, tiered privacy levels (`off`/`errors`/`debug`/`full`), smart redaction, log rotation, and WSL detection with hints.
- Tools: `codex_review` diff-based reviews now fall back to `codex exec` when no API key is available, allowing diff reviews with just `codex login` auth. API key path is still preferred for faster direct API calls.
- Release budget reservations on tool errors.
- Enforce max input size for codex_review prompts (CLI + API).
- Doctor API check now honors API key files.
- Document env/transport options, tool notes, and multiuser script flags.
- Add error-path tests for budget handling.
- Add guided setup wizard (`--setup`) with non-interactive mode.
- Improve setup wizard safety + UX (use existing config as defaults, separate default model from advanced options, warn on non-loopback HTTP host, print global vs source run commands).
- Fix install docs for non-npm distribution; add `npm run setup`/`npm run doctor` and `prepare` build hook.
- Tools: fix `codex_review` CLI invocation for `uncommitted`; add `cwd` support; auto-retry `codex_exec` with `--skip-git-repo-check` when needed; fix `--ask-for-approval` flag ordering.
- Tools: in CLI mode, auto-retry `codex_exec` without a default `--model` override when Codex CLI reports the model is unsupported for ChatGPT-account logins.
- Tools: `codex_review` (CLI mode) ignores `prompt` when `uncommitted`/`base`/`commit` is set (Codex CLI limitation), falls back to stderr when stdout is empty, and treats exit code 1 as non-fatal unless output looks fatal.
- Tools: prompt for trusted directories on startup (TTY), persist trusted dirs, auto-apply `--skip-git-repo-check` for trusted `cwd`, and allow `codex_review` to pass the skip flag.
- Tools/Config: auto-detect git repo root on startup to set `filesystem.roots` and `trust.trustedDirs` when not configured (and write a minimal config file on first run).
- Tools: retry `codex_review` once with `--skip-git-repo-check` when Codex CLI reports an untrusted directory.
- Tools: treat `codex_exec` exit code 1 as non-fatal when output exists (unless fatal/usage detected).
- Tools: add `codex_read_file` and `codex_search_files` with filesystem root allowlist and size/result limits.
- Tools: skip filesystem tool registration when `filesystem.roots` is empty.
- Tools: add `codex_code_fix` with safe file collection, unified diff validation, and optional apply gated by filesystem allowWrite.
- Tools: add `codex_count_tokens` and `codex_count_tokens_batch` using the OpenAI tokenizer with model-aware encodings.
- Tools: add `codex_web_search` (Tavily) and `codex_web_fetch` with URL validation and content limits.
- Tools: add streaming support to `codex_exec` (`stream: true`). CLI mode uses JSONL, API mode uses SSE. Output is buffered and returned at the end.
- Tools: add image/vision input support to `codex_exec` (`images` array). Supports file paths, URLs, and data URLs. CLI uses `--image`, API uses multimodal input. Validates count and size limits.
- Tools: add `codex_transcribe_audio` for audio-to-text transcription using OpenAI Whisper API. API-key auth required; validates file size and extension.
- Tools: add `codex_generate_image` for image generation using OpenAI DALL-E API. API-key auth required; supports size, quality, style, and count options.
- Scripts: add `scripts/configure-mcp-projects.mjs` to configure Claude Code per-git-repo + Gemini + bridge defaults under a directory.

## 0.1.0 (2026-01-19)

- Initial scaffold: docs, config skeleton, MCP server structure, and tooling placeholders.
