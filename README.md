# X MCP Server

<p align="left">
  <a href="https://www.npmjs.com/package/x-mcp-bridge" target="_blank"><img src="https://img.shields.io/npm/v/x-mcp-bridge?color=blue" alt="npm"></a>
  <a href="https://github.com/trendfluence-org/x-mcp-server/actions/workflows/release.yml" target="_blank"><img src="https://github.com/trendfluence-org/x-mcp-server/actions/workflows/release.yml/badge.svg?branch=main" alt="Release"></a>
  <a href="https://github.com/trendfluence-org/x-mcp-server/blob/main/LICENSE" target="_blank"><img src="https://img.shields.io/badge/License-MIT-%233fb950?labelColor=32383f" alt="License"></a>
</p>

Connect Claude to Twitter/X — without paying $100/month for the official API. Uses Playwright to control a managed Chromium session, wrapped as an MCP server.

```
Claude ──MCP──▶ x-mcp-server ──Playwright──▶ Chromium (logged in) ──▶ Twitter/X
```

**No API key required. No manual browser setup. Login once, works forever.**

## Installation Methods

[![npx](https://img.shields.io/badge/npx-Quick_Install-de5fe9?style=for-the-badge&logo=nodedotjs)](#-npx-setup-recommended---universal)
[![Install MCP Bundle](https://img.shields.io/badge/Claude_Desktop_MCPB-d97757?style=for-the-badge&logo=anthropic)](#-claude-desktop-mcp-bundle)
[![HTTP Remote](https://img.shields.io/badge/HTTP_Remote-Claude.ai-008fe2?style=for-the-badge&logo=googlechrome&logoColor=white)](#-http-setup-claudeai-remote)
[![Development](https://img.shields.io/badge/Development-Local-ffdc53?style=for-the-badge&logo=nodedotjs&logoColor=ffdc53)](#-local-setup-develop--contribute)

## Usage Examples

```
What's trending on my timeline right now?
```

```
Search for recent tweets about the AI funding landscape
```

```
Post a tweet: "Just shipped a new feature 🚀"
```

```
Show me my unread DMs and summarize them
```

## Features & Tool Status

| Tool | Method | Status |
|------|--------|--------|
| `twitter_post` | Browser automation | Working |
| `twitter_reply` | Browser automation | Working |
| `twitter_like` | GraphQL API | Working |
| `twitter_retweet` | GraphQL API | Working |
| `twitter_quote` | Browser automation | Working |
| `twitter_follow` | Browser automation | Working |
| `twitter_unfollow` | Browser automation | Working |
| `twitter_undo` | GraphQL API | Working |
| `twitter_search` | Browser DOM parsing | Working |
| `twitter_timeline` | Browser DOM parsing | Working |
| `twitter_bookmarks` | Browser DOM parsing | Working |
| `twitter_tweets` | Browser DOM parsing | Working |
| `twitter_notifications` | Browser DOM parsing | Working |
| `twitter_user` | Browser DOM parsing | Working |
| `twitter_view_tweet` | Browser DOM parsing | Working |
| `twitter_mentions` | Browser DOM parsing | Working |
| `twitter_my_replies` | Browser DOM parsing | Working |
| `twitter_dm_read` | Browser automation | Working |
| `twitter_screenshot` | Playwright screenshot | Working |
| `browser_open` | Playwright navigation | Working |
| `browser_snapshot` | Page text content | Working |

> [!NOTE]
> DM reading works but Twitter's E2E encryption may limit what's visible via browser automation.

<br/>
<br/>

## 🚀 npx Setup (Recommended — Universal)

**Prerequisites:** [Node.js 18+](https://nodejs.org).

### Installation

**Claude Desktop configuration:**

```json
{
  "mcpServers": {
    "twitter": {
      "command": "npx",
      "args": ["-y", "x-mcp-bridge", "--stdio"]
    }
  }
}
```

On first use, Playwright Chromium is downloaded automatically (~100MB, one-time). A browser window then opens for you to log in to Twitter/X. The session is saved to `~/.x-mcp-bridge/profile/` — no login needed on subsequent runs.

> [!NOTE]
> Early tool calls may return an error while the browser is still setting up. If that happens, retry after a few seconds.

### npx Setup Help

<details>
<summary><b>🔧 Configuration</b></summary>

**Session management:**

```bash
npx x-mcp-bridge --login      # open browser, log in, save session, exit
npx x-mcp-bridge --logout     # delete saved browser profile
npx x-mcp-bridge --status     # check if session is valid and exit
```

**HTTP mode** (for Claude.ai remote or MCP Inspector):

```bash
npx x-mcp-bridge              # starts HTTP server on :8080
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `BASE_URL` | `http://localhost:8080` | Public URL for OAuth discovery |
| `TWITTER_MCP_PROFILE` | `~/.x-mcp-bridge/profile` | Browser profile directory |
| `HEADLESS` | `true` | Set `false` to show the browser window |
| `DM_PIN` | *(empty)* | Twitter DM encryption PIN (4 digits, if set up) |

</details>

<details>
<summary><b>❗ Troubleshooting</b></summary>

**Login loop on every start:**

- The browser profile isn't saving. Check that the `TWITTER_MCP_PROFILE` path is writable.

**Tools time out or are slow:**

- Headless mode can trigger bot detection. Run `npx x-mcp-bridge --no-headless` to open a visible browser and debug.

**Playwright Chromium not found:**

- Run `npx playwright install chromium`.

</details>

<br/>
<br/>

## 📦 Claude Desktop MCP Bundle

**Prerequisites:** [Claude Desktop](https://claude.ai/download).

**One-click installation** for Claude Desktop users:

1. Download the latest `.mcpb` from [Releases](https://github.com/trendfluence-org/x-mcp-server/releases/latest)
2. Drag it into Claude Desktop, or go to **File → Install Extension...**
3. On the first tool call, a browser window opens — log in to Twitter/X
4. The session is saved to `~/.x-mcp-bridge/profile/`. No login needed on subsequent runs.

### MCP Bundle Setup Help

<details>
<summary><b>❗ Troubleshooting</b></summary>

**First-time setup:**

- A browser window opens automatically on the first tool call that requires authentication
- Log in to Twitter/X normally; the session is saved to disk automatically

**Session issues:**

- Browser profile is stored at `~/.x-mcp-bridge/profile/`
- If Twitter invalidates your session, call any tool — a login window will reopen
- To force a fresh login: delete the profile directory and restart

**Playwright Chromium not found:**

- Run `npx playwright install chromium` in the server directory

</details>

<br/>
<br/>

## 🌐 HTTP Setup (Claude.ai Remote)

**Prerequisites:** [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com).

### Installation

```bash
git clone https://github.com/trendfluence-org/x-mcp-server.git
cd x-mcp-server
npm install          # also downloads Playwright Chromium (~100MB, one-time)
node server.mjs      # starts HTTP server on :8080
```

Expose with any HTTPS reverse proxy (Cloudflare Tunnel, ngrok, etc.) and add the URL to Claude.ai → **Settings → Connected Tools**.

### HTTP Setup Help

<details>
<summary><b>🔧 Configuration</b></summary>

**Environment variables** (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `BASE_URL` | `http://localhost:8080` | Public URL for OAuth discovery |
| `TWITTER_MCP_PROFILE` | `~/.x-mcp-bridge/profile` | Browser profile directory |
| `HEADLESS` | `true` | Set `false` to show the browser window |
| `DM_PIN` | *(empty)* | Twitter DM encryption PIN (4 digits, if set up) |
| `OAUTH_CLIENT_ID` | `twitter-mcp-client` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | *(auto-generated)* | OAuth client secret |

**Session management:**

```bash
node server.mjs --login      # open browser, log in, save session, exit
node server.mjs --logout     # delete saved browser profile
node server.mjs --status     # check if session is valid and exit
```

**Test with curl:**

```bash
# Register a client
curl -s -X POST http://localhost:8080/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["http://localhost:9999/callback"],"client_name":"test"}'

# Authorize — grab the `code` from the redirect Location header
CODE=$(curl -si "http://localhost:8080/authorize?response_type=code&client_id=twitter-mcp-client&redirect_uri=http://localhost:9999/callback&code_challenge=abc&code_challenge_method=plain&state=x" \
  | grep -i location | sed 's/.*code=\([^&]*\).*/\1/' | tr -d '\r')

# Exchange for a token
TOKEN=$(curl -s -X POST http://localhost:8080/token \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:9999/callback&code_verifier=abc&client_id=twitter-mcp-client" \
  | node -e "process.stdin.resume();var d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")

# Initialize MCP session
curl -s -D /tmp/mcp-headers -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
SESSION_ID=$(grep -i 'mcp-session-id' /tmp/mcp-headers | awk '{print $2}' | tr -d '\r')

# Call a tool
curl -s -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"twitter_timeline","arguments":{"count":5}}}'
```

</details>

<details>
<summary><b>❗ Troubleshooting</b></summary>

**`twitter_timeline` returns `[]`:**

- Twitter returned a "Something went wrong" page. The server auto-retries once; if persistent, run `node server.mjs --status`.

**Login loop on every start:**

- The browser profile isn't saving. Check that the `TWITTER_MCP_PROFILE` path is writable.

**Tools time out or are slow:**

- Headless mode can trigger bot detection. Run `node server.mjs --no-headless` to open a visible browser and debug.

**Playwright Chromium not found:**

- Run `npx playwright install chromium`.

</details>

<br/>
<br/>

## 🛠 Local Setup (Develop & Contribute)

**Prerequisites:** [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com).

### Installation

```bash
# 1. Clone repository
git clone https://github.com/trendfluence-org/x-mcp-server.git
cd x-mcp-server

# 2. Install dependencies (also downloads Playwright Chromium ~100MB)
npm install

# 3. Start with visible browser for debugging
node server.mjs --no-headless
```

### Local Setup Help

<details>
<summary><b>🔧 Configuration</b></summary>

**CLI flags:**

- `--stdio` — stdio transport (used by Claude Desktop / mcpb)
- `--no-headless` — show browser window (debugging)
- `--login` — open browser, log in, save session, exit
- `--logout` — delete saved browser profile
- `--status` — check if session is valid and exit

**stdio mode (direct JSON-RPC):**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"twitter_timeline","arguments":{"count":3}}}' \
  | node server.mjs --stdio 2>/dev/null
```

</details>

<details>
<summary><b>❗ Troubleshooting</b></summary>

**Scraping issues:**

- Use `--no-headless` to watch every navigation in real time.

**Session issues:**

- Profile is stored at `~/.x-mcp-bridge/profile/`. Delete it and run `--login` to start fresh.

**Playwright Chromium not found:**

- Run `npx playwright install chromium`.

</details>

<br/>
<br/>

## Architecture

1. **Managed browser** — Playwright launches and manages a persistent Chromium profile stored at `~/.x-mcp-bridge/profile/`. No external Chrome instance needed.
2. **Auto login** — On first run with no session, the browser opens visibly so you can log in. After login it switches to headless. Session is saved to disk automatically.
3. **MCP transports** — `--stdio` flag for Claude Desktop (mcpb); HTTP + OAuth 2.0 PKCE for Claude.ai remote.
4. **Tool implementations** — Browser automation (open page → wait → parse DOM) for most tools; Twitter's internal GraphQL API for lightweight mutations (like, retweet, undo).

## Notes

- **React contenteditable** — Twitter's compose box is a `contenteditable` div. The server uses `ClipboardEvent paste` for reliable text input.
- **GraphQL mutations** — Like, retweet, and undo use Twitter's internal GraphQL API via in-page `fetch()` (no `x-client-transaction-id` needed for these endpoints).
- **Session persistence** — Playwright's persistent context writes cookies and localStorage to disk automatically. Re-login is only needed if Twitter invalidates the session.
- **DM PIN auto-entry** — If `DM_PIN` is set, the server auto-enters it using React-compatible input simulation.

## License

MIT
