// MultiStream — watch several YouTube live streams at once.
// Zero dependencies: Node 18+ (uses the built-in fetch).
//
//   node server.js            -> http://localhost:3000
//   PORT=8080 node server.js  -> another port
//   HOST=0.0.0.0 node server.js -> reachable from other devices on your LAN
//
// The server does two jobs:
//   1. Serves the web app in ./public (the YouTube player API refuses to run
//      from a file:// page, so the app needs a real http origin).
//   2. /api/resolve: turns "@handle", a channel link or a /live link into the
//      video ID that channel is streaming right now. Browsers can't do this
//      themselves (YouTube pages don't allow cross-origin reads).

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { resolveInput } = require("./lib/resolve");
const { search } = require("./lib/search");

// Searches per visitor per minute (the site may be public; this keeps one
// visitor from using up the YouTube quota or getting the server blocked).
const SEARCH_PER_MIN = 20;
const searchHits = new Map();   // ip -> [timestamps]
function searchAllowed(ip) {
  const now = Date.now();
  const recent = (searchHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= SEARCH_PER_MIN) { searchHits.set(ip, recent); return false; }
  recent.push(now);
  searchHits.set(ip, recent);
  if (searchHits.size > 5000) searchHits.clear();
  return true;
}

const PORT = Number(process.env.PORT) || 3000;
// On your PC: only this computer can connect. On a host like Render (which
// sets PORT), listen on all interfaces so the host can route traffic in.
// Render always sets RENDER=true; any cloud host must use 0.0.0.0.
const HOST = process.env.RENDER ? "0.0.0.0"
  : process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    // Repeat visits: the browser asks "still this version?" and gets a tiny
    // 304 instead of the file again.
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    // Text files go out gzipped (about a quarter of the size).
    const gzip = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) &&
      /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (gzip) {
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === "/api/resolve") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(res, 400, { error: "Missing ?q=" });
    if (q.length > 300) return sendJson(res, 400, { error: "That's too long to be a YouTube link." });
    try {
      const result = await resolveInput(q, { fresh: url.searchParams.get("fresh") === "1" });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message || "Couldn't reach YouTube." });
    }
  }
  if (url.pathname === "/api/search") {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (!searchAllowed(ip)) return sendJson(res, 429, { error: "Too many searches — wait a moment." });
    try {
      const result = await search(url.searchParams.get("q"), { live: url.searchParams.get("live") !== "0" });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message || "Search failed." });
    }
  }
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });
  // Android app link check. The file lives at public/assetlinks.json (no
  // hidden ".well-known" folder needed), but Android asks for it here.
  if (url.pathname === "/.well-known/assetlinks.json" && fs.existsSync(path.join(PUBLIC_DIR, "assetlinks.json"))) {
    return serveStatic(req, res, "/assetlinks.json");
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`MultiStream running at http://${shown}:${PORT}`);
  if (HOST === "0.0.0.0") console.log("Listening on all interfaces.");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} node server.js`);
    process.exit(1);
  }
  throw e;
});
