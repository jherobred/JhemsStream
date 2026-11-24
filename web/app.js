"use strict";
const obs = new OBSWebSocket();
const TAURI = window.__TAURI__;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem("ld." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ld." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("ld." + k); } catch {} },
};
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
/* Icons: authored 24px strokes (Lucide geometry, MIT) */
const ICONS = {
  play: '<path d="M7 4v16l13-8z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="M5 4v16l11-8zM19 5v14"/>', prev: '<path d="M19 20V4L8 12zM5 19V5"/>',
  fade: '<path d="M3 18c6 0 9-12 18-12"/>', mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>', vol: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  phones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/>',
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', wand: '<path d="M4 20 15 9M14 4v2M19 9h2M17.5 5.5 19 4M9 5l.5 1.5M18 13l1.5.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>', check: '<path d="m5 12 5 5L20 7"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  gear2: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  live: '<path d="M4 7h11v10H4zM15 10l5-3v10l-5-3"/>', obs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="2.5"/><circle cx="8" cy="14.5" r="2.5"/><circle cx="16" cy="14.5" r="2.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', gauge: '<path d="M4 18a9 9 0 1 1 16 0M12 14l4-5"/>', note: '<path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>', shuffle: '<path d="M3 6h4l10 12h4M3 18h4l3-3.5M14 9.5 17 6h4M18 3l3 3-3 3M18 15l3 3-3 3"/>',
};
const icon = (n, cls = "ic") => h("span", { class: cls, "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>` });

const S = { scenes: [], program: null, preview: null, studio: false, streaming: false, recording: false, canvas: { w: 1920, h: 1080 },
  thumbs: {}, audio: [], texts: [], connected: false, transDur: 300, transFixed: false, host: "localhost", isDesktop: !!TAURI,
  get isLocal() { return /^(localhost|127\.0\.0\.1|::1)$/i.test(this.host); } };
let readyFns = [];

function log(msg, bad) {
  const t = new Date().toLocaleTimeString();
  $("#log").prepend(h("div", { class: bad ? "bad" : "" }, `${t}  ${msg}`));
}
function toast(msg, kind = "ok", action) {
  const el = h("div", { class: `toast ${kind}`, role: kind === "bad" ? "alert" : "status" }, msg);
  const bye = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  // a toast with a button stays longer, so there is time to press it
  if (action) el.append(h("button", { type: "button", class: "btn small toast-act", onclick: () => { bye(); action.fn(); } }, action.label));
  $("#toasts").append(el);
  setTimeout(bye, action ? 12000 : kind === "bad" ? 6000 : 3200);
}
async function call(type, data) {
  try { return await obs.call(type, data); }
  catch (e) { log(`${type} failed: ${e.message}`, true); throw e; }
}
function banner(msg) { const b = $("#banner"); b.textContent = msg || ""; b.hidden = !msg; }
function openExt(url) { if (window.Setup?.open) Setup.open(url); else window.open(url, "_blank", "noopener"); }

/* ---------- connection ---------- */
let pendingConnect = null;
function connect({ host = "localhost", port = 4455, password = "" } = {}) {
  S.host = host; S.port = port; S.pw = password;
  return new Promise(async (resolve, reject) => {
    pendingConnect = { resolve, reject };
    try {
      if (S.connected) { try { await obs.disconnect(); } catch {} }
      await obs.connect(`ws://${host}:${port}`, password || undefined, {
        eventSubscriptions: OBSWebSocket.EventSubscription.All | OBSWebSocket.EventSubscription.InputVolumeMeters,
      });
    } catch (e) {
      pendingConnect = null;
      const err = new Error(e.code === 4009 ? "Wrong password" : `Can't reach OBS at ${host}:${port}`); err.code = e.code;
      reject(err);
    }
  });
}
obs.on("Identified", async () => {
  S.connected = true; banner(""); document.body.classList.add("connected");
  $("#connect").hidden = true; $("#app").hidden = false;
  $("#connPill").textContent = "OBS connected"; $("#connPill").className = "pill ok";
  log("Connected to OBS");
  try { await refreshAll(); } catch (e) { log("Refresh failed: " + e.message, true); }
  readyFns.forEach(f => { try { f(); } catch {} });
  pendingConnect?.resolve(); pendingConnect = null;
  if (!store.get("helpSeen", false)) openHelp();
});
obs.on("ConnectionClosed", e => {
  if (!S.connected) return;
  S.connected = false; document.body.classList.remove("connected");
  $("#connPill").textContent = "OBS disconnected"; $("#connPill").className = "pill bad";
  log(`Disconnected from OBS (${e.code || "?"})`, true);
  banner("Lost connection to OBS. Reconnecting…");
  if (window.Setup?.onDisconnect) Setup.onDisconnect(); else { $("#app").hidden = true; $("#connect").hidden = false; }
});

async function refreshAll() {
  const v = await call("GetVideoSettings"); S.canvas = { w: v.baseWidth, h: v.baseHeight };
  const quickPref = store.get("quick", false);
  const sm = (await call("GetStudioModeEnabled")).studioModeEnabled;
  if (sm === quickPref) await call("SetStudioModeEnabled", { studioModeEnabled: !quickPref });
  setStudio(!quickPref);
  await Promise.all([refreshScenes(), refreshTransitions(), refreshOutputs(), refreshInputs(), refreshKeyStatus()]);
}

/* ---------- scenes (diffed, so thumbnails never flash) ---------- */
const tileEls = new Map();
async function refreshScenes() {
  const r = await call("GetSceneList");
  S.scenes = r.scenes.slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName).filter(n => !n.startsWith("_LiveDesk"));
  S.program = r.currentProgramSceneName; S.preview = r.currentPreviewSceneName;
  renderScenes(); renderSceneLevels();
}
function renderScenes() {
  const box = $("#scenes");
  const key = S.scenes.join("\u0000");
  if (box.dataset.key !== key) {
    box.dataset.key = key; box.textContent = ""; tileEls.clear();
    if (!S.scenes.length) box.append(h("div", { class: "empty" }, h("b", {}, "No scenes yet."), " Press ", h("b", {}, "Starter scenes"), " for Starting Soon, Main Game, Casters, Break and Ending, or ", h("b", {}, "Add scene"), " to build your own."));
    S.scenes.forEach((name, i) => {
      const img = h("img", { class: "thumb", alt: "", src: S.thumbs[name] || "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" });
      const tile = h("div", { class: "tile", "data-scene": name },
        h("button", { class: "pick", "aria-label": `${name}${i < 9 ? `, key ${i + 1}` : ""}`, onclick: () => pickScene(name) },
          h("span", { class: "shot" }, img, i < 9 ? h("span", { class: "num" }, String(i + 1)) : null, h("span", { class: "tag" })),
          h("span", { class: "nm" }, name)),
        h("div", { class: "acts" },
          h("button", { class: "btn small", onclick: () => window.Editor?.openEdit(name) }, icon("edit"), "Edit"),
          h("button", { class: "btn small director", onclick: () => renameScene(name) }, "Rename"),
          h("button", { class: "btn small icon director del", "aria-label": `Delete ${name}: press 3 times`, title: "Delete: press 3 times", onclick: e => armDelete(e.currentTarget, name) }, icon("trash"))));
      tileEls.set(name, tile); box.append(tile);
    });
  }
  for (const [name, tile] of tileEls) {
    const isP = name === S.program, isV = S.studio && name === S.preview && !isP;
    tile.classList.toggle("is-program", isP); tile.classList.toggle("is-preview", isV);
    tile.querySelector(".tag").textContent = isP ? "On air" : isV ? "Next" : "";
  }
  window.Studio?.decorateTiles?.();
  // keep the on-air scene visible in the Scenes dock
  tileEls.get(S.program)?.scrollIntoView({ block: "nearest" });
  $("#nameProgram").textContent = S.program || "None";
  $("#namePreview").textContent = S.preview || "None";
}
/* Transitions hook: when a JhemsStream stinger is selected, transitions.js runs it (video over both scenes, cut at its point) */
const customTrans = () => window.Transitions?.isCustom?.();
async function pickScene(name) {
  if (S.studio) await call("SetCurrentPreviewScene", { sceneName: name });
  else if (customTrans()) await Transitions.toScene(name);
  else await call("SetCurrentProgramScene", { sceneName: name });
}
async function take() {
  if (!S.studio || S.preview === S.program) return;
  if (customTrans()) return Transitions.toScene(S.preview);
  await call("TriggerStudioModeTransition");
}
/* OBS ignores a transition change while a transition is still running (a studio-mode Cut reports ~1 s), so the
   one that was in use is put back after OBS says the switch ended, and checked until it sticks. */
function restoreTransition(name) {
  return new Promise(res => {
    let done = false;
    const go = async () => {
      if (done) return; done = true; obs.off("SceneTransitionEnded", go); clearTimeout(t);
      for (let i = 0; i < 8; i++) {
        await obs.call("SetCurrentSceneTransition", { transitionName: name }).catch(() => {});
        await new Promise(r => setTimeout(r, 120));
        if ((await obs.call("GetCurrentSceneTransition").catch(() => ({}))).transitionName === name) break;
        await new Promise(r => setTimeout(r, 250));
      }
      res();
    };
    const t = setTimeout(go, 2500);
    obs.on("SceneTransitionEnded", go);
  });
}
async function cut() {
  if (!S.studio) return;
  const cur = (await call("GetCurrentSceneTransition")).transitionName;
  await call("SetCurrentSceneTransition", { transitionName: "Cut" });
  const back = restoreTransition(cur);
  await call("TriggerStudioModeTransition");
  await back;
}
async function renameScene(name) {
  const n = prompt(`Rename "${name}" to:`, name);
  if (n && n.trim() && n !== name) await call("SetSceneName", { sceneName: name, newSceneName: n.trim() });
}
/* deleting takes three presses of the trash button; each press turns it a stronger red, and it calms down after 3 s */
function armDelete(btn, name) {
  if (name === S.program) return toast("That screen is on air. Switch to another screen first.", "warn");
  if (!btn) return;
  clearTimeout(btn._arm);
  const n = (+btn.dataset.arm || 0) + 1;
  const reset = () => { btn.dataset.arm = 0; btn.classList.remove("arm1", "arm2"); btn.title = "Delete: press 3 times"; btn.setAttribute("aria-label", `Delete ${name}: press 3 times`); };
  if (n >= 3) { reset(); log(`Deleted the screen ${name}`); return call("RemoveScene", { sceneName: name }); }
  btn.dataset.arm = n; btn.classList.toggle("arm1", n === 1); btn.classList.toggle("arm2", n === 2);
  const left = 3 - n; btn.title = `Press ${left} more time${left > 1 ? "s" : ""} to delete ${name}`; btn.setAttribute("aria-label", btn.title);
  btn._arm = setTimeout(reset, 3000);
}
async function deleteScene(name) {
  if (name === S.program) return toast("That screen is on air. Switch to another screen first.", "warn");
  if (confirm(`Delete the screen "${name}"? This can't be undone.`)) await call("RemoveScene", { sceneName: name });
}

/* live thumbnails: decode first, then swap, so frames never blank */
/* a request that was in flight when OBS went away never settles; the frame loops give up on it instead of freezing */
const timed = (p, ms = 3000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("OBS took too long")), ms))]);
async function shot(name, w) {
  return (await timed(obs.call("GetSourceScreenshot", { sourceName: name, imageFormat: "jpg", imageWidth: w, imageCompressionQuality: 62 }))).imageData;
}
async function swapImg(img, src) { const t = new Image(); t.src = src; try { await t.decode(); } catch {} img.src = src; }
let gridBusy = false, gridIdx = 0;
/* each monitor runs its own loop and asks for the next frame as soon as one arrives (capped near 30 fps),
   at the size it is drawn, so neither waits on the other. ponytail: still screenshots over the websocket;
   true video would need OBS's virtual camera, which other apps (Discord) could pick up. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function monitorLoop(img, name) {
  for (;;) {
    const n = name();
    if (!S.connected || document.hidden || !n || !img.offsetWidth) { await sleep(250); continue; }
    const t0 = performance.now();
    const w = Math.round(Math.min(960, Math.max(320, img.offsetWidth * devicePixelRatio)) / 16) * 16;
    try { swapImg(img, (await timed(obs.call("GetSourceScreenshot", { sourceName: n, imageFormat: "jpg", imageWidth: w, imageCompressionQuality: 55 }))).imageData); }
    catch { await sleep(400); }
    await sleep(Math.max(0, 33 - (performance.now() - t0)));
  }
}
monitorLoop($("#imgProgram"), () => S.program);
monitorLoop($("#imgPreview"), () => S.studio ? S.preview : null);
setInterval(async () => {
  if (!S.connected || gridBusy || document.hidden || !S.scenes.length) return; gridBusy = true;
  try {
    const name = S.scenes[gridIdx++ % S.scenes.length];
    S.thumbs[name] = await shot(name, 360);
    const img = tileEls.get(name)?.querySelector("img.thumb"); if (img) await swapImg(img, S.thumbs[name]);
  } catch {} finally { gridBusy = false; }
}, 350);

/* ---------- studio / instant ---------- */
function setStudio(on) {
  S.studio = on; document.body.classList.toggle("quick", !on);
  $("#btnStudio").setAttribute("aria-pressed", String(on)); $("#btnStudio").classList.toggle("on", on);
  renderScenes(); window.Settings?.sync?.();
}
/* Studio Mode on = Preview then Transition; off = instant mode, clicking a scene puts it on air */
async function setStudioMode(on) {
  store.set("quick", !on);
  await call("SetStudioModeEnabled", { studioModeEnabled: on });
}
$("#btnStudio").addEventListener("click", () => setStudioMode(!S.studio));

/* ---------- transitions, bunting progress, T-bar ---------- */
const FLAGS = 22, HUES = ["m", "y", "c", "l"];
$("#transProgress").append(...Array.from({ length: FLAGS }, (_, i) => h("i", { class: `flag f-${HUES[i % 4]}`, style: `--i:${i}` })));
async function refreshTransitions() {
  const r = await call("GetSceneTransitionList");
  for (const sel of [$("#selTrans"), $("#selTrans2")]) {
    sel.textContent = "";
    r.transitions.forEach(t => sel.append(h("option", { value: t.transitionName }, t.transitionName)));
    sel.value = r.currentSceneTransitionName;
  }
  const cur = await call("GetCurrentSceneTransition");
  S.transDur = cur.transitionDuration ?? 300; S.transFixed = !!cur.transitionFixed;
  for (const inp of [$("#inDur"), $("#inDur2")]) { inp.value = S.transFixed ? "" : S.transDur; inp.disabled = S.transFixed; }
  $("#tbar").classList.toggle("disabled", S.transFixed);
}
for (const sel of ["#selTrans", "#selTrans2"]) $(sel).addEventListener("change", e => call("SetCurrentSceneTransition", { transitionName: e.target.value }));
for (const inp of ["#inDur", "#inDur2"]) $(inp).addEventListener("change", e => {
  const ms = Math.min(20000, Math.max(50, Number(e.target.value) || 300));
  call("SetCurrentSceneTransitionDuration", { transitionDuration: ms });
});
function runBunting(ms) {
  const b = $("#transProgress");
  b.classList.remove("run"); void b.offsetWidth;
  b.style.setProperty("--dur", Math.max(120, ms) + "ms"); b.classList.add("run");
  $(".mon-program").classList.add("taking");
  setTimeout(() => { b.classList.remove("run"); $(".mon-program").classList.remove("taking"); }, Math.max(120, ms) + 450);
}
obs.on("SceneTransitionStarted", () => { if (!tbarDragging) runBunting(S.transFixed ? 0 : S.transDur); });

let tbarDragging = false, tbarPos = 0, tbarSent = 0;
const tbar = $("#tbar");
function setTbarUI(p) { tbarPos = p; tbar.style.setProperty("--p", p); tbar.setAttribute("aria-valuenow", Math.round(p * 100)); $("#transProgress").style.setProperty("--manual", p); }
function sendTbar(p, release) {
  const now = performance.now();
  if (!release && now - tbarSent < 33) return; tbarSent = now;
  obs.call("SetTBarPosition", { position: Math.min(1, Math.max(0, p)), release }).catch(() => {});
}
function settleTbar() {
  const to = tbarPos > 0.5 ? 1 : 0, from = tbarPos, t0 = performance.now();
  const step = () => {
    const x = Math.min(1, (performance.now() - t0) / 220), p = from + (to - from) * (1 - Math.pow(1 - x, 3));
    setTbarUI(p); sendTbar(p, false);
    if (x < 1) requestAnimationFrame(step);
    else { sendTbar(to, true); setTimeout(() => { setTbarUI(0); tbar.classList.remove("dragging"); $("#transProgress").classList.remove("manual"); }, 120); tbarDragging = false; }
  };
  requestAnimationFrame(step);
}
tbar.addEventListener("pointerdown", e => {
  if (!S.studio || S.transFixed || S.preview === S.program) return;
  tbarDragging = true; tbar.setPointerCapture(e.pointerId); tbar.classList.add("dragging"); $("#transProgress").classList.add("manual");
  const r = tbar.getBoundingClientRect(), y0 = e.clientY;
  const move = ev => { const p = Math.min(1, Math.max(0, (ev.clientY - y0) / (r.height - 24) + 0)); setTbarUI(p); sendTbar(p, false); };
  const up = () => { tbar.removeEventListener("pointermove", move); tbar.removeEventListener("pointerup", up); tbar.removeEventListener("pointercancel", up); settleTbar(); };
  tbar.addEventListener("pointermove", move); tbar.addEventListener("pointerup", up); tbar.addEventListener("pointercancel", up);
});
tbar.addEventListener("keydown", e => {
  if (!S.studio || S.transFixed) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); tbarDragging = true; $("#transProgress").classList.add("manual");
    setTbarUI(Math.min(1, Math.max(0, tbarPos + (e.key === "ArrowDown" ? 0.1 : -0.1)))); sendTbar(tbarPos, false);
    if (tbarPos >= 1 || tbarPos <= 0) settleTbar();
  }
});

/* ---------- stream / record / health ---------- */
async function refreshOutputs() {
  setStreaming((await call("GetStreamStatus")).outputActive);
  setRecording((await call("GetRecordStatus")).outputActive);
}
function setStreaming(on) {
  S.streaming = on; document.body.classList.toggle("streaming", on); $("#onair").hidden = !on;
  $("#btnLive").textContent = on ? "Stop streaming" : "Start streaming"; $("#btnLive").classList.toggle("on", on);
}
function setRecording(on) {
  S.recording = on; const b = $("#btnRec"); b.textContent = on ? "Stop recording" : "Start recording"; b.classList.toggle("on", on);
}
$("#btnLive").addEventListener("click", async () => {
  if (S.streaming) { if (confirm("End the live stream for everyone?")) await call("StopStream"); return; }
  const ss = await call("GetStreamServiceSettings");
  if (!ss.streamServiceSettings?.key) { toast("OBS has no stream key yet. Get it from Facebook first.", "warn"); selectTab("live"); return; }
  const done = checklist.filter((_, i) => checks[i]).length;
  const note = done < checklist.length ? `\n\nChecklist: ${done} of ${checklist.length} done.` : "";
  if (confirm(`Start streaming? "${S.program}" is on Program.${note}\n\nWhen Facebook shows the preview, press "Go live" in Live Producer too.`)) await call("StartStream");
});
$("#btnRec").addEventListener("click", () => call(S.recording ? "StopRecord" : "StartRecord"));
let lastBytes = 0, lastT = 0;
function stat(id, label, val, level) { const el = $(id); el.className = level || ""; el.textContent = label + " "; el.append(h("b", {}, val)); }
/* OBS 33 crashes in GetStats (GetCurrentOutputPath) when it runs while a profile switch rebuilds the outputs.
   Before such a switch JhemsStream goes quiet here and tells every other JhemsStream on this OBS to do the same. */
S.quietUntil = 0;
async function quiet(ms) {
  S.quietUntil = Date.now() + ms;
  await obs.call("BroadcastCustomEvent", { eventData: { jhemsstream: "quiet", ms } }).catch(() => {});
}
obs.on("CustomEvent", d => { if (d?.jhemsstream === "quiet") S.quietUntil = Date.now() + (+d.ms || 6000); });
setInterval(async () => {
  if (!S.connected || Date.now() < S.quietUntil) return;
  try {
    const st = await obs.call("GetStats");
    stat("#sFps", "FPS", st.activeFps.toFixed(0), st.activeFps < 25 ? "bad" : "");
    stat("#sCpu", "CPU", st.cpuUsage.toFixed(0) + "%", st.cpuUsage > 85 ? "bad" : st.cpuUsage > 70 ? "warn" : "");
    if (S.streaming) {
      const s = await obs.call("GetStreamStatus"), now = performance.now();
      const kbps = lastT ? ((s.outputBytes - lastBytes) * 8 / ((now - lastT) / 1000) / 1000) : 0;
      lastBytes = s.outputBytes; lastT = now;
      const drop = s.outputTotalFrames ? (100 * s.outputSkippedFrames / s.outputTotalFrames) : 0;
      stat("#sBitrate", "Bitrate", kbps ? Math.round(kbps).toLocaleString() + " kbps" : "…", kbps && kbps < 1500 ? "bad" : kbps && kbps < 3000 ? "warn" : "");
      stat("#sDrop", "Dropped frames", `${s.outputSkippedFrames} (${drop.toFixed(1)}%)`, drop > 5 ? "bad" : drop > 1 ? "warn" : "");
      $("#liveTime").textContent = (s.outputTimecode || "").slice(0, 8);
    } else { lastBytes = 0; lastT = 0; stat("#sBitrate", "Bitrate", "off air"); stat("#sDrop", "Dropped frames", "off air"); }
  } catch {}
}, 2000);

/* ---------- Facebook stream key ---------- */
async function refreshKeyStatus() {
  const ss = await call("GetStreamServiceSettings");
  const k = ss.streamServiceSettings?.key || "";
  $("#fbStatus").textContent = k ? `OBS has a key ending …${k.slice(-4)}` : "OBS has no stream key yet";
}
$("#btnGetKey").addEventListener("click", () => openExt("https://www.facebook.com/live/producer"));
$("#fbShow").addEventListener("click", () => { const i = $("#fbKey"); const show = i.type === "password"; i.type = show ? "text" : "password"; $("#fbShow").textContent = show ? "Hide" : "Show"; });
$("#btnFbSend").addEventListener("click", async () => {
  const key = $("#fbKey").value.trim(), server = $("#fbServer").value.trim();
  if (!key) return toast("Paste the stream key from Facebook Live Producer first.", "warn");
  if (S.streaming) return toast("End the stream before changing the key.", "warn");
  await call("SetStreamServiceSettings", { streamServiceType: "rtmp_custom", streamServiceSettings: { server, key, use_auth: false } });
  $("#fbKey").value = ""; $("#fbKey").type = "password"; $("#fbShow").textContent = "Show";
  log("Stream key saved to OBS"); toast("Stream key saved to OBS"); refreshKeyStatus();
});

/* ---------- audio mixer + tools ---------- */
// dshow_input is left out: capture cards and webcams carry game or room sound, not a caster mic
const MIC_KINDS = ["wasapi_input_capture", "coreaudio_input_capture", "pulse_input_capture"];
async function refreshInputs() {
  const list = (await call("GetInputList")).inputs;
  // window/game captures report the audio cap even when "capture audio" is off; OBS's own mixer hides those
  // browser sources only reach OBS's mixer with "Control audio via OBS" (reroute_audio); like OBS, hide them otherwise
  const flag = async (i, k) => !!(await obs.call("GetInputSettings", { inputName: i.inputName }).catch(() => null))?.inputSettings?.[k];
  const hasAudio = async i => /^(window|game)_capture$/.test(i.unversionedInputKind) ? flag(i, "capture_audio")
    : i.unversionedInputKind === "browser_source" ? flag(i, "reroute_audio") : true;
  const audio = [];
  for (const i of list.filter(i => i.inputKindCaps & 2)) if (await hasAudio(i)) audio.push(i);
  S.audio = await Promise.all(audio.map(async i => {
    const [v, m, mon] = await Promise.all([
      obs.call("GetInputVolume", { inputName: i.inputName }), obs.call("GetInputMute", { inputName: i.inputName }),
      obs.call("GetInputAudioMonitorType", { inputName: i.inputName }).catch(() => ({ monitorType: "OBS_MONITORING_TYPE_NONE" }))]);
    return { name: i.inputName, kind: i.unversionedInputKind, db: v.inputVolumeDb, muted: m.inputMuted, monitor: mon.monitorType !== "OBS_MONITORING_TYPE_NONE" };
  }));
  renderMixer(); renderDuckSources();
  const texts = list.filter(i => i.unversionedInputKind.startsWith("text_"));
  S.texts = await Promise.all(texts.map(async i => ({ name: i.inputName, text: (await obs.call("GetInputSettings", { inputName: i.inputName })).inputSettings.text || "" })));
  renderTexts();
}
const meterEls = {}, peakHold = {};
const fmtDb = d => (d <= -60 ? "−∞" : (d > 0 ? "+" : "") + d.toFixed(1)) + " dB";
function renderMixer() {
  const box = $("#mixer"); box.textContent = "";
  if (!S.audio.length) box.append(h("div", { class: "empty" }, "No audio sources. In OBS open Settings → Audio and pick your Desktop Audio and Mic."));
  const hidden = new Set(store.get("mixHidden", []));
  for (const a of S.audio) {
    if (hidden.has(a.name)) continue;
    const fill = h("i", { class: "fill" }), peak = h("i", { class: "peak" }); meterEls[a.name] = { fill, peak };
    const range = h("input", { type: "range", min: -60, max: 6, step: 0.5, value: Math.max(-60, a.db), "aria-label": `${a.name} volume` });
    const dbLbl = h("span", { class: "db" }, fmtDb(a.db));
    range.addEventListener("input", () => { dbLbl.textContent = fmtDb(+range.value); obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: +range.value }).catch(() => {}); });
    // OBS layout: name and level on top, meter, then fader with icon buttons beside it
    const mute = h("button", { class: `btn small icon mute${a.muted ? " on" : ""}`, "aria-pressed": String(a.muted), title: a.muted ? "Unmute (fades in)" : "Mute (fades out)", "aria-label": `${a.muted ? "Unmute" : "Mute"} ${a.name}`, onclick: () => fadeMute(a) }, icon(a.muted ? "mute" : "vol"));
    const mon = h("button", { class: `btn small icon${a.monitor ? " on" : ""}`, "aria-pressed": String(a.monitor), title: "Hear it in your headphones", "aria-label": `Monitor ${a.name}`, onclick: () => toggleMonitor(a) }, icon("phones"));
    const tools = MIC_KINDS.includes(a.kind) ? h("button", { class: "btn small icon", title: "Clean up: noise removal, compressor and limiter", "aria-label": `Clean up ${a.name}`, onclick: () => cleanMic(a.name) }, icon("wand")) : null;
    box.append(h("div", { class: `mixrow${a.muted ? " muted-row" : ""}`, "data-input": a.name },
      h("div", { class: "mixhead" }, h("b", { class: "grow", title: a.name }, a.name), a.muted ? h("span", { class: "mutedtag" }, "Muted") : null, dbLbl),
      h("div", { class: "meter" }, fill, peak),
      h("div", { class: "mixctl" }, range, tools, mon, mute)));
  }
}
obs.on("InputVolumeMeters", ({ inputs }) => {
  const now = performance.now();
  for (const i of inputs) {
    const db = levelDb(i);
    Duck.feed(i.inputName, db);
    const el = meterEls[i.inputName]; if (!el) continue;
    const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    el.fill.style.transform = `scaleX(${pct / 100})`;
    const ph = peakHold[i.inputName];
    if (!ph || pct >= ph.v || now - ph.t > 1200) peakHold[i.inputName] = { v: pct, t: now };
    el.peak.style.setProperty("--peak", (peakHold[i.inputName].v / 100 * el.peak.parentElement.clientWidth) + "px");
  }
});
function levelDb(i) { const peak = Math.max(0, ...(i.inputLevelsMul || []).map(c => c[1] || 0)); return peak > 0 ? 20 * Math.log10(peak) : -60; }
async function fadeMute(a) {
  if (a.fading) return; // a second click mid-fade would read a half-faded level as the one to restore
  a.fading = true;
  const steps = 12, base = a.db;
  try {
  if (!a.muted) {
    for (let k = 1; k <= steps; k++) { await obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: base + (-60 - base) * (k / steps) ** 2 }).catch(() => {}); await new Promise(r => setTimeout(r, 30)); }
    await call("SetInputMute", { inputName: a.name, inputMuted: true });
    await call("SetInputVolume", { inputName: a.name, inputVolumeDb: base });
  } else {
    await call("SetInputVolume", { inputName: a.name, inputVolumeDb: -60 });
    await call("SetInputMute", { inputName: a.name, inputMuted: false });
    for (let k = 1; k <= steps; k++) { await obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: -60 + (base + 60) * Math.sqrt(k / steps) }).catch(() => {}); await new Promise(r => setTimeout(r, 30)); }
  }
  } finally { a.fading = false; a.db = base; }
}
async function toggleMonitor(a) {
  await call("SetInputAudioMonitorType", { inputName: a.name, monitorType: a.monitor ? "OBS_MONITORING_TYPE_NONE" : "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" });
  a.monitor = !a.monitor; renderMixer();
}
async function ensureFilter(source, name, kind, settings) {
  const list = (await call("GetSourceFilterList", { sourceName: source })).filters;
  if (list.some(f => f.filterName === name)) { await call("SetSourceFilterEnabled", { sourceName: source, filterName: name, filterEnabled: true }); return false; }
  await call("CreateSourceFilter", { sourceName: source, filterName: name, filterKind: kind, filterSettings: settings });
  return true;
}
async function cleanMic(name) {
  try {
    await ensureFilter(name, "JS Noise removal", "noise_suppress_filter_v2", { method: "rnnoise" });
    await ensureFilter(name, "JS Compressor", "compressor_filter", { ratio: 4, threshold: -20, attack_time: 6, release_time: 60, output_gain: 3 });
    await ensureFilter(name, "JS Limiter", "limiter_filter", { threshold: -3, release_time: 60 });
    toast(`${name}: noise removal, compressor and limiter on`); log(`Cleaned up ${name}`);
  } catch (e) { toast(`Couldn't add filters to ${name}: ${e.message}`, "bad"); }
}
$("#btnCleanMics").addEventListener("click", async () => {
  const mics = S.audio.filter(a => MIC_KINDS.includes(a.kind));
  if (!mics.length) return toast("No microphones found in OBS.", "warn");
  for (const m of mics) await cleanMic(m.name);
});
$("#btnProtect").addEventListener("click", async () => {
  for (const a of S.audio) { try { await ensureFilter(a.name, "JS Limiter", "limiter_filter", { threshold: -3, release_time: 60 }); } catch {} }
  toast(`Limiter on ${S.audio.length} audio sources. Sudden loud sounds get capped at −3 dB.`);
});
obs.on("InputMuteStateChanged", ({ inputName, inputMuted }) => {
  const a = S.audio.find(x => x.name === inputName); if (a) { a.muted = inputMuted; renderMixer(); }
});
obs.on("InputVolumeChanged", ({ inputName, inputVolumeDb }) => {
  const a = S.audio.find(x => x.name === inputName); if (!a) return;
  if (!a.fading) a.db = inputVolumeDb; // fade steps are not the user's level
  const row = [...$$(".mixrow")].find(r => r.dataset.input === inputName); if (!row) return;
  const range = row.querySelector("input[type=range]");
  if (document.activeElement !== range) { range.value = Math.max(-60, inputVolumeDb); row.querySelector(".db").textContent = fmtDb(inputVolumeDb); }
});

/* ---------- ducking: music dips while chosen sources are loud ---------- */
const Duck = {
  sources: new Set(store.get("duckSources", null) || []), depth: store.get("duckDepth", 0.3), threshold: -38,
  lastLoud: 0, on: false, init: store.get("duckSources", null) === null,
  feed(name, db) {
    if (!this.sources.has(name)) return;
    const now = performance.now();
    if (db > this.threshold) { this.lastLoud = now; if (!this.on) { this.on = true; Music.setDuck(true, this.depth); } }
  },
};
setInterval(() => { if (Duck.on && performance.now() - Duck.lastLoud > 700) { Duck.on = false; Music.setDuck(false); } }, 100);
function renderDuckSources() {
  if (Duck.init) { S.audio.filter(a => MIC_KINDS.includes(a.kind)).forEach(a => Duck.sources.add(a.name)); Duck.init = false; }
  const box = $("#duckSources"); box.textContent = "";
  for (const a of S.audio) {
    const cb = h("input", { type: "checkbox" }); cb.checked = Duck.sources.has(a.name);
    cb.addEventListener("change", () => { cb.checked ? Duck.sources.add(a.name) : Duck.sources.delete(a.name); store.set("duckSources", [...Duck.sources]); });
    box.append(h("label", { class: "check" }, cb, a.name));
  }
}
$("#mDuckDepth").value = Duck.depth; $("#mDuckTxt").textContent = Math.round(Duck.depth * 100) + "%";
$("#mDuckDepth").addEventListener("input", e => { Duck.depth = +e.target.value; store.set("duckDepth", Duck.depth); $("#mDuckTxt").textContent = Math.round(Duck.depth * 100) + "%"; if (Duck.on) Music.setDuck(true, Duck.depth); });

/* ---------- music UI: moved to musicui.js; the two no-ops keep the startup calls at the end of this file harmless ---------- */

/* follow the show: per-screen music level */
const defaultLevel = n => /game|match|play/i.test(n) ? 0.25 : /caster|interview|talk/i.test(n) ? 0.35 : 1;
const sceneLevel = n => { const m = store.get("sceneLevels", {}); return n in m ? m[n] : defaultLevel(n); };
function renderSceneLevels() {
  const box = $("#sceneLevels"); box.textContent = "";
  for (const n of S.scenes) {
    const r = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: sceneLevel(n), "aria-label": `Music level on ${n}` });
    const num = h("input", { type: "number", min: 0, max: 100, step: 1, value: Math.round(sceneLevel(n) * 100), "aria-label": `Music level on ${n}, percent` });
    const apply = v => { v = Math.max(0, Math.min(1, v)); const m = store.get("sceneLevels", {}); m[n] = v; store.set("sceneLevels", m); if (n === S.program) Music.setScene(v); };
    r.addEventListener("input", () => { num.value = Math.round(r.value * 100); apply(+r.value); });
    num.addEventListener("input", () => { if (num.value === "") return; r.value = num.value / 100; apply(num.value / 100); });
    box.append(h("div", { class: "lvlrow" }, h("span", {}, n), r, h("span", { class: "pct" }, num, "%")));
  }
  if (S.program && Math.abs(Music.st.sceneLevel - sceneLevel(S.program)) > 0.001) Music.setScene(sceneLevel(S.program));
}

/* ---------- scoreboard + other text ---------- */
const SB = { a: "Team A Name", b: "Team B Name", sa: "Score A", sb: "Score B" };
const textOf = n => S.texts.find(t => t.name === n)?.text ?? null;
const setText = (n, text) => call("SetInputSettings", { inputName: n, inputSettings: { text } });
function renderTexts() {
  const sb = $("#scoreBox"); sb.textContent = "";
  if (!Object.values(SB).every(n => textOf(n) !== null)) sb.append(h("div", { class: "empty" }, "No scoreboard yet. A Director can press ", h("b", {}, "Add starter screens"), " to create one on Main Game."));
  else {
    const team = (nk, sk, side) => {
      const inp = h("input", { value: textOf(SB[nk]), "aria-label": `Team ${side} name`, class: "grow" });
      inp.addEventListener("change", () => setText(SB[nk], inp.value));
      const n = Number(textOf(SB[sk])) || 0;
      return h("div", { class: `scorecard side-${side}` }, inp,
        h("div", { class: "scorectl" },
          h("button", { class: "btn icon", "aria-label": `Team ${side} minus one`, onclick: () => setText(SB[sk], String(Math.max(0, n - 1))) }, icon("minus")),
          h("span", { class: "n" }, String(n)),
          h("button", { class: "btn icon primary", "aria-label": `Team ${side} plus one`, onclick: () => setText(SB[sk], String(n + 1)) }, icon("plus"))));
    };
    sb.append(team("a", "sa", "A"), team("b", "sb", "B"), h("div", { class: "row" },
      h("button", { class: "btn", onclick: swapSides }, "Swap sides"),
      h("button", { class: "btn", onclick: () => { if (confirm("Reset both scores to 0?")) { setText(SB.sa, "0"); setText(SB.sb, "0"); } } }, "Reset scores")));
  }
  const tb = $("#textBox"); tb.textContent = "";
  const others = S.texts.filter(t => !Object.values(SB).includes(t.name));
  if (!others.length) tb.append(h("p", { class: "muted small" }, "None."));
  for (const t of others) {
    const inp = h("input", { value: t.text, "aria-label": t.name });
    inp.addEventListener("change", () => setText(t.name, inp.value));
    tb.append(h("label", { class: "field" }, h("span", {}, t.name), inp));
  }
}
async function swapSides() {
  const [a, b, sa, sb] = [textOf(SB.a), textOf(SB.b), textOf(SB.sa), textOf(SB.sb)];
  await Promise.all([setText(SB.a, b), setText(SB.b, a), setText(SB.sa, sb), setText(SB.sb, sa)]);
}
obs.on("InputSettingsChanged", ({ inputName, inputSettings }) => {
  const t = S.texts.find(x => x.name === inputName);
  if (t && "text" in inputSettings) { t.text = inputSettings.text; if (!document.activeElement?.matches("#scoreBox input, #textBox input")) renderTexts(); }
});

/* ---------- OBS events ---------- */
obs.on("CurrentProgramSceneChanged", ({ sceneName }) => {
  S.program = sceneName; renderScenes(); log(`On air: ${sceneName}`);
  Music.setScene(sceneLevel(sceneName));
});
obs.on("CurrentPreviewSceneChanged", ({ sceneName }) => { S.preview = sceneName; renderScenes(); });
obs.on("SceneListChanged", () => refreshScenes());
obs.on("SceneNameChanged", ({ oldSceneName, sceneName }) => { S.thumbs[sceneName] = S.thumbs[oldSceneName]; refreshScenes(); });
obs.on("StudioModeStateChanged", ({ studioModeEnabled }) => setStudio(studioModeEnabled));
obs.on("StreamStateChanged", ({ outputActive, outputState }) => {
  setStreaming(outputActive);
  const s = outputState.replace("OBS_WEBSOCKET_OUTPUT_", "").toLowerCase();
  log(`Stream: ${s}`, s === "reconnecting");
  if (s === "reconnecting") banner("The stream is reconnecting. Check the internet connection.");
  if (s === "reconnected" || s === "stopped") banner("");
  if (s === "started") toast("You're live. Press Go live in Facebook Live Producer if you haven't.", "ok");
});
obs.on("RecordStateChanged", ({ outputActive }) => setRecording(outputActive));
for (const ev of ["CurrentSceneTransitionChanged", "CurrentSceneTransitionDurationChanged", "SceneTransitionCreated", "SceneTransitionRemoved"]) obs.on(ev, () => refreshTransitions().catch(() => {}));
for (const ev of ["InputCreated", "InputRemoved", "InputNameChanged"]) obs.on(ev, () => refreshInputs().catch(() => {}));

/* ---------- starter screens (safe to run twice) ---------- */
const ABGR = hex => (0xff000000 | parseInt(hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3), 16)) >>> 0;
async function ensureInput(scene, name, kind, settings, transform) {
  if ((await call("GetInputList")).inputs.some(i => i.inputName === name)) return;
  const { sceneItemId } = await call("CreateInput", { sceneName: scene, inputName: name, inputKind: kind, inputSettings: settings });
  if (transform) await call("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform: transform });
}
const text = (t, size, color = "#ffffff") => ({ text: t, font: { face: "Arial", size, style: "Bold", flags: 1 }, color: ABGR(color), outline: true, outline_size: 6, outline_color: ABGR("#1B1530"), align: "center", valign: "center" });
$("#btnStarter").addEventListener("click", async () => {
  if (!confirm("Add starter screens: Starting Soon, Main Game with a scoreboard, Casters, Break and Ending? Screens with these names already are left alone.")) return;
  const { w, h: H } = S.canvas, mid = { alignment: 0, positionX: w / 2, positionY: H / 2 };
  const have = new Set(S.scenes);
  const mk = async n => { if (!have.has(n)) { await call("CreateScene", { sceneName: n }); have.add(n); } };
  try {
    for (const [scene, title, bg] of [["Starting Soon", "STARTING SOON", "#E6297B"], ["Break", "BE RIGHT BACK", "#19B5D8"], ["Ending", "THANKS FOR WATCHING", "#1B1530"]]) {
      await mk(scene);
      await ensureInput(scene, `${scene} Background`, "color_source_v3", { color: ABGR(bg), width: w, height: H });
      await ensureInput(scene, `${scene} Title`, "text_gdiplus_v3", text(title, 140), mid);
    }
    await mk("Casters");
    await ensureInput("Casters", "Casters Background", "color_source_v3", { color: ABGR("#1B1530"), width: w, height: H });
    await ensureInput("Casters", "Casters Title", "text_gdiplus_v3", text("CASTERS", 64, "#FFC928"), { alignment: 0, positionX: w / 2, positionY: H * 0.1 });
    await mk("Scoreboard");
    const y = 60;
    await ensureInput("Scoreboard", "Scoreboard Bar", "color_source_v3", { color: ABGR("#1B1530"), width: 900, height: 100 }, { alignment: 0, positionX: w / 2, positionY: y });
    await ensureInput("Scoreboard", SB.a, "text_gdiplus_v3", text("TEAM A", 44), { alignment: 0, positionX: w / 2 - 260, positionY: y });
    await ensureInput("Scoreboard", SB.sa, "text_gdiplus_v3", text("0", 64, "#FFC928"), { alignment: 0, positionX: w / 2 - 60, positionY: y });
    await ensureInput("Scoreboard", SB.sb, "text_gdiplus_v3", text("0", 64, "#FFC928"), { alignment: 0, positionX: w / 2 + 60, positionY: y });
    await ensureInput("Scoreboard", SB.b, "text_gdiplus_v3", text("TEAM B", 44), { alignment: 0, positionX: w / 2 + 260, positionY: y });
    await mk("Main Game");
    const items = (await call("GetSceneItemList", { sceneName: "Main Game" })).sceneItems;
    if (!items.some(i => i.sourceName === "Scoreboard")) await call("CreateSceneItem", { sceneName: "Main Game", sourceName: "Scoreboard" });
    toast("Starter scenes ready. Next: Edit on Main Game, then Add source, then Discord screen share.");
  } catch (e) { toast("Starter screens stopped: " + e.message, "bad"); }
  await refreshScenes(); refreshInputs();
});
/* ---------- SITE look: Ready Player SITE graphics as browser sources over the plain text ----------
   The text inputs stay as the data (the Scores tab still edits them); they're only hidden. */
const LOOK = [
  ...["Starting Soon", "Break", "Ending", "Casters"].map(sc => ({ scene: sc, kind: "title", src: `${sc} Title`, hide: [`${sc} Title`] })),
  { scene: "Scoreboard", kind: "scoreboard", hide: ["Scoreboard Bar", ...Object.values(SB)] },
];
const lookName = sc => `SITE ${sc} Graphic`;
async function itemId(scene, source) { try { return (await obs.call("GetSceneItemId", { sceneName: scene, sourceName: source })).sceneItemId; } catch { return null; } }
$("#btnSiteLook").addEventListener("click", async () => {
  if (!window.__TAURI__) return toast("The SITE look needs the desktop app on the streaming PC.", "warn");
  const inputs = new Set((await call("GetInputList")).inputs.map(i => i.inputName));
  const on = LOOK.some(l => inputs.has(lookName(l.scene)));
  if (on) {
    if (!confirm("Remove the Ready Player SITE graphics and show the plain text again?")) return;
    for (const l of LOOK) {
      if (inputs.has(lookName(l.scene))) await call("RemoveInput", { inputName: lookName(l.scene) });
      for (const n of l.hide) { const id = await itemId(l.scene, n); if (id != null) await call("SetSceneItemEnabled", { sceneName: l.scene, sceneItemId: id, sceneItemEnabled: true }); }
    }
    toast("Plain text is back.");
    return;
  }
  if (!confirm("Add the Ready Player SITE graphics to Starting Soon, Break, Ending, Casters and the Scoreboard? Your backgrounds and layout stay. The plain text is hidden, not deleted, and the Scores tab keeps working. Press this button again to undo.")) return;
  try {
    const dir = String(await window.__TAURI__.core.invoke("stinger_dir")).replace(/\\/g, "/").replace(/\/+$/, "");
    const base = "file:///" + encodeURI(dir) + "/overlay.html#";
    const { w, h: H } = S.canvas;
    let done = 0;
    for (const l of LOOK) {
      if (!S.scenes.includes(l.scene)) continue;
      const q = new URLSearchParams({ kind: l.kind, port: S.port || 4455, pw: S.pw || "" });
      if (l.kind === "title") {
        const id = await itemId(l.scene, l.src); if (id == null) continue;
        const tr = (await call("GetSceneItemTransform", { sceneName: l.scene, sceneItemId: id })).sceneItemTransform;
        q.set("src", l.src); q.set("t", textOf(l.src) ?? ""); q.set("y", (tr.positionY / H).toFixed(3));
      }
      const settings = { url: base + q, width: w, height: H, fps: 60, shutdown: false, restart_when_active: false, reroute_audio: false };
      const name = lookName(l.scene);
      const { sceneItemId } = await call("CreateInput", { sceneName: l.scene, inputName: name, inputKind: "browser_source", inputSettings: settings });
      const n = (await call("GetSceneItemList", { sceneName: l.scene })).sceneItems.length;
      await call("SetSceneItemIndex", { sceneName: l.scene, sceneItemId, sceneItemIndex: n - 1 });
      for (const hn of l.hide) { const id = await itemId(l.scene, hn); if (id != null) await call("SetSceneItemEnabled", { sceneName: l.scene, sceneItemId: id, sceneItemEnabled: false }); }
      done++;
    }
    toast(done ? `SITE look added to ${done} screen${done > 1 ? "s" : ""}.` : "No starter screens found. Press Starter scenes first.", done ? "ok" : "warn");
  } catch (e) { toast("SITE look stopped: " + e.message, "bad"); }
});
$("#btnNew").addEventListener("click", () => window.Editor?.openNew());

/* ---------- checklist ---------- */
const checklist = [
  "Streaming PC plugged in, sleep turned off, Windows notifications off",
  "Wired internet if possible. Upload at least 6 Mbps (Speed test link)",
  "Discord stream popped out and full screen, showing on Main Game",
  "Game sound comes through once (no echo from Desktop Audio and Discord both)",
  "Caster mics cleaned up; meters move in the light part, never hit the end",
  "Music folder loaded; high-risk songs checked or hidden",
  "Desktop Audio is unmuted in OBS (music plays through it)",
  "Team names and scores set",
  "Stream key saved from Facebook Live Producer (posting as the org Page)",
  "Private test stream done (Facebook audience: Only me)",
  "Starting Soon is on air before GO LIVE",
  "Backup recording started",
];
let checks = store.get("checks", []);
function renderChecks() {
  const box = $("#checklist"); box.textContent = "";
  checklist.forEach((c, i) => {
    const cb = h("input", { type: "checkbox", id: `ck${i}` }); cb.checked = !!checks[i];
    cb.addEventListener("change", () => { checks[i] = cb.checked; store.set("checks", checks); renderChecks(); });
    box.append(h("label", { class: "check", for: `ck${i}` }, cb, c));
  });
  $("#checkCount").textContent = `${checklist.filter((_, i) => checks[i]).length} of ${checklist.length} done`;
}
$("#btnCheckReset").addEventListener("click", () => { checks = []; store.set("checks", checks); renderChecks(); });
renderChecks();

/* ---------- tabs, roles, links ---------- */
function selectTab(id) {
  $$("[role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
  $$("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== id);
}
$$("[role=tab]").forEach(b => b.addEventListener("click", () => selectTab(b.dataset.tab)));
function setRole(r) {
  document.body.dataset.role = r; $("#role").value = r; store.set("role", r);
  if (r === "scores") selectTab("score");
}
$("#role").addEventListener("change", e => setRole(e.target.value));
setRole(store.get("role", "director"));
document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openExt(b.dataset.open); });

/* ---------- hotkeys ---------- */
document.addEventListener("keydown", e => {
  if (e.target.closest("input, select, textarea, dialog, [role=slider]") || e.ctrlKey || e.metaKey || e.altKey || !S.connected) return;
  if (/^[1-9]$/.test(e.key)) { const n = S.scenes[+e.key - 1]; if (n) pickScene(n); }
  else if (e.key === " " || e.key === "Enter") { if (!e.target.closest("button")) { e.preventDefault(); take(); } }
  else if (e.key.toLowerCase() === "c") cut();
});
$("#btnTake").addEventListener("click", take);
$("#btnCut").addEventListener("click", cut);

/* ---------- onboarding ---------- */
/* ---------- guided tour: spotlights each part of the console in turn ---------- */
const HELP = [
  [null, "Welcome to JhemsStream", `<p>OBS makes the video and sends it to Facebook. JhemsStream puts the crew's controls in one window.</p><p>This tour points at each part. Use the arrow keys or the buttons. Esc closes it, and <b>Help</b> in the top bar reopens it.</p>`],
  [".dock-scenes", "1. Pick a scene", `<p>Each row is something viewers can see. Click one to load it into <b>Preview</b>. Keys <b>1</b> to <b>9</b> do the same.</p><p><b>Main</b>, <b>Win</b>, <b>Next A</b> and <b>Next B</b> at the top jump to the scene you set for each (right-click to set). Right-click a scene for more. <b>Add scene</b> has the SITE border templates, and <b>SITE event setup</b> builds every finals screen in show order.</p>`],
  [".mon-preview", "2. Check Preview", `<p>Green means <b>next</b>. Nothing here is on stream yet, so you can fix it safely.</p><p>Click a source on it to select it, drag to move, drag a red handle to resize, Alt and a handle to crop. Right-click for layers, fit and lock. <b>Multiview</b> (M) shows every scene at once.</p>`],
  [".takecol", "3. Transition", `<p>Press <b>Transition</b> or <b>Space</b> to send Preview to air. <b>C</b> cuts instantly. Drag the T-bar to do it by hand.</p><p>Pick the effect here. The <b>Code Rain</b> stingers are the SITE ones.</p>`],
  [".mon-program", "4. Program is live", `<p>Red means <b>on stream</b>. This is exactly what Facebook viewers see.</p>`],
  [".dock-mixer", "Audio", `<p>Mic and game levels. Keep the meters in the green and yellow. <b>Mute all</b>, <b>Fade down</b> and <b>Fade up</b> at the top act on the whole mix. Right-click a source for more.</p>`],
  [".dock-music", "Music", `<p>Paste YouTube or Spotify links or add a folder. Songs crossfade, fade down on gameplay scenes and duck when casters talk. Set how loud each scene is under <b>Music level per scene</b>.</p>`],
  ["#scoreBox", "Scores", `<p>Type team names and press + or &minus;. The scoreboard on stream updates right away.</p>`],
  ["#replayBox", "Instant replay", `<p>Turn on <b>Buffer</b> before going live. Press <b>Instant replay</b> or <b>R</b>: the clip loads into <b>Preview</b> so you can watch it first. Press <b>Air replay</b> (or R again) to show it. It returns to the game when it ends.</p>`],
  [".dock-controls .controls", "Going live", `<ol><li><b>Stream key</b> tab: get the key from Facebook and save it to OBS.</li><li>Tick through the <b>Checklist</b>.</li><li>Put Starting Soon on Program, press <b>Start streaming</b>, then <b>Go live</b> in Facebook.</li></ol>`],
  ["label.role", "Roles", `<p>Helpers pick Switcher, Audio and music, or Scores. Those roles hide streaming and delete buttons so nobody ends the stream by accident.</p>`],
];
let helpStep = 0;
const visibleEl = sel => { const el = sel && document.querySelector(sel); const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? el : null; };
function placeHelp() {
  const [sel] = HELP[helpStep], el = visibleEl(sel), spot = $("#helpSpot"), card = $("#helpCard");
  const pad = 6, gap = 14, vw = innerWidth, vh = innerHeight;
  if (!el) { spot.classList.add("none"); card.style.left = Math.max(16, (vw - card.offsetWidth) / 2) + "px"; card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + "px"; return; }
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  spot.classList.remove("none");
  Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" });
  const cw = card.offsetWidth, ch = card.offsetHeight;
  // below, above, right, left of the target, whichever fits first
  const spots = [[r.left, r.bottom + gap], [r.left, r.top - gap - ch], [r.right + gap, r.top], [r.left - gap - cw, r.top]];
  const fits = ([x, y]) => y >= 8 && y + ch <= vh - 8 && x + cw >= 0 && x <= vw;
  const [x, y] = spots.find(fits) || [(vw - cw) / 2, vh - ch - 16];
  card.style.left = Math.min(Math.max(8, x), vw - cw - 8) + "px";
  card.style.top = Math.min(Math.max(8, y), vh - ch - 8) + "px";
}
function renderHelp() {
  const [, title, body] = HELP[helpStep];
  $("#helpBody").innerHTML = `<h3>${title}</h3>${body}`;
  $("#helpDots").innerHTML = HELP.map((_, i) => `<i class="${i === helpStep ? "on" : ""}"></i>`).join("");
  $("#helpCount").textContent = `${helpStep + 1} of ${HELP.length}`;
  $("#helpBack").disabled = helpStep === 0;
  $("#helpNext").textContent = helpStep === HELP.length - 1 ? "Done" : "Next";
  requestAnimationFrame(placeHelp);
}
/* steps whose part is hidden for this role are skipped in either direction */
function helpGo(d) {
  let n = helpStep + d;
  while (n > 0 && n < HELP.length && HELP[n][0] && !visibleEl(HELP[n][0])) n += d;
  if (n < 0) return;
  if (n >= HELP.length) return $("#dlgHelp").close();
  helpStep = n; renderHelp();
}
function openHelp() { helpStep = 0; $("#dlgHelp").showModal(); renderHelp(); }
$("#helpBack").addEventListener("click", () => helpGo(-1));
$("#helpNext").addEventListener("click", () => helpGo(1));
$("#helpSkip").addEventListener("click", () => $("#dlgHelp").close());
$("#dlgHelp").addEventListener("keydown", e => { if (e.key === "ArrowRight") { e.preventDefault(); helpGo(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); helpGo(-1); } });
addEventListener("resize", () => { if ($("#dlgHelp").open) placeHelp(); });
$("#dlgHelp").addEventListener("close", () => store.set("helpSeen", true));
$$("[data-help]").forEach(b => b.addEventListener("click", openHelp));

/* ---------- shared API for editor.js and setup.js ---------- */
/* OBS asks "outputs still active, exit?" and won't close until someone answers; stopping is asynchronous, so wait
   until every output reports stopped before JhemsStream closes OBS to edit its files */
async function stopOutputsForRestart() {
  await obs.call("StopReplayBuffer").catch(() => {});
  await obs.call("StopVirtualCam").catch(() => {});
  for (let i = 0; i < 60; i++) {
    const outs = (await obs.call("GetOutputList").catch(() => ({ outputs: [] }))).outputs;
    if (!outs.some(o => o.outputActive)) return;
    await new Promise(r => setTimeout(r, 250));
  }
}
/* settings the whole crew shares: stored in OBS's profile through obs-websocket, so every laptop sees the same */
const shared = {
  async get(k, d) { try { const v = (await obs.call("GetPersistentData", { realm: "OBS_WEBSOCKET_DATA_REALM_PROFILE", slotName: "jhemsstream." + k })).slotValue; return v ?? d; } catch { return d; } },
  set(k, v) { return obs.call("SetPersistentData", { realm: "OBS_WEBSOCKET_DATA_REALM_PROFILE", slotName: "jhemsstream." + k, slotValue: v }).catch(() => {}); },
};
window.JS = { obs, S, call, h, $, $$, store, log, toast, icon, pickScene, refreshScenes, refreshInputs, connect, onReady: f => readyFns.push(f), openExt, runTransitionProgress: ms => runBunting(ms),
  quiet, restoreTransition, timed, armDelete, stopOutputsForRestart, take, cut, renameScene, deleteScene, setStudioMode, fadeMute, toggleMonitor, cleanMic, ensureFilter, renderMixer, renderScenes, tileEls, shared, fmtDb, MIC_KINDS, selectTab };

/* ---------- window buttons in our own title bar (desktop app has no Windows title bar) ---------- */
if (TAURI?.window) {
  const win = TAURI.window.getCurrentWindow();
  $("#winctl").hidden = false;
  const syncMax = async () => { const m = await win.isMaximized(); $("#wMax").setAttribute("aria-label", m ? "Restore" : "Maximize"); $("#wMax").title = m ? "Restore" : "Maximize"; };
  $("#wMin").addEventListener("click", () => win.minimize());
  $("#wMax").addEventListener("click", async () => { await win.toggleMaximize(); syncMax(); });
  $("#wClose").addEventListener("click", () => {
    if (S.streaming && !confirm("You're live. Close JhemsStream? OBS keeps streaming, but you lose these controls until you reopen it.")) return;
    win.close();
  });
  win.onResized?.(() => syncMax()); syncMax();
  // tauri.conf.json starts the window hidden; show it once the page has painted (main.rs has a fallback)
  // a hidden window may not get animation frames, so a short timer backs them up
  let shown = false;
  const reveal = () => { if (shown) return; shown = true; win.show().then(() => win.setFocus()).catch(() => {}); };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  setTimeout(reveal, 300);
}
window.addEventListener("load", () => {
  if (window.Setup?.start) Setup.start();
  else { $("#connect").hidden = false; $("#connect").textContent = "setup.js failed to load."; }
});
