"use strict";
/* JhemsStream screen tools: the "Add a screen" wizard (incl. Discord screen share), the per-screen
   editor with an OBS-style layout canvas (select, move, resize, snap, nudge, crop), and Discord auto-fit.
   Needs window.JS from app.js. The pure geometry and image-scan helpers sit in EdMath so node can test them. */

const EdMath = (() => {
  const NONE = "OBS_BOUNDS_NONE";
  /* OBS alignment bits: 1 left, 2 right, 4 top, 8 bottom, 0 centre */
  const ax = (a, w) => (a & 1 ? 0 : a & 2 ? w : w / 2);
  const ay = (a, h) => (a & 4 ? 0 : a & 8 ? h : h / 2);
  const visW = t => Math.max(0, t.sourceWidth - t.cropLeft - t.cropRight);
  const visH = t => Math.max(0, t.sourceHeight - t.cropTop - t.cropBottom);

  /** Canvas-space box of a scene item: the bounds box when it has bounds, else the scaled, cropped source. */
  function rectOf(t) {
    const w = t.boundsType && t.boundsType !== NONE ? t.boundsWidth : visW(t) * t.scaleX;
    const h = t.boundsType && t.boundsType !== NONE ? t.boundsHeight : visH(t) * t.scaleY;
    return { x: t.positionX - ax(t.alignment, w), y: t.positionY - ay(t.alignment, h), w, h };
  }
  /** Transform patch that puts the item's box at x, y with size w, h. */
  function patchFor(t, r) {
    const p = { positionX: r.x + ax(t.alignment, r.w), positionY: r.y + ay(t.alignment, r.h) };
    if (t.boundsType && t.boundsType !== NONE) { p.boundsWidth = r.w; p.boundsHeight = r.h; }
    else if (visW(t) && visH(t)) { p.scaleX = r.w / visW(t); p.scaleY = r.h / visH(t); }
    return p;
  }
  /** Snap a moving box to canvas edges and centre; returns the box plus guide lines to draw. */
  function snapMove(r, W, H, thr) {
    const out = { ...r }, guides = [];
    const pick = (pos, size, targets) => {
      let best = null;
      for (const [edge, off] of [[pos, 0], [pos + size / 2, size / 2], [pos + size, size]])
        for (const tg of targets) { const d = Math.abs(edge - tg); if (d <= thr && (!best || d < best.d)) best = { d, v: tg - off, tg }; }
      return best;
    };
    const sx = pick(r.x, r.w, [0, W / 2, W]); if (sx) { out.x = sx.v; guides.push({ axis: "x", at: sx.tg }); }
    const sy = pick(r.y, r.h, [0, H / 2, H]); if (sy) { out.y = sy.v; guides.push({ axis: "y", at: sy.tg }); }
    return { r: out, guides };
  }
  /** Resize from a corner with the opposite corner fixed; keeps aspect unless free. */
  function resizeFrom(start, corner, px, py, free, W, H, thr) {
    const ar = start.w / start.h || 1;
    const fx = corner.includes("w") ? start.x + start.w : start.x, fy = corner.includes("n") ? start.y + start.h : start.y;
    const snap = v => [0, W, H].reduce((b, t) => Math.abs(v - t) <= thr ? t : b, v);
    let w = Math.max(16, Math.abs(snap(px) - fx)), h = Math.max(16, Math.abs(snap(py) - fy));
    if (!free) { if (w / h > ar) h = w / ar; else w = h * ar; }
    return { x: corner.includes("w") ? fx - w : fx, y: corner.includes("n") ? fy - h : fy, w, h };
  }

  /** Stream aspects Discord shows: 16:9, 16:10, 4:3, 21:9, each within 8%. */
  const aspectOk = (w, h) => h > 0 && [16 / 9, 16 / 10, 4 / 3, 21 / 9].some(a => Math.abs(w / h / a - 1) <= 0.08);

  /** Find the stream video inside a Discord window capture by peeling off letterbox and UI lines from every edge.
      data: RGBA bytes, w x h. A line is UI when >= 92% of its samples are near-black, match the edge's own colour,
      or the line is near-uniform. Returns crop in source pixels, or null when nothing sensible is left. */
  function scanCrop(data, w, h) {
    const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const SAMPLES = 96;
    const line = (vertical, k) => {
      const n = vertical ? h : w, out = [];
      for (let s = 0; s < SAMPLES; s++) { const j = Math.min(n - 1, Math.round((s + 0.5) * n / SAMPLES)); out.push(vertical ? px(k, j) : px(j, k)); }
      return out;
    };
    const median = cs => [0, 1, 2].map(ch => cs.map(c => c[ch]).sort((a, b) => a - b)[cs.length >> 1]);
    const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 18;
    const isUI = (cs, ref) => {
      const ls = cs.map(luma), mean = ls.reduce((a, b) => a + b, 0) / ls.length;
      const sd = Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / ls.length);
      if (sd < 4) return true; // near-uniform line: border, panel, letterbox
      // chat text is light and colourless on the panel grey, so glyph pixels count as UI too
      const glyph = c => luma(c) > 170 && Math.max(...c) - Math.min(...c) < 24;
      return cs.filter(c => luma(c) < 28 || near(c, ref) || glyph(c)).length >= 0.92 * cs.length;
    };
    // ponytail: a fixed 45% cap per edge; anything under a quarter of the window is treated as "no stream found"
    const peel = (vertical, from, step, limit) => {
      const ref = median(line(vertical, from));
      let k = from, n = 0;
      while (n < limit && isUI(line(vertical, k), ref)) { k += step; n++; }
      return n;
    };
    const left = peel(true, 0, 1, Math.floor(w * 0.45)), right = peel(true, w - 1, -1, Math.floor(w * 0.45));
    const top = peel(false, 0, 1, Math.floor(h * 0.45)), bottom = peel(false, h - 1, -1, Math.floor(h * 0.45));
    const cw = w - left - right, ch = h - top - bottom;
    if (cw < w * 0.25 || ch < h * 0.25) return null;
    return { left, top, right, bottom, w: cw, h: ch };
  }
  return { rectOf, patchFor, snapMove, resizeFrom, aspectOk, scanCrop };
})();
if (typeof module === "object" && module.exports) module.exports = EdMath;

if (typeof window !== "undefined") (() => {
  const { h } = JS;
  const call = (t, d) => JS.call(t, d);
  const { rectOf, patchFor, snapMove, resizeFrom, aspectOk, scanCrop } = EdMath;

  const TYPES = [
    { id: "discord", label: "Discord screen share", kind: "window_capture", prop: "window", filter: /discord\.exe/i },
    { id: "monitor", label: "Whole monitor", kind: "monitor_capture", prop: "monitor_id" },
    { id: "window", label: "One window", kind: "window_capture", prop: "window" },
    { id: "game", label: "Game on this PC", kind: "game_capture", prop: "window", extra: [{ itemName: "Any fullscreen game", itemValue: "__any" }] },
    { id: "camera", label: "Camera / capture card", kind: "dshow_input", prop: "video_device_id" },
    { id: "web", label: "Web page / overlay URL", kind: "browser_source", text: "Web address (https://…)" },
    { id: "media", label: "Video file", kind: "ffmpeg_source", text: "Full file path, e.g. C:\\Videos\\intro.mp4" },
    { id: "image", label: "Image file", kind: "image_source", text: "Full file path, e.g. C:\\Pictures\\poster.png" },
  ];
  const DISCORD_TIP = "In Discord, open the player's stream, press Pop Out, then press the full-screen button in the pop-out window. Keep that window open (it can sit behind others, but not minimized). JhemsStream then crops away Discord's chat and buttons so only the game shows.";
  const FIT_FAIL = "Discord isn't showing the stream full screen. In Discord, open the stream, press Pop Out, then the full-screen button, then press Fit again.";

  function dialog(title, wide) {
    const dlg = h("dialog", { class: `editor-dlg${wide ? " wide" : ""}` });
    const body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, title),
      h("button", { type: "button", class: "btn icon", "aria-label": "Close", onclick: () => dlg.close(),
        html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' })), body, foot);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    return { dlg, body, foot };
  }

  /* OBS lists choices only for an existing source, so probe with a throwaway one in a temp scene */
  async function listItems(kind, prop) {
    const scene = "_JhemsStream temp", input = `_JhemsStream probe ${Date.now()}`;
    try {
      await JS.obs.call("CreateScene", { sceneName: scene }).catch(() => {});
      await JS.obs.call("CreateInput", { sceneName: scene, inputName: input, inputKind: kind, inputSettings: {} });
      return (await JS.obs.call("GetInputPropertiesListPropertyItems", { inputName: input, propertyName: prop })).propertyItems;
    } finally {
      await JS.obs.call("RemoveInput", { inputName: input }).catch(() => {});
      await JS.obs.call("RemoveScene", { sceneName: scene }).catch(() => {});
    }
  }
  async function uniqueInputName(base) {
    const names = new Set((await JS.obs.call("GetInputList")).inputs.map(i => i.inputName));
    let n = base, i = 2; while (names.has(n)) n = `${base} ${i++}`; return n;
  }
  /* size: "full", "corner", or a window {x, y, w, h} in canvas pixels (a SITE border slot: fit inside it, keep layer order) */
  async function placeItem(scene, id, size) {
    const { w, h: H } = JS.S.canvas;
    if (size && typeof size === "object") {
      return call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: {
        boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: size.w, boundsHeight: size.h, boundsAlignment: 0, alignment: 5, positionX: size.x, positionY: size.y } });
    }
    const t = size === "corner"
      ? { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w * 0.28, boundsHeight: H * 0.28, boundsAlignment: 0, alignment: 5, positionX: w * 0.7, positionY: H * 0.7 }
      : { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w, boundsHeight: H, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 };
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: t });
    // full-screen sources go behind overlays (scoreboard, text)
    if (size !== "corner") await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
  }

  /* ---------- Discord auto-fit ---------- */
  async function scanDiscord(scene, id) {
    const t = (await JS.obs.call("GetSceneItemTransform", { sceneName: scene, sceneItemId: id })).sceneItemTransform;
    if (!t.sourceWidth || !t.sourceHeight) return { ok: false, reason: "The Discord window isn't showing anything. Is it minimized?" };
    const { sourceName } = await JS.obs.call("GetSceneItemSource", { sceneName: scene, sceneItemId: id });
    const { imageData } = await JS.obs.call("GetSourceScreenshot", { sourceName, imageFormat: "png", imageWidth: t.sourceWidth, imageHeight: t.sourceHeight });
    const img = new Image(); img.src = imageData; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const crop = scanCrop(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    if (!crop || !aspectOk(crop.w, crop.h)) return { ok: false, reason: FIT_FAIL, crop, t, sourceName };
    // the screenshot can come back scaled; map the crop back to source pixels
    const sx = t.sourceWidth / cv.width, sy = t.sourceHeight / cv.height;
    return { ok: true, t, sourceName, crop: { cropLeft: Math.round(crop.left * sx), cropRight: Math.round(crop.right * sx), cropTop: Math.round(crop.top * sy), cropBottom: Math.round(crop.bottom * sy) } };
  }
  /* inside a border window (rect) only the crop changes; the item stays in its window and layer */
  async function applyFit(scene, id, crop, rect) {
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: crop });
    await placeItem(scene, id, rect || "full");
  }
  /** Crop a Discord window capture down to the stream video and fill the screen (or its border window) with it. */
  async function autoFitDiscord(scene, id, { quiet, rect } = {}) {
    try {
      const r = await scanDiscord(scene, id);
      if (!r.ok) { if (!quiet) JS.toast(r.reason, "warn"); return r; }
      await applyFit(scene, id, r.crop, rect);
      if (!quiet) JS.toast("Fitted to the stream video. Discord's chat and buttons are cropped out.", "ok");
      return r;
    } catch (e) { if (!quiet) JS.toast("Couldn't fit the Discord window: " + e.message, "bad"); return { ok: false, reason: e.message }; }
  }
  /* Keep fitting: rescan every 15 s, apply only after two scans agree within 4 px, so hover controls flashing never stick */
  const fitKey = name => "fitDiscord:" + name;
  const lastScan = new Map();
  setInterval(async () => {
    if (!JS.S.connected) return;
    let entries = [];
    try { entries = Object.keys(localStorage).filter(k => k.startsWith("ld.fitDiscord:")).map(k => [k.slice(3), JS.store.get(k.slice(3), null)]); } catch {}
    for (const [key, v] of entries) {
      if (!v || !v.on) continue;
      try {
        const r = await scanDiscord(v.scene, v.id);
        if (!r.ok) { lastScan.delete(key); continue; }
        const prev = lastScan.get(key); lastScan.set(key, r.crop);
        const agree = prev && Object.keys(r.crop).every(k => Math.abs(prev[k] - r.crop[k]) <= 4);
        const changed = Object.keys(r.crop).some(k => Math.abs((r.t[k] || 0) - r.crop[k]) > 2);
        if (agree && changed) await applyFit(v.scene, v.id, r.crop, v.rect);
      } catch { lastScan.delete(key); }
    }
  }, 15000);

  /* ---------- Add a screen ---------- */
  function openNew(target) {
    const { dlg, body, foot } = dialog("Add a screen");
    const sel = h("select", { id: "edTarget" },
      h("option", { value: "__new" }, "A new screen"), ...JS.S.scenes.map(n => h("option", { value: n }, n)));
    sel.value = target && JS.S.scenes.includes(target) ? target : "__new";
    const nameIn = h("input", { id: "edName", placeholder: "e.g. Main Game, Caster Cam", autocomplete: "off" });
    const nameWrap = h("div", { class: "field" }, h("label", { for: "edName" }, "New screen name"), nameIn);
    const syncTarget = () => nameWrap.hidden = sel.value !== "__new";
    sel.addEventListener("change", syncTarget); syncTarget();

    const itemSel = h("select", { id: "edItem" }), itemLbl = h("label", { for: "edItem" }, "Choose");
    const refresh = h("button", { type: "button", class: "btn small", onclick: () => type && choose(type) }, "Refresh");
    const itemWrap = h("div", { class: "field", hidden: true }, itemLbl, h("div", { class: "row" }, itemSel, refresh));
    const textIn = h("input", { id: "edText", autocomplete: "off" }), textLbl = h("label", { for: "edText" }, "");
    const textWrap = h("div", { class: "field", hidden: true }, textLbl, textIn);
    const tip = h("p", { class: "tip", hidden: true }, DISCORD_TIP);
    const sound = h("input", { type: "checkbox", id: "edSound" }); sound.checked = true;
    const soundWrap = h("label", { class: "row", hidden: true, for: "edSound" }, sound, "Also bring in the stream's sound");
    const size = h("select", { id: "edSize" },
      h("option", { value: "full" }, "Fill the whole screen (behind overlays)"),
      h("option", { value: "corner" }, "Small, bottom-right corner (facecam)"));
    const err = h("p", { class: "err", role: "alert" });
    let type = null;

    const typeBtns = TYPES.map(t => h("button", { type: "button", class: "btn", "aria-pressed": "false", onclick: () => choose(t) }, t.label));
    async function choose(t) {
      type = t; err.textContent = "";
      typeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(TYPES[i] === t)));
      textWrap.hidden = !t.text; itemWrap.hidden = !t.prop;
      tip.hidden = soundWrap.hidden = t.id !== "discord";
      if (t.text) { textLbl.textContent = t.text; textIn.value = ""; }
      if (!t.prop) return;
      itemLbl.textContent = t.id === "discord" ? "Which Discord window?" : `Which ${t.label.toLowerCase()}?`;
      itemSel.textContent = ""; itemSel.append(h("option", { value: "" }, "Loading…"));
      try {
        let items = [...(t.extra || []), ...(await listItems(t.kind, t.prop))]
          .filter(i => i.itemEnabled !== false && i.itemValue && i.itemValue !== "DUMMY");
        if (t.filter) items = items.filter(i => t.filter.test(i.itemName));
        if (type !== t) return;
        itemSel.textContent = "";
        items.forEach(i => itemSel.append(h("option", { value: i.itemValue }, i.itemName || i.itemValue)));
        if (!items.length) itemSel.append(h("option", { value: "" },
          t.id === "discord" ? "Open Discord and pop out the stream first" : "Nothing found. Is it plugged in or open?"));
      } catch (e) { itemSel.textContent = ""; itemSel.append(h("option", { value: "" }, "Couldn't list: " + e.message)); }
    }

    const tpl = window.Borders?.TEMPLATES?.length ? h("div", { class: "tpl-row" },
      h("p", { class: "muted" }, "Start from a template"),
      h("div", { class: "tpl-grid" }, ...Borders.TEMPLATES.map(t => h("button", { type: "button", class: "tpl", onclick: () => { dlg.close(); Borders.create(t.id); } },
        h("img", { src: t.thumb, alt: "", width: 320, height: 180, loading: "lazy" }), h("b", {}, t.label), h("span", { class: "muted small" }, t.desc)))),
      h("p", { class: "muted" }, "Or build one yourself")) : null;
    body.append(tpl, h("div", { class: "field" }, h("label", { for: "edTarget" }, "Put it in"), sel), nameWrap,
      h("p", { class: "muted" }, "What do you want to show?"), h("div", { class: "types" }, typeBtns),
      tip, itemWrap, textWrap, soundWrap, h("div", { class: "field" }, h("label", { for: "edSize" }, "Size"), size), err);
    const ok = h("button", { type: "button", class: "btn primary", onclick: add }, "Add");
    foot.append(h("span", { class: "grow" }), h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancel"), ok);
    dlg.showModal();
    if (target === "__discord") choose(TYPES[0]);

    async function add() {
      const fail = m => { err.textContent = m; };
      if (!type) return fail("Pick what you want to show.");
      let scene = sel.value;
      if (scene === "__new") {
        scene = nameIn.value.trim();
        if (!scene) return fail("Give the new screen a name.");
        if (JS.S.scenes.includes(scene)) return fail("A screen with that name already exists. Pick it in 'Put it in' instead.");
      }
      let settings = {}, label = type.label;
      if (type.prop) {
        const v = itemSel.value; if (!v) return fail(type.id === "discord" ? "Open Discord and pop out the stream first, then press Refresh." : "Choose an item from the list.");
        label = itemSel.selectedOptions[0].textContent.replace(/^\[[^\]]+\]:\s*/, "").replace(/^[:\s]+/, "").slice(0, 40) || label;
        if (type.id === "game") settings = v === "__any" ? { capture_mode: "any_fullscreen" } : { capture_mode: "window", window: v };
        // priority 2: Discord renames the window per stream, so fall back to "same executable"
        else if (type.id === "discord") { settings = { window: v, method: 2, client_area: true, cursor: false, priority: 2 }; label = "Discord stream"; }
        else settings = { [type.prop]: v };
      } else {
        const v = textIn.value.trim().replace(/^"|"$/g, ""); if (!v) return fail("Fill in the " + (type.id === "web" ? "address." : "file path."));
        if (type.id === "web") settings = { url: v, width: JS.S.canvas.w, height: JS.S.canvas.h };
        if (type.id === "media") settings = { local_file: v, is_local_file: true, looping: true, restart_on_activate: true };
        if (type.id === "image") settings = { file: v };
        label = v.split(/[\\/]/).pop().slice(0, 40);
      }
      try {
        ok.disabled = true;
        if (!JS.S.scenes.includes(scene)) await call("CreateScene", { sceneName: scene });
        const inputName = await uniqueInputName(`${scene} - ${label}`);
        const { sceneItemId } = await call("CreateInput", { sceneName: scene, inputName, inputKind: type.kind, inputSettings: settings });
        await placeItem(scene, sceneItemId, size.value);
        if (type.id === "discord" && sound.checked) {
          await call("CreateInput", { sceneName: scene, inputName: await uniqueInputName(`${scene} - Discord sound`),
            inputKind: "wasapi_process_output_capture", inputSettings: { window: settings.window, priority: 2 } });
        }
        JS.log(`Added "${inputName}" to ${scene}`); JS.toast(`Added to ${scene}`, "ok");
        dlg.close();
        await JS.refreshScenes(); JS.refreshInputs();
        if (JS.S.studio) JS.pickScene(scene);
        if (type.id === "discord") {
          // keep only the stream video from now on; the first frame needs a moment to arrive
          JS.store.set(fitKey(inputName), { on: true, scene, id: sceneItemId });
          setTimeout(() => autoFitDiscord(scene, sceneItemId), 1500);
        }
      } catch (e) { fail("OBS said: " + e.message); }
      finally { ok.disabled = false; }
    }
  }

  /* ---------- Edit a screen: layout canvas + layers ---------- */
  const KIND_LABEL = { monitor_capture: "Monitor", window_capture: "Window", game_capture: "Game", dshow_input: "Camera",
    browser_source: "Web page", ffmpeg_source: "Video", image_source: "Image", color_source_v3: "Colour", text_gdiplus_v3: "Text",
    wasapi_process_output_capture: "App sound", wasapi_input_capture: "Mic", wasapi_output_capture: "Desktop sound" };
  const AUDIO_ONLY = /^wasapi_/;

  function openEdit(scene) {
    const { dlg, body, foot } = dialog(`Edit "${scene}"`, true);
    const W = JS.S.canvas.w, H = JS.S.canvas.h;
    const img = h("img", { class: "ed-shot", alt: "", width: W, height: H });
    const overlay = h("div", { class: "ed-overlay", tabindex: "0", role: "application",
      "aria-label": `Layout of ${scene}. Click a source to select it, drag to move, drag a corner to resize, hold Shift to resize freely, arrow keys nudge by 1 pixel, Shift and arrow by 10.` });
    const gx = h("i", { class: "ed-guide x", hidden: true }), gy = h("i", { class: "ed-guide y", hidden: true });
    overlay.append(gx, gy);
    const stage = h("div", { class: "ed-stage", style: `aspect-ratio:${W} / ${H}` }, img, overlay);
    const live = h("p", { class: "ed-live", "aria-live": "polite" });
    const num = {}; const numRow = h("div", { class: "ed-num" });
    for (const [k, lbl] of [["x", "X"], ["y", "Y"], ["w", "Width"], ["h", "Height"]]) {
      num[k] = h("input", { type: "number", id: `ed-n-${k}`, step: 1 });
      num[k].addEventListener("change", () => applyNum());
      numRow.append(h("label", { class: "field compact", for: `ed-n-${k}` }, h("span", {}, lbl), num[k]));
    }
    const selName = h("b", {}, "Nothing selected");
    const panelBtns = h("div", { class: "row" },
      h("button", { type: "button", class: "btn small", onclick: () => withSel(id => placeItem(scene, id, "full")) }, "Fit to screen"),
      h("button", { type: "button", class: "btn small", onclick: () => withSel(id => { const r = rectOf(tf.get(id)); return send(id, { ...r, x: (W - r.w) / 2, y: (H - r.h) / 2 }, true); }) }, "Center"),
      h("button", { type: "button", class: "btn small", onclick: () => withSel(id => placeItem(scene, id, "corner")) }, "Corner (facecam)"),
      h("button", { type: "button", class: "btn small", onclick: () => withSel(id => call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 } })) }, "Reset crop"));
    const panel = h("div", { class: "ed-panel" }, h("div", { class: "row" }, h("span", { class: "muted small" }, "Selected:"), selName), numRow, panelBtns);
    const list = h("div", { class: "ed-list" });
    body.append(stage, live, panel, list);
    foot.append(h("button", { type: "button", class: "btn", onclick: () => { dlg.close(); openNew(scene); } }, JS.icon("plus"), "Add source"),
      h("span", { class: "grow" }), h("button", { type: "button", class: "btn primary", onclick: () => dlg.close() }, "Done"));

    let items = [], sel = null, drag = null;
    const tf = new Map(), boxes = new Map(), settings = new Map();

    let busy = false;
    const timer = setInterval(async () => {
      if (busy || !dlg.open) return; busy = true;
      try {
        const { imageData } = await JS.obs.call("GetSourceScreenshot", { sourceName: scene, imageFormat: "jpg", imageWidth: 960, imageCompressionQuality: 65 });
        const next = new Image(); next.src = imageData; await next.decode(); img.src = imageData;
      } catch {} finally { busy = false; }
    }, 500);
    dlg.addEventListener("close", () => clearInterval(timer));

    const pct = (v, of) => (v / of * 100) + "%";
    function drawBoxes() {
      for (const b of boxes.values()) b.remove(); boxes.clear();
      for (const it of items) {
        const t = tf.get(it.sceneItemId);
        if (!t || !it.sceneItemEnabled || AUDIO_ONLY.test(it.inputKind || "")) continue;
        const r = rectOf(t); if (!(r.w > 0 && r.h > 0)) continue;
        const box = h("div", { class: `ed-box${it.sceneItemId === sel ? " sel" : ""}`, "data-id": it.sceneItemId },
          h("span", { class: "ed-tag" }, it.sourceName),
          ...(it.sceneItemId === sel ? ["nw", "ne", "sw", "se"].map(c => h("i", { class: `ed-h ${c}`, "data-corner": c })) : []));
        Object.assign(box.style, { left: pct(r.x, W), top: pct(r.y, H), width: pct(r.w, W), height: pct(r.h, H) });
        overlay.append(box); boxes.set(it.sceneItemId, box);
      }
      syncPanel();
    }
    function syncPanel() {
      const it = items.find(i => i.sceneItemId === sel), t = sel != null && tf.get(sel);
      selName.textContent = it ? it.sourceName : "Nothing selected";
      const r = t ? rectOf(t) : null;
      for (const k of ["x", "y", "w", "h"]) { num[k].disabled = !r; if (document.activeElement !== num[k]) num[k].value = r ? Math.round(r[k]) : ""; }
      panelBtns.querySelectorAll("button").forEach(b => b.disabled = !r);
      list.querySelectorAll(".ed-item").forEach(el => el.classList.toggle("sel", +el.dataset.id === sel));
    }
    function select(id) {
      sel = id; drawBoxes();
      const it = items.find(i => i.sceneItemId === id), t = tf.get(id);
      if (it && t) { const r = rectOf(t); live.textContent = `${it.sourceName} selected, ${Math.round(r.w)} by ${Math.round(r.h)} at ${Math.round(r.x)}, ${Math.round(r.y)}.`; }
    }
    async function withSel(fn) { if (sel == null) return; try { await fn(sel); } catch {} await render(); }

    /* local preview first, OBS at ~20 updates a second, exact value on release */
    let sendTimer = null, sendLast = 0, queued = null;
    function send(id, r, now) {
      const t = tf.get(id), patch = patchFor(t, r);
      Object.assign(t, patch); // keep the local copy in step so the box follows the pointer
      const b = boxes.get(id); if (b) Object.assign(b.style, { left: pct(r.x, W), top: pct(r.y, H), width: pct(r.w, W), height: pct(r.h, H) });
      syncPanel();
      queued = { id, patch };
      const go = () => { sendTimer = null; sendLast = Date.now(); const q = queued; queued = null;
        if (q) return JS.obs.call("SetSceneItemTransform", { sceneName: scene, sceneItemId: q.id, sceneItemTransform: q.patch }).catch(() => {}); };
      if (now) { clearTimeout(sendTimer); return go(); }
      if (!sendTimer) sendTimer = setTimeout(go, Math.max(0, 50 - (Date.now() - sendLast)));
    }
    function applyNum() {
      if (sel == null) return;
      const r = rectOf(tf.get(sel)), n = k => Number.isFinite(+num[k].value) ? +num[k].value : r[k];
      send(sel, { x: n("x"), y: n("y"), w: Math.max(1, n("w")), h: Math.max(1, n("h")) }, true);
    }

    const toCanvas = e => { const b = overlay.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
    const thr = () => 12 * W / (overlay.getBoundingClientRect().width || W);
    function guides(gs) {
      gx.hidden = gy.hidden = true;
      for (const g of gs) { const el = g.axis === "x" ? gx : gy; el.hidden = false; el.style[g.axis === "x" ? "left" : "top"] = pct(g.at, g.axis === "x" ? W : H); }
    }
    overlay.addEventListener("pointerdown", e => {
      const boxEl = e.target.closest(".ed-box"); if (!boxEl) return;
      const id = +boxEl.dataset.id; if (id !== sel) select(id);
      const [px, py] = toCanvas(e);
      drag = { id, corner: e.target.dataset.corner || null, start: rectOf(tf.get(id)), px, py };
      overlay.setPointerCapture(e.pointerId); overlay.focus({ preventScroll: true }); e.preventDefault();
    });
    overlay.addEventListener("pointermove", e => {
      if (!drag) return;
      const [px, py] = toCanvas(e), s = drag.start;
      if (drag.corner) { send(drag.id, resizeFrom(s, drag.corner, px, py, e.shiftKey, W, H, thr())); guides([]); }
      else { const m = snapMove({ ...s, x: s.x + px - drag.px, y: s.y + py - drag.py }, W, H, thr()); send(drag.id, m.r); guides(m.guides); }
    });
    const endDrag = () => {
      if (!drag) return; const id = drag.id; drag = null; guides([]);
      send(id, rectOf(tf.get(id)), true); select(id);
    };
    overlay.addEventListener("pointerup", endDrag);
    overlay.addEventListener("pointercancel", endDrag);
    overlay.addEventListener("keydown", e => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d || sel == null) return;
      e.preventDefault(); const step = e.shiftKey ? 10 : 1, r = rectOf(tf.get(sel));
      send(sel, { ...r, x: r.x + d[0] * step, y: r.y + d[1] * step });
    });

    async function render() {
      items = (await call("GetSceneItemList", { sceneName: scene })).sceneItems.sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
      await Promise.all(items.map(async it => {
        tf.set(it.sceneItemId, (await JS.obs.call("GetSceneItemTransform", { sceneName: scene, sceneItemId: it.sceneItemId })).sceneItemTransform);
        if (it.inputKind === "window_capture" && !settings.has(it.sourceName))
          settings.set(it.sourceName, (await JS.obs.call("GetInputSettings", { inputName: it.sourceName }).catch(() => ({ inputSettings: {} }))).inputSettings);
      }));
      const focusKey = document.activeElement?.dataset?.key;
      list.textContent = "";
      if (!items.length) list.append(h("p", { class: "muted" }, "Nothing on this screen yet. Press + Add source."));
      items.forEach((it, pos) => list.append(row(it, pos, items.length)));
      if (focusKey) list.querySelector(`[data-key="${focusKey}"]`)?.focus();
      if (sel != null && !items.some(i => i.sceneItemId === sel)) sel = null;
      drawBoxes();
    }

    function row(it, pos, count) {
      const id = it.sceneItemId, key = k => `${id}-${k}`;
      const kind = KIND_LABEL[it.inputKind] || (it.isGroup ? "Group" : it.inputKind ? it.inputKind : "Screen");
      const act = async (fn) => { try { await fn(); await render(); } catch {} };
      const vis = h("input", { type: "checkbox", id: `ed-vis-${id}`, "data-key": key("vis") }); vis.checked = it.sceneItemEnabled;
      vis.addEventListener("change", () => act(() => call("SetSceneItemEnabled", { sceneName: scene, sceneItemId: id, sceneItemEnabled: vis.checked })));
      const crop = h("div", { class: "ed-crop", hidden: true });
      const cropBtn = h("button", { type: "button", class: "btn small", "aria-expanded": "false", "data-key": key("crop"),
        onclick: () => { crop.hidden = !crop.hidden; cropBtn.setAttribute("aria-expanded", String(!crop.hidden)); if (!crop.hidden && !crop.childElementCount) buildCrop(id, crop); } }, "Crop");
      const move = (to) => act(() => call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: to }));
      const isDiscord = it.inputKind === "window_capture" && /discord/i.test(settings.get(it.sourceName)?.window || "");
      let discordCtl = null;
      if (isDiscord) {
        const keep = h("input", { type: "checkbox", id: `ed-keep-${id}`, "data-key": key("keep") });
        keep.checked = !!JS.store.get(fitKey(it.sourceName), null)?.on;
        keep.addEventListener("change", () => JS.store.set(fitKey(it.sourceName), { on: keep.checked, scene, id }));
        discordCtl = h("div", { class: "row" },
          h("button", { type: "button", class: "btn small primary", "data-key": key("fit"), onclick: () => act(() => autoFitDiscord(scene, id)) }, "Fit to the stream video"),
          h("label", { class: "row small", for: `ed-keep-${id}` }, keep, "Keep fitting (checks every 15 seconds)"));
      }
      return h("div", { class: "ed-item", "data-id": id },
        h("div", { class: "row" },
          h("label", { class: "row grow", for: `ed-vis-${id}` }, vis, h("b", {}, it.sourceName), h("span", { class: "muted" }, kind)),
          AUDIO_ONLY.test(it.inputKind || "") ? null : h("button", { type: "button", class: "btn small", "data-key": key("sel"), "aria-label": `Select ${it.sourceName} on the layout`, onclick: () => { select(id); overlay.focus({ preventScroll: true }); } }, "Select"),
          h("button", { type: "button", class: "btn small", disabled: pos === 0, "data-key": key("up"), "aria-label": `Move ${it.sourceName} up`, onclick: () => move(it.sceneItemIndex + 1) }, "Up"),
          h("button", { type: "button", class: "btn small", disabled: pos === count - 1, "data-key": key("down"), "aria-label": `Move ${it.sourceName} down`, onclick: () => move(it.sceneItemIndex - 1) }, "Down")),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn small", onclick: () => act(() => placeItem(scene, id, "full")) }, "Fill screen"),
          h("button", { type: "button", class: "btn small", onclick: () => act(() => placeItem(scene, id, "corner")) }, "Corner"),
          cropBtn,
          h("button", { type: "button", class: "btn small", onclick: () => {
            if (confirm(`Remove "${it.sourceName}" from ${scene}?`)) act(() => call("RemoveSceneItem", { sceneName: scene, sceneItemId: id }));
          } }, "Remove")),
        discordCtl, crop);
    }

    async function buildCrop(id, box) {
      const t = (await call("GetSceneItemTransform", { sceneName: scene, sceneItemId: id })).sceneItemTransform;
      const dims = { cropTop: t.sourceHeight, cropBottom: t.sourceHeight, cropLeft: t.sourceWidth, cropRight: t.sourceWidth };
      const vals = { cropTop: t.cropTop, cropBottom: t.cropBottom, cropLeft: t.cropLeft, cropRight: t.cropRight };
      const inputs = {};
      let pending = null, last = 0;
      const sendCrop = () => {
        const wait = 66 - (Date.now() - last); // ~15 updates per second
        if (pending) return;
        pending = setTimeout(async () => {
          pending = null; last = Date.now();
          await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: { ...vals } }).catch(() => {});
          Object.assign(tf.get(id) || {}, vals); drawBoxes();
        }, Math.max(0, wait));
      };
      for (const [k, name] of [["cropTop", "Top"], ["cropBottom", "Bottom"], ["cropLeft", "Left"], ["cropRight", "Right"]]) {
        const out = h("output", {}, `${vals[k]} px`);
        const r = h("input", { type: "range", id: `ed-${k}-${id}`, min: 0, max: Math.max(0, Math.floor(dims[k] * 0.9)), step: 1, value: vals[k] });
        r.addEventListener("input", () => { vals[k] = +r.value; out.textContent = `${r.value} px`; sendCrop(); });
        inputs[k] = [r, out];
        box.append(h("div", { class: "field" }, h("label", { for: `ed-${k}-${id}` }, name), h("div", { class: "row" }, r, out)));
      }
      if (!t.sourceWidth) box.prepend(h("p", { class: "muted" }, "This source has no size yet (is the window open?)."));
      box.append(h("button", { type: "button", class: "btn small", onclick: () => {
        for (const k in vals) { vals[k] = 0; inputs[k][0].value = 0; inputs[k][1].textContent = "0 px"; }
        sendCrop();
      } }, "Reset crop"));
    }

    dlg.showModal();
    render();
  }

  window.Editor = { openNew, openEdit, listItems, placeItem, autoFitDiscord, uniqueInputName, TYPES, fitKey };
})();
