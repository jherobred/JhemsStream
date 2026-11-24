"use strict";
/* SITE border templates: a locked border image over the whole canvas, with windows ("slots") for the game, chat or
   replay underneath or on top, and the SITE scoreboard in the top bar. The crew only picks what each window shows.
   A scene is a border scene when it holds a "SITE Border: …" input; a slot's source is whichever item fills that
   window, so nothing about the layout is kept outside OBS. Window rectangles match scripts/borders/make.py. */
(() => {
  const { obs, S, call, h, $, toast, shared, store } = window.JS;
  const T = window.__TAURI__;
  const BOARD = "SITE Border Scoreboard";
  const SB = { a: "Team A Name", b: "Team B Name", sa: "Score A", sb: "Score B" };
  const TEMPLATES = [
    { id: "gameplay", label: "SITE Gameplay", file: "border-gameplay.png", thumb: "img/tpl-gameplay.jpg", board: true,
      desc: "Thin SITE frame, game fills 90% of the screen, scoreboard in the top bar.",
      slots: [{ id: "game", label: "Game window", rect: [93, 84, 1735, 976], above: false }] },
    { id: "chat", label: "SITE Gameplay + Chat", file: "border-chat.png", thumb: "img/tpl-chat.jpg", board: true,
      desc: "Game on the left, a live chat panel on the right, scoreboard on top.",
      slots: [{ id: "game", label: "Game window", rect: [40, 84, 1448, 815], above: false },
              { id: "chat", label: "Chat panel", rect: [1516, 130, 356, 761], above: true, chat: true }] },
    { id: "replay", label: "SITE Instant Replay", file: "border-replay.png", thumb: "img/tpl-replay.jpg", board: false,
      desc: "The gameplay frame with an INSTANT REPLAY plate. Instant replays air here.",
      slots: [{ id: "replay", label: "Replay", rect: [93, 84, 1735, 976], above: false, replay: true }] },
    { id: "cams", label: "SITE Gameplay + Cams", file: "border-cams.png", thumb: "img/tpl-cams.jpg", board: true,
      desc: "Game in the middle, a camera window in each bottom corner, scoreboard on top.",
      slots: [{ id: "game", label: "Game window", rect: [256, 78, 1408, 792], above: false },
              { id: "camL", label: "Left camera", rect: [24, 876, 336, 189], above: false },
              { id: "camR", label: "Right camera", rect: [1560, 876, 336, 189], above: false }] },
    { id: "arena", label: "SITE Arena (BG2)", file: "border-arena.png", thumb: "img/tpl-arena.jpg", board: true,
      desc: "BG2's neon corridor art as a thin frame, game fills 90% of the screen.",
      slots: [{ id: "game", label: "Game window", rect: [93, 84, 1735, 976], above: false }] },
    { id: "arena-cams", label: "SITE Arena + Cams (BG2)", file: "border-arena-cams.png", thumb: "img/tpl-arena-cams.jpg", board: true,
      desc: "BG2 art, game in the middle and a camera window in each bottom corner.",
      slots: [{ id: "game", label: "Game window", rect: [256, 78, 1408, 792], above: false },
              { id: "camL", label: "Left camera", rect: [24, 876, 336, 189], above: false },
              { id: "camR", label: "Right camera", rect: [1560, 876, 336, 189], above: false }] },
    { id: "casters", label: "SITE Casters (BG2)", file: "border-casters.png", thumb: "img/tpl-casters.jpg", board: false,
      desc: "Two caster cameras side by side with name plates, BG2 art.",
      slots: [{ id: "cam1", label: "Caster 1 camera", rect: [112, 214, 832, 468], above: false },
              { id: "cam2", label: "Caster 2 camera", rect: [976, 214, 832, 468], above: false }] },
  ];
  /* a window's source fills it edge to edge: scaled to cover (no black bars) and centred; the border on top hides
     the overflow. Windows that sit above the border (chat) fit inside instead. */
  async function placeIn(scene, id, slot) {
    const r = scaleRect(slot.rect);
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: {
      boundsType: slot.above ? "OBS_BOUNDS_SCALE_INNER" : "OBS_BOUNDS_SCALE_OUTER", boundsWidth: r.w, boundsHeight: r.h, boundsAlignment: 0,
      alignment: 0, positionX: r.x + r.w / 2, positionY: r.y + r.h / 2 } });
  }
  const borderName = t => `SITE Border: ${t.label.replace(/^SITE /, "")}`;
  const scaleRect = ([x, y, w, h]) => { const kx = S.canvas.w / 1920, ky = S.canvas.h / 1080; return { x: x * kx, y: y * ky, w: w * kx, h: h * ky }; };
  let dir = null;
  async function assetDir() {
    if (!T) throw new Error("Border templates need the desktop app on the streaming PC.");
    dir = dir || String(await T.core.invoke("stinger_dir")).replace(/[\\/]+$/, "");
    return dir;
  }
  const itemsOf = async scene => (await call("GetSceneItemList", { sceneName: scene })).sceneItems;
  const inputNames = async () => new Set((await call("GetInputList")).inputs.map(i => i.inputName));

  /* ---------- which template a scene uses, and what fills each window ---------- */
  async function detect(scene) {
    try {
      const items = await itemsOf(scene);
      const t = TEMPLATES.find(t => items.some(i => i.sourceName === borderName(t)));
      return t ? { t, items } : null;
    } catch { return null; }
  }
  const near = (a, b) => Math.abs(a - b) <= 3;
  async function slotItem(scene, slot, items) {
    const r = scaleRect(slot.rect);
    for (const it of items || await itemsOf(scene)) {
      if (it.sourceName === BOARD || it.sourceName.startsWith("SITE Border:")) continue;
      const t = (await obs.call("GetSceneItemTransform", { sceneName: scene, sceneItemId: it.sceneItemId }).catch(() => null))?.sceneItemTransform;
      if (!t) continue;
      const box = EdMath.rectOf(t);
      // an item counts as the window's source when it sits inside the window and spans it on one axis (fit inside keeps aspect)
      const inside = box.x >= r.x - 3 && box.y >= r.y - 3 && box.x + box.w <= r.x + r.w + 3 && box.y + box.h <= r.y + r.h + 3;
      if (inside && (near(box.w, r.w) || near(box.h, r.h) || (t.boundsType !== "OBS_BOUNDS_NONE" && near(t.boundsWidth, r.w) && near(t.boundsHeight, r.h)))) return it;
    }
    return null;
  }

  /* ---------- layers: windows below the border, chat and scoreboard above it ---------- */
  async function order(scene, t) {
    const items = await itemsOf(scene);
    const idOf = n => items.find(i => i.sourceName === n)?.sceneItemId;
    const top = async id => { if (id == null) return; const n = (await itemsOf(scene)).length; await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: n - 1 }); };
    await top(idOf(borderName(t)));
    for (const sl of t.slots.filter(s => s.above)) await top((await slotItem(scene, sl))?.sceneItemId);
    await top(idOf(BOARD));
  }

  /* ---------- scoreboard in the top bar: one browser source shared by every border scene ---------- */
  let boardOpts = { score: true, label: "" };
  async function boardUrl() {
    const d = await assetDir();
    const q = new URLSearchParams({ kind: "bar", score: boardOpts.score ? "1" : "0", label: boardOpts.label || "", port: S.port || 4455, pw: S.pw || "" });
    return "file:///" + encodeURI(d.replace(/\\/g, "/")) + "/overlay.html#" + q;
  }
  async function ensureScoreInputs() {
    const have = await inputNames();
    const missing = Object.entries(SB).filter(([, n]) => !have.has(n));
    if (!missing.length) return;
    if (!S.scenes.includes("Scoreboard")) await call("CreateScene", { sceneName: "Scoreboard" });
    for (const [k, n] of missing) await call("CreateInput", { sceneName: "Scoreboard", inputName: n, inputKind: "text_gdiplus_v3",
      inputSettings: { text: k === "a" ? "TEAM A" : k === "b" ? "TEAM B" : "0", font: { face: "Arial", size: 44, style: "Bold", flags: 1 } } });
  }
  async function ensureBoard(scene) {
    await ensureScoreInputs();
    const settings = { url: await boardUrl(), width: S.canvas.w, height: S.canvas.h, fps: 60, shutdown: false, restart_when_active: false, reroute_audio: false };
    let id;
    if (!(await inputNames()).has(BOARD)) id = (await call("CreateInput", { sceneName: scene, inputName: BOARD, inputKind: "browser_source", inputSettings: settings })).sceneItemId;
    else id = (await obs.call("GetSceneItemId", { sceneName: scene, sourceName: BOARD }).catch(() => null))?.sceneItemId ?? (await call("CreateSceneItem", { sceneName: scene, sourceName: BOARD })).sceneItemId;
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: S.canvas.w, boundsHeight: S.canvas.h, alignment: 5, positionX: 0, positionY: 0 } });
    await call("SetSceneItemLocked", { sceneName: scene, sceneItemId: id, sceneItemLocked: true });
  }
  /* only the options in the URL's hash change: the file path belongs to the streaming PC, and a helper's laptop
     (desktop app or browser) must never swap in its own path */
  async function setBoardOpts(patch) {
    boardOpts = { ...boardOpts, ...patch };
    await shared.set("board", boardOpts);
    if (!(await inputNames()).has(BOARD)) return;
    const url = (await call("GetInputSettings", { inputName: BOARD })).inputSettings.url || "";
    const [base, hash = ""] = url.split("#"), q = new URLSearchParams(hash);
    q.set("score", boardOpts.score ? "1" : "0"); q.set("label", boardOpts.label || "");
    await call("SetInputSettings", { inputName: BOARD, inputSettings: { url: `${base}#${q}` } });
  }
  async function borderScenes() {
    const out = [];
    for (const n of S.scenes) { const d = await detect(n); if (d) out.push({ scene: n, ...d }); }
    return out;
  }

  /* ---------- make a scene from a template ---------- */
  async function create(id) {
    const t = TEMPLATES.find(x => x.id === id);
    if (!t || !S.connected) return;
    if (!S.isLocal) return toast("Make border screens from JhemsStream on the streaming PC. Its files have to be on the PC that runs OBS.", "warn");
    try {
      const d = await assetDir();
      let name = t.label, i = 2;
      while (S.scenes.includes(name)) name = `${t.label} ${i++}`;
      name = (prompt("Name for the new screen:", name) || "").trim();
      if (!name) return;
      if (S.scenes.includes(name)) return toast("A screen with that name already exists.", "warn");
      await build(name, id);
      await JS.refreshScenes(); JS.refreshInputs();
      if (S.studio) JS.pickScene(name);
      toast(`${name} is ready.${t.slots.some(s => !s.replay) ? " Pick what shows in its window." : " Instant replays now air on it."}`, "ok");
      const open = t.slots.filter(s => !s.replay);
      if (open.length) pickSlot(name, open[0], open.slice(1));
    } catch (e) { toast("Couldn't make the screen: " + (e.message || e), "bad"); }
  }
  /* make a border scene: fills maps slot id -> a source or scene name to show in that window */
  async function build(name, id, fills = {}) {
    const t = TEMPLATES.find(x => x.id === id), d = await assetDir();
    {
      await call("CreateScene", { sceneName: name });
      // the border: one image input per template, reused by every scene made from it, full canvas and locked
      const bname = borderName(t), file = `${d}\\${t.file}`;
      let bid;
      if ((await inputNames()).has(bname)) bid = (await call("CreateSceneItem", { sceneName: name, sourceName: bname })).sceneItemId;
      else bid = (await call("CreateInput", { sceneName: name, inputName: bname, inputKind: "image_source", inputSettings: { file, unload: false } })).sceneItemId;
      await call("SetSceneItemTransform", { sceneName: name, sceneItemId: bid, sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: S.canvas.w, boundsHeight: S.canvas.h, alignment: 5, positionX: 0, positionY: 0 } });
      await call("SetSceneItemLocked", { sceneName: name, sceneItemId: bid, sceneItemLocked: true });
      if (t.board) await ensureBoard(name);
      for (const sl of t.slots.filter(s => s.replay)) await fillReplay(name, sl);
      // windows in reverse so the first one listed (the game) ends up lowest, under camera windows it might overlap
      for (const sl of [...t.slots].reverse()) {
        const src = fills[sl.id]; if (!src || sl.replay) continue;
        const sid = (await call("CreateSceneItem", { sceneName: name, sourceName: src })).sceneItemId;
        await placeIn(name, sid, sl);
        if (!sl.above) await call("SetSceneItemIndex", { sceneName: name, sceneItemId: sid, sceneItemIndex: 0 });
      }
      await order(name, t);
    }
  }
  /* the replay template shows JhemsStream's replay clip input in its window and becomes the replay screen */
  async function fillReplay(scene, sl) {
    const R = window.Replay; const name = R?.INPUT || "JS Replay";
    const r = scaleRect(sl.rect);
    let id;
    if ((await inputNames()).has(name)) id = (await call("CreateSceneItem", { sceneName: scene, sourceName: name })).sceneItemId;
    else id = (await call("CreateInput", { sceneName: scene, inputName: name, inputKind: "ffmpeg_source", inputSettings: { is_local_file: true, looping: false, restart_on_activate: true, close_when_inactive: false } })).sceneItemId;
    await placeIn(scene, id, sl);
    await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
    R?.setScene?.(scene);
  }

  /* ---------- pick what a window shows ---------- */
  const VISUAL = /^(window_capture|monitor_capture|game_capture|dshow_input|browser_source|ffmpeg_source|image_source|vlc_source|scene)$/;
  async function pickSlot(scene, slot, then = []) {
    const t = (await detect(scene))?.t;
    const E = window.Editor;
    const dlg = h("dialog", { class: "editor-dlg" });
    const body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, `${slot.label}: ${scene}`),
      h("button", { type: "button", class: "btn icon", "aria-label": "Close", onclick: () => dlg.close(), html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' })), body, foot);
    dlg.addEventListener("close", () => { dlg.remove(); if (then.length) pickSlot(scene, then[0], then.slice(1)); });
    document.body.append(dlg);
    const err = h("p", { class: "err", role: "alert" });
    const kinds = [["existing", "A source you already have"], ["discord", "Discord screen share"], ["camera", "Camera / capture card"], ["window", "One window"], ["monitor", "Whole monitor"], ["web", slot.chat ? "Chat overlay link (web page)" : "Web page"]];
    const kindSel = h("select", { id: "slKind" }, ...kinds.map(([v, l]) => h("option", { value: v }, l)));
    const itemSel = h("select", { id: "slItem" });
    const urlIn = h("input", { id: "slUrl", type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://…" });
    const itemWrap = h("div", { class: "field" }, h("label", { for: "slItem" }, "Which one"), itemSel);
    const urlWrap = h("div", { class: "field", hidden: true }, h("label", { for: "slUrl" }, "Link"), urlIn);
    const chatTip = slot.chat ? h("p", { class: "tip" }, "Facebook has no official chat overlay link. Two ways that work: paste a chat overlay link from a tool that reads Facebook Live comments (for example Social Stream Ninja, with its browser extension open on your Live Producer page), or pick One window and choose a browser window showing the Live Producer comments.") : null;
    const cur = await slotItem(scene, slot);
    body.append(h("p", { class: "muted" }, cur ? `Now showing: ${cur.sourceName}. The border stays locked; only this window changes.` : "The window is empty. The border stays locked; only this window changes."),
      chatTip, h("div", { class: "field" }, h("label", { for: "slKind" }, "Show"), kindSel), itemWrap, urlWrap, err);
    let typeDef = null;
    async function load() {
      err.textContent = ""; itemSel.textContent = "";
      const k = kindSel.value;
      urlWrap.hidden = k !== "web"; itemWrap.hidden = k === "web";
      if (k === "web") return;
      if (k === "existing") {
        const list = (await call("GetInputList")).inputs.filter(i => VISUAL.test(i.unversionedInputKind) && !i.inputName.startsWith("SITE Border") && i.inputName !== BOARD && !i.inputName.startsWith("JS Stinger"));
        const scenes = S.scenes.filter(n => n !== scene).map(n => ({ inputName: n, scene: true }));
        if (!list.length && !scenes.length) itemSel.append(h("option", { value: "" }, "No sources yet"));
        if (list.length) itemSel.append(h("optgroup", { label: "Sources" }, ...list.map(i => h("option", { value: "i:" + i.inputName }, i.inputName))));
        if (scenes.length) itemSel.append(h("optgroup", { label: "Whole screens" }, ...scenes.map(i => h("option", { value: "s:" + i.inputName }, i.inputName))));
        return;
      }
      typeDef = E.TYPES.find(x => x.id === k);
      itemSel.append(h("option", { value: "" }, "Loading…"));
      try {
        let items = (await E.listItems(typeDef.kind, typeDef.prop)).filter(i => i.itemEnabled !== false && i.itemValue && i.itemValue !== "DUMMY");
        if (typeDef.filter) items = items.filter(i => typeDef.filter.test(i.itemName));
        itemSel.textContent = "";
        items.forEach(i => itemSel.append(h("option", { value: i.itemValue }, i.itemName || i.itemValue)));
        if (!items.length) itemSel.append(h("option", { value: "" }, k === "discord" ? "Open Discord and pop out the stream first" : "Nothing found"));
      } catch (e) { itemSel.textContent = ""; itemSel.append(h("option", { value: "" }, "Couldn't list: " + e.message)); }
    }
    kindSel.addEventListener("change", load);
    const ok = h("button", { type: "button", class: "btn primary", onclick: async () => {
      try {
        ok.disabled = true;
        await fill(scene, slot, t, kindSel.value, itemSel.value, urlIn.value.trim(), typeDef, itemSel.selectedOptions[0]?.textContent || "");
        dlg.close();
      } catch (e) { err.textContent = e.message || String(e); } finally { ok.disabled = false; }
    } }, "Show it");
    foot.append(cur ? h("button", { type: "button", class: "btn", onclick: async () => { await call("RemoveSceneItem", { sceneName: scene, sceneItemId: cur.sceneItemId }); dlg.close(); } }, "Empty the window") : null,
      h("span", { class: "grow" }), h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancel"), ok);
    dlg.showModal();
    load();
  }

  async function fill(scene, slot, t, kind, value, url, typeDef, label) {
    const r = scaleRect(slot.rect), E = window.Editor;
    let id, input, crop = null, discord = false;
    if (kind === "existing") {
      if (!value) throw new Error("Pick a source.");
      input = value.slice(2);
      // reuse the crop the source already has elsewhere (a fitted Discord capture keeps only the stream video)
      if (value.startsWith("i:")) for (const sc of S.scenes) {
        const sid = (await obs.call("GetSceneItemId", { sceneName: sc, sourceName: input }).catch(() => null))?.sceneItemId;
        if (sid == null) continue;
        const tr = (await call("GetSceneItemTransform", { sceneName: sc, sceneItemId: sid })).sceneItemTransform;
        crop = { cropLeft: tr.cropLeft, cropRight: tr.cropRight, cropTop: tr.cropTop, cropBottom: tr.cropBottom }; break;
      }
      id = (await call("CreateSceneItem", { sceneName: scene, sourceName: input })).sceneItemId;
    } else {
      let settings;
      if (kind === "web") {
        if (!/^https?:\/\//i.test(url)) throw new Error("Paste a full link starting with https://");
        settings = { url, width: Math.round(r.w), height: Math.round(r.h), css: "body{background-color:rgba(0,0,0,0)!important;margin:0;overflow:hidden}", reroute_audio: true };
        label = slot.chat ? "Chat" : "Web page";
      } else {
        if (!value) throw new Error("Pick an item from the list.");
        label = label.replace(/^\[[^\]]+\]:\s*/, "").slice(0, 40);
        if (kind === "discord") { settings = { window: value, method: 2, client_area: true, cursor: false, priority: 2 }; label = "Discord stream"; discord = true; }
        else settings = { [typeDef.prop]: value };
      }
      input = await E.uniqueInputName(`${scene} - ${label}`);
      id = (await call("CreateInput", { sceneName: scene, inputName: input, inputKind: kind === "web" ? "browser_source" : typeDef.kind, inputSettings: settings })).sceneItemId;
    }
    const old = await slotItem(scene, slot);
    if (old && old.sceneItemId !== id) await call("RemoveSceneItem", { sceneName: scene, sceneItemId: old.sceneItemId });
    if (crop) await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: crop });
    if (kind === "web") await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: r.w, boundsHeight: r.h, alignment: 5, positionX: r.x, positionY: r.y } });
    else await placeIn(scene, id, slot);
    if (!slot.above) await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
    if (t) await order(scene, t);
    if (discord) {
      JS.store.set(E.fitKey(input), { on: true, scene, id, rect: r });
      setTimeout(() => E.autoFitDiscord(scene, id, { rect: r }), 1500);
    }
    JS.refreshInputs(); toast(`${slot.label} on ${scene}: ${input}`, "ok");
  }

  /* ---------- Scores tab: the border scoreboard's own options ---------- */
  async function renderBoardBox() {
    const box = $("#boardBox"); if (!box) return;
    box.textContent = "";
    const list = await borderScenes();
    const withBoard = list.filter(b => b.t.board);
    if (!withBoard.length) { box.append(h("p", { class: "muted small" }, "Add a SITE Gameplay screen (Add scene, templates) to get the scoreboard in the border's top bar.")); return; }
    const scoreCb = h("input", { type: "checkbox", role: "switch", class: "switch", "aria-label": "Show scores" }); scoreCb.checked = boardOpts.score;
    scoreCb.addEventListener("change", () => setBoardOpts({ score: scoreCb.checked }));
    const label = h("input", { type: "text", value: boardOpts.label, placeholder: "e.g. GAME 2 · BEST OF 3", maxlength: 28, "aria-label": "Small text under VS" });
    label.addEventListener("change", () => setBoardOpts({ label: label.value.trim() }));
    const shows = await Promise.all(withBoard.map(async b => {
      const it = b.items.find(i => i.sourceName === BOARD);
      const cb = h("input", { type: "checkbox" }); cb.checked = !!it?.sceneItemEnabled;
      cb.addEventListener("change", async () => {
        if (!it) { await ensureBoard(b.scene); await order(b.scene, b.t); return renderBoardBox(); }
        call("SetSceneItemEnabled", { sceneName: b.scene, sceneItemId: it.sceneItemId, sceneItemEnabled: cb.checked });
      });
      return h("label", { class: "inline" }, cb, b.scene);
    }));
    box.append(
      h("label", { class: "row" }, scoreCb, h("span", { class: "grow" }, "Show scores next to the team names")),
      h("label", { class: "field" }, h("span", {}, "Small text under VS"), label),
      h("div", { class: "row" }, h("span", { class: "muted small" }, "Scoreboard on:"), ...shows),
      h("p", { class: "muted small" }, "Team names and scores come from the boxes above."));
  }

  JS.onReady(async () => {
    boardOpts = { ...boardOpts, ...(await shared.get("board", {})) };
    renderBoardBox();
    // every crew member's JhemsStream keeps the shared scoreboard URL current (password or port can change)
    if (T && S.isLocal && (await inputNames().catch(() => new Set())).has(BOARD)) call("SetInputSettings", { inputName: BOARD, inputSettings: { url: await boardUrl() } }).catch(() => {});
  });
  for (const ev of ["SceneListChanged", "SceneItemCreated", "SceneItemRemoved"]) obs.on(ev, () => { clearTimeout(renderBoardBox.t); renderBoardBox.t = setTimeout(renderBoardBox, 600); });

  window.Borders = { TEMPLATES, create, build, placeIn, ensureScoreInputs, detect, pickSlot, slotItem, borderScenes, setBoardOpts, get boardOpts() { return boardOpts; }, BOARD };
})();
