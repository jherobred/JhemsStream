"use strict";
/* The OBS-style parts of the console: right-click menus, movable and resizable docks, editing sources right on the
   Preview monitor, Multiview, scene shortcuts (Main, Win, Next A, Next B), whole-mix mute and fades, and app zoom.
   Needs window.JS (app.js), EdMath (editor.js) and window.Borders (borders.js). */
(() => {
  const { obs, S, call, h, $, $$, store, toast, icon, shared } = window.JS;
  const T = window.__TAURI__;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // same rule as the .director buttons: helpers can't delete, rename or rebuild screens by accident
  const role = () => document.body.dataset.role;
  const isDirector = () => role() === "director";
  const canEdit = () => role() === "director" || role() === "switcher";

  /* ================= context menu ================= */
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  /* items: {label, fn, disabled, checked, danger} | "-" | {head} */
  function menu(x, y, items) {
    closeMenu();
    const list = h("div", { class: "ctx", role: "menu" });
    for (const it of items.filter(Boolean)) {
      if (it === "-") { list.append(h("div", { class: "ctx-sep", role: "separator" })); continue; }
      if (it.head) { list.append(h("div", { class: "ctx-head" }, it.head)); continue; }
      const b = h("button", { type: "button", role: it.checked != null ? "menuitemcheckbox" : "menuitem", class: `ctx-item${it.danger ? " danger" : ""}`,
        "aria-checked": it.checked != null ? String(!!it.checked) : false, disabled: !!it.disabled },
        h("span", { class: "ctx-check", "aria-hidden": "true" }, it.checked ? "✓" : ""), h("span", { class: "grow" }, it.label), it.key ? h("span", { class: "ctx-key" }, it.key) : null);
      b.addEventListener("click", () => { closeMenu(); try { const r = it.fn?.(); r?.catch?.(e => toast(e.message || String(e), "bad")); } catch (e) { toast(e.message || String(e), "bad"); } });
      list.append(b);
    }
    document.body.append(list); menuEl = list;
    const r = list.getBoundingClientRect();
    list.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
    list.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
    const btns = () => [...list.querySelectorAll(".ctx-item:not(:disabled)")];
    btns()[0]?.focus();
    list.addEventListener("keydown", e => {
      const bs = btns(), i = bs.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(); }
    });
  }
  addEventListener("pointerdown", e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  addEventListener("blur", closeMenu);
  addEventListener("resize", closeMenu);
  const at = e => [e.clientX || e.target.getBoundingClientRect().left, e.clientY || e.target.getBoundingClientRect().bottom];
  // Shift+F10 and the Menu key open the same menus from the keyboard
  document.addEventListener("keydown", e => {
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && document.activeElement) {
      e.preventDefault();
      const r = document.activeElement.getBoundingClientRect();
      document.activeElement.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 8, clientY: r.bottom }));
    }
  });

  /* ================= app zoom (Ctrl + / Ctrl - / Ctrl 0, Ctrl + wheel) ================= */
  const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  let zoom = store.get("zoom", 1);
  async function setZoom(z, say = true) {
    zoom = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100)); store.set("zoom", zoom);
    const wv = T?.webview?.getCurrentWebview?.();
    if (wv?.setZoom) { try { await wv.setZoom(zoom); } catch { document.documentElement.style.zoom = zoom; } }
    else document.documentElement.style.zoom = zoom;
    if (say) toast(`Zoom ${Math.round(zoom * 100)}%`);
    window.Settings?.sync?.();
  }
  const stepZoom = d => { const i = ZOOMS.findIndex(z => z >= zoom - 0.001); setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + d))]); };
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") { e.preventDefault(); stepZoom(1); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); stepZoom(-1); }
    else if (e.key === "0") { e.preventDefault(); setZoom(1); }
  });
  addEventListener("wheel", e => { if (e.ctrlKey) { e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  if (zoom !== 1) setZoom(zoom, false);

  /* ================= whole mix: mute all, fade down, fade up ================= */
  // what each source was before a whole-mix mute or fade, so it comes back exactly as it was (a muted mic stays muted)
  let mixMem = store.get("mixMem", null);
  let mixBusy = null;          // the running fade ("down" | "up" | "mute" | "unmute"), or null
  let mixStop = false;         // set by Stop: the running fade halts where it is
  const fadeSec = () => store.get("mixFadeSec", 2);
  // which sources the whole-mix buttons act on: all of them, or the ones picked in "Sources…"
  const targets = () => store.get("mixTargets", null);
  const live = () => { const hid = new Set(store.get("mixHidden", [])), t = targets(); return S.audio.filter(a => !hid.has(a.name) && (!t || t.includes(a.name))); };
  /* every level change glides: steps every 50 ms, stoppable */
  async function ramp(list, from, to, ms) {
    const steps = Math.max(4, Math.round(ms / 50));
    for (let k = 1; k <= steps; k++) {
      if (mixStop) return false;
      await Promise.all(list.map(a => obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: from(a) + (to(a) - from(a)) * (k / steps) }).catch(() => {})));
      await sleep(ms / steps);
    }
    return true;
  }
  const dbNow = async a => (await obs.call("GetInputVolume", { inputName: a.name }).catch(() => ({ inputVolumeDb: a.db }))).inputVolumeDb;
  async function wholeMix(kind) {
    if (!S.connected) return;
    if (mixBusy) { mixStop = true; return; } // a second press is Stop
    mixBusy = kind; mixStop = false; renderMixQuick();
    try {
      if (kind === "down" || kind === "mute") {
        const on = live().filter(a => !a.muted);
        if (!on.length) return toast(targets() ? "The picked sources are already muted." : "Everything is already muted.", "warn");
        mixMem = { ...Object.fromEntries(live().map(a => [a.name, { db: a.db, muted: a.muted }])), ...(mixMem || {}) }; store.set("mixMem", mixMem);
        on.forEach(a => { a.fading = true; });
        // start from where each source really is (a stopped fade leaves them part way down)
        const start = Object.fromEntries(await Promise.all(on.map(async a => [a.name, await dbNow(a)])));
        const done = kind === "mute" || await ramp(on, a => start[a.name], () => -60, fadeSec() * 1000);
        if (done) {
          await Promise.all(on.map(a => obs.call("SetInputMute", { inputName: a.name, inputMuted: true })));
          await Promise.all(on.map(a => obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: mixMem[a.name].db })));
          toast(kind === "down" ? "Faded down. Fade up brings it back." : "Muted. Unmute all brings it back.");
        } else toast("Fade stopped where it was. Fade up brings every source back to its level.");
        on.forEach(a => { a.fading = false; });
      } else {
        if (!mixMem) return toast("Nothing to bring back. Fade down or Mute all first.", "warn");
        const back = live().filter(a => mixMem[a.name] && !mixMem[a.name].muted);
        back.forEach(a => { a.fading = true; });
        // sources a stopped fade left half way start from where they are, muted ones from silence
        const start = Object.fromEntries(await Promise.all(back.map(async a => [a.name, a.muted ? -60 : await dbNow(a)])));
        await Promise.all(back.filter(a => a.muted).map(a => obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: -60 })));
        await Promise.all(back.filter(a => a.muted).map(a => obs.call("SetInputMute", { inputName: a.name, inputMuted: false })));
        const done = await ramp(back, a => start[a.name], a => mixMem[a.name].db, kind === "up" ? fadeSec() * 1000 : 300);
        back.forEach(a => { a.fading = false; });
        if (done) { for (const a of back) { a.db = mixMem[a.name].db; delete mixMem[a.name]; } if (!Object.keys(mixMem).some(n => live().some(a => a.name === n))) mixMem = null; store.set("mixMem", mixMem); }
        else toast("Fade stopped where it was.");
      }
    } finally { mixBusy = null; mixStop = false; renderMixQuick(); }
  }
  /* raise or lower the picked sources together, gradually */
  async function nudgeAll(db) {
    const on = live().filter(a => !a.muted); if (!on.length || mixBusy) return;
    mixBusy = "nudge"; renderMixQuick();
    const from = Object.fromEntries(await Promise.all(on.map(async a => [a.name, await dbNow(a)])));
    try { await ramp(on, a => from[a.name], a => Math.max(-60, Math.min(6, from[a.name] + db)), 600); } finally { mixBusy = null; mixStop = false; renderMixQuick(); }
  }
  /* one source to a set level, gradually (right-click presets) */
  async function glide(a, to) {
    const from = await dbNow(a), steps = 12;
    for (let k = 1; k <= steps; k++) { await obs.call("SetInputVolume", { inputName: a.name, inputVolumeDb: from + (to - from) * (k / steps) }).catch(() => {}); await sleep(40); }
  }
  function pickTargets() {
    const dlg = h("dialog", { class: "editor-dlg" }), body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, "Mute all and fades act on")), body, foot);
    dlg.addEventListener("close", () => dlg.remove()); document.body.append(dlg);
    const t = targets(), boxes = S.audio.map(a => { const cb = h("input", { type: "checkbox", id: `mt-${a.name}` }); cb.checked = !t || t.includes(a.name); return [a.name, cb]; });
    body.append(h("p", { class: "muted small" }, "Untick sources that should keep playing, like the casters' mics during a fade to music."),
      ...boxes.map(([n, cb]) => h("label", { class: "check", for: cb.id }, cb, n)));
    foot.append(h("button", { type: "button", class: "btn", onclick: () => boxes.forEach(([, cb]) => { cb.checked = true; }) }, "All"), h("span", { class: "grow" }),
      h("button", { type: "button", class: "btn primary", onclick: () => { const on = boxes.filter(([, cb]) => cb.checked).map(([n]) => n); store.set("mixTargets", on.length === boxes.length ? null : on); renderMixQuick(); dlg.close(); } }, "Done"));
    dlg.showModal();
  }
  function renderMixQuick() {
    const box = $("#mixQuick"); if (!box) return;
    box.textContent = "";
    const anyMem = !!mixMem, t = targets();
    const btn = (ic, label, fn, title, on) => h("button", { type: "button", class: `qbtn${on ? " on" : ""}`, title, onclick: fn, "aria-pressed": on != null ? String(!!on) : false }, icon(ic), h("span", {}, label));
    const stop = k => mixBusy === k ? btn("close", "Stop", () => wholeMix(k), "Stop the fade where it is", true) : null;
    const who = t ? `${t.length} picked source${t.length === 1 ? "" : "s"}` : "every source";
    box.append(
      stop("down") || stop("up") || stop("mute") || stop("unmute") || btn("mute", anyMem ? "Unmute all" : "Mute all", () => wholeMix(anyMem ? "unmute" : "mute"), anyMem ? `Bring ${who} back as it was` : `Mute ${who} now`, anyMem),
      mixBusy ? null : btn("down", "Fade down", () => wholeMix("down"), `Fade ${who} down to silence over ${fadeSec()} s`),
      mixBusy ? null : btn("up", "Fade up", () => wholeMix("up"), `Fade ${who} back up over ${fadeSec()} s`),
      btn("gear", t ? `${t.length} sources` : "All sources", pickTargets, "Choose which sources Mute all and the fades act on", !!t));
  }
  $("#mixQuick")?.addEventListener("contextmenu", e => {
    e.preventDefault();
    menu(...at(e), [{ head: "Whole mix" },
      { label: "Lower everything 3 dB", fn: () => nudgeAll(-3) }, { label: "Raise everything 3 dB", fn: () => nudgeAll(3) }, "-",
      ...[1, 2, 3, 5, 8].map(s => ({ label: `Fade length ${s} s`, checked: fadeSec() === s, fn: () => { store.set("mixFadeSec", s); renderMixQuick(); } }))]);
  });
  renderMixQuick();

  /* mixer rows and the empty mixer */
  $("#mixer")?.addEventListener("contextmenu", e => {
    e.preventDefault();
    const row = e.target.closest(".mixrow"), hidden = store.get("mixHidden", []);
    const unhide = hidden.length ? [{ label: `Show hidden sources (${hidden.length})`, fn: () => { store.set("mixHidden", []); JS.renderMixer(); } }] : [];
    if (!row) return menu(...at(e), [{ head: "Audio Mixer" }, { label: "Mute all", fn: () => wholeMix("mute") }, { label: "Fade down", fn: () => wholeMix("down") }, { label: "Fade up", fn: () => wholeMix("up") }, { label: "Choose sources for Mute all and fades…", fn: pickTargets }, unhide.length ? "-" : null, ...unhide]);
    const a = S.audio.find(x => x.name === row.dataset.input); if (!a) return;
    const vol = db => () => glide(a, db);
    menu(...at(e), [{ head: a.name },
      { label: a.muted ? "Unmute (fade in)" : "Mute (fade out)", fn: () => JS.fadeMute(a) },
      { label: "Hear in headphones", checked: a.monitor, fn: () => JS.toggleMonitor(a) }, "-",
      ...[0, -6, -12, -20].map(db => ({ label: `Set to ${db} dB`, fn: vol(db) })), "-",
      JS.MIC_KINDS.includes(a.kind) ? { label: "Clean up this mic", fn: () => JS.cleanMic(a.name) } : null,
      { label: "Limit loud spikes", fn: () => JS.ensureFilter(a.name, "JS Limiter", "limiter_filter", { threshold: -3, release_time: 60 }).then(() => toast(`Limiter on ${a.name}`)) },
      !isDirector() ? null : { label: "Rename…", fn: async () => { const n = prompt(`Rename "${a.name}" to:`, a.name); if (n && n.trim() && n !== a.name) await call("SetInputName", { inputName: a.name, newInputName: n.trim() }); } },
      { label: "Hide from this mixer", fn: () => { store.set("mixHidden", [...hidden, a.name]); JS.renderMixer(); toast(`${a.name} is hidden here. Right-click the mixer to show it again.`); } },
      ...unhide]);
  });

  /* ================= scene shortcuts: Main, Win, Next A, Next B ================= */
  const ROLES = [["main", "Main"], ["win", "Win"], ["nextA", "Next A"], ["nextB", "Next B"]];
  let roles = {};
  const roleOf = scene => ROLES.filter(([k]) => roles[k] === scene).map(([, l]) => l);
  async function setRole(k, scene) {
    roles = { ...roles, [k]: scene || undefined }; if (!scene) delete roles[k];
    await shared.set("roles", roles); renderRoles(); decorateTiles();
  }
  function roleMenu(x, y, k, label) {
    menu(x, y, [{ head: `${label} is…` }, ...S.scenes.map(n => ({ label: n, checked: roles[k] === n, fn: () => setRole(k, n) })),
      roles[k] ? "-" : null, roles[k] ? { label: `Clear ${label}`, fn: () => setRole(k, null) } : null]);
  }
  function renderRoles() {
    const box = $("#sceneRoles"); if (!box) return;
    box.textContent = "";
    for (const [k, label] of ROLES) {
      const sc = roles[k] && S.scenes.includes(roles[k]) ? roles[k] : null;
      const b = h("button", { type: "button", class: `role-btn${sc ? "" : " unset"}${sc && sc === S.program ? " is-program" : sc && S.studio && sc === S.preview ? " is-preview" : ""}`,
        title: sc ? `${label}: ${sc}. Click to ${S.studio ? "load it into Preview" : "put it on air"}. Right-click to change.` : `Choose which scene is ${label}`,
        "aria-label": sc ? `${label}: ${sc}` : `Set ${label}` }, label);
      b.addEventListener("click", e => sc ? JS.pickScene(sc) : roleMenu(...at(e), k, label));
      b.addEventListener("contextmenu", e => { e.preventDefault(); roleMenu(...at(e), k, label); });
      box.append(b);
    }
  }
  function decorateTiles() {
    for (const [name, tile] of JS.tileEls) {
      tile.querySelector(".role-tags")?.remove();
      const rs = roleOf(name);
      if (rs.length) tile.querySelector(".nm")?.after(h("span", { class: "role-tags" }, ...rs.map(r => h("i", {}, r))));
    }
    renderRoles();
    if (mvOpen) renderMv();
  }
  obs.on("SceneNameChanged", ({ oldSceneName, sceneName }) => {
    let changed = false;
    for (const k in roles) if (roles[k] === oldSceneName) { roles[k] = sceneName; changed = true; }
    if (changed) shared.set("roles", roles);
  });

  /* scene tiles and the empty Scenes dock */
  $("#scenes")?.addEventListener("contextmenu", async e => {
    e.preventDefault();
    const tile = e.target.closest(".tile"), [x, y] = at(e);
    if (!tile) return menu(x, y, [{ head: "Scenes" }, canEdit() ? { label: "Add scene…", fn: () => window.Editor?.openNew() } : null,
      ...(canEdit() ? (window.Borders?.TEMPLATES || []) : []).map(t => ({ label: `New ${t.label}`, fn: () => Borders.create(t.id) })), "-",
      { label: "Multiview", key: "M", fn: openMv }]);
    const name = tile.dataset.scene, live = name === S.program;
    const border = await window.Borders?.detect(name);
    menu(x, y, [{ head: name },
      S.studio ? { label: "Load into Preview", fn: () => call("SetCurrentPreviewScene", { sceneName: name }) } : null,
      { label: S.studio ? "Transition to it now" : "Put on air", disabled: live, fn: async () => { if (S.studio) { await call("SetCurrentPreviewScene", { sceneName: name }); await JS.take(); } else JS.pickScene(name); } },
      { label: "Cut to it now", disabled: live, fn: async () => { if (S.studio) { await call("SetCurrentPreviewScene", { sceneName: name }); await JS.cut(); } else await call("SetCurrentProgramScene", { sceneName: name }); } },
      "-",
      ...(border && canEdit() ? border.t.slots.filter(s => !s.replay).map(s => ({ label: `Change ${s.label.toLowerCase()}…`, fn: () => Borders.pickSlot(name, s) })) : []),
      ...(window.Site && (await Site.screenOf(name)) ? [{ label: "Edit screen text…", fn: () => Site.editScreen(name) }] : []),
      { label: "Edit scene…", fn: () => window.Editor?.openEdit(name) },
      canEdit() ? { label: "Add source…", fn: () => window.Editor?.openNew(name) } : null,
      isDirector() ? { label: "Rename…", fn: () => JS.renameScene(name) } : null,
      isDirector() ? { label: "Duplicate", fn: () => duplicateScene(name) } : null,
      "-", { head: "Shortcut" },
      ...ROLES.map(([k, l]) => ({ label: l, checked: roles[k] === name, fn: () => setRole(k, roles[k] === name ? null : name) })),
      "-",
      isDirector() ? { label: "Delete (3 presses of the trash button)", danger: true, disabled: live, fn: () => { const b = JS.tileEls.get(name)?.querySelector(".del"); JS.armDelete(b, name); b?.focus(); toast(`Press the trash button on ${name} 2 more times to delete it.`, "warn"); } } : null]);
  });
  /* obs-websocket has no "duplicate scene": make a new scene and add every item again with its transform */
  async function duplicateScene(name) {
    let n = `${name} copy`, i = 2; while (S.scenes.includes(n)) n = `${name} copy ${i++}`;
    await call("CreateScene", { sceneName: n });
    const items = (await call("GetSceneItemList", { sceneName: name })).sceneItems.sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
    for (const it of items) {
      const { sceneItemId } = await call("DuplicateSceneItem", { sceneName: name, sceneItemId: it.sceneItemId, destinationSceneName: n });
      if (it.sceneItemLocked) await call("SetSceneItemLocked", { sceneName: n, sceneItemId, sceneItemLocked: true });
    }
    toast(`Made ${n}.`);
  }

  /* ================= docks: drag a title to move, drag an edge to resize, right-click to hide ================= */
  const DOCKS = { scenes: "Scenes", sources: "Sources", mixer: "Audio Mixer", music: "Music", show: "Scores and stream", controls: "Controls" };
  const DEFAULT_W = { scenes: 1, sources: 0.9, mixer: 1.2, music: 1.25, show: 1.15, controls: 0.6 };
  let layout = { order: Object.keys(DOCKS), hidden: [], w: { ...DEFAULT_W }, ...store.get("dockLayout", {}) };
  if (!layout.order.includes("sources")) layout.order.splice(Math.max(0, layout.order.indexOf("scenes") + 1), 0, "sources");
  layout.w = { ...DEFAULT_W, ...layout.w };
  layout.order = [...layout.order.filter(k => DOCKS[k]), ...Object.keys(DOCKS).filter(k => !layout.order.includes(k))];
  const dockEl = k => $(`[data-dock="${k}"]`);
  function applyLayout() {
    const shown = layout.order.filter(k => !layout.hidden.includes(k));
    layout.order.forEach((k, i) => { const d = dockEl(k); if (d) { d.style.order = i; d.hidden = layout.hidden.includes(k); } });
    $(".docks")?.style.setProperty("--dock-cols", shown.map(k => `minmax(150px,${layout.w[k] ?? 1}fr)`).join(" "));
    store.set("dockLayout", layout);
  }
  function resetLayout() { layout = { order: Object.keys(DOCKS), hidden: [], w: { ...DEFAULT_W } }; applyLayout(); toast("Docks are back in their usual places."); }
  function dockMenu(e, k) {
    e.preventDefault();
    const i = layout.order.indexOf(k), move = d => { const o = layout.order; [o[i], o[i + d]] = [o[i + d], o[i]]; applyLayout(); };
    menu(...at(e), [{ head: DOCKS[k] },
      { label: "Move left", disabled: i === 0, fn: () => move(-1) }, { label: "Move right", disabled: i === layout.order.length - 1, fn: () => move(1) },
      { label: "Hide this dock", fn: () => { layout.hidden.push(k); applyLayout(); toast(`${DOCKS[k]} is hidden. Right-click any dock title to show it again.`); } }, "-",
      ...Object.keys(DOCKS).filter(x => layout.hidden.includes(x)).map(x => ({ label: `Show ${DOCKS[x]}`, fn: () => { layout.hidden = layout.hidden.filter(y => y !== x); applyLayout(); } })),
      { label: "Reset dock layout", fn: resetLayout }]);
  }
  for (const k of Object.keys(DOCKS)) {
    const d = dockEl(k); if (!d) continue;
    const grip = d.querySelector(".dock-title, .tabs");
    grip?.classList.add("dock-grip");
    grip?.setAttribute("title", "Drag to move this dock. Right-click for more.");
    grip?.addEventListener("contextmenu", e => { if (!e.target.closest("button, input, select")) dockMenu(e, k); });
    grip?.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button, input, select, [role=tab]")) return;
      const x0 = e.clientX, y0 = e.clientY; let dragging = false, target = null;
      const mv = ev => {
        if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragging = true; d.classList.add("dock-dragging"); document.body.classList.add("dock-moving");
        const over = document.elementsFromPoint(ev.clientX, ev.clientY).find(el => el.matches?.("[data-dock]") && el !== d);
        $$(".dock-drop").forEach(x => x.classList.remove("dock-drop", "after")); target = null;
        if (over) { const r = over.getBoundingClientRect(); target = { k: over.dataset.dock, after: ev.clientX > r.left + r.width / 2 }; over.classList.add("dock-drop"); over.classList.toggle("after", target.after); }
      };
      const up = () => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
        d.classList.remove("dock-dragging"); document.body.classList.remove("dock-moving"); $$(".dock-drop").forEach(x => x.classList.remove("dock-drop", "after"));
        if (dragging && target) { const o = layout.order.filter(x => x !== k); o.splice(o.indexOf(target.k) + (target.after ? 1 : 0), 0, k); layout.order = o; applyLayout(); }
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    });
    // right-edge handle: drag to make this dock wider or narrower
    const edge = h("div", { class: "dock-edge", role: "separator", "aria-orientation": "vertical", "aria-label": `Resize ${DOCKS[k]}`, tabindex: "0" });
    d.append(edge);
    const resize = dx => {
      const shown = layout.order.filter(x => !layout.hidden.includes(x)), total = shown.reduce((s, x) => s + (layout.w[x] ?? 1), 0);
      const px = $(".docks").clientWidth / total;
      layout.w[k] = Math.max(0.3, Math.min(4, (layout.w[k] ?? 1) + dx / px)); applyLayout();
    };
    edge.addEventListener("pointerdown", e => {
      e.preventDefault(); edge.setPointerCapture(e.pointerId); let last = e.clientX;
      const mv = ev => { resize(ev.clientX - last); last = ev.clientX; };
      const up = () => { edge.removeEventListener("pointermove", mv); edge.removeEventListener("pointerup", up); };
      edge.addEventListener("pointermove", mv); edge.addEventListener("pointerup", up);
    });
    edge.addEventListener("keydown", e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); resize(e.key === "ArrowLeft" ? -20 : 20); } });
    edge.addEventListener("dblclick", () => { layout.w[k] = DEFAULT_W[k]; applyLayout(); });
  }
  applyLayout();

  /* ================= edit sources on the Preview monitor ================= */
  const AUDIO_ONLY = /^wasapi_|^coreaudio|^pulse_/;
  const PV = { scene: null, items: [], tf: new Map(), sel: null, hover: null, drag: null, busy: false };
  const editOn = () => store.get("pvEdit", true) && canEdit();
  const target = () => S.studio ? S.preview : S.program;
  const screenEl = () => (S.studio ? $("#imgPreview") : $("#imgProgram"))?.parentElement;
  const isLiveEdit = () => !S.studio || S.preview === S.program;
  const ovs = [$("#imgPreview"), $("#imgProgram")].map(img => {
    const ov = h("div", { class: "pv-ov", tabindex: "-1", "aria-label": "Sources on this screen. Click one to select it, drag to move, drag a handle to resize, Alt and a handle to crop, Shift to resize freely, arrows nudge." },
      h("i", { class: "pv-guide x", hidden: true }), h("i", { class: "pv-guide y", hidden: true }), h("span", { class: "pv-live", hidden: true }, "Editing what's on air"));
    img.parentElement.append(ov);
    return ov;
  });
  const curOv = () => screenEl()?.querySelector(".pv-ov");
  async function loadItems(force) {
    const sc = target();
    if (!S.connected || !sc || (PV.busy && !force) || PV.drag) return;
    PV.busy = true;
    try {
      const items = (await JS.timed(call("GetSceneItemList", { sceneName: sc }))).sceneItems.sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
      const tfs = await JS.timed(Promise.all(items.map(it => obs.call("GetSceneItemTransform", { sceneName: sc, sceneItemId: it.sceneItemId }).then(r => r.sceneItemTransform).catch(() => null))));
      if (PV.drag) return;
      if (sc !== PV.scene) { PV.sel = null; PV.scene = sc; }
      PV.items = items; PV.tf = new Map(items.map((it, i) => [it.sceneItemId, tfs[i]]));
      queueMicrotask(renderSources);
      if (PV.sel != null && !items.some(i => i.sceneItemId === PV.sel)) PV.sel = null;
      draw();
    } catch {} finally { PV.busy = false; }
  }
  setInterval(() => { if (editOn() && !document.hidden) loadItems(); }, 1500);
  for (const ev of ["CurrentPreviewSceneChanged", "CurrentProgramSceneChanged", "StudioModeStateChanged", "SceneItemCreated", "SceneItemRemoved", "SceneItemListReindexed", "SceneItemEnableStateChanged", "SceneItemLockStateChanged"])
    obs.on(ev, () => setTimeout(() => loadItems(true), 60));
  const pct = (v, of) => (v / of * 100) + "%";
  const W = () => S.canvas.w, H = () => S.canvas.h;
  const visible = it => it.sceneItemEnabled && !AUDIO_ONLY.test(it.inputKind || "") && PV.tf.get(it.sceneItemId);
  function draw() {
    if (!PV.drag) queueMicrotask(renderSources);
    for (const ov of ovs) { ov.querySelectorAll(".pv-box").forEach(b => b.remove()); ov.classList.remove("live"); ov.querySelector(".pv-live").hidden = true; }
    const ov = curOv(); if (!ov || !editOn()) return;
    const box = (id, cls) => {
      const it = PV.items.find(i => i.sceneItemId === id); const t = it && PV.tf.get(id); if (!t) return;
      const r = EdMath.rectOf(t);
      const b = h("div", { class: `pv-box ${cls}${it.sceneItemLocked ? " locked" : ""}` }, h("span", { class: "pv-tag" }, it.sceneItemLocked ? "🔒 " + it.sourceName : it.sourceName),
        ...(cls === "sel" && !it.sceneItemLocked ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(c => h("i", { class: `pv-h ${c}`, "data-h": c })) : []));
      Object.assign(b.style, { left: pct(r.x, W()), top: pct(r.y, H()), width: pct(r.w, W()), height: pct(r.h, H()) });
      ov.append(b);
    };
    if (PV.hover != null && PV.hover !== PV.sel) box(PV.hover, "hover");
    if (PV.sel != null) { box(PV.sel, "sel"); if (isLiveEdit()) { ov.classList.add("live"); ov.querySelector(".pv-live").hidden = false; } }
  }
  const toCanvas = (ov, e) => { const b = ov.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W(), (e.clientY - b.top) / b.height * H()]; };
  const thr = ov => 10 * W() / (ov.getBoundingClientRect().width || W());
  /* topmost visible item under the point; locked items (borders) are skipped so the sources under them stay clickable */
  function hit(x, y, includeLocked) {
    for (const it of PV.items) {
      if (!visible(it) || (it.sceneItemLocked && !includeLocked)) continue;
      const r = EdMath.rectOf(PV.tf.get(it.sceneItemId));
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return it.sceneItemId;
    }
    return null;
  }
  let sendT = null, sendLast = 0, queued = null;
  function send(id, patch, now) {
    Object.assign(PV.tf.get(id), patch); draw();
    queued = { id, patch: { ...(queued?.id === id ? queued.patch : {}), ...patch }, scene: PV.scene };
    const go = () => { sendT = null; sendLast = Date.now(); const q = queued; queued = null; if (q) return obs.call("SetSceneItemTransform", { sceneName: q.scene, sceneItemId: q.id, sceneItemTransform: q.patch }).catch(() => {}); };
    if (now) { clearTimeout(sendT); return go(); }
    if (!sendT) sendT = setTimeout(go, Math.max(0, 40 - (Date.now() - sendLast)));
  }
  const setRect = (id, r, now) => send(id, EdMath.patchFor(PV.tf.get(id), r), now);
  function guides(ov, gs) {
    const gx = ov.querySelector(".pv-guide.x"), gy = ov.querySelector(".pv-guide.y"); gx.hidden = gy.hidden = true;
    for (const g of gs) { const el = g.axis === "x" ? gx : gy; el.hidden = false; el.style[g.axis === "x" ? "left" : "top"] = pct(g.at, g.axis === "x" ? W() : H()); }
  }
  /* edge or corner drag: corners keep the shape (Shift frees it), edges stretch one side, Alt crops instead */
  function resizeRect(s, hd, px, py, free, ov) {
    if (hd.length === 2) return EdMath.resizeFrom(s, hd, px, py, free, W(), H(), thr(ov));
    const r = { ...s };
    if (hd === "e") r.w = Math.max(8, px - s.x); if (hd === "s") r.h = Math.max(8, py - s.y);
    if (hd === "w") { r.x = Math.min(px, s.x + s.w - 8); r.w = s.x + s.w - r.x; }
    if (hd === "n") { r.y = Math.min(py, s.y + s.h - 8); r.h = s.y + s.h - r.y; }
    return r;
  }
  function cropRect(id, s, st, hd, px, py) {
    const t = PV.tf.get(id); if (!t.sourceWidth || !t.sourceHeight) return;
    const vw = t.sourceWidth - st.cropLeft - st.cropRight, vh = t.sourceHeight - st.cropTop - st.cropBottom;
    const kx = vw / s.w, ky = vh / s.h, c = { cropLeft: st.cropLeft, cropRight: st.cropRight, cropTop: st.cropTop, cropBottom: st.cropBottom }, r = { ...s };
    const clampX = v => Math.max(0, Math.min(t.sourceWidth - 8, Math.round(v))), clampY = v => Math.max(0, Math.min(t.sourceHeight - 8, Math.round(v)));
    if (hd.includes("w")) { const d = Math.min(px - s.x, s.w - 8); c.cropLeft = clampX(st.cropLeft + d * kx); r.x = s.x + (c.cropLeft - st.cropLeft) / kx; r.w = s.w - (c.cropLeft - st.cropLeft) / kx; }
    if (hd.includes("e")) { const d = Math.min(s.x + s.w - px, s.w - 8); c.cropRight = clampX(st.cropRight + d * kx); r.w = s.w - (c.cropRight - st.cropRight) / kx; }
    if (hd.includes("n")) { const d = Math.min(py - s.y, s.h - 8); c.cropTop = clampY(st.cropTop + d * ky); r.y = s.y + (c.cropTop - st.cropTop) / ky; r.h = s.h - (c.cropTop - st.cropTop) / ky; }
    if (hd.includes("s")) { const d = Math.min(s.y + s.h - py, s.h - 8); c.cropBottom = clampY(st.cropBottom + d * ky); r.h = s.h - (c.cropBottom - st.cropBottom) / ky; }
    Object.assign(t, c);
    send(id, { ...c, ...EdMath.patchFor(t, r) });
  }
  for (const ov of ovs) {
    ov.addEventListener("pointermove", e => {
      if (PV.drag || ov !== curOv() || !editOn()) return;
      const [x, y] = toCanvas(ov, e), hv = hit(x, y);
      if (hv !== PV.hover) { PV.hover = hv; draw(); }
    });
    ov.addEventListener("pointerleave", () => { if (PV.hover != null && !PV.drag) { PV.hover = null; draw(); } });
    ov.addEventListener("pointerdown", e => {
      if (e.button !== 0 || ov !== curOv() || !editOn()) return;
      const [x, y] = toCanvas(ov, e), hd = e.target.dataset?.h;
      let id = hd ? PV.sel : hit(x, y);
      if (id == null) { if (PV.sel != null) { PV.sel = null; draw(); } return; }
      if (id !== PV.sel) { PV.sel = id; draw(); }
      const t = PV.tf.get(id);
      PV.drag = { id, hd: hd || null, crop: !!hd && e.altKey, start: EdMath.rectOf(t), st: { cropLeft: t.cropLeft, cropRight: t.cropRight, cropTop: t.cropTop, cropBottom: t.cropBottom }, x, y };
      ov.setPointerCapture(e.pointerId); ov.focus({ preventScroll: true }); e.preventDefault();
    });
    ov.addEventListener("pointermove", e => {
      const d = PV.drag; if (!d || ov !== curOv()) return;
      const [px, py] = toCanvas(ov, e), s = d.start;
      if (d.crop) cropRect(d.id, s, d.st, d.hd, px, py);
      else if (d.hd) { setRect(d.id, resizeRect(s, d.hd, px, py, e.shiftKey, ov)); guides(ov, []); }
      else { const m = EdMath.snapMove({ ...s, x: s.x + px - d.x, y: s.y + py - d.y }, W(), H(), e.ctrlKey ? 0 : thr(ov)); setRect(d.id, m.r); guides(ov, m.guides); }
    });
    const end = () => { const d = PV.drag; if (!d) return; PV.drag = null; guides(ov, []); send(d.id, {}, true); setTimeout(() => loadItems(true), 150); };
    ov.addEventListener("pointerup", end); ov.addEventListener("pointercancel", end);
    ov.addEventListener("dblclick", e => {
      const [x, y] = toCanvas(ov, e), id = hit(x, y); if (id == null) return;
      const border = PV.items.find(i => i.sourceName.startsWith("SITE Border:"));
      if (border) slotFor(id).then(sl => sl ? Borders.pickSlot(PV.scene, sl) : window.Editor?.openEdit(PV.scene)); else window.Editor?.openEdit(PV.scene);
    });
    ov.addEventListener("keydown", e => {
      if (PV.sel == null) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); const st = e.shiftKey ? 10 : 1, r = EdMath.rectOf(PV.tf.get(PV.sel)); setRect(PV.sel, { ...r, x: r.x + d[0] * st, y: r.y + d[1] * st }); return; }
      if (e.key === "Delete" && isDirector()) { e.preventDefault(); removeItem(PV.sel); }
      if (e.key === "Escape") { PV.sel = null; draw(); }
    });
    ov.addEventListener("contextmenu", e => { e.preventDefault(); if (ov === curOv()) pvMenu(e, ov); });
  }
  async function slotFor(id) {
    const b = await Borders.detect(PV.scene); if (!b) return null;
    for (const sl of b.t.slots) if ((await Borders.slotItem(PV.scene, sl))?.sceneItemId === id) return sl;
    return null;
  }
  const itemCall = (type, extra) => call(type, { sceneName: PV.scene, sceneItemId: PV.sel, ...extra });
  async function removeItem(id) {
    const it = PV.items.find(i => i.sceneItemId === id); if (!it) return;
    if (!confirm(`Remove "${it.sourceName}" from ${PV.scene}?${isLiveEdit() ? "\n\nThis screen is on air." : ""}`)) return;
    await call("RemoveSceneItem", { sceneName: PV.scene, sceneItemId: id }); PV.sel = null; loadItems(true);
  }
  async function pvMenu(e, ov, forced) {
    // the source under the cursor, else the selection, else a locked layer (border, scoreboard) to unlock it
    const [x, y] = ov ? toCanvas(ov, e) : [-1, -1], id = forced ?? (hit(x, y) ?? PV.sel ?? hit(x, y, true));
    if (id != null && id !== PV.sel) { PV.sel = id; draw(); }
    const it = PV.items.find(i => i.sceneItemId === id), t = it && PV.tf.get(id);
    const border = await window.Borders?.detect(PV.scene);
    const sceneItems = [{ head: `Scene: ${PV.scene}` },
      { label: "Add source…", fn: () => window.Editor?.openNew(PV.scene) },
      { label: "Edit scene and layers…", fn: () => window.Editor?.openEdit(PV.scene) },
      ...(border ? border.t.slots.filter(s => !s.replay).map(s => ({ label: `Change ${s.label.toLowerCase()}…`, fn: () => Borders.pickSlot(PV.scene, s) })) : []),
      { label: "Edit sources on the monitor", checked: editOn(), fn: () => { store.set("pvEdit", !editOn()); PV.sel = null; draw(); } },
      { label: "Multiview", key: "M", fn: openMv }];
    const screenText = window.Site && (await Site.screenOf(PV.scene)) ? [{ label: "Edit screen text…", fn: () => Site.editScreen(PV.scene) }] : [];
    sceneItems.splice(3, 0, ...screenText);
    if (!it || !editOn()) return menu(e.clientX, e.clientY, sceneItems.filter(x => x?.label !== "Add source…" || canEdit()));
    const n = PV.items.length, idx = it.sceneItemIndex, { w: CW, h: CH } = S.canvas;
    const r = EdMath.rectOf(t);
    const slot = border && !it.sourceName.startsWith("SITE Border") ? await slotFor(id) : null;
    menu(e.clientX, e.clientY, [{ head: it.sourceName },
      { label: "Bring to front", disabled: idx === n - 1, fn: () => itemCall("SetSceneItemIndex", { sceneItemIndex: n - 1 }) },
      { label: "Bring forward", disabled: idx === n - 1, fn: () => itemCall("SetSceneItemIndex", { sceneItemIndex: idx + 1 }) },
      { label: "Send backward", disabled: idx === 0, fn: () => itemCall("SetSceneItemIndex", { sceneItemIndex: idx - 1 }) },
      { label: "Send to back", disabled: idx === 0, fn: () => itemCall("SetSceneItemIndex", { sceneItemIndex: 0 }) }, "-",
      slot ? { label: `Fit to the ${slot.label.toLowerCase()}`, fn: () => window.Editor.placeItem(PV.scene, id, { x: slot.rect[0] * CW / 1920, y: slot.rect[1] * CH / 1080, w: slot.rect[2] * CW / 1920, h: slot.rect[3] * CH / 1080 }) } : null,
      { label: "Fill screen (no black bars)", fn: () => itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_SCALE_OUTER", boundsWidth: CW, boundsHeight: CH, boundsAlignment: 0, alignment: 0, positionX: CW / 2, positionY: CH / 2 } }) },
      { label: "Fit to screen", key: "Ctrl F", fn: () => itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: CW, boundsHeight: CH, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } }) },
      { label: "Stretch to screen", key: "Ctrl S", fn: () => itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: CW, boundsHeight: CH, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } }) },
      { label: "Center on screen", key: "Ctrl D", fn: () => setRect(id, { ...r, x: (CW - r.w) / 2, y: (CH - r.h) / 2 }, true) },
      { label: "Center horizontally", fn: () => setRect(id, { ...r, x: (CW - r.w) / 2 }, true) },
      { label: "Center vertically", fn: () => setRect(id, { ...r, y: (CH - r.h) / 2 }, true) },
      { label: "Reset size", key: "Ctrl R", fn: () => itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_NONE", scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, positionX: r.x, positionY: r.y } }) },
      { label: "Reset crop", disabled: !(t.cropLeft || t.cropRight || t.cropTop || t.cropBottom), fn: () => itemCall("SetSceneItemTransform", { sceneItemTransform: { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 } }) }, "-",
      { label: "Visible", checked: it.sceneItemEnabled, fn: () => itemCall("SetSceneItemEnabled", { sceneItemEnabled: !it.sceneItemEnabled }) },
      { label: "Locked", checked: it.sceneItemLocked, fn: () => itemCall("SetSceneItemLocked", { sceneItemLocked: !it.sceneItemLocked }) },
      !isDirector() ? null : { label: "Rename source…", fn: async () => { const nn = prompt(`Rename "${it.sourceName}" to:`, it.sourceName); if (nn && nn.trim() && nn !== it.sourceName) await call("SetInputName", { inputName: it.sourceName, newInputName: nn.trim() }); } },
      { label: "Properties…", fn: () => props(it) },
      { label: "Filters (opens in OBS)", fn: () => call("OpenInputFiltersDialog", { inputName: it.sourceName }).then(() => toast("Filters opened in OBS on the streaming PC.")) },
      isDirector() ? { label: "Remove from scene", key: "Del", danger: true, fn: () => removeItem(id) } : null, "-",
      ...sceneItems]);
  }
  // OBS's own transform shortcuts, while the monitor has focus
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey) || e.altKey || !document.activeElement?.classList.contains("pv-ov") || PV.sel == null) return;
    const { w: CW, h: CH } = S.canvas, r = EdMath.rectOf(PV.tf.get(PV.sel));
    const k = e.key.toLowerCase();
    if (k === "f") itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: CW, boundsHeight: CH, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } });
    else if (k === "s") itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: CW, boundsHeight: CH, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } });
    else if (k === "d") setRect(PV.sel, { ...r, x: (CW - r.w) / 2, y: (CH - r.h) / 2 }, true);
    else if (k === "r") itemCall("SetSceneItemTransform", { sceneItemTransform: { boundsType: "OBS_BOUNDS_NONE", scaleX: 1, scaleY: 1, rotation: 0 } });
    else return;
    e.preventDefault(); setTimeout(() => loadItems(true), 120);
  });

  /* ================= Sources dock ================= */
  /* properties: SITE screens and the chat link edit here; text edits here; anything else opens OBS's own dialog */
  async function props(it) {
    if (window.Site && (it.sourceName.startsWith("SITE Screen · ") || it.sourceName === Site.CHAT)) return Site.editScreen(PV.scene, it.sourceName);
    if (/^text_/.test(it.inputKind || "")) {
      const cur = (await call("GetInputSettings", { inputName: it.sourceName })).inputSettings.text || "";
      const t = prompt(`Text of "${it.sourceName}":`, cur); if (t != null && t !== cur) await call("SetInputSettings", { inputName: it.sourceName, inputSettings: { text: t } });
      return;
    }
    if (it.isGroup || !it.inputKind) return toast("That layer is a whole scene. Pick it in Scenes to edit what's inside.", "warn");
    await call("OpenInputPropertiesDialog", { inputName: it.sourceName });
    toast(`${it.sourceName}: properties opened in OBS on the streaming PC.`);
  }
  let srcKey = "";
  function renderSources() {
    const box = $("#sources"); if (!box) return;
    const key = [PV.scene, PV.sel, ...PV.items.map(i => `${i.sceneItemId}:${i.sceneItemEnabled}:${i.sceneItemLocked}:${i.sourceName}`)].join("|");
    if (key === srcKey) return; srcKey = key;
    $("#srcOf").textContent = PV.scene || "";
    box.textContent = "";
    const edit = canEdit();
    for (const it of PV.items) {
      const id = it.sceneItemId, toggle = (type, field) => e => { e.stopPropagation(); if (edit) call(type, { sceneName: PV.scene, sceneItemId: id, [field]: !it[field] }).then(() => loadItems(true)); };
      const li = h("li", { class: `src${id === PV.sel ? " sel" : ""}${it.sceneItemEnabled ? "" : " off"}`, tabindex: "0", role: "option", "aria-selected": String(id === PV.sel) },
        h("button", { type: "button", class: "src-ic", disabled: !edit, title: it.sceneItemEnabled ? "Hide" : "Show", "aria-label": `${it.sceneItemEnabled ? "Hide" : "Show"} ${it.sourceName}`, onclick: toggle("SetSceneItemEnabled", "sceneItemEnabled") }, icon(it.sceneItemEnabled ? "eye" : "eyeoff")),
        h("span", { class: "src-nm", title: it.sourceName }, it.sourceName),
        h("button", { type: "button", class: `src-ic${it.sceneItemLocked ? " on" : ""}`, disabled: !edit, title: it.sceneItemLocked ? "Unlock" : "Lock", "aria-label": `${it.sceneItemLocked ? "Unlock" : "Lock"} ${it.sourceName}`, onclick: toggle("SetSceneItemLocked", "sceneItemLocked") }, icon(it.sceneItemLocked ? "lock" : "unlock")));
      const select = () => { PV.sel = id; draw(); renderSources(); };
      li.addEventListener("click", select);
      li.addEventListener("dblclick", () => props(it));
      li.addEventListener("keydown", e => { if (e.key === "Enter") props(it); else if (e.key === "Delete" && isDirector()) removeItem(id); });
      li.addEventListener("contextmenu", e => { e.preventDefault(); select(); pvMenu(e, null, id); });
      box.append(li);
    }
    if (!PV.items.length && PV.scene) box.append(h("li", { class: "empty" }, "Nothing here yet. Press + to add a source."));
    const foot = $("#srcFoot"); foot.textContent = "";
    const sel = PV.items.find(i => i.sceneItemId === PV.sel), n = PV.items.length;
    const fb = (ic, label, fn, dis) => h("button", { type: "button", class: "btn small icon", title: label, "aria-label": label, disabled: !!dis, onclick: fn }, icon(ic));
    foot.append(
      fb("plus", "Add source", () => window.Editor?.openNew(PV.scene), !edit || !PV.scene),
      fb("minus", "Remove from scene", () => removeItem(PV.sel), !isDirector() || !sel),
      fb("gear2", "Properties", () => props(sel), !sel),
      fb("up", "Move up", () => itemCall("SetSceneItemIndex", { sceneItemIndex: Math.min(n - 1, sel.sceneItemIndex + 1) }).then(() => loadItems(true)), !edit || !sel || sel.sceneItemIndex >= n - 1),
      fb("down", "Move down", () => itemCall("SetSceneItemIndex", { sceneItemIndex: Math.max(0, sel.sceneItemIndex - 1) }).then(() => loadItems(true)), !edit || !sel || sel.sceneItemIndex <= 0));
  }

  /* Program monitor menu (in Studio Mode it isn't editable, like OBS) */
  $("#imgProgram")?.parentElement.addEventListener("contextmenu", e => {
    if (!S.studio) return; // in one-monitor mode the editor above owns the menu
    e.preventDefault();
    menu(e.clientX, e.clientY, [{ head: `Program: ${S.program}` },
      { label: "Multiview", key: "M", fn: openMv },
      { label: "Save a screenshot", fn: snap }]);
  });
  /* saved by OBS next to its recordings, at full canvas size */
  async function snap() {
    const dir = (await call("GetRecordDirectory")).recordDirectory.replace(/[\\/]+$/, "");
    const safe = S.program.replace(/[\\/:*?"<>|]/g, "_"), when = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const file = `${dir}/${safe} ${when}.png`;
    await call("SaveSourceScreenshot", { sourceName: S.program, imageFormat: "png", imageFilePath: file });
    toast(`Screenshot saved: ${file}`);
  }

  /* ================= Multiview ================= */
  let mvOpen = false, mvEl = null, mvTiles = new Map();
  function openMv() {
    if (mvOpen) return closeMv();
    mvOpen = true;
    const pv = h("img", { class: "mv-img", alt: "Preview" }), pg = h("img", { class: "mv-img", alt: "Program" });
    const grid = h("div", { class: "mv-grid" });
    mvEl = h("div", { class: "mv", role: "dialog", "aria-label": "Multiview" },
      h("div", { class: "mv-bar" }, h("b", {}, "Multiview"), h("span", { class: "muted small grow" }, S.studio ? "Click a scene to load it into Preview, double-click to transition to it." : "Click a scene to put it on air."),
        S.studio ? h("button", { type: "button", class: "btn primary", onclick: () => JS.take() }, "Transition") : null,
        S.studio ? h("button", { type: "button", class: "btn", onclick: () => JS.cut() }, "Cut") : null,
        h("button", { type: "button", class: "btn", onclick: closeMv }, "Close (M)")),
      h("div", { class: "mv-top" },
        S.studio ? h("div", { class: "mv-big next" }, pv, h("span", { class: "mv-lbl" }, h("i", { class: "tally next" }, "Preview"), h("span", { class: "mv-name pv-name" }))) : null,
        h("div", { class: "mv-big air" }, pg, h("span", { class: "mv-lbl" }, h("i", { class: "tally air" }, "Program"), h("span", { class: "mv-name pg-name" })))),
      grid);
    $(".workspace").append(mvEl);
    document.body.classList.add("mv-on");
    mvEl.pv = pv; mvEl.pg = pg; mvEl.grid = grid;
    renderMv(); mvLoop();
  }
  function closeMv() { mvOpen = false; mvEl?.remove(); mvEl = null; mvTiles.clear(); document.body.classList.remove("mv-on"); }
  function renderMv() {
    if (!mvEl) return;
    const key = S.scenes.join("\u0000");
    if (mvEl.grid.dataset.key !== key) {
      mvEl.grid.dataset.key = key; mvEl.grid.textContent = ""; mvTiles.clear();
      S.scenes.forEach((n, i) => {
        const img = h("img", { alt: "", src: S.thumbs[n] || "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" });
        const b = h("button", { type: "button", class: "mv-tile", "data-scene": n, title: n }, img, h("span", { class: "mv-tname" }, i < 9 ? h("kbd", {}, String(i + 1)) : null, n, h("span", { class: "mv-roles" })));
        let clickT = null;
        b.addEventListener("click", () => { clearTimeout(clickT); clickT = setTimeout(() => JS.pickScene(n), S.studio ? 180 : 0); });
        b.addEventListener("dblclick", async () => { clearTimeout(clickT); if (!S.studio) return; await call("SetCurrentPreviewScene", { sceneName: n }); await JS.take(); });
        b.addEventListener("contextmenu", e => { e.preventDefault(); JS.tileEls.get(n)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: e.clientX, clientY: e.clientY })); });
        mvTiles.set(n, b); mvEl.grid.append(b);
      });
    }
    for (const [n, b] of mvTiles) {
      b.classList.toggle("is-program", n === S.program); b.classList.toggle("is-preview", S.studio && n === S.preview && n !== S.program);
      b.querySelector(".mv-roles").textContent = roleOf(n).join(" · ");
    }
    mvEl.querySelector(".pv-name") && (mvEl.querySelector(".pv-name").textContent = S.preview || "");
    mvEl.querySelector(".pg-name").textContent = S.program || "";
  }
  async function mvLoop() {
    let i = 0;
    while (mvOpen) {
      mvEl.pg.src = $("#imgProgram").src; if (S.studio) mvEl.pv.src = $("#imgPreview").src;
      const n = S.scenes[i++ % Math.max(1, S.scenes.length)];
      if (n && S.connected) {
        try {
          const w = Math.round(Math.min(480, Math.max(240, (mvTiles.get(n)?.offsetWidth || 320) * devicePixelRatio)) / 16) * 16;
          S.thumbs[n] = (await JS.timed(obs.call("GetSourceScreenshot", { sourceName: n, imageFormat: "jpg", imageWidth: w, imageCompressionQuality: 55 }))).imageData;
          const img = mvTiles.get(n)?.querySelector("img"); if (img) img.src = S.thumbs[n];
        } catch {}
      }
      await sleep(Math.max(40, 300 / Math.max(1, S.scenes.length)));
    }
  }
  for (const id of ["#btnMultiview", "#btnMultiview2"]) $(id)?.addEventListener("click", openMv);
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, select, textarea, dialog, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey || !S.connected) return;
    if (e.key.toLowerCase() === "m") { e.preventDefault(); openMv(); }
    else if (e.key === "Escape" && mvOpen) closeMv();
  });
  for (const ev of ["CurrentProgramSceneChanged", "CurrentPreviewSceneChanged", "SceneListChanged"]) obs.on(ev, () => setTimeout(() => { if (mvOpen) renderMv(); renderRoles(); }, 50));

  $("#role")?.addEventListener("change", () => { PV.sel = null; draw(); });
  JS.onReady(async () => { roles = await shared.get("roles", {}) || {}; decorateTiles(); loadItems(true); renderMixQuick(); });

  window.Studio = { reloadRoles: async () => { roles = await shared.get("roles", {}) || {}; decorateTiles(); }, menu, closeMenu, setZoom, get zoom() { return zoom; }, ZOOMS, decorateTiles, openMv, closeMv, resetLayout, wholeMix,
    get layout() { return layout; }, showDock: k => { layout.hidden = layout.hidden.filter(x => x !== k); applyLayout(); }, DOCKS, editOn, setEditOn: v => { store.set("pvEdit", !!v); PV.sel = null; draw(); } };
})();
