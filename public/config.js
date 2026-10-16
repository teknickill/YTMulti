// MultiStream website settings. Edit, commit, and your host redeploys.
//
// Video and chat always come straight from YouTube to each viewer. This only
// covers search and "what is @handle streaming right now".
//
// relayUrl  Your Cloudflare Worker (see worker/README.md), e.g.
//           "https://multistream-relay.yourname.workers.dev".
//           The Android app doesn't need it (it reads YouTube itself).
//           Empty and the site run with `node server.js`: its own /api is used.
window.MULTISTREAM_CONFIG = {
  relayUrl: "https://sweet-meadow-77d1.millernick192.workers.dev",
};
