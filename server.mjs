#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium as playwrightChromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
const chromium = addExtra(playwrightChromium);
chromium.use(StealthPlugin());
import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import "dotenv/config";

// CLI flags
const STDIO_MODE   = process.argv.includes("--stdio");
const NO_HEADLESS  = process.argv.includes("--no-headless") || process.env.HEADLESS === "false";
const CMD_LOGIN    = process.argv.includes("--login");
const CMD_LOGOUT   = process.argv.includes("--logout");
const CMD_STATUS   = process.argv.includes("--status");

// In stdio mode stdout is the MCP protocol channel — redirect all logs to stderr
if (STDIO_MODE) { console.log = console.error; }

// === CONFIG ===

const PORT = parseInt(process.env.PORT || "8080");
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const VERSION = "0.0.3";
const DM_PIN = process.env.DM_PIN || "";
const PROFILE_DIR = process.env.TWITTER_MCP_PROFILE || join(homedir(), ".x-mcp-bridge", "profile");

if (DM_PIN && !/^\d{4}$/.test(DM_PIN)) {
  console.error("Error: DM_PIN must be exactly 4 digits"); process.exit(1);
}

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "twitter-mcp-client";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || randomBytes(32).toString("hex");
var registeredRedirectUris = [];
const authCodes = new Map();
const accessTokens = new Map();

// === TOKEN PERSISTENCE ===

var TOKEN_FILE = new URL(".tokens.json", import.meta.url).pathname;

function saveTokens() {
  try {
    var data = { tokens: Object.fromEntries(accessTokens), codes: Object.fromEntries(authCodes) };
    writeFileSync(TOKEN_FILE, JSON.stringify(data));
  } catch(e) { console.error("saveTokens error:", e.message); }
}

function loadTokens() {
  try {
    if (!existsSync(TOKEN_FILE)) return;
    var raw = readFileSync(TOKEN_FILE, "utf-8");
    var data = JSON.parse(raw);
    var now = Date.now();
    if (data.tokens) { for (var [k,v] of Object.entries(data.tokens)) { if (v > now) accessTokens.set(k, v); } }
    if (data.codes) { for (var [k,v] of Object.entries(data.codes)) { if (v.expires > now) authCodes.set(k, v); } }
    console.log("Loaded " + accessTokens.size + " tokens, " + authCodes.size + " codes from disk");
  } catch(e) { console.error("loadTokens error:", e.message); }
}
loadTokens();

setInterval(function() {
  var now = Date.now();
  for (var [k, v] of authCodes) { if (v.expires < now) authCodes.delete(k); }
  for (var [k, v] of accessTokens) { if (v < now) accessTokens.delete(k); }
  saveTokens();
}, 60000);

// ============================================================
// BROWSER MANAGEMENT (Playwright — replaces bb-browser + CDP)
// ============================================================

mkdirSync(PROFILE_DIR, { recursive: true });

var _browserCtx = null;
var _page = null;

async function ensureBrowserInstalled() {
  var execPath = chromium.executablePath();
  if (!existsSync(execPath)) {
    console.error("First-time setup: downloading Playwright Chromium. This may take a few minutes...");
    var { execSync } = await import("child_process");
    var playwrightBin = new URL("./node_modules/.bin/playwright", import.meta.url).pathname;
    execSync('"' + playwrightBin + '" install chromium', { stdio: "inherit" });
    console.error("Chromium installed.");
  }
}

async function launchContext(headless) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: NO_HEADLESS ? false : headless,
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    permissions: ["clipboard-read", "clipboard-write"],
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
}

var _loginTask = null;

async function runLoginFlow() {
  try {
    await ensureBrowserInstalled();
    console.error("Opening visible browser for Twitter login...");
    var ctx = await launchContext(false);
    var page = ctx.pages()[0] || await ctx.newPage();
    await page.goto("https://x.com/login");
    console.error("Please log in to Twitter/X in the browser window. Waiting up to 5 minutes...");
    await page.waitForURL(/x\.com\/(home|[^/]+\/status)/, { timeout: 300000 });
    console.error("Login successful. Saving session...");
    await page.waitForTimeout(2000); // flush cookies to disk
    await ctx.close();
    console.error("Login browser closed. Session ready.");
  } catch(e) {
    console.error("Login flow error (will retry on next tool call):", e.message);
  } finally {
    _loginTask = null; // reset so next expiry can trigger a new login window
  }
}

async function getBrowserPage() {
  if (_browserCtx && _page && !_page.isClosed()) return _page;

  await ensureBrowserInstalled();

  var hasSession = existsSync(join(PROFILE_DIR, "Default", "Cookies"));

  if (!hasSession) {
    if (!_loginTask) {
      _loginTask = runLoginFlow();
    }
    throw new Error(
      "No X/Twitter session found. A login browser window has been opened — " +
      "please sign in to X/Twitter, then retry this tool."
    );
  }

  // Session exists — start headless; reopen visible if session has expired
  console.error("Starting browser (headless)...");
  _browserCtx = await launchContext(true);
  _page = _browserCtx.pages()[0] || await _browserCtx.newPage();

  await _page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  var url = _page.url();
  var needsLogin = url.includes("/login") || url.includes("/i/flow/login") || url.includes("/i/flow/signup");
  var hasError = !needsLogin && await _page.evaluate('document.body ? document.body.innerText.includes("Something went wrong") : false').catch(() => false);

  if (needsLogin || hasError) {
    console.error("Session expired or invalid — triggering re-login.");
    await _browserCtx.close();
    _browserCtx = null;
    _page = null;
    if (!_loginTask) {
      _loginTask = runLoginFlow();
    }
    throw new Error(
      "Your X/Twitter session has expired. A login browser window has been opened — " +
      "please sign in to X/Twitter, then retry this tool."
    );
  }

  console.error("Browser ready.");
  return _page;
}

async function ensureOnTwitter() {
  var page = await getBrowserPage();
  var url = page.url();
  if (!url.includes("x.com") && !url.includes("twitter.com")) {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    await sleep(2000);
  }
  return page;
}

async function closeBrowser() {
  if (_browserCtx) {
    try { await _browserCtx.close(); } catch(e) {}
    _browserCtx = null;
    _page = null;
  }
}

// === CLI COMMANDS ===

async function runLogin() {
  await ensureBrowserInstalled();
  var ctx = await launchContext(false); // always visible for login
  var page = ctx.pages()[0] || await ctx.newPage();
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  var url = page.url();
  if (!url.includes("/login") && !url.includes("/i/flow")) {
    console.error("Already logged in. Profile: " + PROFILE_DIR);
    await ctx.close(); return;
  }
  await page.goto("https://x.com/login");
  console.error("Please log in to Twitter/X in the browser window. Waiting up to 5 minutes...");
  await page.waitForURL(/x\.com\/(home|[^/]+\/status)/, { timeout: 300000 });
  console.error("Login successful! Session saved to: " + PROFILE_DIR);
  await ctx.close();
}

async function runLogout() {
  var { rmSync } = await import("fs");
  if (existsSync(PROFILE_DIR)) {
    rmSync(PROFILE_DIR, { recursive: true, force: true });
    console.error("Logged out. Profile deleted: " + PROFILE_DIR);
  } else {
    console.error("No profile found at: " + PROFILE_DIR);
  }
}

async function runStatus() {
  await ensureBrowserInstalled();
  console.error("Checking session...");
  var ctx = await launchContext(true);
  var page = ctx.pages()[0] || await ctx.newPage();
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  var url = page.url();
  var loggedIn = !url.includes("/login") && !url.includes("/i/flow");
  var hasError = await page.evaluate('document.body ? document.body.innerText.includes("Something went wrong") : true').catch(() => true);
  await ctx.close();
  if (loggedIn && !hasError) {
    console.error("Status: Logged in ✓  Profile: " + PROFILE_DIR);
  } else if (loggedIn && hasError) {
    console.error("Status: Logged in but Twitter is showing errors (may be temporary). Profile: " + PROFILE_DIR);
  } else {
    console.error("Status: Not logged in.  Run: node server.mjs --login");
  }
}

// === HELPERS ===

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function jsStr(s) { return JSON.stringify(String(s)); }

function isTwitterUrl(s) {
  try { var u = new URL(s); return /^https?:$/.test(u.protocol) && /^(.*\.)?(x\.com|twitter\.com)$/.test(u.hostname); }
  catch { return false; }
}

function extractTweetId(url) {
  var m = url.match(/status\/(\d+)/);
  return m ? m[1] : "";
}

// Click the tweet submit button — works on both home inline composer (tweetButtonInline)
// and the dedicated /compose/post page (tweetButton).
var TWEET_BTN_SEL = '[data-testid="tweetButtonInline"],[data-testid="tweetButton"]';

async function waitAndClickTweetButton(page, retries, delayMs) {
  for (var a = 0; a < retries; a++) {
    await sleep(delayMs);
    var ready = await page.evaluate('(function(){ var b=document.querySelector(\'[data-testid="tweetButtonInline"],[data-testid="tweetButton"]\'); return !!(b&&!b.disabled); })()');
    if (ready) break;
  }
  try {
    // Get button position and move mouse naturally before clicking
    var box = await page.locator(TWEET_BTN_SEL).first().boundingBox();
    if (!box) return "not ready: button not found";
    var x = box.x + box.width / 2 + (Math.random() * 4 - 2);
    var y = box.y + box.height / 2 + (Math.random() * 4 - 2);
    await page.mouse.move(x / 2, y / 2); // move from a distance
    await sleep(80 + Math.random() * 120);
    await page.mouse.move(x, y, { steps: 8 });
    await sleep(40 + Math.random() * 60);
    await page.mouse.click(x, y);
    return "ok";
  } catch(e) {
    return "not ready: " + e.message;
  }
}

// Insert text into a Twitter contenteditable box via ClipboardEvent.
// DataTransfer paste triggers Twitter's paste handler which updates React state,
// enabling the tweetButton on the /compose/post modal.
async function pasteText(page, selector, text) {
  await page.evaluate('(function(){ var t=document.querySelector(' + jsStr(selector) + '); if(!t)return; t.focus(); var dt=new DataTransfer(); dt.setData("text/plain",' + jsStr(text) + '); t.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true})); })()');
}

// === SHARED TWEET PARSER ===

function parseTweetsJS(cnt) {
  return '(function(){ var tweets=[]; var articles=document.querySelectorAll(\'article[data-testid="tweet"]\'); for(var i=0;i<Math.min(articles.length,' + cnt + ');i++){ var a=articles[i]; var user=a.querySelector(\'[data-testid="User-Name"]\'); var text=a.querySelector(\'[data-testid="tweetText"]\'); var time=a.querySelector("time"); var imgs=Array.from(a.querySelectorAll(\'[data-testid="tweetPhoto"] img\')).map(function(x){return x.src}); var link=a.querySelector(\'a[href*="/status/"]\'); tweets.push({user:user?user.textContent:"",text:text?text.textContent:"",time:time?time.getAttribute("datetime"):"",images:imgs,url:link?"https://x.com"+link.getAttribute("href"):""}); } return JSON.stringify(tweets); })()';
}

async function openAndParseTweets(url, count, waitMs) {
  var page = await getBrowserPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(waitMs || 4000);
  // If Twitter shows its "Something went wrong" error page, reload once and retry
  var hasError = await page.evaluate('document.body ? document.body.innerText.includes("Something went wrong") : false');
  if (hasError) {
    console.error("Twitter error page detected, reloading...");
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);
    hasError = await page.evaluate('document.body ? document.body.innerText.includes("Something went wrong") : false');
    if (hasError) {
      // Session is expired — close browser, clear cookies, trigger re-login
      await _browserCtx.close().catch(() => {});
      _browserCtx = null; _page = null;
      var { rmSync } = await import("fs");
      rmSync(join(PROFILE_DIR, "Default", "Cookies"), { force: true });
      if (!_loginTask) _loginTask = runLoginFlow();
      throw new Error("Your X/Twitter session has expired. A login browser window has been opened — please sign in to X/Twitter, then retry this tool.");
    }
  }
  return await page.evaluate(parseTweetsJS(count || 20));
}

// === GRAPHQL API HELPER ===

async function twitterAPI(mutation, tweetId, extraVars) {
  var page = await ensureOnTwitter();
  var endpoints = {
    FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
    UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA",
    CreateRetweet: "mbRO74GrOvSfRcJnlMapnQ",
    DeleteRetweet: "ZyZigVsNiFO6v1dEks1eWg",
    DeleteTweet: "nxpZCY2K-I6QoFHAHeojFQ",
  };
  var id = endpoints[mutation];
  if (!id) return "Error: unknown mutation " + mutation;
  var vars = extraVars || '{"tweet_id":"' + tweetId + '"}';
  return await page.evaluate('(async function(){ var ct0=document.cookie.split(";").map(function(c){return c.trim()}).find(function(c){return c.startsWith("ct0=")}).split("=")[1]; var r=await fetch("/i/api/graphql/' + id + '/' + mutation + '",{method:"POST",credentials:"include",headers:{"authorization":"Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA","x-csrf-token":ct0,"content-type":"application/json"}, body:JSON.stringify({variables:' + vars + ',queryId:"' + id + '"})}); return r.ok?"ok: "+r.status:"error: "+r.status+" "+await r.text().then(function(t){return t.substring(0,200)}); })()');
}

// === DM HELPERS ===

function dmPinJS() {
  return '(function(){ var inputs=document.querySelectorAll("input[type=\\"text\\"]"); if(inputs.length<4) return "no_pin"; var pin=' + jsStr(DM_PIN) + '; for(var i=0;i<4;i++){ var inp=inputs[i]; inp.focus(); var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; ns.call(inp,pin[i]); inp.dispatchEvent(new Event("input",{bubbles:true})); inp.dispatchEvent(new Event("change",{bubbles:true})); inp.dispatchEvent(new KeyboardEvent("keydown",{key:pin[i],code:"Digit"+pin[i],bubbles:true})); inp.dispatchEvent(new KeyboardEvent("keyup",{key:pin[i],code:"Digit"+pin[i],bubbles:true})); } return "pin_entered"; })()';
}

function dmConvoListJS() {
  return '(function(){ var items=document.querySelectorAll("[data-testid*=\\"dm-conversation-item\\"]"); var list=[]; for(var i=0;i<items.length;i++){ var it=items[i]; list.push({id:it.getAttribute("data-testid"),preview:it.textContent.trim().substring(0,200)}); } return JSON.stringify(list); })()';
}

function dmClickConvoJS() {
  return '(function(){ var item=document.querySelector("[data-testid*=\\"dm-conversation-item\\"]"); if(!item) return "no conversation"; var rect=item.getBoundingClientRect(); var x=rect.left+200; var y=rect.top+rect.height/2; ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(t){ item.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window})); }); return "clicked"; })()';
}

function dmReadMessagesJS() {
  return '(function(){ var els=document.querySelectorAll("[data-testid*=\\"message-text\\"]"); var msgs=[]; for(var i=0;i<els.length;i++){ var el=els[i]; var clone=el.cloneNode(true); var times=clone.querySelectorAll("time, [datetime]"); for(var j=0;j<times.length;j++) times[j].remove(); var text=clone.textContent.trim(); var row=el.closest("[data-testid*=\\"message-\\"]"); var time=""; if(row){ var t=row.querySelector("time"); if(t) time=t.getAttribute("datetime")||t.textContent.trim(); } msgs.push({text:text,time:time}); } var user=document.querySelector("[data-testid=\\"dm-conversation-username\\"]"); return JSON.stringify({partner:user?user.textContent.trim():"",url:location.href,messages:msgs}); })()';
}

// ============================================================
// MCP SERVER
// ============================================================

function makeServer() {
  var s = new McpServer({ name: "twitter-bridge", version: VERSION });

  // === WRITE TOOLS ===

  s.tool("twitter_post", "Post a new tweet", { text: z.string() }, async function(p) {
    var page = await getBrowserPage();
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    var hasBox = await page.evaluate('!!document.querySelector(\'[data-testid="tweetTextarea_0"]\')');
    if (!hasBox) return { content: [{ type: "text", text: "Error: compose box not found" }] };
    await pasteText(page, '[data-testid="tweetTextarea_0"]', p.text);
    var r = await waitAndClickTweetButton(page, 5, 1000);
    return { content: [{ type: "text", text: r === "ok" ? "posted" : r }] };
  });

  s.tool("twitter_reply", "Reply to a tweet", { tweet_url: z.string(), text: z.string() }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var page = await getBrowserPage();
    await page.goto(p.tweet_url, { waitUntil: "domcontentloaded" });
    var found = false;
    for (var attempt = 0; attempt < 3; attempt++) {
      await sleep(3000);
      var count = await page.evaluate('document.querySelectorAll(\'[data-testid="tweetTextarea_0"]\').length');
      if (count > 0) { found = true; break; }
    }
    if (!found) return { content: [{ type: "text", text: "Error: reply box not found" }] };
    // Last textarea on the page is the reply box
    await page.evaluate('document.querySelectorAll(\'[data-testid="tweetTextarea_0"]\')[document.querySelectorAll(\'[data-testid="tweetTextarea_0"]\').length-1].focus()');
    await pasteText(page, '[data-testid="tweetTextarea_0"]:last-of-type', p.text);
    var r = await waitAndClickTweetButton(page, 5, 1000);
    return { content: [{ type: "text", text: r === "ok" ? "replied" : r }] };
  });

  s.tool("twitter_like", "Like a tweet (no page navigation)", { tweet_url: z.string() }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var id = extractTweetId(p.tweet_url);
    if (!id) return { content: [{ type: "text", text: "Error: could not extract tweet ID from URL" }] };
    var r = await twitterAPI("FavoriteTweet", id);
    return { content: [{ type: "text", text: r.includes("ok") ? "liked" : r }] };
  });

  s.tool("twitter_retweet", "Retweet (no page navigation)", { tweet_url: z.string() }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var id = extractTweetId(p.tweet_url);
    if (!id) return { content: [{ type: "text", text: "Error: could not extract tweet ID" }] };
    var r = await twitterAPI("CreateRetweet", id);
    return { content: [{ type: "text", text: r.includes("ok") ? "retweeted" : r }] };
  });

  s.tool("twitter_undo", "Undo an action: unlike, unretweet, or delete tweet", {
    tweet_url: z.string(),
    action: z.enum(["unlike", "unretweet", "delete"]).describe("unlike / unretweet / delete")
  }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var id = extractTweetId(p.tweet_url);
    if (!id) return { content: [{ type: "text", text: "Error: could not extract tweet ID" }] };
    var map = { unlike: "UnfavoriteTweet", unretweet: "DeleteRetweet", delete: "DeleteTweet" };
    var mutation = map[p.action];
    var vars = p.action === "unretweet" ? '{"source_tweet_id":"' + id + '"}' : undefined;
    var r = await twitterAPI(mutation, id, vars);
    return { content: [{ type: "text", text: r.includes("ok") ? p.action + " done" : r }] };
  });

  s.tool("twitter_quote", "Quote tweet - posts on your timeline with embedded tweet card", { tweet_url: z.string(), text: z.string() }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var page = await getBrowserPage();
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    var pasteContent = p.text + "\n" + p.tweet_url;
    await pasteText(page, '[data-testid="tweetTextarea_0"]', pasteContent);
    var r = await waitAndClickTweetButton(page, 5, 2000);
    return { content: [{ type: "text", text: r === "ok" ? "quoted" : r }] };
  });

  s.tool("twitter_follow", "Follow a user", { screen_name: z.string() }, async function(p) {
    var name = p.screen_name.replace(/\W/g, "");
    var page = await getBrowserPage();
    await page.goto("https://x.com/" + name, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    var r = await page.evaluate('(function(){ var btns=document.querySelectorAll(\'[role="button"]\'); for(var i=0;i<btns.length;i++){ if(btns[i].textContent.trim()==="Follow"){ btns[i].click(); return "followed @' + name + '"; }} return "follow button not found"; })()');
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_unfollow", "Unfollow a user", { screen_name: z.string() }, async function(p) {
    var name = p.screen_name.replace(/\W/g, "");
    var page = await getBrowserPage();
    await page.goto("https://x.com/" + name, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    await page.evaluate('(function(){ var btns=document.querySelectorAll(\'[role="button"]\'); for(var i=0;i<btns.length;i++){ if(btns[i].textContent.includes("Following")){ btns[i].click(); return; }} })()');
    await sleep(1000);
    var r = await page.evaluate('(function(){ var b=document.querySelector(\'[data-testid="confirmationSheetConfirm"]\'); if(!b)return "confirm not found"; b.click(); return "unfollowed @' + name + '"; })()');
    return { content: [{ type: "text", text: r }] };
  });

  // === READ TOOLS ===

  s.tool("twitter_search", "Search tweets", { query: z.string(), count: z.number().optional(), type: z.enum(["latest", "top"]).optional() }, async function(p) {
    var q = encodeURIComponent(p.query);
    var filter = (p.type === "top") ? "" : "&f=live";
    var r = await openAndParseTweets("https://x.com/search?q=" + q + "&src=typed_query" + filter, p.count || 20);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_notifications", "Get your notifications", { count: z.number().optional() }, async function(p) {
    var r = await openAndParseTweets("https://x.com/notifications", p.count || 20, 5000);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_my_replies", "Get your own replies to other tweets", { screen_name: z.string(), count: z.number().optional() }, async function(p) {
    var name = p.screen_name.replace(/\W/g, "");
    var r = await openAndParseTweets("https://x.com/" + name + "/with_replies", p.count || 20, 5000);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_mentions", "Get mentions and replies to your tweets", { count: z.number().optional() }, async function(p) {
    var r = await openAndParseTweets("https://x.com/notifications/mentions", p.count || 20, 5000);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_bookmarks", "Get your bookmarks", { count: z.number().optional() }, async function(p) {
    var r = await openAndParseTweets("https://x.com/i/bookmarks", p.count || 20);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_tweets", "Get a user's tweets", { screen_name: z.string(), count: z.number().optional() }, async function(p) {
    var name = p.screen_name.replace(/\W/g, "");
    var r = await openAndParseTweets("https://x.com/" + name, p.count || 20);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_user", "Get a user's profile", { screen_name: z.string() }, async function(p) {
    var name = p.screen_name.replace(/\W/g, "");
    var page = await getBrowserPage();
    await page.goto("https://x.com/" + name, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    var r = await page.evaluate('(function(){ var nameEl=document.querySelector(\'[data-testid="UserName"]\'); var bioEl=document.querySelector(\'[data-testid="UserDescription"]\'); var locEl=document.querySelector(\'[data-testid="UserLocation"]\'); var urlEl=document.querySelector(\'[data-testid="UserUrl"]\'); var joined=document.querySelector(\'[data-testid="UserJoinDate"]\'); var stats=document.querySelectorAll(\'a[href*="/following"], a[href*="/followers"]\'); var following=""; var followers=""; for(var i=0;i<stats.length;i++){ var sp=stats[i].querySelector("span>span"); if(!sp)continue; if(stats[i].href.includes("/following"))following=sp.textContent; else followers=sp.textContent; } return JSON.stringify({name:nameEl?nameEl.textContent.trim():"",bio:bioEl?bioEl.textContent.trim():"",location:locEl?locEl.textContent.trim():"",website:urlEl?urlEl.textContent.trim():"",joined:joined?joined.textContent.trim():"",following:following,followers:followers}); })()');
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_timeline", "Get your home timeline", { count: z.number().optional() }, async function(p) {
    var r = await openAndParseTweets("https://x.com/home", p.count || 20, 3000);
    return { content: [{ type: "text", text: r }] };
  });

  s.tool("twitter_view_tweet", "View a tweet with full details and image URLs", { tweet_url: z.string(), include_replies: z.boolean().optional() }, async function(p) {
    if (!isTwitterUrl(p.tweet_url)) return { content: [{ type: "text", text: "Error: invalid Twitter URL" }] };
    var page = await getBrowserPage();
    await page.goto(p.tweet_url, { waitUntil: "domcontentloaded" });
    for (var waitI = 0; waitI < 10; waitI++) {
      var found = await page.evaluate('!!document.querySelector(\'article[data-testid="tweet"]\')');
      if (found) break;
      await sleep(1500);
    }
    await sleep(1000);
    var mainJS = '(function(){ var article=document.querySelector(\'article[data-testid="tweet"]\'); if(!article)return JSON.stringify({error:"not found"}); var user=article.querySelector(\'[data-testid="User-Name"]\'); var text=article.querySelector(\'[data-testid="tweetText"]\'); var time=article.querySelector("time"); var imgs=Array.from(article.querySelectorAll(\'[data-testid="tweetPhoto"] img\')).map(function(x){return x.src}); var video=article.querySelector("video"); var likes=article.querySelector(\'[data-testid="like"]\'); var rts=article.querySelector(\'[data-testid="retweet"]\'); return JSON.stringify({user:user?user.textContent:"",text:text?text.textContent:"",time:time?time.getAttribute("datetime"):"",images:imgs,has_video:!!video,likes:likes?likes.textContent.trim():"0",retweets:rts?rts.textContent.trim():"0"}); })()';
    var mainTweet = await page.evaluate(mainJS);
    if (p.include_replies !== false) {
      for (var scrollI = 0; scrollI < 5; scrollI++) {
        await page.evaluate("window.scrollBy(0, 1000)");
        await sleep(1500);
      }
      await sleep(2000);
      var repliesJS = '(function(){ var cells=document.querySelectorAll(\'[data-testid="cellInnerDiv"]\'); var replies=[]; var skippedFirst=false; for(var i=0;i<cells.length&&replies.length<20;i++){ var c=cells[i]; var art=c.querySelector("article"); if(!art)continue; if(!skippedFirst){skippedFirst=true;continue;} var user=art.querySelector(\'[data-testid="User-Name"]\'); var text=art.querySelector(\'[data-testid="tweetText"]\'); var time=art.querySelector("time"); var imgs=Array.from(art.querySelectorAll(\'[data-testid="tweetPhoto"] img\')).map(function(x){return x.src}); var link=art.querySelector(\'a[href*="/status/"]\'); replies.push({user:user?user.textContent:"",text:text?text.textContent:"",time:time?time.getAttribute("datetime"):"",images:imgs,url:link?"https://x.com"+link.getAttribute("href"):""}); } return JSON.stringify(replies); })()';
      var replies = await page.evaluate(repliesJS);
      try {
        var result = { tweet: JSON.parse(mainTweet), replies: JSON.parse(replies) };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch(e) {
        return { content: [{ type: "text", text: JSON.stringify({ tweet: mainTweet, replies_raw: replies, error: "parse error" }) }] };
      }
    }
    return { content: [{ type: "text", text: mainTweet }] };
  });

  s.tool("twitter_screenshot", "Screenshot the current Twitter page", {}, async function() {
    var page = await getBrowserPage();
    var buf = await page.screenshot();
    return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }] };
  });

  s.tool("twitter_dm_read", "Read your DM conversations", {}, async function() {
    var page = await getBrowserPage();
    await page.goto("https://x.com/messages", { waitUntil: "domcontentloaded" });
    await sleep(5000);

    var pinResult = await page.evaluate(dmPinJS());
    if (pinResult.indexOf("pin_entered") >= 0) {
      await sleep(4000);
    }

    var convos = await page.evaluate(dmConvoListJS());
    var clickResult = await page.evaluate(dmClickConvoJS());
    if (clickResult.indexOf("no conversation") >= 0) {
      return { content: [{ type: "text", text: JSON.stringify({ conversations: JSON.parse(convos || "[]"), messages: [] }) }] };
    }
    await sleep(4000);

    var msgs = await page.evaluate(dmReadMessagesJS());
    try {
      var result = { conversations: JSON.parse(convos || "[]"), chat: JSON.parse(msgs || "{}") };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch(e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "parse error", raw_convos: convos, raw_msgs: msgs }) }] };
    }
  });

  // === BROWSER TOOLS ===

  s.tool("browser_open", "Open any URL (http/https only)", { url: z.string() }, async function(p) {
    try { var u = new URL(p.url); if (!/^https?:$/.test(u.protocol)) throw 0; }
    catch { return { content: [{ type: "text", text: "Error: only http/https URLs allowed" }] }; }
    var page = await getBrowserPage();
    await page.goto(p.url, { waitUntil: "domcontentloaded" });
    return { content: [{ type: "text", text: "opened: " + p.url }] };
  });

  s.tool("browser_snapshot", "Get current page content", { depth: z.number().optional() }, async function(p) {
    var page = await getBrowserPage();
    var r = await page.evaluate('(function(){ return JSON.stringify({url:location.href,title:document.title,text:document.body?document.body.innerText.substring(0,10000):""}); })()');
    return { content: [{ type: "text", text: r }] };
  });

  return s;
}

// ============================================================
// HTTP SERVER + OAUTH
// ============================================================

function parseBody(req, maxBytes) {
  maxBytes = maxBytes || 65536;
  return new Promise(function(resolve, reject) {
    var b = ""; req.on("data", function(c) { b += c; if (b.length > maxBytes) { req.destroy(); reject(new Error("body too large")); } });
    req.on("end", function() { resolve(b); });
  });
}

if (CMD_LOGIN) {
  await runLogin(); process.exit(0);
} else if (CMD_LOGOUT) {
  await runLogout(); process.exit(0);
} else if (CMD_STATUS) {
  await runStatus(); process.exit(0);
} else if (STDIO_MODE) {
  var stdioTransport = new StdioServerTransport();
  await makeServer().connect(stdioTransport);
} else {

var httpServer = createServer(async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  var url = new URL(req.url, "http://localhost:" + PORT);
  console.log(new Date().toISOString() + " " + req.method + " " + url.pathname + (req.headers["authorization"] ? " [auth]" : ""));

  // OAuth discovery
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ resource: BASE_URL, authorization_servers: [BASE_URL] })); return;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      issuer: BASE_URL,
      authorization_endpoint: BASE_URL + "/authorize",
      token_endpoint: BASE_URL + "/token",
      registration_endpoint: BASE_URL + "/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256", "plain"]
    })); return;
  }

  // OAuth dynamic registration
  if (url.pathname === "/register" && req.method === "POST") {
    var body = JSON.parse(await parseBody(req));
    var uris = body.redirect_uris || [];
    registeredRedirectUris = uris;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      client_name: body.client_name || "claude",
      redirect_uris: uris
    })); return;
  }

  // OAuth authorize (auto-approve, validates redirect_uri)
  if (url.pathname === "/authorize") {
    var rawRedir = url.searchParams.get("redirect_uri");
    if (!rawRedir || (registeredRedirectUris.length > 0 && !registeredRedirectUris.includes(rawRedir))) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_redirect_uri" })); return;
    }
    var redir = new URL(rawRedir);
    var code = randomBytes(32).toString("hex");
    authCodes.set(code, { expires: Date.now() + 300000, codeChallenge: url.searchParams.get("code_challenge"), redirectUri: rawRedir });
    saveTokens();
    redir.searchParams.set("code", code);
    if (url.searchParams.get("state")) redir.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { Location: redir.toString() }); res.end(); return;
  }

  // OAuth token exchange
  if (url.pathname === "/token" && req.method === "POST") {
    var tbody = new URLSearchParams(await parseBody(req));
    var stored = authCodes.get(tbody.get("code"));
    if (!stored || stored.expires < Date.now()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" })); return;
    }
    if (stored.codeChallenge && tbody.get("code_verifier")) {
      if (createHash("sha256").update(tbody.get("code_verifier")).digest("base64url") !== stored.codeChallenge) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
    }
    if (stored.redirectUri && tbody.get("redirect_uri") !== stored.redirectUri) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" })); return;
    }
    authCodes.delete(tbody.get("code"));
    var token = randomBytes(48).toString("hex");
    accessTokens.set(token, Date.now() + 86400000);
    saveTokens();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 86400 })); return;
  }

  // MCP endpoint
  if (url.pathname === "/mcp") {
    var auth = req.headers["authorization"];
    var tk = auth ? auth.replace("Bearer ", "") : "";
    if (!tk || !accessTokens.has(tk) || accessTokens.get(tk) < Date.now()) {
      if (tk) { accessTokens.delete(tk); saveTokens(); }
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    var transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    var server = makeServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, "0.0.0.0", function() {
  console.log("Twitter MCP Bridge v" + VERSION + ": http://0.0.0.0:" + PORT + "/mcp");
});

} // end STDIO_MODE else
