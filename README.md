# CineMoy

A compact movie & series streaming app:

- **Catalog**: Cinemeta (the same catalog Stremio uses): popular movies/series, genres, search, episodes.
- **Streams**: Torrentio (any configuration: quality filters, sorting, Real-Debrid/AllDebrid/Premiumize).
- **Torrent engine**: built in (WebTorrent). Plays while downloading, with seeking.
- **Farsi subtitles**: searched automatically from OpenSubtitles (no key needed) and SubDL (free key; it holds the old Subscene archive),
  plus any extra Stremio subtitle addon. Encoding is fixed automatically (Windows-1256 → UTF-8), Arabic ي/ك are converted to Persian ی/ک,
  and lines render right-to-left. Shown in the player's **Subtitles** menu with sync (±0.5s) and size controls, or load your own `.srt`/`.zip`.
- **One UI for every screen**: mouse/touch on desktop & phone, arrow keys / remote (D-pad) on TVs.
- Continue watching, auto-play next episode (same release group), audio-track switching, optional ffmpeg compatibility mode.

```
 ┌──────────── UI (web/) ────────────┐        ┌──────────── server/ (Node) ─────────────┐
 │ Windows (Electron) · browser · TV │ ─HTTP→ │ Cinemeta · Torrentio · subtitles · torrent│
 └───────────────────────────────────┘        │ engine → HTTP video stream · ffmpeg (opt.)│
                                              └──────────────────────────────────────────┘
```

Torrents can't run inside a browser or TV (they need raw TCP/UDP), so the **server** is the engine. On Windows the
desktop app runs it for you. For TVs and phones, run it on any PC/NAS in the house and open its address.

## Run

Requires Node.js 18+.

```bash
npm install
```

**Windows desktop app**

```bash
npm run desktop
```

Build an installer and a portable `.exe` (output in `dist/`):

```bash
npm run build:win
```

**Web / TV server**

```bash
npm start
```

It prints addresses like `http://192.168.1.20:7070`. Open that on a phone, a TV browser, or another PC on the same network.
The Windows desktop app also listens on the network, so while it is open your TV can use it the same way.

**Docker (NAS / Raspberry Pi / always-on PC)**

```bash
docker build -t cinemoy . && docker run -d --network host --restart unless-stopped cinemoy
```

## TV platforms

The UI has no build step and is fully remote-controllable (arrows, OK, Back, Play/Pause, FF/RW).

| Platform | How |
|---|---|
| **Android TV / Google TV / Fire TV** | Easiest: open the server address in a TV browser. For an app icon, wrap `http://<server>:7070` in a WebView/TWA app (e.g. [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or a minimal Capacitor app). |
| **LG webOS** | Package as a *hosted web app* whose `appinfo.json` `main` points to `http://<server>:7070`. Back key (461) is handled. |
| **Samsung Tizen** | Package as a hosted web app with Tizen Studio pointing to the server URL. Back (10009) and media keys are registered. |

Requires a modern TV web engine (roughly 2021+ models; Chromium 89+). If the UI is packaged *inside* a TV app instead of loaded
from the server, set **Settings → Server address**.

## Settings (⚙)

- **Torrentio addon URL**: paste your configured link from <https://torrentio.strem.fun/configure>. Both
  `stremio://torrentio.strem.fun/…/manifest.json` and `https://…` work. With a debrid service, streams are instant and need no torrenting.
- **SubDL API key**: free at <https://subdl.com/panel/api>. Strongly recommended: by far the most Farsi subtitles.
- **Subtitle languages**, auto-enable best Farsi subtitle, extra subtitle addons, server address.

## Video codecs

Browsers and TVs play H.264/VP9/AV1 video with AAC/MP3/Opus audio. Many torrents are **HEVC (x265)**, **10-bit**, or have
**AC3/DTS** audio, which won't play (or will play without sound). Two options:

1. Pick x264 sources (sources the device probably can't decode are marked *may not play*).
2. Install **ffmpeg** on the server (`winget install ffmpeg` on Windows; included in the Docker image). The app then detects
   unsupported files and converts them on the fly, and lets you switch audio tracks (e.g. a Farsi dub inside a dual-audio file).

## Project layout

```
server/index.js      HTTP API + static UI
server/addons.js     Cinemeta + Torrentio (Stremio addon protocol)
assets/              original logo; web/logo.svg + web/icon*.{svg,png} + build/icon.png are generated from it
server/subtitles.js  subtitle providers, download, unzip, encoding fix, SRT/VTT/ASS parsing
server/torrent.js    WebTorrent engine → ranged HTTP video streams
server/transcode.js  optional ffmpeg probe / transcode
web/                 single-page UI (no build step)
electron/main.cjs    Windows desktop wrapper
```

**Adding a subtitle source:** write an async function in `server/subtitles.js` that returns
`{ provider, lang, label, ref: register({ url, lang }) }` items, then add it to `search()`.

## Notes

- Subscene shut down in 2024; its Farsi archive lives on at SubDL, which is why SubDL is the main Farsi source.
- The server has no login. Run it only on your home network, not exposed to the internet.
- Torrent cache lives in the system temp folder and is cleared on start/exit; idle torrents are dropped after 5 minutes.
- What you stream is your responsibility: only watch content you have the right to access in your country.
