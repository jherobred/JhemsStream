"use strict";
/* JhemsStream stingers: video transitions that run live without restarting OBS.
   One media source sits on top of both the current and the target scene. It starts on Program,
   OBS cuts at the stinger's cut point, and because it is the same source in both scenes it keeps
   playing across the cut and covers it. Audio: none, the video's own, or a separate file/YouTube/Spotify. */
(() => {
  const { obs, S, call, h, $, store, toast } = window.JS;
  const T = window.__TAURI__;
  const AUDIO_IN = "JS Stinger Audio";
  const CUT_LEAD_MS = 40;
  let stingers = store.get("stingers", []);           // the user's own
  let overrides = store.get("stingerOverrides", {});  // edits to built-ins
  let builtins = [];
  let selected = store.get("stingerSel", null);
  let running = false;

  const all = () => [...builtins.map(b => ({ ...b, ...(overrides[b.id] || {}), builtin: true })), ...stingers];
  const byId = id => all().find(s => s.id === id);
  const inputOf = s => `JS Stinger: ${s.name}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const save = () => { store.set("stingers", stingers); store.set("stingerOverrides", overrides); };
  function patch(s, fields) {
    if (s.builtin) overrides[s.id] = { ...(overrides[s.id] || {}), ...fields };
    else Object.assign(stingers.find(x => x.id === s.id) || {}, fields);
    save();
  }
  /* resolves with {data, t} for the first matching OBS event, or null after the timeout */
  function waitEvent(name, pred, timeout) {
    return new Promise(res => {
      const f = d => { if (pred(d)) { clearTimeout(tm); obs.off(name, f); res({ data: d, t: performance.now() }); } };
      const tm = setTimeout(() => { obs.off(name, f); res(null); }, Math.max(0, timeout));
      obs.on(name, f);
    });
  }

  /* ---------- OBS objects ---------- */
  async function hasInput(name) { return (await call("GetInputList")).inputs.some(i => i.inputName === name); }
  async function ensureInput(s) {
    const name = inputOf(s);
    const settings = { local_file: s.file, is_local_file: true, looping: false, restart_on_activate: false, close_when_inactive: false, hw_decode: true };
    if (!(await hasInput(name))) await call("CreateInput", { sceneName: S.program, inputName: name, inputKind: "ffmpeg_source", inputSettings: settings, sceneItemEnabled: false });
    else await call("SetInputSettings", { inputName: name, inputSettings: settings });
    await call("SetInputMute", { inputName: name, inputMuted: s.audio !== "own" });
    return name;
  }
  async function ensureAudioInput(path, volume) {
    const settings = { local_file: path, is_local_file: true, looping: false, restart_on_activate: false, close_when_inactive: false };
    if (!(await hasInput(AUDIO_IN))) await call("CreateInput", { sceneName: S.program, inputName: AUDIO_IN, inputKind: "ffmpeg_source", inputSettings: settings, sceneItemEnabled: false });
    else await call("SetInputSettings", { inputName: AUDIO_IN, inputSettings: settings });
    await call("SetInputVolume", { inputName: AUDIO_IN, inputVolumeMul: Math.max(0, Math.min(1, (volume ?? 100) / 100)) });
    await call("SetInputMute", { inputName: AUDIO_IN, inputMuted: false });
  }
  /* the item exists in the scene, sits on top, fills the canvas, and stays hidden until a run */
  async function ensureItem(scene, source, fit) {
    let id;
    try { id = (await obs.call("GetSceneItemId", { sceneName: scene, sourceName: source })).sceneItemId; }
    catch {
      id = (await call("CreateSceneItem", { sceneName: scene, sourceName: source, sceneItemEnabled: false })).sceneItemId;
      if (fit) await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: {
        boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: S.canvas.w, boundsHeight: S.canvas.h, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } });
    }
    const n = (await call("GetSceneItemList", { sceneName: scene })).sceneItems.length;
    await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: n - 1 });
    return id;
  }
  const show = (scene, id, on) => call("SetSceneItemEnabled", { sceneName: scene, sceneItemId: id, sceneItemEnabled: on });
  const media = (inputName, a) => call("TriggerMediaInputAction", { inputName, mediaAction: `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${a}` });
  async function durationOf(input) {
    try { return (await obs.call("GetMediaInputStatus", { inputName: input })).mediaDuration || null; } catch { return null; }
  }
  async function cutName() {
    const t = (await call("GetSceneTransitionList")).transitions.find(x => x.transitionKind === "cut_transition");
    return t ? t.transitionName : "Cut";
  }

  /* ---------- separate sound from YouTube ---------- */
  let ytP = null;
  function ytPlayer() {
    if (ytP) return ytP;
    ytP = new Promise((res, rej) => {
      const make = () => {
        const host = h("div", { class: "trans-yt", "aria-hidden": "true" }), inner = h("div"); host.append(inner); document.body.append(host);
        const p = new YT.Player(inner, { width: 200, height: 200, playerVars: { autoplay: 0, controls: 0, playsinline: 1 },
          events: { onReady: () => res(p), onError: e => toast(`YouTube sound for the transition failed (error ${e.data}).`, "warn") } });
      };
      if (window.YT?.Player) return make();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); make(); };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api";
        sc.onerror = () => { ytP = null; rej(new Error("YouTube couldn't load")); }; document.head.append(sc);
      }
    });
    return ytP;
  }
  // music.js declares `const Music` at top level: a global binding, not a window property
  const M = () => (typeof Music !== "undefined" ? Music : null);
  const parse = url => M()?.parseUrl?.(url) || null;

  /* load a stinger's YouTube sound ahead of time so it starts the instant the transition does */
  let ytCued = null;
  async function precue(s) {
    if (s?.audio !== "separate" || s.sep?.kind !== "youtube") return;
    const p = parse(s.sep.url); if (p?.kind !== "yt") return;
    const start = +s.sep.startSec || 0, key = `${p.vid}@${start}`;
    if (ytCued === key) return;
    try { (await ytPlayer()).cueVideoById({ videoId: p.vid, startSeconds: start }); ytCued = key; } catch {}
  }

  /* start the stinger's separate sound; returns a stop function */
  async function startSound(s) {
    const sep = s.sep || {};
    if (s.audio !== "separate") return () => {};
    if (sep.kind === "youtube") {
      const p = parse(sep.url);
      if (!p || p.kind !== "yt") { toast("The transition's YouTube link isn't a video link.", "warn"); return () => {}; }
      try {
        const pl = await ytPlayer(), start = +sep.startSec || 0, key = `${p.vid}@${start}`;
        pl.setVolume(sep.volume ?? 80);
        // a pre-cued video starts at once; loading on demand takes a second or more
        if (ytCued === key) { pl.seekTo(start, true); pl.playVideo(); } else pl.loadVideoById({ videoId: p.vid, startSeconds: start });
        return () => { try { pl.pauseVideo(); pl.cueVideoById({ videoId: p.vid, startSeconds: start }); ytCued = key; } catch {} };
      } catch (e) { toast(e.message, "warn"); return () => {}; }
    }
    if (sep.kind === "spotify") {
      const p = parse(sep.url);
      if (p?.uri) JS.openExt(p.uri);
      return () => {};
    }
    return () => {};
  }

  /* ---------- the run ---------- */
  async function run(id, target, opts = {}) {
    const s = byId(id);
    if (!s || running || !S.connected) return false;
    if (!s.file) { toast(`"${s.name}" has no video file.`, "warn"); return false; }
    const previewOnly = !!opts.previewOnly, from = S.program;
    if (!previewOnly && target === from) return false;
    running = true;
    try {
      const vin = await ensureInput(s);
      const scenes = previewOnly ? [target] : [from, target];
      const vids = {}, aids = {};
      for (const sc of scenes) vids[sc] = await ensureItem(sc, vin, true);
      const fileSound = s.audio === "separate" && s.sep?.kind === "file" && s.sep.path;
      if (fileSound) { await ensureAudioInput(s.sep.path, s.sep.volume); for (const sc of scenes) aids[sc] = await ensureItem(sc, AUDIO_IN, false); }
      const cutT = previewOnly ? null : await cutName();
      const prevTrans = previewOnly ? null : (await call("GetCurrentSceneTransition")).transitionName;
      if (!previewOnly && S.studio && S.preview !== target) await call("SetCurrentPreviewScene", { sceneName: target });

      const startScene = previewOnly ? target : from;
      await show(startScene, vids[startScene], true);
      if (fileSound) await show(startScene, aids[startScene], true);
      const duck = s.duckMusic !== false && M()?.setDuck;
      if (duck) M().setDuck(true, 0.3);
      const started = waitEvent("MediaInputPlaybackStarted", d => d.inputName === vin, 300);
      const t0 = performance.now();
      await media(vin, "RESTART");
      if (fileSound) await media(AUDIO_IN, "RESTART");
      const stopSound = await startSound(s);
      const ev = await started, base = ev ? ev.t : t0;
      let dur = s.durationMs || await durationOf(vin);
      if (dur && dur !== s.durationMs) patch(s, { durationMs: dur });
      let cutAt = s.cutPointMs ?? (dur ? Math.round(dur / 2) : 500);
      if (s.cutPointMs == null) patch(s, { cutPointMs: cutAt });
      JS.runTransitionProgress?.(cutAt);

      if (!previewOnly) {
        // everything but the switch happens before the wait, so the cut itself is one call
        await show(target, vids[target], true);
        if (fileSound) await show(target, aids[target], true);
        await call("SetCurrentSceneTransition", { transitionName: cutT });
        // ponytail: fixed lead for OBS applying the switch on its next frame; tune if cuts land late on slower PCs
        await sleep(Math.max(0, cutAt - CUT_LEAD_MS - (performance.now() - base)));
        if (S.studio) await call("TriggerStudioModeTransition");
        else await call("SetCurrentProgramScene", { sceneName: target });
        setTimeout(() => call("SetCurrentSceneTransition", { transitionName: prevTrans }).catch(() => {}), 150);
      }
      // clean up in the background so the operator gets control back right after the cut
      (async () => {
        const left = (dur || 4000) + 500 - (performance.now() - base);
        await waitEvent("MediaInputPlaybackEnded", d => d.inputName === vin, left);
        for (const sc of scenes) { await show(sc, vids[sc], false).catch(() => {}); if (fileSound) await show(sc, aids[sc], false).catch(() => {}); }
        await media(vin, "STOP").catch(() => {});
        if (fileSound) await media(AUDIO_IN, "STOP").catch(() => {});
        stopSound();
        if (duck) M().setDuck(false);
        running = false;
      })();
      return true;
    } catch (e) {
      running = false;
      toast(`Transition failed: ${e.message}`, "bad");
      return false;
    }
  }
  const toScene = (name, opts = {}) => run(opts.stingerId || selected, name);

  /* ---------- the Transition select ---------- */
  function decorate(sel) {
    if (!sel || sel.querySelector("optgroup.js-stingers")) return;
    const list = all(); if (!list.length) return;
    sel.append(h("optgroup", { label: "JhemsStream stingers", class: "js-stingers" }, ...list.map(s => h("option", { value: "js:" + s.id }, s.name))));
    if (selected && byId(selected)) sel.value = "js:" + selected;
  }
  const decorateAll = (force) => ["#selTrans", "#selTrans2"].forEach(q => { const s = $(q); if (!s) return; if (force) s.querySelector("optgroup.js-stingers")?.remove(); decorate(s); });
  // app.js rebuilds the options on every OBS transition event; put ours back each time
  ["#selTrans", "#selTrans2"].forEach(q => { const s = $(q); if (s) new MutationObserver(() => decorate(s)).observe(s, { childList: true }); });
  // runs before app.js's own change handler, which would send a stinger id to OBS
  document.addEventListener("change", e => {
    const t = e.target;
    if (!t.matches?.("#selTrans, #selTrans2")) return;
    if (t.value.startsWith("js:")) {
      e.stopImmediatePropagation();
      selected = t.value.slice(3);
      ["#selTrans", "#selTrans2"].forEach(q => { const s = $(q); if (s) s.value = t.value; });
      precue(byId(selected));
    } else selected = null;
    store.set("stingerSel", selected);
  }, true);

  /* ---------- built-ins shipped with the desktop app ---------- */
  async function loadBuiltins() {
    if (!T) return;
    try {
      const dir = String(await T.core.invoke("stinger_dir")).replace(/[\\/]+$/, "");
      let m = await T.core.invoke("stinger_manifest").catch(() => null);
      if (typeof m === "string") m = JSON.parse(m);
      const list = Array.isArray(m) ? m : (m?.stingers || []);
      const join = f => /^[a-z]:[\\/]|^\\\\/i.test(f) ? f : `${dir}\\${f}`;
      builtins = list.map(e => ({
        id: "builtin:" + e.file, name: e.name || e.file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), file: join(e.file),
        cutPointMs: e.cutPointMs ?? null, durationMs: e.durationMs ?? null,
        audio: e.sound ? "separate" : "none", sep: e.sound ? { kind: "file", path: join(e.sound), volume: 100 } : null, duckMusic: true,
      }));
      decorateAll(true);
    } catch { /* no bundled stingers in this build */ }
  }

  /* ---------- manager dialog ---------- */
  const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const AUDIO_TXT = { none: "No audio", own: "Audio from the video", separate: "Separate sound" };
  const base = p => String(p || "").split(/[\\/]/).pop();
  let dlg = null;

  function open() {
    dlg?.close();
    dlg = h("dialog", { class: "trans-dlg" });
    const body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, "Transitions"), h("button", { type: "button", class: "btn icon", "aria-label": "Close", onclick: () => dlg.close(), html: ICON_X })), body, foot);
    dlg.addEventListener("close", () => { dlg.remove(); dlg = null; });
    document.body.append(dlg);
    listView(body, foot);
    dlg.showModal();
  }

  async function listView(body, foot) {
    body.textContent = ""; foot.textContent = "";
    const obsBox = h("div", { class: "trans-list" }, h("p", { class: "muted small" }, "Loading OBS transitions"));
    body.append(h("h4", { class: "trans-sub" }, "OBS transitions"), obsBox,
      h("p", { class: "muted small" }, "More OBS styles, like Fade to Black and extra wipes, are added in Settings, OBS connection, Set up OBS again (OBS restarts)."));
    call("GetSceneTransitionList").then(r => {
      obsBox.textContent = "";
      for (const t of r.transitions) obsBox.append(h("div", { class: "trans-row" },
        h("div", { class: "grow" }, h("b", {}, t.transitionName), h("div", { class: "muted small" }, t.transitionKind.replace(/_transition$/, "").replace(/_/g, " "), t.transitionFixed ? ", fixed length" : "")),
        h("button", { type: "button", class: "btn small", onclick: () => useObs(t.transitionName) }, t.transitionName === r.currentSceneTransitionName && !selected ? "In use" : "Use")));
    }).catch(() => { obsBox.textContent = "Connect to OBS to see its transitions."; });

    const mine = h("div", { class: "trans-list" });
    body.append(h("h4", { class: "trans-sub" }, "JhemsStream stingers"), mine);
    const list = all();
    if (!list.length) mine.append(h("p", { class: "empty" }, "No stingers yet. A stinger is a short video that covers the screen while the scene changes. Add your own with Add stinger."));
    for (const s of list) {
      const inUse = selected === s.id;
      mine.append(h("div", { class: `trans-row${inUse ? " is-use" : ""}` },
        h("div", { class: "grow" },
          h("b", {}, s.name, s.builtin ? h("span", { class: "trans-tag" }, "Built in") : null),
          h("div", { class: "muted small" }, `${base(s.file)}, cuts at ${s.cutPointMs != null ? (s.cutPointMs / 1000).toFixed(2) + " s" : "half its length"}, ${AUDIO_TXT[s.audio] || "No audio"}`)),
        h("div", { class: "row trans-acts" },
          h("button", { type: "button", class: "btn small", onclick: () => { useStinger(s.id); listView(body, foot); } }, inUse ? "In use" : "Use"),
          h("button", { type: "button", class: "btn small", onclick: () => testOnPreview(s.id) }, "Test on Preview"),
          h("button", { type: "button", class: "btn small", onclick: () => formView(body, foot, s) }, "Edit"),
          s.builtin ? null : h("button", { type: "button", class: "btn small", "aria-label": `Delete ${s.name}`, onclick: () => remove(s, body, foot) }, "Delete"))));
    }
    foot.append(h("span", { class: "spacer" }), h("button", { type: "button", class: "btn primary", onclick: () => formView(body, foot, null) }, "Add stinger"));
  }

  function useObs(name) {
    selected = null; store.set("stingerSel", null);
    call("SetCurrentSceneTransition", { transitionName: name }).then(() => { ["#selTrans", "#selTrans2"].forEach(q => { const s = $(q); if (s) s.value = name; }); });
    dlg?.close();
  }
  function useStinger(id) {
    selected = id; store.set("stingerSel", id);
    decorateAll(true); precue(byId(id));
    ["#selTrans", "#selTrans2"].forEach(q => { const s = $(q); if (s) s.value = "js:" + id; });
  }
  function testOnPreview(id) {
    if (!S.studio) return toast("Turn on Studio Mode to test a stinger on Preview without going on air.", "warn");
    if (S.preview === S.program) return toast("Preview shows the on-air scene. Pick another scene for Preview first, so the test stays off air.", "warn");
    run(id, S.preview, { previewOnly: true });
  }
  async function remove(s, body, foot) {
    if (!confirm(`Delete the stinger "${s.name}"?`)) return;
    stingers = stingers.filter(x => x.id !== s.id); if (selected === s.id) selected = null; save(); store.set("stingerSel", selected);
    if (S.connected) await obs.call("RemoveInput", { inputName: inputOf(s) }).catch(() => {});
    decorateAll(true); listView(body, foot);
  }

  async function pickFile(filters) {
    if (!T?.dialog) return null;
    const p = await T.dialog.open({ multiple: false, filters });
    return Array.isArray(p) ? p[0] : p;
  }
  /* read a video's length through a short-lived probe input (hidden, removed right after) */
  async function probeDuration(path) {
    if (!S.connected || !path) return null;
    const name = `JS Stinger probe ${Date.now()}`;
    try {
      await call("CreateInput", { sceneName: S.program, inputName: name, inputKind: "ffmpeg_source", sceneItemEnabled: false,
        inputSettings: { local_file: path, is_local_file: true, close_when_inactive: false, restart_on_activate: false } });
      for (let i = 0; i < 10; i++) { await sleep(150); const d = await durationOf(name); if (d) return d; }
      return null;
    } catch { return null; } finally { obs.call("RemoveInput", { inputName: name }).catch(() => {}); }
  }

  function formView(body, foot, s) {
    const edit = !!s, cur = s ? { ...s, sep: { kind: "file", volume: 100, startSec: 0, ...(s.sep || {}) } } : { name: "", file: "", cutPointMs: null, audio: "own", sep: { kind: "file", path: "", url: "", startSec: 0, volume: 100 }, duckMusic: true };
    body.textContent = ""; foot.textContent = "";
    const err = h("p", { class: "err", role: "alert" });
    const name = h("input", { id: "stName", value: cur.name, autocomplete: "off", disabled: !!s?.builtin });
    const file = h("input", { id: "stFile", value: cur.file, autocomplete: "off", placeholder: "C:\\Videos\\stinger.webm", readonly: !!T || !!s?.builtin });
    const cut = h("input", { id: "stCut", type: "number", min: 0, step: 10, value: cur.cutPointMs ?? "" });
    const durTxt = h("span", { class: "muted small" }, cur.durationMs ? `Video length ${(cur.durationMs / 1000).toFixed(2)} s.` : "");
    const pickVideo = h("button", { type: "button", class: "btn small", disabled: !!s?.builtin, onclick: async () => {
      const p = await pickFile([{ name: "Video", extensions: ["webm", "mp4", "mov", "mkv"] }]); if (!p) return;
      file.value = p; if (!name.value) name.value = base(p).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      durTxt.textContent = "Reading the video length…";
      const d = await probeDuration(p); cur.durationMs = d;
      durTxt.textContent = d ? `Video length ${(d / 1000).toFixed(2)} s.` : "Couldn't read the length. Set the cut point yourself.";
      if (d && !cut.value) cut.value = Math.round(d / 2);
    } }, "Choose video");

    const radios = ["none", "own", "separate"].map(v => {
      const r = h("input", { type: "radio", name: "stAudio", value: v }); r.checked = cur.audio === v;
      r.addEventListener("change", () => sepBox.hidden = v !== "separate");
      return h("label", { class: "row trans-radio" }, r, AUDIO_TXT[v]);
    });
    const kind = h("select", { id: "stKind", "aria-label": "Sound source" },
      h("option", { value: "file" }, "Sound file"), h("option", { value: "youtube" }, "YouTube link"), h("option", { value: "spotify" }, "Spotify link"));
    kind.value = cur.sep.kind;
    const sPath = h("input", { id: "stSPath", value: cur.sep.path || "", readonly: !!T, placeholder: "C:\\Sounds\\whoosh.wav", autocomplete: "off" });
    const sUrl = h("input", { id: "stSUrl", value: cur.sep.url || "", placeholder: "https://www.youtube.com/watch?v=…", autocomplete: "off" });
    const sStart = h("input", { id: "stSStart", type: "number", min: 0, step: 0.5, value: cur.sep.startSec ?? 0 });
    const sVol = h("input", { id: "stSVol", type: "range", min: 0, max: 100, step: 1, value: cur.sep.volume ?? 100 });
    const pickSound = h("button", { type: "button", class: "btn small", onclick: async () => { const p = await pickFile([{ name: "Sound", extensions: ["wav", "mp3", "ogg", "m4a", "flac", "opus"] }]); if (p) sPath.value = p; } }, "Choose sound");
    const fileRow = h("div", { class: "field" }, h("label", { for: "stSPath" }, "Sound file"), h("div", { class: "row" }, sPath, T ? pickSound : null));
    const urlRow = h("div", { class: "field" }, h("label", { for: "stSUrl" }, "Link"), sUrl);
    const startRow = h("div", { class: "field" }, h("label", { for: "stSStart" }, "Start at (seconds)"), sStart);
    const spNote = h("p", { class: "tip" }, "Spotify opens in its own app, so its timing can't be exact. For a sound that lands on the cut, use a sound file or YouTube.");
    const syncKind = () => { fileRow.hidden = kind.value !== "file"; urlRow.hidden = kind.value === "file"; startRow.hidden = kind.value !== "youtube"; spNote.hidden = kind.value !== "spotify"; };
    kind.addEventListener("change", syncKind);
    const sepBox = h("div", { class: "trans-sep" },
      h("div", { class: "field" }, h("label", { for: "stKind" }, "Sound source"), kind), fileRow, urlRow, startRow,
      h("div", { class: "field" }, h("label", { for: "stSVol" }, "Volume"), sVol), spNote);
    sepBox.hidden = cur.audio !== "separate"; syncKind();
    const duck = h("input", { type: "checkbox", id: "stDuck" }); duck.checked = cur.duckMusic !== false;

    body.append(
      h("div", { class: "field" }, h("label", { for: "stName" }, "Name"), name),
      h("div", { class: "field" }, h("label", { for: "stFile" }, "Video"), h("div", { class: "row" }, file, T ? pickVideo : null)),
      T ? null : h("p", { class: "muted small" }, "Type the full path of the video on the streaming PC. WebM with a transparent background works best."),
      h("div", { class: "field" }, h("label", { for: "stCut" }, "Cut point (ms)"), cut,
        h("span", { class: "muted small" }, "The moment the video fully covers the screen, usually half its length. "), durTxt),
      h("fieldset", { class: "trans-audio" }, h("legend", {}, "Sound"), ...radios), sepBox,
      h("label", { class: "row trans-radio", for: "stDuck" }, duck, "Lower the music while the transition plays"), err);

    foot.append(h("button", { type: "button", class: "btn", onclick: () => listView(body, foot) }, "Back"), h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn primary", onclick: async () => {
        const audio = dlg.querySelector('input[name="stAudio"]:checked')?.value || "none";
        const n = name.value.trim(), f = file.value.trim().replace(/^"|"$/g, "");
        if (!n) return err.textContent = "Give the stinger a name.";
        if (!f) return err.textContent = "Choose the stinger video.";
        if (!s && all().some(x => x.name.toLowerCase() === n.toLowerCase())) return err.textContent = "A stinger with that name already exists.";
        const sep = { kind: kind.value, path: sPath.value.trim().replace(/^"|"$/g, ""), url: sUrl.value.trim(), startSec: +sStart.value || 0, volume: +sVol.value };
        if (audio === "separate") {
          if (sep.kind === "file" && !sep.path) return err.textContent = "Choose the sound file.";
          if (sep.kind === "youtube" && parse(sep.url)?.kind !== "yt") return err.textContent = "That isn't a YouTube video link.";
          if (sep.kind === "spotify" && parse(sep.url)?.kind !== "sp") return err.textContent = "That isn't a Spotify link.";
        }
        const fields = { file: f, cutPointMs: cut.value === "" ? null : Math.max(0, Math.round(+cut.value)), audio, sep: audio === "separate" ? sep : null, duckMusic: duck.checked, durationMs: cur.durationMs ?? null };
        if (s?.builtin) patch(s, fields);
        else if (s) {
          if (n !== s.name && S.connected) await obs.call("SetInputName", { inputName: inputOf(s), newInputName: `JS Stinger: ${n}` }).catch(() => {});
          patch(s, { ...fields, name: n });
        } else { stingers.push({ id: Math.random().toString(36).slice(2, 10), name: n, ...fields }); save(); }
        // keep the OBS source in step with the edit (file and mute state)
        const fresh = byId(s ? s.id : stingers[stingers.length - 1].id);
        if (S.connected && await hasInput(inputOf(fresh)).catch(() => false)) await ensureInput(fresh).catch(() => {});
        if (selected === fresh.id) precue(fresh);
        decorateAll(true); listView(body, foot);
      } }, edit ? "Save" : "Add stinger"));
  }

  $("#btnTransManage")?.addEventListener("click", open);
  JS.onReady(async () => { decorateAll(true); await loadBuiltins(); if (selected) precue(byId(selected)); });

  window.Transitions = {
    isCustom: () => !!(selected && byId(selected) && S.connected),
    toScene, run, open, get list() { return all(); }, get selected() { return selected; },
    soundPlayer: () => ytP, // the YouTube player used for transition sounds, if one was made
  };
})();
