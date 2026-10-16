# MultiStream relay (Cloudflare Worker)

The website can't read youtube.com itself (browsers block that), so search and
`@handle` lookups go through this tiny relay. Video and chat never pass
through it. The Android app doesn't use it: it reads YouTube on the phone.

Free plan: about 100,000 requests a day, and it never sleeps. [LOW CONFIDENCE on current limits]

## Set it up (dashboard, no tools needed)

1. Sign up / log in at **dash.cloudflare.com** (free).
2. **Workers & Pages → Create → Create Worker** (pick "Hello World"). Name it `multistream-relay` → **Deploy**.
3. **Edit code**. Delete everything, paste the whole of **`worker/worker.js`**, **Deploy**.
4. Copy its address, e.g. `https://multistream-relay.yourname.workers.dev`.
5. Check it: open `https://multistream-relay.yourname.workers.dev/search?q=lofi` → you should see JSON with results.
6. In your site repo, `public/config.js`:
   ```js
   relayUrl: "https://multistream-relay.yourname.workers.dev",
   ```
   Commit; Render redeploys.
7. Recommended: Worker → **Settings → Variables and Secrets → Add**: `ALLOWED_ORIGINS` = your site, e.g. `https://multistream-site.onrender.com` → Deploy. Other websites can then no longer use your relay from their pages.

## Updating

`worker/worker.js` is built from `public/ytcore.js` (the shared YouTube parser) and `worker/handler.js`.
After changing either: `npm run build:worker`, then paste the new `worker/worker.js` again (step 3).

## Endpoints

| URL | Returns |
|---|---|
| `/search?q=lofi&live=1` | `{ results: [...], source: "page" }` (`live=0`: all videos) |
| `/resolve?q=@LofiGirl` | `{ kind: "channel", channelId, channelName, live, upcoming, videoId, title }` |
| `/health` | `{ ok: true }` |

Limits: 30 lookups per visitor per minute. Answers are cached briefly (search 2 min, channels 45 s).
