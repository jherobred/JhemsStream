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
  let ctx = null, bus = null, sceneNode = null;
  const decks = [0, 1].map(i => ({ i, el: new Audio(), gain: null, url: null, item: null, mode: null, yt: null, ytReady: null,
                                   g: 0, ramp: null, sent: -1, token: 0, crossing: false, state: -1 }));
  const st = {
    queue: [], cur: -1, active: -1, mode: null, playing: false, xfade: 6, master: 0.8, shuffle: false, skipCopyrighted: false,
    sceneLevel: 1, sceneFade: 3, duck: 1, played: new Set(), failRun: 0, listeners: [],
  };
  let sceneRamp = { from: 1, to: 1, t0: 0, ms: 0 };
  const ext = { app: null, user: 1, fade: 1, sent: -1, timer: null };
  let uid = Date.now();
  const newId = () => "q" + (uid++).toString(36);

  /* ---------- bus ----------
     music level = master² × scene level × duck. The scene level ramps slowly (decibel S-curve, see
     sceneCurve); ducking is a separate fast multiplier, so a duck never resets a scene ramp. Files:
     decks → bus (master² × duck) → sceneNode (scene ramp) → speakers. YouTube and Spotify read the
     same numbers from JS at about 30 Hz. */
  const sceneNow = (t = performance.now()) => sceneCurve(sceneRamp.from, sceneRamp.to, sceneRamp.ms ? (t - sceneRamp.t0) / sceneRamp.ms : 1);
  const busValue = () => st.master * st.master * sceneNow() * st.duck;
  function ensureCtx() {
    if (ctx) return;
    ctx = new AudioContext();
    sceneNode = ctx.createGain(); sceneNode.gain.value = sceneNow(); sceneNode.connect(ctx.destination);
    bus = ctx.createGain(); bus.connect(sceneNode);
    for (const d of decks) {
      d.el.preload = "auto";
      d.gain = ctx.createGain(); d.gain.gain.value = 0;
      ctx.createMediaElementSource(d.el).connect(d.gain);
      d.gain.connect(bus);
      d.el.addEventListener("timeupdate", () => checkEnd(d));
      d.el.addEventListener("ended", () => { if (decks[st.active] === d && d.mode === "file" && st.playing && !d.crossing) next(true); });
    }
    applyBus(0.05); scheduleScene();
  }
  function applyBus(tc = 0.25) {
    if (bus) bus.gain.setTargetAtTime(st.master * st.master * st.duck, ctx.currentTime, tc);
    pushExt();
  }
  /* schedule the scene ramp on the Web Audio clock with the same curve the JS side uses */
  function scheduleScene() {
    if (!sceneNode) return;
    const g = sceneNode.gain, now = ctx.currentTime, left = sceneRamp.t0 + sceneRamp.ms - performance.now();
    g.cancelScheduledValues(now);
    if (left <= 20) { g.setValueAtTime(sceneRamp.to, now); return; }
    const c = new Float32Array(64), t0 = performance.now();
    for (let i = 0; i < 64; i++) c[i] = sceneNow(t0 + (left * i) / 63);
    g.setValueCurveAtTime(c, now + 0.001, left / 1000);
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
    if (sceneRamp.ms && now - sceneRamp.t0 <= sceneRamp.ms + 50) pushExt();
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
  function waitPlaying(d, ms = 15000) {
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
    emit("loading", i); // the dock shows the YouTube stage now: a zero-size player loads slowly
    await rampTo(din, 0, 0.08); stopDeck(din);
    if (tok !== din.token) return;
    try {
      if (item.kind === "file") {
        ensureCtx(); if (ctx.state === "suspended") await ctx.resume();
        const url = await srcFor(item);
        if (tok !== din.token) return URL.revokeObjectURL(url);
        if (din.url) URL.revokeObjectURL(din.url);
        din.mode = "file"; din.url = url; din.el.src = url;
        const { start } = cueRange(item, item.duration);
        if (start > 0) { await metaReady(din.el); din.el.currentTime = start; }
        await din.el.play();
      } else {
        await ensureYT(din);
        if (tok !== din.token) return;
        din.mode = "yt"; din.g = 0; din.ramp = null; din.sent = 0; din.yt.setVolume(0);
        din.item = item;
        const ready = waitPlaying(din);
        const { start } = cueRange(item, item.duration);
        din.yt.loadVideoById(start > 0 ? { videoId: item.vid, startSeconds: start } : item.vid);
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
    const p = deckPos(d); if (!p || !p.dur) return;
    if (shouldAdvance(p.cur, cueRange(d.item, p.dur), st.xfade)) { d.crossing = true; next(true); }
  }
  function metaReady(el, ms = 8000) {
    if (el.readyState >= 1) return Promise.resolve();
    return new Promise(res => {
      const done = () => { clearTimeout(t); el.removeEventListener("loadedmetadata", done); el.removeEventListener("error", done); res(); };
      const t = setTimeout(done, ms);
      el.addEventListener("loadedmetadata", done); el.addEventListener("error", done);
    });
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
  /* gradual: a new scene level ramps from wherever the current ramp is, over secs (default: Scene fade) */
  function setScene(level, secs = st.sceneFade) {
    const t = performance.now();
    sceneRamp = { from: sceneNow(t), to: Math.max(0, level), t0: t, ms: Math.max(0, secs) * 1000 };
    st.sceneLevel = level; scheduleScene(); pushExt(); emit("level");
  }
  function setDuck(on, depth) { const v = on ? depth : 1; if (v === st.duck) return; st.duck = v; applyBus(on ? 0.05 : 0.35); emit("duck"); }
  function setMaster(v) { st.master = v; applyBus(0.05); }

  function emit(type, data) { st.listeners.forEach(f => { try { f(type, data); } catch (e) { console.error(e); } }); }
  const label = t => !t ? "" : (t.title && t.author) ? `${t.title}, ${t.author}` : (t.title || "Untitled");
  function position() {
    const d = decks[st.active]; if (st.mode === "sp" || !d) return null;
    const p = deckPos(d); if (p && p.dur) p.end = Math.min(p.dur, cueRange(d.item, p.dur).end);
    return p;
  }

  /* ---------- cue points and pre-listen ----------
     Each item can start at cueIn and end at cueOut (seconds). Pre-listen plays an item from its
     start point privately: files go to a chosen "Cue output" (headphones) with setSinkId, which OBS
     Desktop Audio does not record. YouTube can't be routed, so its pre-listen is main-speakers only,
     allowed before going live while the music is stopped. */
  const cue = { el: new Audio(), item: null, url: null, mode: null, yt: null, ytReady: null, sink: store.get("cueSink", "") };
  cue.el.preload = "auto";
  cue.el.addEventListener("ended", () => stopPrelisten());
  function setCue(id, patch) {
    const it = st.queue[indexOf(id)]; if (!it || it.kind === "sp") return;
    const round = v => Math.round(v * 10) / 10;
    if ("in" in patch) it.cueIn = round(Math.max(0, +patch.in || 0));
    if ("out" in patch) it.cueOut = patch.out == null || patch.out === "" ? null : round(Math.max(0, +patch.out));
    const r = cueRange(it, it.duration);
    // an end point at (or past) the song end, or not after the start, means "play to the end"
    it.cueIn = r.start; it.cueOut = isFinite(r.end) && !(it.duration && r.end >= it.duration) ? r.end : null;
    save(); emit("cuepoint", id);
  }
  async function isDefaultSink(id) {
    if (!id || id === "default" || id === "communications") return true;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const def = devs.find(d => d.kind === "audiooutput" && d.deviceId === "default"), mine = devs.find(d => d.deviceId === id);
    return !!(def && mine && def.groupId && def.groupId === mine.groupId);
  }
  // a saved Cue output that is unplugged: the browser would fall back to the main speakers
  async function sinkMissing(id) {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
    return !!id && devs.some(d => d.deviceId) && !devs.some(d => d.deviceId === id);
  }
  async function canPrelisten(item) {
    if (!item) return { ok: false, why: "Pick a song." };
    if (item.kind === "sp") return { ok: false, why: "Spotify plays in its own app, so it can’t be pre-listened here." };
    if (item.kind === "file") {
      if (!cue.el.setSinkId) return { ok: false, why: "This browser can’t send sound to a second output. Use the desktop app." };
      if (await sinkMissing(cue.sink)) return { ok: false, why: "Your Cue output isn’t connected. Plug in your headphones or pick them again under Headphones (cue)." };
      if (await isDefaultSink(cue.sink)) return { ok: false, why: "Choose a Cue output that isn’t your main speakers. OBS Desktop Audio records the main speakers, so the pre-listen would go out on the stream." };
      return { ok: true };
    }
    if (window.JS?.S?.streaming) return { ok: false, why: "You’re live. YouTube pre-listen plays on the main speakers, which OBS Desktop Audio records." };
    if (st.playing) return { ok: false, why: "Music is playing. YouTube pre-listen plays on the main speakers, so stop the music first." };
    return { ok: true, note: "Pre-listen plays on the main speakers for YouTube. It reaches OBS Desktop Audio, so only use it before going live." };
  }
  function ensureCueYT() {
    if (cue.ytReady) return cue.ytReady;
    cue.ytReady = loadYT().then(YT => new Promise(res => {
      const slot = document.createElement("div"); slot.className = "yt-deck yt-cue"; slot.dataset.deck = "cue";
      const inner = document.createElement("div"); slot.append(inner); stageHost().append(slot);
      cue.yt = new YT.Player(inner, { width: "100%", height: "100%",
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
        events: { onReady: () => res(cue.yt), onStateChange: e => { if (e.data === 0) stopPrelisten(); } } });
    }));
    return cue.ytReady;
  }
  async function prelisten(i, at) {
    const item = st.queue[i], chk = await canPrelisten(item);
    if (!chk.ok) throw new Error(chk.why);
    stopPrelisten();
    const t = at ?? cueRange(item, item.duration).start;
    cue.item = item;
    if (item.kind === "file") {
      cue.url = await srcFor(item); cue.el.src = cue.url;
      // routing happens before play, so a missing device can never leak the pre-listen to the main speakers
      try { await cue.el.setSinkId(cue.sink); }
      catch { stopPrelisten(); throw new Error("Couldn’t reach your Cue output. Plug in your headphones or pick them again under Headphones (cue)."); }
      await metaReady(cue.el);
      if (!item.duration && isFinite(cue.el.duration)) { item.duration = cue.el.duration; save(); }
      cue.el.currentTime = t; await cue.el.play(); cue.mode = "file";
    } else {
      await ensureCueYT();
      cue.yt.setVolume(30); cue.yt.loadVideoById({ videoId: item.vid, startSeconds: t }); cue.mode = "yt";
    }
    emit("cue"); return chk;
  }
  function stopPrelisten() {
    if (cue.mode === "file") cue.el.pause();
    if (cue.mode === "yt") try { cue.yt.pauseVideo(); } catch {}
    if (cue.url) { URL.revokeObjectURL(cue.url); cue.url = null; cue.el.removeAttribute("src"); cue.el.load(); } // load() frees the media player
    const was = cue.mode; cue.mode = null; cue.item = null;
    if (was) emit("cue");
  }
  function cueTime() {
    if (cue.mode === "file") return cue.el.currentTime;
    if (cue.mode === "yt") try { return cue.yt.getCurrentTime(); } catch {}
    return null;
  }
  function cueSeek(t) {
    if (cue.mode === "file") cue.el.currentTime = t;
    if (cue.mode === "yt") try { cue.yt.seekTo(t, true); } catch {}
  }
  /* "Send to stream": stop the private pre-listen and crossfade the stream to the item from its start point */
  function sendToStream(i) { stopPrelisten(); return play(i); }
  async function listSinks(askForNames = false) {
    if (askForNames) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); }
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
  }
  function setSink(id) { cue.sink = id; store.set("cueSink", id); if (cue.mode === "file") cue.el.setSinkId(id).catch(() => {}); }

  st.queue = store.get("queue", []); st.cur = Math.min(store.get("queueCur", -1), st.queue.length - 1);
  st.xfade = store.get("xfade", 6); st.master = store.get("master", 0.8); st.sceneFade = store.get("sceneFade", 3);
  st.shuffle = store.get("shuffle", false); st.skipCopyrighted = store.get("skipCopyrighted", false);

  return { st, ext, decks, play, next, prev, toggle, fadeOut, add, addUrl, addFiles, remove, move, playNext, clear, save,
           setScene, setDuck, setMaster, extSkip, extToggle, tweenExt, pushExt, label, position, parseUrl, ep, pickNext,
           get sceneNow() { return sceneNow(); },
           cue, setCue, canPrelisten, prelisten, stopPrelisten, cueTime, cueSeek, sendToStream, listSinks, setSink, isDefaultSink, sinkMissing,
           on: f => st.listeners.push(f), get level() { return busValue(); }, get current() { return st.queue[st.cur] || null; } };
})();

/* Scene level ramp: interpolate in decibels on a smoothstep, so the change sounds even and
   starts and ends gently. Silence is floored at -60 dB and lands on exact 0 at the end. */
function sceneCurve(from, to, x) {
  if (x >= 1) return to;
  if (x <= 0) return from;
  const db = g => g > 0.001 ? 20 * Math.log10(g) : -60;
  const s = x * x * (3 - 2 * x), d = db(from) + (db(to) - db(from)) * s;
  return d <= -60 ? 0 : Math.pow(10, d / 20);
}

/* Cue math. start = cueIn kept inside the song; end = cueOut, or the song end when unset or not after start. */
function cueRange(item, dur) {
  const D = dur > 0 ? dur : Infinity;
  let start = Math.max(0, +item?.cueIn || 0);
  if (start > D - 1) start = Math.max(0, D - 1);
  let end = item?.cueOut > 0 ? Math.min(+item.cueOut, D) : D;
  if (end <= start + 1) end = D;
  return { start, end };
}
/* Move on when past the end point, or when the crossfade has to start to finish on it. */
function shouldAdvance(cur, range, xfade) {
  if (!isFinite(range.end)) return false;
  if (cur >= range.end - 0.05) return true;
  return range.end - range.start > xfade * 2 && range.end - cur <= xfade;
}
/* "1:23", "83", "1:23.5", "0:01:23" to seconds; NaN when it isn't a time */
function parseClock(s) {
  const p = String(s ?? "").trim().split(":");
  if (!p[0] && p.length === 1) return NaN;
  if (p.some(x => !/^\d+(\.\d+)?$/.test(x)) || p.length > 3) return NaN;
  return p.reduce((acc, x) => acc * 60 + +x, 0);
}

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
