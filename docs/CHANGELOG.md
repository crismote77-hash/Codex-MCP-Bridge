# Changelog

## Unreleased

- Release budget reservations on tool errors.
- Enforce max input size for codex_review prompts (CLI + API).
- Doctor API check now honors API key files.
- Document env/transport options, tool notes, and multiuser script flags.
- Add error-path tests for budget handling.
- Add guided setup wizard (`--setup`) with non-interactive mode.
- Improve setup wizard safety + UX (use existing config as defaults, separate default model from advanced options, warn on non-loopback HTTP host, print global vs source run commands).
- Fix install docs for non-npm distribution; add `npm run setup`/`npm run doctor` and `prepare` build hook.
- Tools: fix `codex_review` CLI invocation for `uncommitted`; add `cwd` support; auto-retry `codex_exec` with `--skip-git-repo-check` when needed; fix `--ask-for-approval` flag ordering.

## 0.1.0 (2026-01-19)

- Initial scaffold: docs, config skeleton, MCP server structure, and tooling placeholders.
