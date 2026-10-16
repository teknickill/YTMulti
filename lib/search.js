// YouTube search for the Add box. Parsing lives in public/ytcore.js (shared
// with the web page and the Worker relay); this is the Node server's side.
//
//   Reads YouTube's own search results page. If the separate backup add-on
//   (public/ytkey.js) is installed and YT_API_KEY is set, uses the Data API.

"use strict";

const core = require("../public/ytcore.js");
const { parseResultsPage, compact, httpError } = core;
let backup = null;   // the optional Data API add-on
try { backup = require("../public/ytkey.js"); } catch (e) { /* not installed */ }

const CACHE_MS = 2 * 60 * 1000;
const cache = new Map(); // "live|query" -> { at, value }

async function searchPage(q, live) {
  return core.searchFromPage(q, live, core.fetchPage);
}

async function search(q, { live = true, key = process.env.YT_API_KEY, fetchPage = searchPage } = {}) {
  q = String(q || "").trim();
  if (!q) throw httpError(400, "Type something to search for.");
  if (q.length > 120) throw httpError(400, "That search is too long.");
  const ck = `${live ? 1 : 0}|${q.toLowerCase()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const useKey = !!(key && backup);
  const results = useKey ? await backup.search(q, live, key) : await fetchPage(q, live);
  const value = { results, source: useKey ? "api" : "page" };
  cache.set(ck, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { search, parseResultsPage, compact, _cache: cache };
