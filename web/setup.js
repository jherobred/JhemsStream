"use strict";
/* JhemsStream setup: gets OBS installed, configured, open and connected, then keeps it that way.
   Also owns the header's quick links and the update button. */
window.Setup = (() => {
  const T = window.__TAURI__;
  const desktop = !!T;
  const J = () => window.JS;
  const invoke = (cmd, args) => T.core.invoke(cmd, args);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let flowRunning = false, mode = "auto", lastTarget = null, pendingUpdate = null;

  /* ---------- external opener ---------- */
  async function open(url) {
    if (!desktop) { window.open(url, "_blank", "noopener"); return; }
    try { await T.opener.openUrl(url); } catch (e) { J().toast("Couldn't open " + url, "error"); throw e; }
  }

  /* ---------- rendering helpers ---------- */
  const STEP_LABELS = { installed: "OBS installed", ws: "Remote control on", open: "OBS open", connected: "Connected" };
  const steps = { installed: "todo", ws: "todo", open: "todo", connected: "todo" };
  let note = "", actions = [], error = "";

  function render() {
    const { h, $ } = J();
    const box = $("#connect"); if (!box) return;
    box.textContent = "";
    if (mode === "manual" || !desktop) { box.append(manualCard()); return; }
    const ol = h("ol", { class: "steps" }, Object.keys(STEP_LABELS).map(k =>
      h("li", { class: "step", "data-state": steps[k] }, h("span", { class: "state" }, stateText(steps[k])), STEP_LABELS[k])));
    box.append(h("div", { class: "card" },
      h("h2", {}, "Getting OBS ready"),
      ol,
      note ? h("p", { class: "muted", "aria-live": "polite" }, note) : null,
      error ? h("p", { class: "err", role: "alert" }, error) : null,
      actions.length ? h("div", { class: "row" }, actions) : null,
      h("p", { class: "tip" },
        h("button", { class: "btn ghost small", type: "button", onclick: () => { mode = "manual"; render(); } }, "Connect to OBS on another computer"))));
  }
  const stateText = s => ({ done: "Done", todo: "To do", busy: "Working", fail: "Problem" }[s] || s);
  function set(k, v) { steps[k] = v; }
  function show(n = "", acts = [], err = "") { note = n; actions = acts; error = err; render(); }

  function manualCard() {
    const { h, store } = J();
    const host = h("input", { id: "cHost", value: store.get("host", "localhost"), autocomplete: "off" });
    const port = h("input", { id: "cPort", value: store.get("port", "4455"), inputmode: "numeric" });
    const pass = h("input", { id: "cPass", type: "password", value: store.get("pass", ""), autocomplete: "off" });
    const remember = h("input", { type: "checkbox", id: "cRemember" }); remember.checked = !!store.get("pass", "");
    const err = h("p", { class: "err", role: "alert" });
    const form = h("form", { class: "card" },
      h("h2", {}, "Connect to OBS"),
      h("p", { class: "muted" }, "On the streaming PC, open OBS → Tools → WebSocket Server Settings → tick Enable WebSocket server → Show Connect Info."),
      h("div", { class: "field" }, h("label", { for: "cHost" }, "Computer running OBS"), host,
        h("span", { class: "muted" }, "localhost on the streaming PC, or the Server IP from Connect Info.")),
      h("div", { class: "field" }, h("label", { for: "cPort" }, "Port"), port),
      h("div", { class: "field" }, h("label", { for: "cPass" }, "Password"), pass),
      h("label", { class: "row" }, remember, " Remember password on this device"),
      err,
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "submit" }, "Connect"),
        desktop ? h("button", { class: "btn ghost", type: "button", onclick: () => { mode = "auto"; start(); } }, "Back to automatic setup") : null),
      desktop ? null : h("p", { class: "tip" }, "The desktop app can install and set up OBS for you. ",
        h("a", { href: "https://github.com/jherobred/JhemsStream/releases/latest", target: "_blank", rel: "noopener" }, "Download JhemsStream for Windows")));
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.textContent = "";
      const t = { host: host.value.trim() || "localhost", port: port.value.trim() || "4455", password: pass.value };
      store.set("host", t.host); store.set("port", t.port);
      if (remember.checked) store.set("pass", t.password); else store.del("pass");
      try { await connectTo(t); }
      catch (e2) { err.textContent = e2.code === 4009 ? "Wrong password. Copy it again from Show Connect Info." : `Can't reach OBS at ${t.host}:${t.port}. Is OBS open with the WebSocket server on?`; }
    });
    // a remembered password reconnects by itself once per page load
    if (store.get("pass", "") && !manualCard.tried) {
      manualCard.tried = true;
      // the card can be re-rendered right after start, so submit whichever form is on screen
      const go = (n = 0) => { const f = document.querySelector("#connect form"); if (f && !J().S.connected) f.requestSubmit(); else if (!f && n < 40) setTimeout(() => go(n + 1), 50); };
      setTimeout(go, 150);
    }
    return form;
  }

  async function connectTo(t) { lastTarget = t; await J().connect(t); }
  const isLocal = t => !t || ["localhost", "127.0.0.1", "::1"].includes(String(t.host).toLowerCase());

  /* ---------- automatic flow (desktop) ---------- */
  async function auto() {
    if (flowRunning) return; flowRunning = true;
    try {
      error = "";
      let info = await invoke("obs_info");
      set("installed", info.installed ? "done" : "todo");
      if (!info.installed) {
        return show("OBS isn't on this computer yet.", [
          J().h("button", { class: "btn primary", type: "button", onclick: install }, "Install OBS for me"),
          J().h("button", { class: "btn ghost", type: "button", onclick: () => open("https://obsproject.com/download") }, "Download page")]);
      }
      set("ws", info.ws_enabled ? "done" : "todo");
      if (!info.ws_enabled) {
        return show(info.running
          ? "OBS's remote control is off. JhemsStream will close OBS, turn it on, and reopen OBS. Save anything you're editing in OBS first."
          : "OBS's remote control is off. JhemsStream will turn it on and open OBS.",
          [J().h("button", { class: "btn primary", type: "button", onclick: () => setupObs(info.running) }, "Set up OBS for JhemsStream")]);
      }
      await openAndConnect(info);
    } catch (e) {
      show("", [J().h("button", { class: "btn", type: "button", onclick: start }, "Try again")], String(e.message || e));
    } finally { flowRunning = false; }
  }

  async function openAndConnect(info) {
    set("open", info.running ? "done" : "busy");
    if (!info.running) { show("Opening OBS…"); await invoke("obs_launch"); }
    set("connected", "busy");
    const t = { host: "localhost", port: String(info.port || 4455), password: info.password || "" };
    const until = Date.now() + 60000;
    for (let n = 0; ; n++) {
      show(n ? "Waiting for OBS to start…" : "Connecting…");
      try {
        await connectTo(t);
        set("open", "done"); set("connected", "done"); show("Connected to OBS.");
        return;
      } catch (e) {
        if (e.code === 4009) {
          set("connected", "fail");
          return show("", [J().h("button", { class: "btn primary", type: "button", onclick: () => setupObs(true) }, "Reset OBS remote control")],
            "OBS rejected the saved password. Resetting closes and reopens OBS.");
        }
        if (Date.now() > until) {
          set("connected", "fail");
          return show("", [
            J().h("button", { class: "btn primary", type: "button", onclick: start }, "Try again"),
            J().h("button", { class: "btn ghost", type: "button", onclick: () => invoke("obs_launch") }, "Open OBS")],
            "OBS didn't answer within a minute. If OBS shows a dialog, close it, then try again.");
        }
        if (n === 1) { const i2 = await invoke("obs_info").catch(() => null); if (i2 && !i2.running) await invoke("obs_launch").catch(() => {}); if (i2) set("open", i2.running ? "done" : "busy"); }
        await sleep(2000);
      }
    }
  }

  async function install() {
    set("installed", "busy");
    show("Installing OBS. This takes a few minutes. Keep JhemsStream open.");
    try {
      await invoke("obs_install");
      set("installed", "done");
      J().toast("OBS installed", "ok");
      await setupObs(false, true);
    } catch (e) {
      set("installed", "fail");
      show("", [J().h("button", { class: "btn", type: "button", onclick: install }, "Try again"),
        J().h("button", { class: "btn ghost", type: "button", onclick: () => open("https://obsproject.com/download") }, "Download page")],
        "Install didn't finish: " + (e.message || e) + ". Use the download page, then reopen JhemsStream.");
    }
  }

  async function setupObs(running, skipConfirm) {
    if (running && !skipConfirm && !confirm("JhemsStream will close OBS, turn on its remote control, and reopen it. Continue?")) return;
    set("ws", "busy"); show(running ? "Closing OBS and turning on remote control…" : "Turning on remote control…");
    try {
      const info = await hold(() => invoke("obs_setup"));
      set("ws", "done"); set("open", "busy");
      J().toast("OBS is set up. Added Swipe, Slide and Luma Wipe transitions.", "ok");
      flowRunning = true;
      try { await openAndConnect({ ...info, running: true }); } finally { flowRunning = false; }
    } catch (e) {
      set("ws", "fail");
      show("", [J().h("button", { class: "btn", type: "button", onclick: start }, "Try again")], String(e.message || e));
    }
  }

  /* ---------- public flow entry points ---------- */
  function start() {
    renderLinks(); if (desktop) checkUpdate(true);
    if (!desktop || mode === "manual") { render(); return; }
    Object.keys(steps).forEach(k => steps[k] = "todo");
    render(); auto();
  }

  /* while JhemsStream itself has OBS closed to edit its files, a reconnect must not reopen it (OBS would load the old
     file and later save over the edit); the edit reopens OBS itself */
  let holding = 0;
  async function hold(task) {
    holding++;
    try { return await task(); } finally { holding--; setTimeout(() => { if (!J().S.connected && !flowRunning) auto(); }, 1500); }
  }
  async function onDisconnect() {
    if (holding) { J().toast("OBS is restarting for setup. JhemsStream reconnects when it's back.", "warn"); for (const k of ["open", "connected"]) set(k, "todo"); render(); return; }
    if (!desktop || mode === "manual" || !isLocal(lastTarget)) { render(); return; }
    J().toast("Lost OBS. Reconnecting…", "warn");
    for (const k of ["open", "connected"]) set(k, "todo");
    await sleep(1500);
    const info = await invoke("obs_info").catch(() => null);
    if (info && info.installed && !info.running) J().toast("OBS closed or crashed. Reopening it…", "warn");
    auto();
  }

  /* ---------- quick links ---------- */
  function renderLinks() {
    const { h, $ } = J();
    const box = $("#quickLinks"); if (!box) return;
    box.textContent = "";
    // icon + label; the label hides when the window is narrow, so the name stays in title and aria-label
    const chip = (ic, label, fn, title) => h("button", { class: "link-chip", type: "button", title: title || label, "aria-label": label, onclick: () => fn().catch(() => {}) }, J().icon(ic), h("span", { class: "lbl" }, label));
    box.append(...[
      chip("live", "Facebook Live", () => open("https://www.facebook.com/live/producer"), "Open Facebook Live Producer to get the stream key"),
      desktop ? chip("obs", "Open OBS", async () => { await invoke("obs_launch"); J().toast("Opening OBS", "ok"); }) : null,
      chip("chat", "Discord", async () => {
        if (!desktop) return open("https://discord.com/app");
        try { await T.opener.openUrl("discord://"); } catch { await open("https://discord.com/app"); }
      }),
      chip("gauge", "Speed test", () => open("https://fast.com"), "Check upload speed (fast.com → Show more info)"),
      desktop ? chip("folder", "Recordings", async () => {
        const r = await J().call("GetRecordDirectory");
        await T.opener.openPath(r.recordDirectory);
      }, "Open the folder where OBS saves recordings") : null,
      chip("note", "Free music", () => open("https://www.facebook.com/sound/collection"), "Facebook Sound Collection: music made for Facebook videos")].filter(Boolean));
  }

  /* ---------- updater ---------- */
  async function checkUpdate(silent) {
    if (!desktop || !T.updater) return null;
    try {
      const u = await T.updater.check();
      if (!u) { if (!silent) J().toast("JhemsStream is up to date", "ok"); renderUpdate(null); return null; }
      pendingUpdate = u; renderUpdate(u); return u;
    } catch (e) {
      if (!silent) J().toast("Couldn't check for updates. Are you online?", "warn");
      renderUpdate(null);
      return null;
    }
  }
  function renderUpdate(u) {
    const { h, $ } = J();
    const slot = $("#updateSlot"); if (!slot) return;
    slot.textContent = "";
    if (!u) { slot.append(h("button", { class: "btn ghost small bar-btn", type: "button", title: "Check for updates", "aria-label": "Check for updates", onclick: () => checkUpdate(false) }, J().icon("refresh"), h("span", { class: "lbl" }, "Check for updates"))); return; }
    slot.append(h("button", { class: "btn primary small", type: "button", onclick: install_update }, `Update to v${u.version}`));
  }
  async function install_update() {
    if (J().S.streaming) { J().toast("Update after the stream ends", "warn"); return; }
    const u = pendingUpdate; if (!u) return;
    if (!confirm(`Install JhemsStream v${u.version}? The app restarts. OBS keeps running.`)) return;
    const { h, $ } = J(), slot = $("#updateSlot");
    const lbl = h("span", { class: "muted", "aria-live": "polite" }, "Downloading…");
    slot.textContent = ""; slot.append(lbl);
    let total = 0, got = 0;
    try {
      await u.downloadAndInstall(ev => {
        if (ev.event === "Started") total = ev.data.contentLength || 0;
        else if (ev.event === "Progress") { got += ev.data.chunkLength; lbl.textContent = total ? `Downloading ${Math.round(got / total * 100)}%` : "Downloading…"; }
        else if (ev.event === "Finished") lbl.textContent = "Installing…";
      });
      await T.process.relaunch();
    } catch (e) {
      J().toast("Update failed: " + (e.message || e), "error");
      renderUpdate(u);
    }
  }

  return { start, onDisconnect, open, checkUpdate, hold, get desktop() { return desktop; } };
})();
