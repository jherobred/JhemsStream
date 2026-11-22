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
  const TAG = { copyrighted: "Copyrighted", free: "Royalty-free source", unknown: "Unknown" };
  const svg = d => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = { play: '<path d="M7 5v14l11-7z"/>', next: '<path d="M4 6h10M4 12h10M4 18h6M17 14v7M14 18l3 3 3-3"/>',
               up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>' };
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
      const row = h("li", { class: `qrow${cur ? " current" : ""}${it.err ? " broken" : ""}`, "data-id": it.id, "aria-current": cur ? "true" : false },
        h("span", { class: "q-num" }, cur && st.playing ? "Now" : String(i + 1)),
        h("div", { class: "q-main" },
          h("div", { class: "q-title" }, it.title || "Untitled"),
          h("div", { class: "q-sub" }, notes.join(", ")),
          h("div", { class: "q-tags" }, tagEl(it), it.err ? h("span", { class: "mtag mtag-err" }, it.err) : null,
            h("span", { class: "sr", id: whyId }, it.tag?.why || ""))),
        h("span", { class: "q-dur" }, it.duration ? fmtTime(it.duration) : ""),
        h("div", { class: "q-acts" },
          withKey(iconBtn("play", `Play ${it.title} now`, () => cmd("play", it.id)), `play-${it.id}`),
          withKey(iconBtn("next", `Play ${it.title} next`, () => { Music.playNext(it.id); }), `next-${it.id}`),
          withKey(iconBtn("up", `Move ${it.title} up`, () => Music.move(it.id, -1)), `up-${it.id}`),
          withKey(iconBtn("down", `Move ${it.title} down`, () => Music.move(it.id, 1)), `down-${it.id}`),
          withKey(iconBtn("x", `Remove ${it.title}`, () => Music.remove(it.id)), `x-${it.id}`)));
      row.querySelector(".q-title").setAttribute("aria-describedby", whyId);
      box.append(row);
    });
    if (focusKey) box.querySelector(`[data-qfocus="${CSS.escape(focusKey)}"]`)?.focus();
  }
  const withKey = (el, k) => { el.dataset.qfocus = k; return el; };

  /* ---------- adding ---------- */
  async function addLink(text) {
    const btn = $("#mAddBtn"); btn.disabled = true; btn.textContent = "Adding…";
    try {
      const p = Music.parseUrl(text);
      const n = await Music.addUrl(text);
      const added = st.queue.slice(-n), cr = added.filter(q => q.tag?.level === "copyrighted").length, bad = added.filter(q => q.err).length;
      toast(`${p?.kind === "ytlist" ? "Playlist added" : "Added"}: ${n} ${n === 1 ? "song" : "songs"}${cr ? `, ${cr} tagged copyrighted` : ""}${bad ? `, ${bad} can't play outside YouTube` : ""}`, cr || bad ? "warn" : "ok");
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
      toast(`${n} songs added${cr ? `, ${cr} tagged copyrighted` : ""}`, cr ? "warn" : "ok");
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
    let title = "Nothing playing", src = st.queue.length ? "Press Play to start the queue" : "Queue empty", tag = null;
    if (!host && remote) { title = remote.title || "Nothing playing"; src = remote.playing ? `Playing on the streaming PC, ${SRC[remote.kind] || ""}` : "Paused"; tag = remote.tag; }
    else if (it) { title = Music.label(it); src = `${st.playing ? "Now playing" : "Paused"} from ${SRC[it.kind]}${it.kind === "sp" ? ". It plays in the Spotify app, so press Next to move on." : `. Crossfades over ${st.xfade} s.`}`; tag = it.tag; }
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
    const yt = Music.decks.some(d => d.mode === "yt" && d.yt && (st.mode === "yt" && st.playing || d.g > 0.01));
    $("#ytStage").hidden = !yt;
    for (const s of $$(".yt-deck")) s.classList.toggle("front", st.mode === "yt" && String(st.active) === s.dataset.deck);
  }
  Music.on((type, data) => {
    if (type === "error") return toast(data, "bad");
    if (type === "warn") return toast(data, "warn");
    if (type === "change" || type === "queue") { renderQueue(); renderNow(); broadcast(); }
    if (type === "duck") $("#mDuckTag").hidden = st.duck === 1;
  });
  setInterval(() => {
    const p = Music.position(), lvl = Music.level;
    if (p && p.dur) { $("#npBar").style.transform = `scaleX(${Math.min(1, p.cur / p.dur)})`; $("#npCur").textContent = fmtTime(p.cur); $("#npLeft").textContent = "−" + fmtTime(p.dur - p.cur); }
    else { $("#npBar").style.transform = "scaleX(0)"; $("#npCur").textContent = "0:00"; $("#npLeft").textContent = ""; }
    stage();
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
