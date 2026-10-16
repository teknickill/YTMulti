"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, parseLivePage, resolveInput, _cache } = require("../lib/resolve");

const VID = "dQw4w9WgXcQ";
const CH = "UCabcdefghijklmnopqrstuv";

test("classify: video forms", () => {
  for (const input of [
    VID,
    `https://www.youtube.com/watch?v=${VID}`,
    `youtube.com/watch?v=${VID}&t=30s`,
    `https://youtu.be/${VID}?si=x`,
    `https://www.youtube.com/live/${VID}?feature=share`,
    `https://m.youtube.com/watch?v=${VID}`,
    `https://www.youtube.com/embed/${VID}`,
    `https://www.youtube.com/shorts/${VID}`,
  ]) assert.deepEqual(classify(input), { kind: "video", videoId: VID }, input);
});

test("classify: channel forms", () => {
  const cases = {
    "@LofiGirl": "/@LofiGirl",
    "https://www.youtube.com/@LofiGirl": "/@LofiGirl",
    "https://www.youtube.com/@LofiGirl/live": "/@LofiGirl",
    "youtube.com/@some.name-1/streams": "/@some.name-1",
    [CH]: `/channel/${CH}`,
    [`https://www.youtube.com/channel/${CH}`]: `/channel/${CH}`,
    [`https://www.youtube.com/embed/live_stream?channel=${CH}`]: `/channel/${CH}`,
    "https://www.youtube.com/c/SomeName": "/c/SomeName",
    "https://www.youtube.com/user/OldName": "/user/OldName",
  };
  for (const [input, path] of Object.entries(cases)) {
    assert.deepEqual(classify(input), { kind: "channel", path }, input);
  }
});

test("classify: rejects other things", () => {
  for (const input of ["", "hello world", "https://vimeo.com/123", "https://www.youtube.com/", "@a", "https://evil.com/@x"]) {
    assert.equal(classify(input).kind, "unknown", input);
  }
});

const livePage = `<html><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=${VID}">
<meta property="og:title" content="Big &amp; Live Stream">
<meta itemprop="identifier" content="${CH}">
<link itemprop="name" content="Tek &#39;n Stuff">
</head><body><script>var x={"isLiveNow":true,"isLive":true};</script></body></html>`;

const offlinePage = `<html><head>
<link rel="canonical" href="https://www.youtube.com/channel/${CH}">
<meta property="og:title" content="Tek">
</head><body><script>{"externalId":"${CH}","author":"Tek"}</script></body></html>`;

const upcomingPage = `<link rel="canonical" href="https://www.youtube.com/watch?v=${VID}">
<script>{"channelId":"${CH}","isUpcoming":true,"upcomingEventData":{}}</script>`;

test("parseLivePage: live", () => {
  const p = parseLivePage(livePage);
  assert.equal(p.live, true);
  assert.equal(p.videoId, VID);
  assert.equal(p.channelId, CH);
  assert.equal(p.channelName, "Tek 'n Stuff");
  assert.equal(p.title, "Big & Live Stream");
});

test("parseLivePage: offline", () => {
  const p = parseLivePage(offlinePage);
  assert.equal(p.live, false);
  assert.equal(p.videoId, null);
  assert.equal(p.channelId, CH);
});

test("parseLivePage: scheduled (upcoming) isn't live", () => {
  const p = parseLivePage(upcomingPage);
  assert.equal(p.live, false);
  assert.equal(p.upcoming, true);
  assert.equal(p.videoId, VID);
});

test("resolveInput: video needs no network", async () => {
  const r = await resolveInput(`https://youtu.be/${VID}`, { fetchPage: () => { throw new Error("no"); } });
  assert.deepEqual(r, { kind: "video", videoId: VID, live: null });
});

test("resolveInput: channel live / offline / cache / fresh", async () => {
  _cache.clear();
  let calls = 0;
  let page = livePage;
  const fetchPage = async (path) => { calls++; assert.equal(path, "/@Tek"); return page; };
  let r = await resolveInput("@Tek", { fetchPage });
  assert.equal(r.live, true);
  assert.equal(r.videoId, VID);
  assert.equal(r.channelName, "Tek 'n Stuff");
  page = offlinePage;
  r = await resolveInput("https://www.youtube.com/@Tek/live", { fetchPage });
  assert.equal(calls, 1, "second lookup within 45 s comes from the cache");
  assert.equal(r.live, true);
  r = await resolveInput("@Tek", { fetchPage, fresh: true });
  assert.equal(calls, 2);
  assert.equal(r.live, false);
  assert.equal(r.videoId, null);
  assert.equal(r.channelId, CH);
});

test("resolveInput: errors", async () => {
  await assert.rejects(resolveInput("not a link"), (e) => e.status === 400);
  _cache.clear();
  await assert.rejects(resolveInput("@Nobody", { fetchPage: async () => "<html></html>" }), (e) => e.status === 404);
});
