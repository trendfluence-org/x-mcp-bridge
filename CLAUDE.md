# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Development Commands

```bash
npm install                  # install deps + download Playwright Chromium (~100MB, one-time)
node server.mjs              # HTTP server on :8080
node server.mjs --stdio      # stdio transport (used by Claude Desktop / mcpb)
node server.mjs --no-headless  # HTTP server with visible browser (debugging)
```

## Session Management

```bash
node server.mjs --login      # open browser, log in, save session, exit
node server.mjs --logout     # delete saved browser profile
node server.mjs --status     # check if session is valid and exit
```

## Debugging Locally

Always verify bugs end-to-end against live Twitter, not just code analysis.
Use the HTTP server + OAuth flow for curl-based testing, or stdio + pipe for direct JSON-RPC.

### Method A: Visible browser (quickest)

```bash
node server.mjs --no-headless
```

The browser window opens so you can watch every navigation. Combine with HTTP testing below.

### Method B: HTTP server + curl

**Step 1 — start the server**
```bash
node server.mjs
# Twitter MCP Bridge v0.0.2: http://0.0.0.0:8080/mcp
```

**Step 2 — get an OAuth token**
```bash
# Register a client
CLIENT=$(curl -s -X POST http://localhost:8080/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["http://localhost:9999/callback"],"client_name":"test"}')
echo $CLIENT

# Authorize (auto-approved) — grab the `code` from the redirect Location header
CODE=$(curl -si "http://localhost:8080/authorize?response_type=code&client_id=twitter-mcp-client&redirect_uri=http://localhost:9999/callback&code_challenge=abc&code_challenge_method=plain&state=x" \
  | grep -i location | sed 's/.*code=\([^&]*\).*/\1/' | tr -d '\r')
echo "Code: $CODE"

# Exchange for a token
TOKEN=$(curl -s -X POST http://localhost:8080/token \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:9999/callback&code_verifier=abc&client_id=twitter-mcp-client" \
  | node -e "process.stdin.resume();var d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")
echo "Token: $TOKEN"
```

**Step 3 — initialize MCP session**
```bash
curl -s -D /tmp/mcp-headers -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

SESSION_ID=$(grep -i 'mcp-session-id' /tmp/mcp-headers | awk '{print $2}' | tr -d '\r')
echo "Session: $SESSION_ID"
```

**Step 4 — call a tool**
```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"twitter_timeline","arguments":{"count":5}}}'
```

### Method C: stdio directly

```bash
# Send a single initialize + tool call over stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"twitter_status","arguments":{}}}' \
  | node server.mjs --stdio 2>/dev/null
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `twitter_timeline` returns `[]` | Twitter "Something went wrong" error page | Server auto-retries once; if persistent, run `--status` |
| Login loop on every start | Profile not saving | Check `TWITTER_MCP_PROFILE` path is writable |
| Playwright Chromium not found | First run, binary not downloaded | `npx playwright install chromium` |
| Tools time out / slow | Headless bot detection | Try `--no-headless` to debug; page loads differ |

## Release Process

1. Fix bugs and test locally with `--no-headless` + curl
2. Run `node server.mjs --status` to confirm session works
3. Bump version in `package.json` (both `package.json` and `manifest.json`)
4. Push to `main` — the release workflow auto-builds and publishes the `.mcpb`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `BASE_URL` | `http://localhost:8080` | Public URL for OAuth discovery |
| `TWITTER_MCP_PROFILE` | `~/.twitter-bridge-mcp/profile` | Browser profile path |
| `HEADLESS` | `true` | Set `false` to show browser (same as `--no-headless`) |
| `DM_PIN` | *(empty)* | 4-digit Twitter DM PIN |
