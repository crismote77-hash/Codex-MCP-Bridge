#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$repo_root/dist/index.js" ]]; then
  echo "Missing $repo_root/dist/index.js" >&2
  echo "Run: npm install && npm run build" >&2
  exit 1
fi

exec codex \
  -c 'mcp_servers.codex-bridge.command="node"' \
  -c "mcp_servers.codex-bridge.args=[\"$repo_root/dist/index.js\",\"--stdio\"]" \
  "$@"
