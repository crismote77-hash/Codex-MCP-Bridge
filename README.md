# Codex MCP Bridge

Expose OpenAI Codex CLI capabilities to other AI CLIs via MCP.

## Quick Start
1) npm install -g codex-mcp-bridge
2) codex login status (or codex login / codex login --with-api-key)
3) Add to your MCP client config (see docs/USER_MANUAL.md)
4) codex-mcp-bridge --stdio

## Features
- CLI-first auth via Codex CLI credentials with API key fallback
- Tools: codex_exec, codex_review
- Optional Streamable HTTP transport
- Usage stats, rate limits, daily token budgets (optional shared Redis)
- Multi-user MCP client configuration script

## Documentation
- docs/USER_MANUAL.md
- docs/TECHNICAL.md
- docs/CHANGELOG.md

## License
MIT
