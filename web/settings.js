"use strict";
/* Settings window: sections on the left with search, rows of title + description + control on the right. */
(() => {
  const { h, $, store, S, call, toast } = window.JS;
  const T = window.__TAURI__;
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16" fill="currentColor"/>',
    switching: '<rect x="3" y="6" width="7" height="12" rx="1.5"/><rect x="14" y="6" width="7" height="12" rx="1.5"/><path d="M10.5 12h3"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    crew: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a4.5 4.5 0 0 1 4.5 4.8"/>',
    stream: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    obs: '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
    quality: '<path d="M4 18h3v-5H4zM10.5 18h3V9h-3zM17 18h3V5h-3z"/>',
    updates: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01"/>',
  };

  /* controls */
  const sw = (checked, onChange, label) => {
    const i = h("input", { type: "checkbox", role: "switch", class: "switch", "aria-label": label });
    i.checked = checked; i.addEventListener("change", () => onChange(i.checked)); return i;
  };
  const seg = (opts, value, onChange, label) => {
    const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
    for (const [v, text] of opts) {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(v === value) }, text);
      b.addEventListener("click", () => { box.querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", String(x === b))); onChange(v); });
      box.append(b);
    }
    return box;
  };
  const sel = (opts, value, onChange, label) => {
    const s = h("select", { "aria-label": label });
    for (const [v, text] of opts) s.append(h("option", { value: v }, text));
    s.value = String(value); s.addEventListener("change", () => onChange(s.value)); return s;
  };
  const btn = (text, fn) => h("button", { type: "button", class: "btn small", onclick: fn }, text);

  /* theme: the stored value pins a scheme; "light dark" follows Windows. OBS is dark, so dark is the default. */
  const meta = document.querySelector('meta[name="color-scheme"]');
  function themeValue() { try { return localStorage.getItem("color-scheme") ?? "dark"; } catch { return meta.content; } }
  function setTheme(v) { meta.content = v; try { localStorage.setItem("color-scheme", v); } catch {} }
  window.addEventListener("storage", e => { if (e.key === "color-scheme") meta.content = e.newValue ?? "dark"; });
  const sysDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  function setCompact(on) { document.body.classList.toggle("compact", on); store.set("compact", on); }
  setCompact(store.get("compact", false));

  let version = "browser";
  if (T?.app?.getVersion) T.app.getVersion().then(v => { version = v; }).catch(() => {});

  const SECTIONS = () => [
    { id: "appearance", label: "Appearance", rows: [
      { title: "Theme", desc: "Dark matches OBS. System follows the Windows setting.", badge: "This computer",
        ctl: () => seg([["light dark", `System (${sysDark() ? "dark" : "light"})`], ["light", "Light"], ["dark", "Dark"]], themeValue(), setTheme, "Theme") },
      { title: "Compact view", desc: "Smaller controls and tighter rows, so more fits on a laptop screen.", badge: "This computer",
        ctl: () => sw(document.body.classList.contains("compact"), setCompact, "Compact view") },
    ] },
    { id: "switching", label: "Switching", rows: [
      { title: "Studio Mode", desc: "Load a scene into Preview, then send it to Program with Transition. Turn it off to put scenes on air with one click.",
        ctl: () => sw(S.studio, on => { store.set("quick", !on); call("SetStudioModeEnabled", { studioModeEnabled: on }); }, "Studio Mode") },
      { title: "Keyboard shortcuts", desc: "1 to 9 pick a scene, Space or Enter transitions, C cuts. Shortcuts pause while you type in a field." },
    ] },
    { id: "audio", label: "Audio and music", rows: [
      { title: "Crossfade length", desc: "How long two songs overlap when one ends or someone presses Next.",
        ctl: () => sel([3, 4, 6, 8, 10, 12].map(s => [s, `${s} seconds`]), Music.st.xfade, v => { Music.st.xfade = +v; store.set("xfade", +v); const r = $("#mXfade"); if (r) { r.value = v; $("#mXfTxt").textContent = v + " s"; } }, "Crossfade length") },
      { title: "Duck music under talking", desc: "How quiet the music gets while a caster mic is loud. Pick which mics in the Music dock.",
        ctl: () => sel([[0.15, "15%"], [0.3, "30%"], [0.5, "50%"], [0.7, "70%"]], store.get("duckDepth", 0.3), v => { const r = $("#mDuckDepth"); r.value = v; r.dispatchEvent(new Event("input")); }, "Duck level") },
      { title: "Music folder", desc: store.get("musicDir", "") || (T ? "None chosen yet." : "In a browser, add songs from the Music dock."),
        ctl: () => T ? btn("Choose folder", () => $("#mFolder").click()) : null },
    ] },
    { id: "crew", label: "Crew", rows: [
      { title: "Role on this computer", desc: "Switcher, Audio and music, and Scores hide streaming, the stream key and delete buttons, so helpers can’t end the stream by accident.", badge: "This computer",
        ctl: () => sel([...$("#role").options].map(o => [o.value, o.textContent]), $("#role").value, v => { const r = $("#role"); r.value = v; r.dispatchEvent(new Event("change")); }, "Role") },
    ] },
    { id: "stream", label: "Stream", rows: [
      { title: "Facebook stream key", desc: $("#fbStatus")?.textContent || "Paste the key from Facebook Live Producer.", director: true,
        ctl: () => btn("Change stream key", () => { close(); document.querySelector('[data-tab="live"]')?.click(); $("#fbKey")?.focus(); }) },
      { title: "Facebook Live Producer", desc: "Where you create the live video, copy its key and press Go live after OBS starts streaming.",
        ctl: () => btn("Open", () => window.JS.openExt("https://www.facebook.com/live/producer")) },
    ] },
    { id: "quality", label: "Stream quality", rows: qualityRows() },
    { id: "obs", label: "OBS connection", rows: [
      { title: "Connected to", desc: S.connected ? `OBS at ${S.host}` : "Not connected",
        ctl: () => btn("Reconnect", async () => { close(); try { await window.JS.obs.disconnect(); } catch {} }) },
      ...(T ? [
        { title: "Set up OBS again", desc: "Closes OBS, turns on its remote control, adds Swipe, Slide and Luma Wipe transitions, then reopens it.", director: true,
          ctl: () => btn("Set up OBS", async () => {
            if (S.streaming) return toast("Stop streaming before setting up OBS again.", "warn");
            if (!confirm("Close and reopen OBS now?")) return;
            close(); try { await T.core.invoke("obs_setup"); toast("OBS is restarting with remote control on."); } catch (e) { toast("Setup failed: " + e, "bad"); }
          }) },
        { title: "Open OBS", desc: "Starts OBS on this computer if it isn’t running.", ctl: () => btn("Open OBS", () => T.core.invoke("obs_launch")) },
      ] : []),
    ] },
    { id: "updates", label: "Updates", rows: [
      { title: "Version", desc: T ? `JhemsStream ${version}. Updates install from GitHub and the app restarts. OBS keeps running.` : "Running in a browser. The desktop app updates itself.",
        ctl: () => T ? btn("Check for updates", () => window.Setup?.checkUpdate?.(false)) : btn("Get the desktop app", () => window.JS.openExt("https://github.com/jherobred/JhemsStream/releases/latest")) },
    ] },
    { id: "help", label: "Help", rows: [
      { title: "Guide", desc: "The six-step tour for new crew members.", ctl: () => btn("Open guide", () => { close(); document.querySelector("[data-help]")?.click(); }) },
    ] },
  ];
  const GROUPS = [["appearance", "switching"], ["audio", "crew"], ["stream", "quality", "obs"], ["updates", "help"]];

  /* stream quality rows read the values Quality loaded from OBS */
  function qualityRows() {
    const Qm = window.Quality;
    if (!Qm || !Qm.Q.loaded) return [{ title: "Stream quality", desc: S.connected ? "Reading settings from OBS." : "Connect to OBS to change the stream quality." }];
    const Q = Qm.Q, cur = Qm.current(), again = () => render();
    const lock = S.streaming || S.recording;
    const note = lock ? " Locked while streaming or recording." : "";
    const num = h("input", { type: "number", min: 500, max: 9000, step: 100, value: Q.vb, "aria-label": "Video bitrate in kbps", disabled: lock });
    num.addEventListener("change", async () => { await Qm.set("vb", num.value); again(); });
    const up = h("input", { type: "number", min: 0.5, max: 1000, step: 0.5, placeholder: "Mbps", "aria-label": "Measured upload speed in Mbps" });
    const upBtn = btn("Suggest", () => {
      const v = parseFloat(up.value);
      if (!(v > 0)) return toast("Type the upload speed from the speed test first.", "warn");
      const p = Qm.suggest(v);
      if (confirm(`${v} Mbps upload: use ${p.label} (${p.h}p, ${p.fps} fps, ${p.vb} kbps)?`)) Qm.applyPreset(p.id).then(again);
    });
    return [
      { title: "Quality preset", desc: (cur ? cur.desc : "Custom settings. Pick a preset to reset them.") + note,
        ctl: () => sel([...Qm.PRESETS.map(p => [p.id, p.label]), ...(cur ? [] : [["custom", "Custom"]])], cur ? cur.id : "custom", async v => { if (v !== "custom") { await Qm.applyPreset(v); again(); } }, "Quality preset") },
      { title: "Check my internet", desc: "Run a speed test, type the upload speed, and JhemsStream suggests the preset that fits with room to spare.",
        ctl: () => h("div", { class: "row" }, up, upBtn, btn("Speed test", () => window.JS.openExt("https://fast.com"))) },
      { title: "Video bitrate (kbps)", desc: "Higher looks sharper but needs more upload. Facebook takes up to 9000. Keep it under about 75% of your upload speed." + note,
        ctl: () => num },
      { title: "Resolution", desc: `What viewers get. The canvas stays ${Q.bw} by ${Q.bh}.` + note,
        ctl: () => sel([["1920x1080", "1080p"], ["1600x900", "900p"], ["1280x720", "720p"]], `${Q.w}x${Q.h}`, async v => { await Qm.set("res", v); again(); }, "Resolution") },
      { title: "Frame rate", desc: "60 fps makes fast games smoother but needs about 1.5 times the bitrate for the same sharpness." + note,
        ctl: () => sel([[30, "30 fps"], [60, "60 fps"]], Q.fps, async v => { await Qm.set("fps", v); again(); }, "Frame rate") },
      { title: "Encoder", desc: "The graphics card keeps the PC fast while streaming. Use the processor only if the graphics option fails." + (Q.gpus?.length ? ` This PC: ${Q.gpus.join(", ")}.` : "") + note,
        ctl: () => sel(Qm.encoders().map(e => [e.id, e.label]), Q.enc, async v => { await Qm.set("enc", v); again(); }, "Encoder") },
      { title: "Audio bitrate", desc: "160 kbps is plenty for casters and music." + note,
        ctl: () => sel([[128, "128 kbps"], [160, "160 kbps"], [192, "192 kbps"], [320, "320 kbps"]], Q.ab, async v => { await Qm.set("ab", v); again(); }, "Audio bitrate") },
    ];
  }

  let current = "appearance";
  function row(r) {
    const text = h("div", { class: "set-text" },
      h("div", { class: "set-title" }, r.title, r.badge ? h("span", { class: "set-badge" }, r.badge) : null),
      h("div", { class: "set-desc" }, r.desc));
    const ctl = r.ctl ? r.ctl() : null;
    return h("div", { class: `set-row${r.director ? " director" : ""}` }, text, ctl ? h("div", { class: "set-ctl" }, ctl) : null);
  }
  function render() {
    const q = $("#setSearch").value.trim().toLowerCase(), secs = SECTIONS(), main = $("#setMain");
    main.textContent = "";
    const links = $("#setLinks"); links.textContent = "";
    GROUPS.forEach((g, gi) => {
      if (gi) links.append(h("hr", { class: "set-sep" }));
      for (const id of g) {
        const s = secs.find(x => x.id === id);
        const b = h("button", { type: "button", class: "set-link", "aria-current": !q && id === current ? "page" : false, html: svg(ICON[id]) }, s.label);
        b.addEventListener("click", () => { current = id; $("#setSearch").value = ""; render(); main.scrollTop = 0; });
        links.append(b);
      }
    });
    const shown = q ? secs.map(s => ({ ...s, rows: s.rows.filter(r => (r.title + " " + r.desc + " " + s.label).toLowerCase().includes(q)) })).filter(s => s.rows.length)
                    : secs.filter(s => s.id === current);
    if (!shown.length) { main.append(h("p", { class: "set-empty" }, `No settings match “${q}”.`)); return; }
    for (const s of shown) main.append(h("section", { class: "set-section" }, h("h3", {}, s.label), ...s.rows.map(row)));
  }
  function open(section) {
    if (section) current = section; $("#setSearch").value = ""; render(); $("#dlgSettings").showModal(); $("#setSearch").focus();
    if (S.connected && window.Quality) window.Quality.load().then(() => { if ($("#dlgSettings").open) render(); }).catch(() => {});
  }
  function close() { $("#dlgSettings").close(); }
  $("#setSearch").addEventListener("input", render);
  $("#setClose").addEventListener("click", close);
  $("#dlgSettings").addEventListener("click", e => { if (e.target === e.currentTarget) close(); });
  for (const id of ["#btnSettings", "#btnSettings2"]) $(id)?.addEventListener("click", () => open());
  $("#btnQuality")?.addEventListener("click", () => open("quality"));
  window.Settings = { open, close, sync: () => { if ($("#dlgSettings").open) render(); } };
})();
