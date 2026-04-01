#!/usr/bin/env bash
# Build x-mcp-server.mcpb — a self-contained MCP bundle for Claude Desktop
set -euo pipefail

cd "$(dirname "$0")"

echo "Installing production dependencies..."
npm install --omit=dev

echo "Installing Playwright Chromium..."
npx playwright install chromium

VERSION=$(node -p "require('./package.json').version")
OUTFILE="x-mcp-server-v${VERSION}.mcpb"

echo "Packaging $OUTFILE..."
zip -r "$OUTFILE" \
  server.mjs \
  manifest.json \
  package.json \
  node_modules \
  .env.example

echo ""
echo "Done: $OUTFILE"
echo ""
echo "To install: drag $OUTFILE into Claude Desktop, or use:"
echo "  File > Install Extension... > $OUTFILE"
echo ""
echo "Note: Playwright Chromium (~100MB) is downloaded separately on first run,"
echo "not included in the bundle. It caches at ~/Library/Caches/ms-playwright/"
