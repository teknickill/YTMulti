# MultiStream

Watch several YouTube live streams at once in one browser tab. No dependencies: just Node.js 18 or newer.

## Run

Hosted, it's a plain static site (see **Host it** below). To run it on your PC:

| Windows | Any OS |
|---|---|
| Double-click `start.bat` | `node server.js`, then open http://localhost:3000 |

| Setting | How |
|---|---|
| Another port | `set PORT=8080` (cmd) / `PORT=8080 node server.js`. Setting PORT also opens the app to your network (hosts like Render need that). Add `HOST=127.0.0.1` to keep it to this PC only. |
| Open from your phone or another PC on your network | `HOST=0.0.0.0 node server.js`, then `http://<this-pc-ip>:3000`. Live chat may not load from a bare IP address, see below |
| Run tests | `npm test` |
| Rebuild the relay file after changing `public/ytcore.js` | `npm run build:worker` |

## Where the data comes from

Video and chat stream straight from YouTube to each viewer. Nothing hosted by you carries them.
Only two small lookups need help, because a web page can't read youtube.com itself: **search**, and **"what is @handle streaming now"**.

| Viewer is using | Lookups go through | Your cost / quota |
|---|---|---|
| **Android app** | The phone itself: the app downloads the YouTube page, the page reads it | None. Each phone uses its own connection |
| **Website** | The **relay**: a tiny Cloudflare Worker (`worker/`) | None (free plan) |
| Running `node server.js` on your PC | The server's own `/api` | None |
| Pasted video links (`watch?v=`, `youtu.be/`, IDs) | Nothing: read in the page | None |

All of these read YouTube's own pages, so there's no API key and no daily quota.
A separate **backup add-on** (Data API key) exists for emergencies only; it isn't part of this folder.

The parser is one file, `public/ytcore.js`, shared by the page, the Android path, the Worker and the server. When YouTube changes its pages, fix it there, then `npm run build:worker` and re-paste the Worker. The Android app picks the fix up from the website, no APK update needed.

## Host it (Render Static Site + Cloudflare Worker)

A Render **Static Site** is served from Render's CDN: no server runs, so nothing sleeps and there's no 30-second wake-up.

1. **Relay first:** follow `worker/README.md` (about 5 minutes). Put its address in `public/config.js` → `relayUrl`, and commit.
2. **Render:** **New → Static Site** → pick this repo.
   - Build command: leave blank (or `true`)
   - Publish directory: `public`
   - Create. Your site is at `https://<name>.onrender.com`.
   - Or **New → Blueprint**: `render.yaml` sets the same up (service name `multistream-site`).
3. Worker → Settings → Variables: `ALLOWED_ORIGINS` = your new site address.
4. **Android app:** in `app/build.gradle`, set `SITE_URL` to the new address, commit, and the Action builds the new APK.
5. Once the static site works, delete the old Render **web service** (it's the one that sleeps).

Every push to the repo redeploys the site.

## Search

Type words in the Add box (the button says **Search**) and press Enter. Results show **Live now** by default; switch to **All videos** for regular uploads.

- **+ Add** adds that exact stream. The list stays open so you can add several.
- **Follow** adds the channel instead: when its stream ends, its next one plays in the same spot.
- Links, `@handles` and IDs still add directly (the button says **Add**).
- Without a relay (and not in the app), search and @handles say they aren't set up; pasted video links still work.

## What you can paste

| Input | Behavior |
|---|---|
| `@handle`, a channel link, `/channel/UC…`, `/c/…`, `/user/…` | **Follows the channel.** Plays whatever it's streaming. If it's offline, the tile waits and checks every minute. When a stream ends, it picks up the next one. |
| `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/live/…`, `/embed/…`, `/shorts/…`, an 11-character ID | Plays that exact video or stream |

Paste several at once, separated by commas or spaces. Up to 16 streams.

## Controls

| Action | How |
|---|---|
| Give a stream the sound (Solo) | Click it, or press `1`–`9` |
| Set each stream's volume | Switch to **Mix**. Each tile gets a slider and a mute button |
| Mute everything | `M` or the speaker button |
| Pause or play everything | `Space` |
| One big stream, the rest beside it | **Focus** or `F`. Use ⤢ on a tile to make it the big one |
| Reorder | Drag a tile by its name onto another (phones: ⋯ → Move up / down) |
| Remove | ✕ (phones: ⋯ → Remove). **Undo** appears for a few seconds |
| Live chat | 💬 on a stream opens **that stream's chat** in a full-height column on the right. 1–2 chats stack; 3 or more become tabs, so each chat always gets the whole column. Drag the column's left edge to resize it. `C` or the toolbar 💬 shows/hides every chat. ↗ pops a chat into its own window. Pointing at a chat outlines its stream. On phones a chat opens under its video, most of the screen tall |
| Full screen one stream | Double-click it |
| Share the set | 🔗 copies a link that opens the same streams |
| YouTube account for chat | 👤 in the toolbar, the ☰ menu or any chat header. **Signed in**: chats use your YouTube login (type, badges). **Signed out**: chats never show your account. **Sign in to YouTube** opens Google's sign-in, then reloads the chats. In the Android app, **Sign out** clears the app's YouTube login |

Your streams, audio mode, layout and data setting are remembered in this browser.

## Data use

Pick **Full / Saver / Min** in the toolbar.

| Setting | What plays | Rough data per hour [LOW CONFIDENCE] |
|---|---|---|
| **Full** | Every stream, at the quality YouTube picks for its tile size | ~0.5–3 GB per stream |
| **Saver** | Every stream at low quality (~240p), the one with sound at ~360p. When the tab is in the background, only the one with sound keeps playing | ~0.3 GB for the one with sound + ~0.15 GB per other stream |
| **Min** | Only the stream with sound (~360p). The others show a still picture that updates each minute; click one to switch to it | ~0.3 GB total |

- If the browser's own Data Saver / Lite mode is on, the first visit starts in **Saver**.
- The app itself is about 60 KB, sent compressed (about 20 KB). Repeat visits only check that the files haven't changed.
- Chat costs little (text plus small images).

**YouTube's own player controls work too.** Mute or change volume inside a stream's player and the app follows it instead of undoing it. In Solo, unmuting a stream in its own player gives it the sound.

**Stream buttons** show only while you're using a stream (mouse moving over it, or a tap on phones) and fade after a couple of seconds. Each stream's name stays in a small label; 🔊 next to it marks the one you're hearing.

**Phones**
- One slim top bar: **+ Add**, a mute-all button and **☰** (sound mode, data use, layout, pause, chats, share, help).
- Streams stack full width in a scrolling list. Chat opens under its video.
- Tap a stream to show its buttons (tap again to hide). In Solo, that tap also gives it the sound; in Mix it never changes the sound.
- ⋯ on a stream: sound, chat, big-one, move up/down, full screen, reload, open on YouTube, remove (with Undo).
- **Add to Home Screen** installs it like an app (full screen, its own icon).

## How it works

- `public/` is the whole website. It uses YouTube's official IFrame Player API, one player per tile. Tiles are positioned absolutely and never moved in the page, so changing the layout or order never restarts a stream.
- `public/ytcore.js` reads YouTube's pages: a channel's `/live` page (is it live, which video) and search results. Lookups are cached (channels 45 s, searches 2 min).
- `public/config.js` holds the relay address.
- `worker/` is the relay. `server.js` + `lib/` are for running it on your PC.

## Limits

- **Sound:** browsers start new pages muted. Click the page once and the chosen stream's sound comes on (a banner reminds you).
- **Embedding:** some streams have embedding turned off by their owner. Those tiles show **Open on YouTube**.
- **Live chat:** YouTube only serves embedded chat to the site named in the request (the app fills in its own address), and only for streams that are live or have chat replay. It works on `localhost` and on a real domain such as your Render link. It may not load from a bare IP address like `192.168.x.x`.
- **Chat sign-in (website):** embedded chat sees your YouTube login only if the browser allows third-party cookies for this site. If it shows signed out anyway, use ↗ (pop-out is always signed in). **Signed out** mode uses `credentialless` frames: Chrome/Edge only; other browsers ignore it. [LOW CONFIDENCE] on Google allowing sign-in inside the Android app's WebView; if it refuses, use ↗ to open chat in your browser.
- **Search and channel lookup** read YouTube's public pages (as ReVanced/NewPipe-style apps do). If YouTube changes them, lookups can break until `public/ytcore.js` is fixed; pasted video links keep working. YouTube's Terms of Service don't cover reading its pages this way. YouTube may also slow down or challenge the shared relay if it sees heavy traffic from it [LOW CONFIDENCE]; the Android app isn't affected (each phone is separate).
- **iPhone/iPad:** iOS may limit how many videos play with sound at once, and element full screen isn't available there (the menu hides it). [LOW CONFIDENCE] on the exact iOS limits.
- **Data saver quality:** Saver works by making each YouTube player small (YouTube picks quality from player size) and scaling it up on screen. [LOW CONFIDENCE] on the exact quality YouTube picks, especially on high-resolution phone screens. **Min** is the guaranteed saver: the other streams really stop.
