# JhemsStream handoff

For any AI model or agent picking this project up (MausBot, Codex, Gemini, Claude). Read this, then `PRODUCT.md`, then the code. The full Claude Code chat that built it is in `.claude-chat/` (see the end).

## What it is

A Windows desktop companion for OBS Studio, built for Jhems's student org esports Facebook Live (event: 2026-11-23, 12pm to 6pm). It looks like a sibling of OBS (dark Yami-style docks) and lets a 2-3 person crew run the stream: Studio Mode switching, scenes, audio mixer, music queue, scores, stream key, quality presets.

- Repo: https://github.com/jherobred/JhemsStream (public, MIT)
- Releases: every release ships `JhemsStream_<ver>_x64-setup.exe`. The app updates itself from GitHub (Tauri updater, signed).

## Layout

| Path | What |
|---|---|
| `web/index.html` | Markup: menu bar, Studio Mode row, docks, status bar, Settings and Help dialogs |
| `web/app.css` | All tokens (light-dark), OBS-sibling styles, compact view, settings window |
| `web/app.js` | Core: OBS connection, scenes, thumbnails, transitions, T-bar, stream/record, health, mixer and audio tools, ducking, per-scene music levels, scoreboard, starter scenes, checklist, roles, hotkeys, onboarding. Exposes `window.JS` |
| `web/music.js` | Music engine: queue of file / YouTube / Spotify items, two decks with equal-power crossfades (Web Audio for files, YouTube IFrame API volume ramps), ducking bus, other-app fading, copyright tagging |
| `web/musicui.js`, `web/music.css` | Music dock UI |
| `web/settings.js` | Settings window (sections + search). Theme via `<meta name="color-scheme">`, compact view |
| `web/quality.js` | Stream quality presets and fields (OBS Simple output: VBitrate, ABitrate, StreamEncoder; SetVideoSettings for resolution/fps) |
| `web/editor.js` | New-scene wizard (incl. Discord screen share), scene editor, layout canvas, Discord auto-fit crop |
| `web/setup.js` | OBS auto-setup flow, manual connect, quick links, updater button |
| `web/vendor/obs-ws.global.js` | obs-websocket-js 5.0.6 (vendored, works offline) |
| `src-tauri/src/main.rs` | Rust commands: obs_info, obs_launch, obs_setup, obs_install (winget), list_audio, read_audio, app_audio_list, app_audio_set (Windows per-app volume), media_key, gpu_names |
| `scripts/release.ps1` | Build, sign and (with `-Publish`) create the GitHub release with exe, .sig and latest.json |
| `PRODUCT.md`, `.impeccable/` | Product truth and the design direction contract (OBS sibling, pinned by the user) |

## Build and release

```powershell
npm install
npm run dev                       # run the desktop app
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Publish -Notes "what changed"
```

- Bump the version in three places first: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`.
- Updater signing key: `C:\Users\J30N\.tauri\jhemsstream.key` (never commit it). Its password is literally two double-quote characters. Losing it breaks auto-updates for everyone.
- `latest.json` must have no UTF-8 BOM (the script handles it).
- The machine PATH has a broken entry; the script prepends `~/.cargo/bin`.
- Commits: plain messages, no co-author trailer (Jhems's rule).

## Testing tricks

- Browser preview: `python -m http.server 8771 --bind 127.0.0.1 --directory web`, connect with the OBS WebSocket password (OBS > Tools > WebSocket Server Settings > Show Connect Info).
- Real app over DevTools: start `src-tauri\target\release\jhemsstream.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, then drive it with Chrome DevTools Protocol (`Runtime.evaluate`, `Page.captureScreenshot`).
- Never call StartStream in tests (it would go live on the org's Page).

## Known limits

- Spotify has no playback API: Spotify items open in the Spotify app; JhemsStream fades that app's volume.
- YouTube pre-listen can't be routed to headphones (iframes always play on the default device, which OBS Desktop Audio captures).
- Copyright tags are estimates from file tags and channel names. Facebook decides what gets muted.
- obs-websocket can't create transitions; the desktop app adds Swipe, Slide and Luma Wipe by editing the scene collection while OBS is closed (it makes a backup first).

## Chat history

`.claude-chat/` holds the Claude Code transcript (`.jsonl`, one JSON event per line) of the session that built v0.1 to v0.2.x, plus a zip export. It is gitignored because it is large and contains local paths.
