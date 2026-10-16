"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { search, parseResultsPage, compact, _cache } = require("../lib/search");

function page(contents) {
  const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents } }] } } } } };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>var other = {};</script></html>`;
}
const liveVideo = {
  videoRenderer: {
    videoId: "AAAAAAAAAA1",
    title: { runs: [{ text: "Lofi beats 24/7 " }, { text: "radio" }] },
    ownerText: { runs: [{ text: "Lofi Girl", navigationEndpoint: { browseEndpoint: { browseId: "UCSJ4gkVC6NrvII8umztf0Ow" } } }] },
    badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }],
    viewCountText: { runs: [{ text: "31K" }, { text: " watching" }] },
    thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/a.jpg" }, { url: "https://i.ytimg.com/b.jpg" }] },
  },
};
const plainVideo = {
  videoRenderer: {
    videoId: "BBBBBBBBBB2",
    title: { runs: [{ text: "A <b>normal</b> video" }] },
    longBylineText: { runs: [{ text: "Someone" }] },
    lengthText: { simpleText: "10:01" },
  },
};
const upcoming = { videoRenderer: { videoId: "CCCCCCCCCC3", title: { simpleText: "Soon" }, upcomingEventData: { startTime: "1" } } };

test("parseResultsPage: live, normal and upcoming videos", () => {
  const r = parseResultsPage(page([liveVideo, { shelfRenderer: { content: { items: [plainVideo] } } }, upcoming, liveVideo]));
  assert.equal(r.length, 3, "nested results found, duplicates dropped");
  assert.deepEqual(
    [r[0].videoId, r[0].title, r[0].channel, r[0].channelId, r[0].live, r[0].viewers],
    ["AAAAAAAAAA1", "Lofi beats 24/7 radio", "Lofi Girl", "UCSJ4gkVC6NrvII8umztf0Ow", true, "31K watching"]);
  assert.equal(r[0].thumb, "https://i.ytimg.com/vi/AAAAAAAAAA1/mqdefault_live.jpg");
  assert.equal(r[0].thumbFallback, "https://i.ytimg.com/b.jpg");
  assert.deepEqual([r[1].live, r[1].length, r[1].channel, r[1].channelId], [false, "10:01", "Someone", null]);
  assert.equal(r[2].upcoming, true);
});

test("parseResultsPage: page without data is an error", () => {
  assert.throws(() => parseResultsPage("<html>consent</html>"), (e) => e.status === 502);
});

test("search: no key uses the page, caches, separates live/all", async () => {
  _cache.clear();
  let calls = [];
  const fetchPage = async (q, live) => { calls.push([q, live]); return [{ videoId: "x" }]; };
  const a = await search("lofi", { key: "", fetchPage });
  const b = await search("LOFI", { key: "", fetchPage });
  await search("lofi", { key: "", live: false, fetchPage });
  assert.deepEqual(a, { results: [{ videoId: "x" }], source: "page" });
  assert.equal(b, a, "same search within 2 minutes comes from the cache");
  assert.deepEqual(calls, [["lofi", true], ["lofi", false]]);
});

test("search: input checks", async () => {
  await assert.rejects(search("   ", { key: "" }), (e) => e.status === 400);
  await assert.rejects(search("x".repeat(121), { key: "" }), (e) => e.status === 400);
});

test("compact numbers", () => {
  assert.deepEqual([compact(950), compact(1234), compact(31000), compact(2500000)], ["950", "1.2K", "31K", "2.5M"]);
});

