#!/bin/sh
# Launcher for Claude Desktop (mcpb). Installs npm deps on first run then starts the MCP server.
set -e
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "First-time setup: installing dependencies..." >&2
  npm install --ignore-scripts --silent
fi

exec node server.mjs --stdio
