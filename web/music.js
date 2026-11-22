"use strict";
/* JhemsStream music engine.
   One queue of local files, YouTube videos and Spotify links. Two decks crossfade between any two
   items (file <-> YouTube included) with equal-power curves. The bus follows the on-air scene and
   ducks under the casters. File decks ramp on the Web Audio clock; YouTube decks ramp through the
   IFrame player's setVolume at about 30 Hz. Spotify has no playback API, so a Spotify item opens in
   the Spotify app and its Windows volume follows the bus (desktop app only). */
const Music = (() => {
  const T = window.__TAURI__;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ld." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ld." + k, JSON.stringify(v)); } catch {} },
  };
  let ctx = null, bus = null;
  const decks = [0, 1].map(i => ({ i, el: new Audio(), gain: null, url: null, item: null, mode: null, yt: null, ytReady: null,
                                   g: 0, ramp: null, sent: -1, token: 0, crossing: false, state: -1 }));
  const st = {
    queue: [], cur: -1, active: -1, mode: null, playing: false, xfade: 6, master: 0.8, shuffle: false, skipCopyrighted: false,
    sceneLevel: 1, duck: 1, played: new Set(), failRun: 0, listeners: [],
  };
  const ext = { app: null, user: 1, fade: 1, sent: -1, timer: null };
  let uid = Date.now();
  const newId = () => "q" + (uid++).toString(36);

  /* ---------- bus ---------- */
  const busValue = () => st.master * st.master * st.sceneLevel * st.duck;
  function ensureCtx() {
    if (ctx) return;
    ctx = new AudioContext();
    bus = ctx.createGain(); bus.connect(ctx.destination);
    for (const d of decks) {
      d.el.preload = "auto";
      d.gain = ctx.createGain(); d.gain.gain.value = 0;
      ctx.createMediaElementSource(d.el).connect(d.gain);
      d.gain.connect(bus);
      d.el.addEventListener("timeupdate", () => checkEnd(d));
      d.el.addEventListener("ended", () => { if (decks[st.active] === d && d.mode === "file" && st.playing) next(true); });
    }
    applyBus(0.05);
  }
  function applyBus(tc = 0.25) {
    if (bus) bus.gain.setTargetAtTime(busValue(), ctx.currentTime, tc);
    pushExt();
  }
  /* equal-power: sin rise, cos fall, so two decks crossing keep the loudness level */
  const ep = (from, to, x) => to < from ? to + (from - to) * Math.cos(x * Math.PI / 2) : from + (to - from) * Math.sin(x * Math.PI / 2);

  /* ---------- deck ramps ---------- */
  function rampTo(d, to, secs) {
    if (d.mode === "file" && d.gain) {
      const g = d.gain.gain, now = ctx.currentTime, from = g.value;
      g.cancelScheduledValues(now); g.setValueAtTime(from, now);
      if (secs <= 0.05 || Math.abs(from - to) < 0.001) g.linearRampToValueAtTime(to, now + 0.04);
      else { const c = new Float32Array(64); for (let i = 0; i < 64; i++) c[i] = ep(from, to, i / 63); g.setValueCurveAtTime(c, now + 0.001, secs); }
      d.g = to;
    } else d.ramp = { from: d.g, to, t0: performance.now(), ms: Math.max(40, secs * 1000) };
    return new Promise(r => setTimeout(r, Math.max(40, secs * 1000)));
  }
  // ponytail: YouTube volume is an integer 0-100 stepped at ~30 Hz; quiet tails are coarse, fine for music beds
  setInterval(() => {
    const now = performance.now(), bv = busValue();
    for (const d of decks) {
      if (d.mode !== "yt" || !d.yt?.setVolume) continue;
      if (d.ramp) { const x = Math.min(1, (now - d.ramp.t0) / d.ramp.ms); d.g = ep(d.ramp.from, d.ramp.to, x); if (x >= 1) d.ramp = null; }
      const v = Math.round(Math.max(0, Math.min(1, d.g * bv)) * 100);
      if (v !== d.sent) { d.sent = v; try { d.yt.setVolume(v); } catch {} }
      checkEnd(d);
    }
  }, 33);
  function stopDeck(d) {
    if (d.mode === "file") d.el.pause();
    if (d.mode === "yt") try { d.yt.pauseVideo(); } catch {}
  }

  /* ---------- YouTube players ---------- */
  let ytApi = null;
  function loadYT() {
    if (ytApi) return ytApi;
    ytApi = new Promise((res, rej) => {
      if (window.YT?.Player) return res(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => { ytApi = null; rej(new Error("YouTube player couldn't load. Is the internet on?")); };
      document.head.append(s);
    });
    return ytApi;
  }
  /* The players live in #ytStage (the now-playing card) so they stay rendered and visible. */
  function stageHost() {
    let s = document.getElementById("ytStage");
    if (!s) { s = document.createElement("div"); s.id = "ytStage"; s.className = "yt-stage"; document.body.append(s); }
    return s;
  }
  function ensureYT(d) {
    if (d.ytReady) return d.ytReady;
    d.ytReady = loadYT().then(YT => new Promise(res => {
      const slot = document.createElement("div"); slot.className = "yt-deck"; slot.dataset.deck = d.i;
      const inner = document.createElement("div"); slot.append(inner); stageHost().append(slot);
      d.yt = new YT.Player(inner, {
        width: "100%", height: "100%",
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => { d.yt.setVolume(0); d.sent = 0; res(d.yt); },
          onStateChange: e => { d.state = e.data; d.onState?.(e.data); if (e.data === 0 && decks[st.active] === d && st.playing) next(true); },
          onError: e => onYTError(d, e.data),
        },
      });
    }));
    return d.ytReady;
  }
  const YT_ERR = { 2: "Bad link", 5: "Can't play here", 100: "Video removed or private", 101: "Can't embed", 150: "Can't embed", 153: "Can't embed" };
  function onYTError(d, code) {
    const item = d.item; if (!item) return;
    item.err = YT_ERR[code] || "Can't play";
    emit("error", `${item.title || "That video"}: ${item.err === "Can't embed" ? "the owner blocked playing it outside YouTube" : item.err.toLowerCase()}. Skipping it.`);
    save(); emit("queue");
    d.onFail?.(item.err);
    if (decks[st.active] === d && st.playing) next(true);
  }
  function waitPlaying(d, ms = 9000) {
    return new Promise((res, rej) => {
      const done = (ok, why) => { clearTimeout(t); d.onState = null; d.onFail = null; ok ? res() : rej(new Error(why)); };
      const t = setTimeout(() => done(false, "timeout"), ms);
      d.onState = s => { if (s === 1) done(true); };
      d.onFail = why => done(false, why);
    });
  }

  /* ---------- play ---------- */
  async function srcFor(item) {
    if (item.file instanceof File) return URL.createObjectURL(item.file);
    const buf = await T.core.invoke("read_audio", { path: item.path });
    return URL.createObjectURL(new Blob([buf]));
  }
  /* Start item i on the idle deck and crossfade to it. Safe mid-fade: the idle deck gets a quick
     fade first, and a newer call on the same deck cancels an older one (token). */
  async function play(i, fade = st.xfade, auto = false) {
    const item = st.queue[i]; if (!item) return;
    if (item.kind === "sp") return playSpotify(i, fade);
    const inIdx = st.active === 0 ? 1 : 0, din = decks[inIdx], dout = st.active >= 0 ? decks[st.active] : null;
    const tok = ++din.token, wasPlaying = st.playing, fromSpotify = st.mode === "sp";
    st.pending = i; // a second Next during loading moves on from here
    await rampTo(din, 0, 0.08); stopDeck(din);
    if (tok !== din.token) return;
    try {
      if (item.kind === "file") {
        ensureCtx(); if (ctx.state === "suspended") await ctx.resume();
        const url = await srcFor(item);
        if (tok !== din.token) return URL.revokeObjectURL(url);
        if (din.url) URL.revokeObjectURL(din.url);
        din.mode = "file"; din.url = url; din.el.src = url;
        await din.el.play();
      } else {
        await ensureYT(din);
        if (tok !== din.token) return;
        din.mode = "yt"; din.g = 0; din.ramp = null; din.sent = 0; din.yt.setVolume(0);
        din.item = item;
        const ready = waitPlaying(din);
        din.yt.loadVideoById(item.vid);
        await ready;
        if (!item.duration) { item.duration = din.yt.getDuration() || 0; save(); }
      }
    } catch (e) {
      if (tok !== din.token) return;
      st.pending = null;
      if (item.kind === "file") { item.err = "Can't play"; emit("error", `Couldn't play ${label(item)}: ${e.message}`); }
      else if (!item.err) { item.err = e.message === "timeout" ? "Didn't start" : "Can't play"; emit("error", `${label(item)} didn't start. Skipping it.`); }
      emit("queue"); save();
      if (++st.failRun >= st.queue.length) { st.failRun = 0; emit("error", "Nothing in the queue would play."); return; }
      const n = pickNext(auto, i); if (n >= 0 && n !== i) return play(n, fade, auto);
      return;
    }
    if (tok !== din.token) return;
    st.pending = null; st.failRun = 0; din.item = item; din.crossing = false;
    rampTo(din, 1, wasPlaying ? fade : Math.min(fade, 2));
    if (dout && dout !== din && wasPlaying) rampTo(dout, 0, fade).then(() => { if (decks[st.active] !== dout) stopDeck(dout); });
    if (fromSpotify) leaveSpotify(fade);
    st.active = inIdx; st.cur = i; st.mode = item.kind; st.playing = true; st.played.add(item.id);
    emit("change");
  }
  function checkEnd(d) {
    if (d !== decks[st.active] || d.crossing || !st.playing || d.mode !== st.mode) return;
    const p = deckPos(d); if (!p) return;
    const left = p.dur - p.cur;
    if (p.dur > st.xfade * 2 && left <= st.xfade) { d.crossing = true; next(true); }
  }
  function deckPos(d) {
    if (d.mode === "file") return { cur: d.el.currentTime || 0, dur: d.el.duration || d.item?.duration || 0 };
    if (d.mode === "yt" && d.yt?.getCurrentTime) { try { return { cur: d.yt.getCurrentTime() || 0, dur: d.yt.getDuration() || 0 }; } catch {} }
    return null;
  }

  /* ---------- Spotify (plays in its own app) ---------- */
  async function playSpotify(i, fade) {
    const item = st.queue[i], dout = st.active >= 0 ? decks[st.active] : null;
    if (dout && st.playing && st.mode !== "sp") rampTo(dout, 0, fade).then(() => stopDeck(dout));
    ext.app = "Spotify.exe"; ext.fade = 0; ext.sent = -1;
    window.JS?.openExt ? window.JS.openExt(item.uri) : window.open(item.uri);
    st.cur = i; st.mode = "sp"; st.playing = true; st.played.add(item.id); emit("change");
    if (!T) { emit("warn", "Spotify plays in its own app. In a browser JhemsStream can't fade it; use the desktop app on the streaming PC."); return; }
    setTimeout(() => tweenExt(1, 2), 1500);
    setTimeout(async () => {
      const apps = await T.core.invoke("app_audio_list").catch(() => []);
      if (st.mode === "sp" && !apps.some(a => /^spotify\.exe$/i.test(a.name))) emit("warn", "Spotify isn’t playing. Is the Spotify app installed and signed in?");
    }, 6000);
  }
  function leaveSpotify(fade) {
    tweenExt(0, fade).then(async () => {
      if (st.mode === "sp") return; // came back to Spotify meanwhile
      // ponytail: play/pause is a toggle; if the user already paused Spotify this resumes it silently at volume 0
      if (T) await T.core.invoke("media_key", { key: "playpause" }).catch(() => {});
      ext.app = null;
    });
  }

  /* ---------- queue order ---------- */
  function pickNext(auto = false, from = st.cur) {
    const n = st.queue.length; if (!n) return -1;
    const ok = it => !it.err && !(auto && st.skipCopyrighted && it.tag?.level === "copyrighted");
    const order = [...Array(n).keys()].map(k => (from + 1 + k) % n).filter(k => k !== from && ok(st.queue[k]));
    if (!order.length) return -1;
    if (!st.shuffle) return order[0];
    let pool = order.filter(k => !st.played.has(st.queue[k].id));
    if (!pool.length) { st.played.clear(); pool = order; }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function next(auto = false) {
    const n = pickNext(auto, st.pending ?? st.cur);
    if (n < 0) { if (auto) fadeOut(st.xfade); return; }
    return play(n, st.xfade, auto);
  }
  function prev() {
    const n = st.queue.length; if (!n) return;
    for (let k = 1; k <= n; k++) { const j = (st.cur - k + n) % n; if (!st.queue[j].err) return play(j); }
  }
  async function toggle() {
    if (st.mode === "sp") return extToggle();
    if (!st.playing) {
      if (st.active < 0 || !decks[st.active].item) { const n = st.cur >= 0 ? st.cur : pickNext(false, -1); return n >= 0 ? play(n) : undefined; }
      const d = decks[st.active];
      if (d.mode === "file") { ensureCtx(); await ctx.resume(); await d.el.play(); }
      else try { d.yt.playVideo(); } catch {}
      rampTo(d, 1, 1.5); st.playing = true; emit("change"); return;
    }
    fadeOut(1.5);
  }
  function fadeOut(secs = 3) {
    if (!st.playing) return;
    if (st.mode === "sp") { tweenExt(0, secs); st.playing = false; emit("change"); return; }
    const d = decks[st.active]; if (!d) return;
    rampTo(d, 0, secs).then(() => { if (!st.playing) stopDeck(d); });
    st.playing = false; emit("change");
  }

  /* ---------- queue editing ---------- */
  function add(items, at = st.queue.length) {
    st.queue.splice(at, 0, ...items);
    if (st.cur >= at) st.cur += items.length;
    save(); emit("queue"); return items.length;
  }
  const indexOf = id => st.queue.findIndex(q => q.id === id);
  function remove(id) {
    const i = indexOf(id); if (i < 0) return;
    if (i === st.cur && st.playing) fadeOut(1);
    st.queue.splice(i, 1);
    if (i < st.cur) st.cur--; else if (i === st.cur) st.cur = -1;
    save(); emit("queue");
  }
  function move(id, delta) {
    const i = indexOf(id), j = i + delta; if (i < 0 || j < 0 || j >= st.queue.length) return;
    const [it] = st.queue.splice(i, 1); st.queue.splice(j, 0, it);
    if (st.cur === i) st.cur = j; else if (st.cur === j) st.cur = i;
    save(); emit("queue");
  }
  function playNext(id) {
    const i = indexOf(id); if (i < 0 || i === st.cur) return;
    const [it] = st.queue.splice(i, 1); if (i < st.cur) st.cur--;
    st.queue.splice(st.cur + 1, 0, it); save(); emit("queue");
  }
  function clear() { if (st.playing) fadeOut(1.5); st.queue = []; st.cur = -1; save(); emit("queue"); }
  function save() {
    store.set("queue", st.queue.filter(q => q.kind !== "file" || q.path).map(({ file, ...q }) => q));
    store.set("queueCur", st.cur);
  }

  /* ---------- links ---------- */
  function parseUrl(text) {
    const s = String(text || "").trim();
    let m = s.match(/^spotify:(track|album|playlist|episode|artist):([A-Za-z0-9]+)/);
    if (m) return { kind: "sp", type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` };
    let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "open.spotify.com") {
      m = u.pathname.match(/\/(track|album|playlist|episode|artist)\/([A-Za-z0-9]+)/);
      return m ? { kind: "sp", type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
    }
    if (!/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return null;
    const list = u.searchParams.get("list");
    let vid = u.searchParams.get("v");
    if (host === "youtu.be") vid = u.pathname.slice(1);
    m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/); if (m) vid = m[2];
    vid = vid && /^[\w-]{11}/.test(vid) ? vid.slice(0, 11) : null;
    // RD... lists are endless auto-generated mixes, not playlists someone made
    if (list && !/^RD/.test(list) && (u.pathname === "/playlist" || !vid)) return { kind: "ytlist", list };
    if (list && !/^RD/.test(list) && vid) return { kind: "ytlist", list, vid };
    return vid ? { kind: "yt", vid } : null;
  }
  async function oembed(url) {
    const r = await fetch(url); if (!r.ok) { const e = new Error("oembed " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function ytItem(vid) {
    const it = { id: newId(), kind: "yt", vid, url: `https://www.youtube.com/watch?v=${vid}`, title: "YouTube video", author: "" };
    try { const o = await oembed(`https://www.youtube.com/oembed?url=${encodeURIComponent(it.url)}&format=json`); it.title = o.title; it.author = o.author_name || ""; }
    catch (e) { if (e.status === 401 || e.status === 403) it.err = "Can't embed"; else if (e.status === 404 || e.status === 400) it.err = "Video removed or private"; }
    it.tag = tagYouTube(it.title, it.author);
    return it;
  }
  async function spItem(p) {
    const it = { id: newId(), kind: "sp", uri: p.uri, url: p.url, spType: p.type, title: `Spotify ${p.type}`, author: "" };
    try { const o = await oembed(`https://open.spotify.com/oembed?url=${encodeURIComponent(p.url)}`); it.title = o.title || it.title; } catch {}
    it.tag = { level: "copyrighted", why: "Spotify only carries commercial releases. Facebook will likely mute or block it." };
    return it;
  }
  /* A YouTube playlist expands to its videos: cue it in a throwaway player and read getPlaylist(). */
  function ytPlaylistIds(list) {
    return loadYT().then(YT => new Promise((res, rej) => {
      const host = document.createElement("div"); host.className = "yt-probe"; const inner = document.createElement("div"); host.append(inner); stageHost().append(host);
      let p; const end = (ids, err) => { clearTimeout(t); try { p.destroy(); } catch {} host.remove(); err ? rej(err) : res(ids); };
      const t = setTimeout(() => end(null, new Error("The playlist didn't load. Is it public or unlisted?")), 12000);
      p = new YT.Player(inner, { width: 200, height: 200, playerVars: { autoplay: 0, controls: 0 },
        events: {
          onReady: () => p.cuePlaylist({ listType: "playlist", list }),
          onStateChange: e => { if (e.data === 5) { const ids = p.getPlaylist(); if (ids?.length) end(ids); } },
          onError: () => end(null, new Error("YouTube refused that playlist.")),
        } });
    }));
  }
  async function pool(items, n, fn) {
    const out = new Array(items.length); let k = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i]); } }));
    return out;
  }
  /* Adds a pasted link. Returns how many queue items it added. */
  async function addUrl(text) {
    const p = parseUrl(text);
    if (!p) throw new Error("That isn't a YouTube or Spotify link.");
    if (p.kind === "sp") return add([await spItem(p)]);
    if (p.kind === "yt") return add([await ytItem(p.vid)]);
    const ids = await ytPlaylistIds(p.list);
    return add(await pool(ids, 6, ytItem));
  }
  function addFiles(tracks) {
    return add(tracks.map(t => {
      const r = copyrightRisk(t);
      return { id: newId(), kind: "file", path: t.path || "", file: t.file || null, title: t.title || t.file?.name?.replace(/\.[^.]+$/, "") || "",
               author: t.artist || "", duration: t.duration || 0, meta: { file: t.file?.name || t.file || "", isrc: t.isrc, label: t.label, copyright: t.copyright },
               tag: { level: { high: "copyrighted", low: "free" }[r.level] || "unknown", why: r.why } };
    }));
  }

  /* ---------- other app volume (Spotify through Windows) ---------- */
  function extValue() { return ext.user * ext.fade * busValue(); }
  function pushExt() {
    if (!ext.app || !T) return;
    const v = Math.round(extValue() * 100) / 100;
    if (Math.abs(v - ext.sent) < 0.01) return;
    ext.sent = v; T.core.invoke("app_audio_set", { name: ext.app, volume: v }).catch(() => {});
  }
  function tweenExt(to, secs) {
    return new Promise(res => {
      clearInterval(ext.timer); const from = ext.fade, t0 = performance.now();
      ext.timer = setInterval(() => {
        const x = Math.min(1, (performance.now() - t0) / (secs * 1000));
        ext.fade = ep(from, to, x); pushExt();
        if (x >= 1) { clearInterval(ext.timer); res(); }
      }, 40);
    });
  }
  setInterval(pushExt, 120);
  async function extSkip() { if (!T) return; await tweenExt(0, 0.8); await T.core.invoke("media_key", { key: "next" }); await new Promise(r => setTimeout(r, 450)); await tweenExt(1, 1.6); }
  async function extToggle() {
    if (!T) return;
    if (st.playing) { st.playing = false; emit("change"); await tweenExt(0, 1.2); await T.core.invoke("media_key", { key: "playpause" }); }
    else { st.playing = true; emit("change"); await T.core.invoke("media_key", { key: "playpause" }); await tweenExt(1, 1.5); }
  }

  /* ---------- bus controls ---------- */
  function setScene(level, secs = 1.2) { st.sceneLevel = level; applyBus(secs / 3); emit("level"); }
  function setDuck(on, depth) { const v = on ? depth : 1; if (v === st.duck) return; st.duck = v; applyBus(on ? 0.05 : 0.35); emit("duck"); }
  function setMaster(v) { st.master = v; applyBus(0.05); }

  function emit(type, data) { st.listeners.forEach(f => { try { f(type, data); } catch (e) { console.error(e); } }); }
  const label = t => !t ? "" : (t.title && t.author) ? `${t.title}, ${t.author}` : (t.title || "Untitled");
  function position() { const d = decks[st.active]; return st.mode === "sp" || !d ? null : deckPos(d); }

  st.queue = store.get("queue", []); st.cur = Math.min(store.get("queueCur", -1), st.queue.length - 1);
  st.xfade = store.get("xfade", 6); st.master = store.get("master", 0.8);
  st.shuffle = store.get("shuffle", false); st.skipCopyrighted = store.get("skipCopyrighted", false);

  return { st, ext, decks, play, next, prev, toggle, fadeOut, add, addUrl, addFiles, remove, move, playNext, clear, save,
           setScene, setDuck, setMaster, extSkip, extToggle, tweenExt, pushExt, label, position, parseUrl, ep, pickNext,
           on: f => st.listeners.push(f), get level() { return busValue(); }, get current() { return st.queue[st.cur] || null; } };
})();

/* Copyright tag for a YouTube upload, from its title and channel. Facebook's own matching decides; this only flags. */
function tagYouTube(title = "", author = "") {
  const a = author.toLowerCase(), t = title.toLowerCase();
  const freeChannels = ["nocopyrightsounds", "ncs", "streambeats", "harris heller", "pixabay", "youtube audio library", "audio library"];
  if (freeChannels.some(k => a === k || a.startsWith(k + " ") || a.includes(k) && k.length > 4))
    return { level: "free", why: `Uploaded by ${author}, a royalty-free library. Check its rules for Facebook.` };
  if (/ - topic$/.test(a)) return { level: "copyrighted", why: `${author} is an auto-generated label channel. Facebook will likely mute or block it.` };
  if (/vevo/.test(a)) return { level: "copyrighted", why: `${author} is a VEVO label channel. Facebook will likely mute or block it.` };
  if (/\brecords?\b|\brecordings\b|\bmusic group\b|\bentertainment\b/.test(a)) return { level: "copyrighted", why: `${author} looks like a record label channel. Facebook will likely mute or block it.` };
  if (/official (music )?video|official audio|official lyric|lyric video|lyrics video|\(feat\.|\bft\.|official mv\b/.test(t))
    return { level: "copyrighted", why: "The title marks an official release. Facebook will likely mute or block it." };
  if (/no copyright|copyright free|royalty[- ]free/.test(t + " " + a))
    return { level: "free", why: "The uploader says it is free to use. Uploaders are sometimes wrong, so check the source." };
  return { level: "unknown", why: "Couldn't tell from the title or channel. Only play it if you know it's free to stream." };
}

/* Copyright risk from file tags and file name. */
function copyrightRisk(t) {
  const hay = [t.file?.name || t.file, t.title, t.artist, t.album, t.comment, t.copyright, t.label].join(" ").toLowerCase();
  const free = ["ncs", "nocopyrightsounds", "no copyright", "streambeats", "harris heller", "pixabay", "youtube audio library",
                "sound collection", "free music archive", "creative commons", "cc-by", "cc by", "royalty free", "royalty-free", "uppbeat", "epidemic sound"];
  if (free.some(k => hay.includes(k))) return { level: "low", why: "Tags point to a royalty-free library. Check its rules for Facebook." };
  if (t.isrc) return { level: "high", why: "Has an ISRC code, so it's a commercially registered recording. Facebook will likely mute or block it." };
  if (t.label || /℗|\(p\)|©|\(c\)/i.test(t.copyright || "")) return { level: "high", why: `Tagged with a label or copyright owner (${(t.label || t.copyright).slice(0, 40)}). Likely to be flagged.` };
  if (t.artist && t.album) return { level: "unknown", why: "Looks like an album track. Check where it came from before playing it live." };
  return { level: "unknown", why: "No details in the file. Only play it if you know it's free to stream." };
}
