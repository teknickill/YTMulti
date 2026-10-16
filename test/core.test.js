"use strict";
// public/ytcore.js high-level lookups (used by the web page, the Android
// app path and the Worker) and the built Cloudflare Worker itself.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YT = require("../public/ytcore.js");

const CH = "UCabcdefghijklmnopqrstuv";
const VID = "LIVEVIDEO01";
const livePage = `<link rel="canonical" href="https://www.youtube.com/watch?v=${VID}">
<meta itemprop="identifier" content="${CH}"><link itemprop="name" content="Tek">"isLiveNow":true
<meta property="og:title" content="On air">`;
const resultsPage = `<script>var ytInitialData = ${JSON.stringify({ a: [{ videoRenderer: { videoId: "AAAAAAAAAA1",
  title: { simpleText: "Lofi" }, badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } }] } }] })};</script>`;

function clear() { YT._resolveCache.clear(); YT._searchCache.clear(); }

test("core.resolve: page first; key not touched when the page works", async () => {
  clear();
  const urls = [];
  const r = await YT.resolve("@Tek", { getText: async (u) => { urls.push(u); return { status: 200, text: livePage }; }, key: "K" });
  assert.deepEqual([r.kind, r.live, r.videoId, r.channelId], ["channel", true, VID, CH]);
  assert.deepEqual(urls, ["https://www.youtube.com/@Tek/live"]);
});

test("core.resolve: page fails -> fallback (the backup add-on hook) is used", async () => {
  clear();
  const r = await YT.resolve("@Tek", { getText: async () => ({ status: 429, text: "" }),
    fallback: async (c) => YT.channelValue(c, { live: true, videoId: VID, channelId: CH }) });
  assert.deepEqual([r.live, r.videoId], [true, VID]);
});

test("core: 'channel doesn't exist' stops (no backup tried); no sources = clear error", async () => {
  clear();
  let keyUsed = false;
  const real = global.fetch;
  try {
    await assert.rejects(YT.resolve("@Nobody", { getText: async () => ({ status: 404, text: "" }), fallback: async () => { keyUsed = true; } }), (e) => e.status === 404);
    assert.equal(keyUsed, false);
    await assert.rejects(YT.resolve("@Tek", {}), (e) => e.status === 503);
    assert.deepEqual(await YT.resolve(`https://youtu.be/${VID}`), { kind: "video", videoId: VID, live: null });
  } finally { global.fetch = real; }
});

test("core.search: page, plain-string getText works too", async () => {
  clear();
  const r = await YT.search("lofi", { getText: async () => resultsPage });
  assert.deepEqual([r.source, r.results.length, r.results[0].live], ["page", 1, true]);
});

async function loadWorker() {
  require("child_process").execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "build-worker.js")]);
  const tmp = path.join(os.tmpdir(), `ms-worker-${process.pid}.mjs`);
  fs.copyFileSync(path.join(__dirname, "..", "worker", "worker.js"), tmp);
  return (await import(tmp)).default;
}

test("worker: /resolve, /search, CORS, errors", async () => {
  clear();
  const worker = await loadWorker();
  const real = global.fetch; const seen = [];
  global.fetch = async (u, init) => {
    u = String(u); seen.push([u, init && init.headers && init.headers.Cookie]);
    const html = u.includes("/results?") ? resultsPage : u.includes("@Nobody") ? "" : livePage;
    return new Response(html, { status: u.includes("@Nobody") ? 404 : 200 });
  };
  const get = (p, origin, env) => worker.fetch(new Request(`https://relay.example${p}`, { headers: origin ? { Origin: origin } : {} }), env || {});
  try {
    let res = await get("/resolve?q=%40Tek", "https://site.example");
    let body = await res.json();
    assert.deepEqual([res.status, body.live, body.videoId], [200, true, VID]);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(seen[0][1], "CONSENT=YES+cb; SOCS=CAI", "consent cookie sent");
    res = await get("/search?q=lofi&live=1");
    body = await res.json();
    assert.deepEqual([res.status, body.results[0].videoId], [200, "AAAAAAAAAA1"]);
    res = await get("/resolve?q=%40Nobody");
    assert.equal(res.status, 404);
    res = await get("/resolve?q=not%20a%20link");
    assert.equal(res.status, 400);
    res = await get("/resolve?q=%40Tek", "https://site.example", { ALLOWED_ORIGINS: "https://site.example/, https://b.example" });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://site.example");
    res = await get("/resolve?q=%40Tek", "https://evil.example", { ALLOWED_ORIGINS: "https://site.example" });
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://site.example");
    res = await worker.fetch(new Request("https://relay.example/search", { method: "OPTIONS" }), {});
    assert.equal(res.status, 204);
    assert.equal((await get("/health")).status, 200);
    assert.equal((await get("/nope")).status, 404);
  } finally { global.fetch = real; }
});
