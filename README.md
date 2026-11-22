# LiveDesk

A simple control panel for OBS, built for volunteer crews running a livestream: school org events, esports tournaments, church streams.

OBS does the video and sends it to Facebook (or YouTube, or Twitch). LiveDesk gives your team big, clear buttons to run the show without learning OBS.

## Features

- **Preview → TAKE** switching with live thumbnails of every screen, like a real broadcast switcher. Number keys 1–9 pick a screen, Space takes it live, C cuts.
- **Instant mode** for one-click switching when you don't need a preview.
- **Transitions**: pick any transition set up in OBS (Fade, Swipe, Slide, Luma Wipe, Stinger) and set its duration.
- **+ New screen**: add a monitor, a window, a game, a camera or capture card, a web overlay, or a video or image file. LiveDesk scales it to fit, or puts it in a corner as a facecam.
- **Starter screens** in one click: Starting Soon, Main Game with a scoreboard, Casters, Break, Ending. Safe to run twice.
- **Scoreboard**: team names, +/− scores, swap sides.
- **Audio mixer**: live level meters, mute, and volume for every source.
- **Facebook Live**: paste the stream key and send it to OBS. The key is never saved by LiveDesk.
- **Health bar**: bitrate, dropped frames, FPS, and CPU, with color warnings.
- **Pre-show checklist** and a **step-by-step guide** for first-time volunteers.
- **Volunteer mode** hides Go Live, End Stream, the stream key, and delete buttons.
- One HTML file and one vendored library. No install, no build, no internet needed.

## Quick start

1. Install [OBS Studio](https://obsproject.com) 28 or newer.
2. In OBS: **Tools → WebSocket Server Settings** → tick **Enable WebSocket server** → **Show Connect Info**. Keep that window open.
3. Download this repo (Code → Download ZIP) and unzip it.
4. Double-click `index.html`. It opens in your browser.
5. Enter `localhost`, port `4455`, and the password from step 2. Press **Connect**.

### Control from another laptop

Copy the LiveDesk folder to the other laptop. Make sure both machines are on the same network. Open `index.html` there and enter the **Server IP** from OBS's Connect Info instead of `localhost`. Windows may ask to allow OBS through the firewall. Allow it on private networks.

## Going live on Facebook

1. Open [Facebook Live Producer](https://www.facebook.com/live/producer). Post as your Page and choose **Streaming software**.
2. Copy the **Stream key**. In LiveDesk, open the **Facebook** tab, paste the key, and press **Send to OBS**.
3. Put **Starting Soon** live, then press **GO LIVE** in LiveDesk.
4. When Facebook shows your preview, press **Go live** in Facebook too.

Do a private test first by setting the Facebook audience to **Only me**.

## Adding fancier transitions

The OBS WebSocket API can choose transitions but can't create them. Add a transition once in OBS: find the **Scene Transitions** dock, press **+**, then pick Swipe, Slide, Luma Wipe, or **Stinger** (an animated video wipe, often a team or event logo). It appears in LiveDesk right away.

## How it works

LiveDesk talks to OBS through [obs-websocket](https://github.com/obsproject/obs-websocket), which is built into OBS 28+. It uses the [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) client, vendored in `vendor/` so it works offline.

## License

MIT
