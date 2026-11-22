---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: ["web/app.css","web/app.js","web/settings.js"]
---

## Scope

The JhemsStream main window (web/index.html, app.css, app.js, settings.js and its dialogs): the operator console a 2-3 person student crew uses for six hours to run an esports Facebook Live. Mode: Operate.

## Audience and task

Jhems (director) plus helpers on the same or other laptops: pick the next scene, transition it to Program, keep audio and music flowing, update scores, go live.

## Direction contract

THESIS: A sibling of OBS Studio: the same dark docked workspace, Studio Mode on top and docks below, so anyone who has seen OBS knows where everything is. It refuses both the generic dark neon dashboard and a decorated themed skin; the user rejected the fiesta world as too stylized.

OWN-WORLD: Yami-like greys (window #1D1F26, docks #272A33, dock titles #2B2E38, controls #3B3E49, borders #3A3D48), white text, OBS blue #284CB8 for checked and primary controls, green Preview and red Program tallies, red only for live and recording. A matching light theme and a compact density. System UI font (Segoe UI), 13px base, 4px radius, flat surfaces, no shadows except floating toasts and dialogs.

STORY: The operator sees Preview (next) and Program (live) side by side, presses Transition or drags the T-bar, watches the progress segments fill under Program, then works the docks: Scenes, Audio Mixer, Music, Scores and Stream key, Controls. Settings opens a searchable two-pane window with switches, segmented controls and selects.

FIRST VIEWPORT: Menu bar (name, quick links, role, Help, Settings). Studio Mode row sized to fit above the docks: Preview | transition column (Transition, Cut, T-bar, transition select, duration) | Program. Docks row: Scenes list with thumbnails, Audio Mixer, Music queue, tabbed Scores / Stream key / Checklist / Log, Controls (Start streaming, Start recording, Studio Mode, Settings). Status bar with connection, LIVE time, dropped frames, bitrate, CPU, FPS.

FORM: seed: none (pinned) "make sure it looks something like OBS or exactly like OBS but a sibling version of it". Signature move: Studio Mode with a draggable T-bar and transition progress segments under Program.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
