// Turns whatever someone pastes into something the player can use.
// The parsing lives in public/ytcore.js (shared with the web page and the
// Cloudflare Worker relay); this file is the Node server's side of it.
//
//   Video forms (no network needed): watch?v=ID, youtu.be/ID, /live/ID,
//     /embed/ID, /shorts/ID, an 11-character ID
//   Channel forms (fetches the channel's /live page): @handle, /@handle,
//     /channel/UC..., UC..., /c/Name, /user/Name

"use strict";

const core = require("../public/ytcore.js");
const { classify, parseLivePage, httpError } = core;

const CACHE_MS = 45 * 1000;
const cache = new Map(); // channel path -> { at, value }

async function fetchLivePage(path) {
  const r = await core.fetchPage(core.livePageUrl(path));
  if (r.status === 404) throw httpError(404, "YouTube says that channel doesn't exist.");
  if (r.status < 200 || r.status >= 300) throw httpError(502, `YouTube answered ${r.status}.`);
  return r.text;
}

async function resolveInput(raw, { fresh = false, fetchPage = fetchLivePage } = {}) {
  const c = classify(raw);
  if (c.kind === "video") return { kind: "video", videoId: c.videoId, live: null };
  if (c.kind !== "channel") {
    throw httpError(400, "That doesn't look like a YouTube video, live link, channel or @handle.");
  }
  const hit = cache.get(c.path);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const html = await fetchPage(c.path);
  const p = parseLivePage(html);
  if (!p.channelId && !p.videoId) throw httpError(404, "Couldn't find that channel on YouTube.");
  const value = {
    kind: "channel",
    input: c.path.replace(/^\//, ""),
    channelId: p.channelId,
    channelName: p.channelName,
    live: p.live,
    upcoming: p.upcoming,
    videoId: p.live || p.upcoming ? p.videoId : null,
    title: p.title,
  };
  cache.set(c.path, { at: Date.now(), value });
  return value;
}

module.exports = { classify, parseLivePage, resolveInput, _cache: cache };
