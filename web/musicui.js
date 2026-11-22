"use strict";
/* Music dock: now playing, the add box, the queue, mix controls. Runs on the music PC or relays to it. */
(() => {
  const { h, $, $$, store, toast, obs, S } = window.JS;
  const TAURI = window.__TAURI__;
  const st = Music.st;
  // the PC next to OBS plays the music; other laptops send commands to it through OBS
  const isHost = () => S.isLocal;
  const fmtTime = s => !isFinite(s) || s < 0 ? "0:00" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const SRC = { file: "File", yt: "YouTube", sp: "Spotify" };
  const TAG = { copyrighted: "Likely copyrighted", free: "Royalty-free source", unknown: "Unknown source" };
  const svg = d => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = { play: '<path d="M7 5v14l11-7z"/>', next: '<path d="M4 6h10M4 12h10M4 18h6M17 14v7M14 18l3 3 3-3"/>',
               up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
               cue: '<path d="M3 14v-2a9 9 0 0 1 18 0v2M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/>' };
  // cue times keep tenths when set that finely
  const fmtCue = s => { if (!isFinite(s) || s < 0) return "0:00"; const t = Math.round(s * 10) / 10, m = Math.floor(t / 60), r = t - m * 60;
                        return `${m}:${String(Math.floor(r)).padStart(2, "0")}${r % 1 ? "." + Math.round((r % 1) * 10) : ""}`; };
  let openCue = null;               // id of the item whose cue panel is open
  const playhead = {};              // id -> where "Set start here" points when not pre-listening
  const iconBtn = (ic, label, fn, extra = "") => h("button", { type: "button", class: `btn small icon ${extra}`, "aria-label": label, title: label, html: svg(IC[ic]), onclick: fn });

  /* ---------- commands (local or relayed) ---------- */
  function cmd(c, arg) {
    if (!isHost()) { obs.call("BroadcastCustomEvent", { eventData: { jhs: 1, type: "music-cmd", cmd: c, arg } }).catch(() => {}); return; }
    const byId = id => st.queue.findIndex(q => q.id === id);
    if (c === "play") { const i = byId(arg); if (i >= 0) Music.play(i); }
    if (c === "toggle") Music.toggle();
    if (c === "next") Music.next();
    if (c === "prev") Music.prev();
    if (c === "fade") Music.fadeOut(3);
    if (c === "add") addLink(arg);
  }

  /* ---------- queue ---------- */
  function tagEl(item, id) {
    const t = item.tag || { level: "unknown", why: "" };
    return h("span", { class: `mtag mtag-${t.level}`, title: t.why, id }, TAG[t.level]);
  }
  function renderQueue() {
    const box = $("#queue"), focusKey = document.activeElement?.dataset?.qfocus;
    box.textContent = "";
    $("#qCount").textContent = st.queue.length === 1 ? "1 song" : `${st.queue.length} songs`;
    $("#qClear").hidden = !st.queue.length || !isHost();
    if (!isHost()) { box.append(h("li", { class: "q-empty" }, "The queue lives on the streaming PC. Links you add here go to its queue.")); return; }
    if (!st.queue.length) {
      box.append(h("li", { class: "q-empty" }, "The queue is empty. Paste a YouTube or Spotify link above, or add a music folder."));
      return;
    }
    st.queue.forEach((it, i) => {
      const cur = i === st.cur, whyId = `qwhy-${it.id}`;
      const notes = [SRC[it.kind]];
      if (it.author) notes.push(it.author);
      if (it.kind === "sp") notes.push("Plays in the Spotify app");
      const cueTxt = it.kind !== "sp" && (it.cueIn || it.cueOut != null) ? `Starts at ${fmtCue(it.cueIn || 0)}${it.cueOut != null ? `, ends at ${fmtCue(it.cueOut)}` : ""}` : null;
      if (cueTxt) notes.push(cueTxt);
      const cueBtn = it.kind === "sp"
        ? iconBtn("cue", "Spotify plays in its own app, so start and end points aren’t supported", () => toast("Spotify plays in its own app, so start and end points aren’t supported.", "warn"), "is-off")
        : iconBtn("cue", `${openCue === it.id ? "Close" : "Open"} cue for ${it.title}: start point, end point, pre-listen`, () => { openCue = openCue === it.id ? null : it.id; renderQueue(); });
      if (it.kind === "sp") cueBtn.setAttribute("aria-disabled", "true");
      if (openCue === it.id) cueBtn.setAttribute("aria-expanded", "true");
      const row = h("li", { class: `qrow${cur ? " current" : ""}${it.err ? " broken" : ""}`, "data-id": it.id, "aria-current": cur ? "true" : false, tabindex: "0",
                             title: "Press Enter to send this song to the stream" },
        h("span", { class: "q-num" }, cur && st.playing ? "Now" : String(i + 1)),
        h("div", { class: "q-main" },
          h("div", { class: "q-title" }, it.title || "Untitled"),
          h("div", { class: "q-sub" }, notes.join(", ")),
          h("div", { class: "q-tags" }, tagEl(it), it.err ? h("span", { class: "mtag mtag-err" }, it.err) : null,
            h("span", { class: "sr", id: whyId }, it.tag?.why || ""))),
        h("span", { class: "q-dur" }, it.duration ? fmtTime(it.duration) : ""),
        h("div", { class: "q-acts" },
          withKey(iconBtn("play", `Play ${it.title} now`, () => cmd("play", it.id)), `play-${it.id}`),
          withKey(cueBtn, `cue-${it.id}`),
          withKey(iconBtn("next", `Play ${it.title} next`, () => { Music.playNext(it.id); }), `next-${it.id}`),
          withKey(iconBtn("up", `Move ${it.title} up`, () => Music.move(it.id, -1)), `up-${it.id}`),
          withKey(iconBtn("down", `Move ${it.title} down`, () => Music.move(it.id, 1)), `down-${it.id}`),
          withKey(iconBtn("x", `Remove ${it.title}`, () => Music.remove(it.id)), `x-${it.id}`)));
      row.querySelector(".q-title").setAttribute("aria-describedby", whyId);
      row.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === row) { e.preventDefault(); send(it.id); } });
      if (openCue === it.id && it.kind !== "sp") row.append(cuePanel(it));
      box.append(row);
    });
    if (openCue && !st.queue.some(q => q.id === openCue)) openCue = null;
    if (focusKey) box.querySelector(`[data-qfocus="${CSS.escape(focusKey)}"]`)?.focus();
  }
  const withKey = (el, k) => { el.dataset.qfocus = k; return el; };

  /* ---------- cue panel: start point, end point, private pre-listen, send to stream ---------- */
  const idx = id => st.queue.findIndex(q => q.id === id);
  const listening = it => Music.cue.item === it;
  async function send(id) {
    const i = idx(id); if (i < 0) return;
    if (st.queue[i].err) return toast(`${st.queue[i].title} can’t play (${st.queue[i].err}).`, "warn");
    const r = cueRange(st.queue[i], st.queue[i].duration);
    await Music.sendToStream(i);
    toast(`Sent to the stream${r.start ? ` from ${fmtCue(r.start)}` : ""}, crossfading over ${st.xfade} s`);
  }
  function cuePanel(it) {
    const id = it.id, field = (cls, attrs) => h("input", { class: `cue-t ${cls}`, type: "text", autocomplete: "off", spellcheck: "false", ...attrs });
    const scrub = h("input", { type: "range", class: "cue-range", min: 0, step: 0.1, "aria-label": `Playhead in ${it.title}` });
    const startIn = field("cue-in", { "aria-label": "Start point, minutes and seconds", inputmode: "decimal" });
    const endIn = field("cue-out", { "aria-label": "End point, minutes and seconds. Empty plays to the end", placeholder: "Song end", inputmode: "decimal" });
    const listenBtn = h("button", { type: "button", class: "btn small cue-listen" }, "Pre-listen");
    const note = h("p", { class: "cue-note small", role: "status" });
    const setIn = v => { Music.setCue(id, { in: v }); if (listening(it)) Music.cueSeek(cueRange(it, it.duration).start); };
    const nudge = d => h("button", { type: "button", class: "btn small", "aria-label": `Move start ${d > 0 ? "later" : "earlier"} by ${Math.abs(d)} seconds`, onclick: () => setIn(cueRange(it, it.duration).start + d) }, `${d > 0 ? "+" : "−"}${Math.abs(d)} s`);
    const here = () => listening(it) ? Music.cueTime() : (playhead[id] ?? cueRange(it, it.duration).start);
    const typed = (inp, key) => inp.addEventListener("change", () => {
      const raw = inp.value.trim();
      if (key === "out" && !raw) return Music.setCue(id, { out: null });
      const t = parseClock(raw);
      if (!isFinite(t)) { toast("Type a time like 1:23 or 83.", "warn"); updatePanel(it); return; }
      key === "in" ? setIn(t) : Music.setCue(id, { out: t });
    });
    typed(startIn, "in"); typed(endIn, "out");
    scrub.addEventListener("input", () => { playhead[id] = +scrub.value; if (listening(it)) Music.cueSeek(+scrub.value); paintTime(it); });
    listenBtn.addEventListener("click", async () => {
      if (listening(it)) return Music.stopPrelisten();
      try { const chk = await Music.prelisten(idx(id), playhead[id]); note.textContent = chk.note || "Pre-listening in your headphones. Viewers don’t hear it."; note.className = `cue-note small${chk.note ? " warn" : ""}`; }
      catch (e) { note.textContent = e.message; note.className = "cue-note small bad"; }
    });
    return h("div", { class: "cue", "data-cue": id, role: "group", "aria-label": `Cue for ${it.title}` },
      h("div", { class: "cue-track" }, scrub, h("i", { class: "cue-mark in", "aria-hidden": "true" }), h("i", { class: "cue-mark out", "aria-hidden": "true" })),
      h("div", { class: "cue-now small", "aria-live": "off" }),
      h("div", { class: "cue-line" }, h("label", { class: "cue-lbl" }, "Start", startIn), nudge(-5), nudge(-1), nudge(1), nudge(5),
        h("button", { type: "button", class: "btn small", onclick: () => setIn(here()) }, "Set start here")),
      h("div", { class: "cue-line" }, h("label", { class: "cue-lbl" }, "End", endIn),
        h("button", { type: "button", class: "btn small", onclick: () => Music.setCue(id, { out: here() }) }, "Set end here"),
        h("button", { type: "button", class: "btn small", onclick: () => Music.setCue(id, { out: null }) }, "Play to the end")),
      h("div", { class: "cue-line" }, listenBtn,
        h("button", { type: "button", class: "btn small primary", onclick: () => send(id) }, "Send to stream")),
      note);
  }
  function paintTime(it) {
    const pane = $(`.cue[data-cue="${CSS.escape(it.id)}"]`); if (!pane) return;
    const t = listening(it) ? Music.cueTime() : (playhead[it.id] ?? cueRange(it, it.duration).start);
    pane.querySelector(".cue-now").textContent = `${listening(it) ? "Pre-listening at" : "Playhead"} ${fmtCue(t || 0)}${it.duration ? ` of ${fmtCue(it.duration)}` : ""}`;
    const sc = pane.querySelector(".cue-range");
    if (document.activeElement !== sc && t != null) sc.value = t;
  }
  async function updatePanel(it) {
    const pane = $(`.cue[data-cue="${CSS.escape(it.id)}"]`); if (!pane) return;
    const dur = it.duration || 0, r = cueRange(it, dur), sc = pane.querySelector(".cue-range");
    sc.max = dur || 0; sc.disabled = !dur;
    pane.style.setProperty("--cue-in", dur ? `${(r.start / dur) * 100}%` : "0%");
    pane.style.setProperty("--cue-out", dur && isFinite(r.end) ? `${(r.end / dur) * 100}%` : "100%");
    for (const [sel, v] of [[".cue-in", fmtCue(r.start)], [".cue-out", it.cueOut != null ? fmtCue(it.cueOut) : ""]]) {
      const inp = pane.querySelector(sel); if (document.activeElement !== inp) inp.value = v;
    }
    paintTime(it);
    const btn = pane.querySelector(".cue-listen"), note = pane.querySelector(".cue-note");
    btn.textContent = listening(it) ? "Stop pre-listen" : "Pre-listen";
    btn.classList.toggle("on", listening(it));
    if (listening(it)) return;
    const chk = await Music.canPrelisten(it);
    btn.disabled = !chk.ok; btn.title = chk.ok ? "Hear it from the start point" : chk.why;
    if (!note.classList.contains("bad")) { note.textContent = chk.ok ? (chk.note || (dur ? "" : "Pre-listen once to load the song length.")) : chk.why; note.className = `cue-note small${chk.ok && !chk.note ? "" : " warn"}`; }
  }
  const refreshCue = () => { const it = st.queue[idx(openCue)]; if (it) updatePanel(it); };

  /* ---------- cue output (headphones) ---------- */
  async function renderSinks(askForNames) {
    const sel = $("#cueSink"), note = $("#cueNote");
    if (!Music.cue.el.setSinkId || !navigator.mediaDevices?.enumerateDevices) { sel.disabled = true; note.textContent = "This browser can’t pick an output. Use the desktop app on the streaming PC for pre-listen."; return; }
    let devs;
    try { devs = await Music.listSinks(askForNames); }
    catch (e) { note.textContent = "Couldn’t read the audio devices: " + e.message; return; }
    sel.textContent = ""; sel.append(h("option", { value: "" }, "Choose your headphones"));
    let k = 0;
    for (const d of devs) {
      if (!d.deviceId || d.deviceId === "default" || d.deviceId === "communications") continue;
      sel.append(h("option", { value: d.deviceId }, d.label || `Output ${++k}`));
    }
    sel.value = Music.cue.sink; if (sel.value !== Music.cue.sink) sel.value = "";
    const unnamed = sel.options.length === 1 || [...sel.options].slice(1).every(o => /^Output \d+$/.test(o.textContent));
    if (Music.cue.sink && await Music.sinkMissing(Music.cue.sink)) note.textContent = "Your saved Cue output isn’t connected. Plug in your headphones or pick another output.";
    else if (!Music.cue.sink) note.textContent = unnamed ? "Windows hides device names until you allow it. Press Show device names, then pick your headphones." : "Pick your headphones to pre-listen to music files.";
    else if (await Music.isDefaultSink(Music.cue.sink)) note.textContent = "That’s your main speakers. OBS Desktop Audio records them, so pre-listen is off. Pick your headphones.";
    else note.textContent = "Pre-listen plays here. Viewers don’t hear it.";
    refreshCue();
  }
  $("#cueSink").addEventListener("change", e => { Music.setSink(e.target.value); renderSinks(false); });
  $("#cueNames").addEventListener("click", () => renderSinks(true));
  navigator.mediaDevices?.addEventListener?.("devicechange", () => renderSinks(false));
  renderSinks(false);

  /* ---------- adding ---------- */
  async function addLink(text) {
    const btn = $("#mAddBtn"); btn.disabled = true; btn.textContent = "Adding…";
    try {
      const p = Music.parseUrl(text);
      const n = await Music.addUrl(text);
      const added = st.queue.slice(-n), cr = added.filter(q => q.tag?.level === "copyrighted").length, bad = added.filter(q => q.err).length;
      toast(`${p?.kind === "ytlist" ? "Playlist added" : "Added"}: ${n} ${n === 1 ? "song" : "songs"}${cr ? `, ${cr} likely copyrighted` : ""}${bad ? `, ${bad} can't play outside YouTube` : ""}`, cr || bad ? "warn" : "ok");
      $("#mAddUrl").value = "";
    } catch (e) { toast(e.message, "bad"); }
    finally { btn.disabled = false; btn.textContent = "Add"; }
  }
  $("#mAddForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("#mAddUrl").value.trim(); if (!v) return;
    if (!Music.parseUrl(v)) return toast("That isn't a YouTube or Spotify link.", "warn");
    if (!isHost()) { cmd("add", v); $("#mAddUrl").value = ""; toast("Sent to the streaming PC"); return; }
    addLink(v);
  });
  async function addFolder() {
    if (!TAURI) return $("#mFiles").click();
    const dir = await TAURI.dialog.open({ directory: true, title: "Choose a music folder" });
    if (!dir) return;
    store.set("musicDir", dir);
    try {
      const tracks = await TAURI.core.invoke("list_audio", { dir });
      const n = Music.addFiles(tracks), cr = st.queue.slice(-n).filter(q => q.tag.level === "copyrighted").length;
      toast(`${n} songs added${cr ? `, ${cr} likely copyrighted` : ""}`, cr ? "warn" : "ok");
    } catch (e) { toast("Couldn't read that folder: " + e, "bad"); }
  }
  $("#mFolder").addEventListener("click", addFolder);
  $("#mFiles").addEventListener("change", e => {
    const n = Music.addFiles([...e.target.files].map(f => ({ file: f, title: f.name.replace(/\.[^.]+$/, "") })));
    toast(`${n} songs added. Files picked in a browser stay only until this page reloads.`);
    e.target.value = "";
  });
  $("#qClear").addEventListener("click", () => { if (confirm("Remove every song from the queue?")) Music.clear(); });

  /* ---------- options ---------- */
  $("#mShuffle").checked = st.shuffle;
  $("#mShuffle").addEventListener("change", e => { st.shuffle = e.target.checked; store.set("shuffle", st.shuffle); });
  $("#mSkipCopy").checked = st.skipCopyrighted;
  $("#mSkipCopy").addEventListener("change", e => { st.skipCopyrighted = e.target.checked; store.set("skipCopyrighted", st.skipCopyrighted); });
  $("#mXfade").value = st.xfade; $("#mXfTxt").textContent = st.xfade + " s";
  $("#mXfade").addEventListener("input", e => { st.xfade = +e.target.value; store.set("xfade", st.xfade); $("#mXfTxt").textContent = st.xfade + " s"; });
  Music.setMaster(st.master); $("#mMaster").value = st.master;
  $("#mMaster").addEventListener("input", e => { Music.setMaster(+e.target.value); store.set("master", +e.target.value); $("#mMasterTxt").textContent = Math.round(e.target.value * 100) + "%"; });
  $("#mMasterTxt").textContent = Math.round(st.master * 100) + "%";
  $("#mSceneFade").value = st.sceneFade; $("#mSceneFadeTxt").textContent = st.sceneFade + " s";
  $("#mSceneFade").addEventListener("input", e => { st.sceneFade = +e.target.value; store.set("sceneFade", st.sceneFade); $("#mSceneFadeTxt").textContent = st.sceneFade + " s"; });

  /* ---------- transport ---------- */
  $("#mPlay").addEventListener("click", () => cmd("toggle"));
  $("#mNext").addEventListener("click", () => cmd("next"));
  $("#mPrev").addEventListener("click", () => cmd("prev"));
  $("#mFade").addEventListener("click", () => cmd("fade"));
  $("#mSpSkip").addEventListener("click", () => Music.extSkip());

  /* ---------- now playing ---------- */
  let remote = null;
  function renderNow() {
    const host = isHost(), it = Music.current;
    $("#musicRemote").hidden = host;
    $("#musicRemote").textContent = "Music plays on the streaming PC. These buttons control it from here.";
    let title = "Nothing playing", src = st.queue.length ? "Press Play to start the queue" : "Paste a link or add a music folder below", tag = null;
    if (!host && remote) { title = remote.title || "Nothing playing"; src = remote.playing ? `Playing on the streaming PC, from ${SRC[remote.kind] || "the queue"}` : "Paused on the streaming PC"; tag = remote.tag; }
    else if (it) { title = Music.label(it); src = `${st.playing ? "From" : "Paused, from"} ${{ file: "a music file", yt: "YouTube", sp: "Spotify" }[it.kind]}${it.kind === "sp" ? ", plays in the Spotify app, press Next to move on" : `, crossfades over ${st.xfade} s`}`; tag = it.tag; }
    $("#npTitle").textContent = title; $("#npSrc").textContent = src;
    const nt = $("#npTag"); nt.hidden = !tag;
    if (tag) { nt.className = `mtag mtag-${tag.level}`; nt.textContent = TAG[tag.level]; nt.title = tag.why || ""; $("#npWhy").textContent = tag.why || ""; }
    else $("#npWhy").textContent = "";
    const playing = host ? st.playing : !!remote?.playing;
    $("#mPlay").textContent = playing ? "Pause" : "Play";
    $("#mSpSkip").hidden = !(host && st.mode === "sp" && TAURI);
    stage();
  }
  /* show the YouTube players while one is playing or still fading out */
  function stage() {
    const cueYT = Music.cue.mode === "yt", loadingYT = st.pending != null && st.queue[st.pending]?.kind === "yt";
    // a zero-size player loads slowly, so the stage shows while a YouTube song is loading too
    const yt = cueYT || loadingYT || Music.decks.some(d => d.mode === "yt" && d.yt && (st.mode === "yt" && st.playing || d.g > 0.01));
    $("#ytStage").hidden = !yt;
    for (const s of $$(".yt-deck")) s.classList.toggle("front", cueYT ? s.dataset.deck === "cue" : st.mode === "yt" && String(st.active) === s.dataset.deck);  }
  Music.on((type, data) => {
    if (type === "error") return toast(data, "bad");
    if (type === "warn") return toast(data, "warn");
    if (type === "change" || type === "queue") { renderQueue(); renderNow(); broadcast(); refreshCue(); }
    if (type === "cuepoint") { refreshCue(); const row = $(`.qrow[data-id="${CSS.escape(data)}"] .q-sub`), it = st.queue[idx(data)];
      if (row && it) { const n = [SRC[it.kind], it.author, it.kind === "sp" ? "Plays in the Spotify app" : null, (it.cueIn || it.cueOut != null) ? `Starts at ${fmtCue(it.cueIn || 0)}${it.cueOut != null ? `, ends at ${fmtCue(it.cueOut)}` : ""}` : null]; row.textContent = n.filter(Boolean).join(", "); } }
    if (type === "cue" || type === "loading") { refreshCue(); stage(); }
    if (type === "duck") $("#mDuckTag").hidden = st.duck === 1;
  });
  setInterval(() => {
    const p = Music.position(), lvl = Music.level;
    if (p && p.dur) { $("#npBar").style.transform = `scaleX(${Math.min(1, p.cur / p.dur)})`; $("#npCur").textContent = fmtTime(p.cur); $("#npLeft").textContent = "−" + fmtTime(p.dur - p.cur); }
    else { $("#npBar").style.transform = "scaleX(0)"; $("#npCur").textContent = "0:00"; $("#npLeft").textContent = ""; }
    stage();
    const ci = st.queue[idx(openCue)];
    if (ci) {
      // a YouTube pre-listen learns the song length once it loads
      if (Music.cue.item === ci && Music.cue.mode === "yt" && !ci.duration) { const d = Music.cue.yt?.getDuration?.(); if (d) { ci.duration = d; Music.save(); updatePanel(ci); } }
      paintTime(ci);
    }
    $("#mLevel").style.transform = `scaleX(${Math.min(1, st.playing ? lvl : 0)})`; $("#mLevelTxt").textContent = Math.round((st.playing ? lvl : 0) * 100) + "%";
  }, 250);

  /* ---------- relay between laptops ---------- */
  function broadcast() {
    if (!isHost() || !S.connected) return;
    const it = Music.current;
    obs.call("BroadcastCustomEvent", { eventData: { jhs: 1, type: "music-state", title: it ? Music.label(it) : "", kind: it?.kind, tag: it?.tag || null, playing: st.playing } }).catch(() => {});
  }
  setInterval(broadcast, 4000);
  obs.on("CustomEvent", d => {
    if (!d || d.jhs !== 1) return;
    if (d.type === "music-cmd" && isHost()) cmd(d.cmd, d.arg);
    if (d.type === "music-state" && !isHost()) { remote = d; renderNow(); }
  });

  renderQueue(); renderNow();
  window.MusicUI = { renderQueue, renderNow, addLink };
})();
