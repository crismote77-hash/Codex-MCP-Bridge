# Codex MCP Bridge

Expose OpenAI Codex CLI capabilities to other AI CLIs via MCP.

## Quick Start
This project is not published to the npm registry yet. Install from GitHub or from a local clone.

### Option A: Global install (GitHub)
```bash
npm install -g git+ssh://git@github.com:crismote77-hash/Codex-MCP-Bridge.git
# or: npm install -g git+https://github.com/crismote77-hash/Codex-MCP-Bridge.git
```

### Option B: From source (local clone)
```bash
git clone git@github.com:crismote77-hash/Codex-MCP-Bridge.git
cd Codex-MCP-Bridge
npm install
npm run setup
```

Then:
1) codex login status (or codex login / codex login --with-api-key)
2) Add to your MCP client config (see docs/USER_MANUAL.md)
3) codex-mcp-bridge --stdio

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
