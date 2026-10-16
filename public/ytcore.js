// MultiStream — YouTube lookups (search, @handle -> live video), shared by:
//   - the web page (window.YTCore), incl. the Android app, which downloads
//     the YouTube page natively and hands the text to this parser
//   - the Cloudflare Worker relay (worker/worker.js is built from this file)
//   - the Node server (lib/resolve.js, lib/search.js)
// One parser, so a fix for a YouTube page change goes in one place.
//
// Data comes from YouTube's own pages (what youtube.com shows): no key, no
// quota. It needs something that can download youtube.com pages: the relay,
// the Node server, or the Android app.
// The Data API key backup is a separate add-on (ytkey.js), not part of this.
(function (root) {
  "use strict";

  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
  const HANDLE = /^@[A-Za-z0-9._-]{3,100}$/;
  const RESOLVE_CACHE_MS = 45 * 1000;
  const SEARCH_CACHE_MS = 2 * 60 * 1000;
  const resolveCache = new Map();   // channel path -> { at, value }
  const searchCache = new Map();    // "live|query" -> { at, value }

  // What a page download sends (server / relay / Android app).
  const PAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    // Skips the EU cookie-consent interstitial, which has none of the data.
    Cookie: "CONSENT=YES+cb; SOCS=CAI",
  };

  function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
  }

  /* ------------------------------------------------------------- classify */
  /** Pure parsing: what kind of thing is this? */
  function classify(raw) {
    const input = String(raw || "").trim();
    if (VIDEO_ID.test(input)) return { kind: "video", videoId: input };
    if (CHANNEL_ID.test(input)) return { kind: "channel", path: `/channel/${input}` };
    if (HANDLE.test(input)) return { kind: "channel", path: `/${input}` };

    let url;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch (e) {
      return { kind: "unknown" };
    }
    const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "").toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);

    if (host === "youtu.be") {
      return parts[0] && VIDEO_ID.test(parts[0]) ? { kind: "video", videoId: parts[0] } : { kind: "unknown" };
    }
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return { kind: "unknown" };

    const v = url.searchParams.get("v");
    if (parts[0] === "watch" && v && VIDEO_ID.test(v)) return { kind: "video", videoId: v };
    if (parts[0] === "embed" && parts[1] === "live_stream") {   // 11 characters, like a video ID
      const ch = url.searchParams.get("channel");
      return ch && CHANNEL_ID.test(ch) ? { kind: "channel", path: `/channel/${ch}` } : { kind: "unknown" };
    }
    if (["live", "embed", "shorts", "v"].includes(parts[0]) && parts[1] && VIDEO_ID.test(parts[1])) {
      return { kind: "video", videoId: parts[1] };
    }
    if (parts[0] && parts[0].startsWith("@") && HANDLE.test(parts[0])) {
      return { kind: "channel", path: `/${parts[0]}` };
    }
    if (parts[0] === "channel" && parts[1] && CHANNEL_ID.test(parts[1])) {
      return { kind: "channel", path: `/channel/${parts[1]}` };
    }
    if ((parts[0] === "c" || parts[0] === "user") && parts[1] && /^[A-Za-z0-9._-]{1,100}$/.test(parts[1])) {
      return { kind: "channel", path: `/${parts[0]}/${parts[1]}` };
    }
    return { kind: "unknown" };
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  /* ------------------------------------------------------- page parsing */
  /** A channel's /live page -> is it live, which video. */
  function parseLivePage(html) {
    const out = { live: false, videoId: null, channelId: null, channelName: null, title: null, upcoming: false };

    const chan =
      html.match(/<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"/) ||
      html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) ||
      html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ||
      html.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (chan) out.channelId = chan[1];

    const author =
      html.match(/<link itemprop="name" content="([^"]+)"/) ||
      html.match(/"ownerChannelName":"([^"]+)"/) ||
      html.match(/"author":"([^"]+)"/);
    if (author) out.channelName = decodeEntities(author[1]);

    // When a channel is live, its /live page IS the watch page of that stream,
    // so the canonical link points at the video.
    const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
    if (canon) {
      out.videoId = canon[1];
      const isLiveNow = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
      const upcoming = /"isUpcoming":true/.test(html) || /"upcomingEventData"/.test(html);
      out.live = isLiveNow && !upcoming;
      out.upcoming = upcoming && !isLiveNow;
      const t = html.match(/<meta property="og:title" content="([^"]*)"/) || html.match(/<meta name="title" content="([^"]*)"/);
      if (t) out.title = decodeEntities(t[1]);
    }
    return out;
  }

  const text = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join("") : "") || "";

  /** A search results page -> list of videos. */
  function parseResultsPage(html) {
    const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) ||
              html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
    if (!m) throw httpError(502, "YouTube's search page didn't have results in the expected place.");
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { throw httpError(502, "Couldn't read YouTube's search results."); }
    const out = [];
    const seen = new Set();
    (function walk(node) {
      if (!node || typeof node !== "object" || out.length >= 25) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const v = node.videoRenderer;
      if (v && v.videoId && !seen.has(v.videoId)) {
        seen.add(v.videoId);
        const owner = (v.ownerText || v.longBylineText || {}).runs || [];
        const badges = JSON.stringify(v.badges || []) + JSON.stringify(v.thumbnailOverlays || []);
        const live = /BADGE_STYLE_TYPE_LIVE_NOW|"LIVE"|"style":"LIVE"/.test(badges);
        const upcoming = !!v.upcomingEventData;
        const thumbs = (v.thumbnail && v.thumbnail.thumbnails) || [];
        out.push({
          videoId: v.videoId,
          title: text(v.title),
          channel: owner[0] ? owner[0].text : "",
          channelId: (owner[0] && owner[0].navigationEndpoint && owner[0].navigationEndpoint.browseEndpoint &&
                      owner[0].navigationEndpoint.browseEndpoint.browseId) || null,
          thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault${live ? "_live" : ""}.jpg`,
          thumbFallback: thumbs.length ? thumbs[thumbs.length - 1].url : null,
          live,
          upcoming,
          viewers: live ? text(v.viewCountText) || text(v.shortViewCountText) : "",
          length: text(v.lengthText),
        });
      }
      for (const k in node) if (k !== "videoRenderer") walk(node[k]);
    })(data);
    return out;
  }

  const livePageUrl = (path) => `https://www.youtube.com${path}/live`;
  // sp=EgJAAQ%3D%3D is YouTube's own "Live" search filter.
  const searchPageUrl = (q, live) =>
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${live ? "&sp=EgJAAQ%253D%253D" : ""}`;

  /** Server / relay: download a youtube.com page. Returns { status, text }. */
  async function fetchPage(url) {
    const res = await fetch(url, { redirect: "follow", headers: PAGE_HEADERS, signal: AbortSignal.timeout(10000) });
    return { status: res.status, text: await res.text() };
  }

  function channelValue(c, p) {
    if (!p.channelId && !p.videoId) throw httpError(404, "Couldn't find that channel on YouTube.");
    return {
      kind: "channel",
      input: c.path.replace(/^\//, ""),
      channelId: p.channelId,
      channelName: p.channelName,
      live: p.live,
      upcoming: p.upcoming,
      videoId: p.live || p.upcoming ? p.videoId : null,
      title: p.title,
    };
  }

  /** getText(url) -> { status, text } (or a plain string). */
  async function resolveFromPage(c, getText) {
    let r = await getText(livePageUrl(c.path));
    if (typeof r === "string") r = { status: 200, text: r };
    if (r.status === 404) throw httpError(404, "YouTube says that channel doesn't exist.");
    if (r.status < 200 || r.status >= 300) throw httpError(502, `YouTube answered ${r.status}.`);
    return channelValue(c, parseLivePage(r.text));
  }

  async function searchFromPage(q, live, getText) {
    let r = await getText(searchPageUrl(q, live));
    if (typeof r === "string") r = { status: 200, text: r };
    if (r.status < 200 || r.status >= 300) throw httpError(502, `YouTube search answered ${r.status}.`);
    return parseResultsPage(r.text);
  }

  /* ------------------------------------------------------- high level */
  // Errors that are about the input itself: no point trying another source.
  const isFinal = (e) => e && (e.status === 400 || e.status === 404);

  async function firstOf(tries) {
    let last;
    for (const t of tries) {
      if (!t) continue;
      try { return await t(); } catch (e) { if (isFinal(e)) throw e; last = e; }
    }
    throw last || httpError(503, "No way to reach YouTube is set up.");
  }

  /**
   * resolve("@handle" | link | id, { getText, fresh, fallback })
   * getText(url) downloads a youtube.com page. fallback(c) is an optional
   * last resort (the ytkey.js add-on), used only if the page way fails.
   */
  async function resolve(raw, opts) {
    opts = opts || {};
    const c = classify(raw);
    if (c.kind === "video") return { kind: "video", videoId: c.videoId, live: null };
    if (c.kind !== "channel") throw httpError(400, "That doesn't look like a YouTube video, live link, channel or @handle.");
    const hit = resolveCache.get(c.path);
    if (!opts.fresh && hit && Date.now() - hit.at < RESOLVE_CACHE_MS) return hit.value;
    const value = await firstOf([
      opts.getText && (() => resolveFromPage(c, opts.getText)),
      opts.fallback && (() => opts.fallback(c)),
    ]);
    resolveCache.set(c.path, { at: Date.now(), value });
    if (resolveCache.size > 500) resolveCache.delete(resolveCache.keys().next().value);
    return value;
  }

  /** search(q, { live, getText, fallback }) -> { results, source } */
  async function search(q, opts) {
    opts = opts || {};
    const live = opts.live !== false;
    q = String(q || "").trim();
    if (!q) throw httpError(400, "Type something to search for.");
    if (q.length > 120) throw httpError(400, "That search is too long.");
    const ck = `${live ? 1 : 0}|${q.toLowerCase()}`;
    const hit = searchCache.get(ck);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.value;
    const value = await firstOf([
      opts.getText && (async () => ({ results: await searchFromPage(q, live, opts.getText), source: "page" })),
      opts.fallback && (async () => ({ results: await opts.fallback(q, live), source: "backup" })),
    ]);
    searchCache.set(ck, { at: Date.now(), value });
    if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value);
    return value;
  }

  const YTCore = {
    classify, decodeEntities, compact, parseLivePage, parseResultsPage, channelValue,
    livePageUrl, searchPageUrl, fetchPage, PAGE_HEADERS, httpError, isFinal,
    resolveFromPage, searchFromPage,
    resolve, search, _resolveCache: resolveCache, _searchCache: searchCache,
  };
  if (typeof module === "object" && module.exports) module.exports = YTCore;
  root.YTCore = YTCore;
})(typeof globalThis !== "undefined" ? globalThis : this);
