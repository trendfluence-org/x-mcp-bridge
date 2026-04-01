# X MCP Server

Connect Claude to Twitter/X — without paying $100/month for the official API.

Uses [Playwright](https://playwright.dev) to control a managed Chromium session, wrapped as an MCP server that Claude can talk to via stdio (Claude Desktop) or HTTP (Claude.ai remote).

```
Claude ──MCP──▶ x-mcp-server ──Playwright──▶ Chromium (logged in) ──▶ Twitter/X
```

**No API key required. No manual browser setup. Login once, works forever.**

## What it can do

| Tool | Method |
|------|--------|
| `twitter_post` | Browser automation |
| `twitter_reply` | Browser automation |
| `twitter_like` | GraphQL API |
| `twitter_retweet` | GraphQL API |
| `twitter_quote` | Browser automation |
| `twitter_follow` | Browser automation |
| `twitter_unfollow` | Browser automation |
| `twitter_undo` | GraphQL API |
| `twitter_search` | Browser DOM parsing |
| `twitter_timeline` | Browser DOM parsing |
| `twitter_bookmarks` | Browser DOM parsing |
| `twitter_tweets` | Browser DOM parsing |
| `twitter_notifications` | Browser DOM parsing |
| `twitter_user` | Browser DOM parsing |
| `twitter_view_tweet` | Browser DOM parsing |
| `twitter_mentions` | Browser DOM parsing |
| `twitter_my_replies` | Browser DOM parsing |
| `twitter_dm_read` | Browser automation |
| `twitter_screenshot` | Playwright screenshot |
| `browser_open` | Playwright navigation |
| `browser_snapshot` | Page text content |

> DM reading works but Twitter's E2E encryption may limit what's visible via browser automation.

## Install via MCPB (Claude Desktop)

1. Download `x-mcp-server-v0.0.1.mcpb` from [Releases](../../releases)
2. Drag it into Claude Desktop, or go to **File → Install Extension...**
3. On first use, a browser window will open — log in to Twitter/X
4. Done. The session is saved; no login needed on subsequent runs.

## Manual setup (HTTP / Claude.ai remote)

```bash
git clone https://github.com/trendfluence-org/x-mcp-server.git
cd x-mcp-server
npm install          # also downloads Playwright Chromium (~100MB, one-time)
node server.mjs      # starts HTTP server on :8080
```

Expose with any HTTPS reverse proxy (Cloudflare Tunnel, ngrok, etc.) and add the URL to Claude.ai → Settings → Connected Tools.

## Architecture

1. **Managed browser** — Playwright launches and manages a persistent Chromium profile stored at `~/.twitter-bridge-mcp/profile/`. No external Chrome instance needed.
2. **Auto login** — On first run with no session, the browser opens visibly so you can log in. After login it switches to headless. Session is saved to disk automatically.
3. **MCP transports** — `--stdio` flag for Claude Desktop (mcpb); HTTP + OAuth 2.0 PKCE for Claude.ai remote.
4. **Tool implementations** — Browser automation (open page → wait → parse DOM) for most tools; Twitter's internal GraphQL API for lightweight mutations (like, retweet, undo).

## Configuration

All config via environment variables or `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `BASE_URL` | `http://localhost:8080` | Public URL (for OAuth discovery) |
| `TWITTER_MCP_PROFILE` | `~/.twitter-bridge-mcp/profile` | Browser profile directory |
| `DM_PIN` | *(empty)* | Twitter DM encryption PIN (4 digits, if set up) |
| `OAUTH_CLIENT_ID` | `twitter-mcp-client` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | *(auto-generated)* | OAuth client secret |

## Build MCPB bundle

```bash
bash build-mcpb.sh
# Creates x-mcp-server-v0.0.1.mcpb
```

## Notes

- **React contenteditable** — Twitter's compose box is a `contenteditable` div. The server uses `ClipboardEvent paste` for reliable text input.
- **GraphQL mutations** — Like, retweet, and undo use Twitter's internal GraphQL API via in-page `fetch()` (no `x-client-transaction-id` needed for these endpoints).
- **Session persistence** — Playwright's persistent context writes cookies and localStorage to disk automatically. Re-login is only needed if Twitter invalidates the session.
- **DM PIN auto-entry** — If `DM_PIN` is set, the server auto-enters it using React-compatible input simulation.

## License

MIT
