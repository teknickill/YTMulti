/* ------------------------------------------------------------------ relay
 * MultiStream relay: a Cloudflare Worker that does the two lookups a web page
 * can't do itself (it can't read youtube.com): search, and "what is @handle
 * streaming now". Video and chat never pass through here.
 *
 *   GET /search?q=lofi&live=1     -> { results: [...], source }
 *   GET /resolve?q=@LofiGirl      -> { kind, channelId, live, videoId, ... }
 *   GET /health                   -> { ok: true }
 *   add &debug=1 to /resolve      -> what YouTube sent back (always HTTP 200)
 *
 * Setting (Worker -> Settings -> Variables), optional:
 *   ALLOWED_ORIGINS  your site, e.g. https://multistream.onrender.com
 *                    (comma-separated; empty = any site may use this relay)
 */
const RATE_PER_MIN = 30;           // lookups per visitor per minute
const hits = new Map();            // ip -> [timestamps] (per Worker instance)

function allowed(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= RATE_PER_MIN) { hits.set(ip, recent); return false; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

function cors(request, env) {
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const allow = !list.length ? "*" : list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, body, request, env, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    }, cors(request, env)),
  });
}

export default {
  async fetch(request, env) {
    env = env || {};
    const YT = globalThis.YTCore;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    if (request.method !== "GET") return json(405, { error: "GET only." }, request, env);
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(200, { ok: true }, request, env);
    if (url.pathname !== "/search" && url.pathname !== "/resolve") return json(404, { error: "Not found." }, request, env);
    if (!allowed(request.headers.get("CF-Connecting-IP") || "")) {
      return json(429, { error: "Too many lookups — wait a moment." }, request, env);
    }
    const opts = { getText: YT.fetchPage };
    const q = url.searchParams.get("q") || "";
    try {
      if (url.pathname === "/search") {
        const r = await YT.search(q, Object.assign({ live: url.searchParams.get("live") !== "0" }, opts));
        return json(200, r, request, env, 60);
      }
      if (q.length > 300) return json(400, { error: "That's too long to be a YouTube link." }, request, env);
      if (url.searchParams.get("debug") === "1") {
        const trace = [];
        const getText = async (u) => {
          const r = await YT.fetchPage(u);
          trace.push({ asked: u, status: r.status, finalUrl: r.url, bytes: r.text.length,
            title: (r.text.match(/<title>([^<]*)<\/title>/) || [])[1] || null,
            watchCanonical: /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=/.test(r.text),
            handle: YT.findHandle(r.text) });
          return r;
        };
        YT._resolveCache.delete(YT.classify(q).path);
        let result = null, error = null;
        try { result = await YT.resolve(q, { getText, fresh: true }); } catch (e) { error = { status: e.status || 502, message: e.message }; }
        return json(200, { trace, result, error }, request, env);
      }
      const r = await YT.resolve(q, Object.assign({ fresh: url.searchParams.get("fresh") === "1" }, opts));
      return json(200, r, request, env, 20);
    } catch (e) {
      return json(e.status || 502, { error: e.message || "Couldn't reach YouTube." }, request, env);
    }
  },
};
