"use strict";
/* JhemsStream screen tools: the "Add a screen" wizard (incl. Discord screen share)
   and the per-screen editor (layers, show/hide, order, fit, crop). Needs window.JS from app.js. */
(() => {
  const { h } = JS;
  const call = (t, d) => JS.call(t, d);

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
  const DISCORD_TIP = "In Discord, click the player's stream, then Pop Out, then press full screen in the pop-out window. Keep that window open (it can sit behind others, but not minimized).";

  function dialog(title) {
    const dlg = h("dialog", { class: "editor-dlg" });
    const body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, title),
      h("button", { type: "button", class: "btn icon", "aria-label": "Close", onclick: () => dlg.close() }, "×")), body, foot);
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
  async function placeItem(scene, id, size) {
    const { w, h: H } = JS.S.canvas;
    const t = size === "corner"
      ? { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w * 0.28, boundsHeight: H * 0.28, boundsAlignment: 0, alignment: 5, positionX: w * 0.7, positionY: H * 0.7 }
      : { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w, boundsHeight: H, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 };
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: t });
    // full-screen sources go behind overlays (scoreboard, text)
    if (size !== "corner") await call("SetSceneItemIndex", { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
  }

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

    body.append(h("div", { class: "field" }, h("label", { for: "edTarget" }, "Put it in"), sel), nameWrap,
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
      } catch (e) { fail("OBS said: " + e.message); }
      finally { ok.disabled = false; }
    }
  }

  /* ---------- Edit a screen ---------- */
  const KIND_LABEL = { monitor_capture: "Monitor", window_capture: "Window", game_capture: "Game", dshow_input: "Camera",
    browser_source: "Web page", ffmpeg_source: "Video", image_source: "Image", color_source_v3: "Colour", text_gdiplus_v3: "Text",
    wasapi_process_output_capture: "App sound", wasapi_input_capture: "Mic", wasapi_output_capture: "Desktop sound" };

  function openEdit(scene) {
    const { dlg, body, foot } = dialog(`Edit "${scene}"`);
    const img = h("img", { class: "ed-thumb", alt: `Live view of ${scene}` });
    const list = h("div", { class: "ed-list" });
    body.append(img, list);
    foot.append(h("button", { type: "button", class: "btn", onclick: () => { dlg.close(); openNew(scene); } }, "+ Add source"),
      h("span", { class: "grow" }), h("button", { type: "button", class: "btn primary", onclick: () => dlg.close() }, "Done"));

    let busy = false;
    const timer = setInterval(async () => {
      if (busy || !dlg.open) return; busy = true;
      try {
        const { imageData } = await JS.obs.call("GetSourceScreenshot", { sourceName: scene, imageFormat: "jpg", imageWidth: 640, imageCompressionQuality: 65 });
        const next = new Image(); next.src = imageData; await next.decode(); img.src = imageData;
      } catch {} finally { busy = false; }
    }, 500);
    dlg.addEventListener("close", () => clearInterval(timer));

    async function render() {
      const items = (await call("GetSceneItemList", { sceneName: scene })).sceneItems.sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
      const focusKey = document.activeElement?.dataset?.key;
      list.textContent = "";
      if (!items.length) list.append(h("p", { class: "muted" }, "Nothing on this screen yet. Press + Add source."));
      items.forEach((it, pos) => list.append(row(it, pos, items.length)));
      if (focusKey) list.querySelector(`[data-key="${focusKey}"]`)?.focus();
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
      return h("div", { class: "ed-item" },
        h("div", { class: "row" },
          h("label", { class: "row grow", for: `ed-vis-${id}` }, vis, h("b", {}, it.sourceName), h("span", { class: "muted" }, kind)),
          h("button", { type: "button", class: "btn small", disabled: pos === 0, "data-key": key("up"), "aria-label": `Move ${it.sourceName} up`, onclick: () => move(it.sceneItemIndex + 1) }, "Up"),
          h("button", { type: "button", class: "btn small", disabled: pos === count - 1, "data-key": key("down"), "aria-label": `Move ${it.sourceName} down`, onclick: () => move(it.sceneItemIndex - 1) }, "Down")),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn small", onclick: () => act(() => placeItem(scene, id, "full")) }, "Fill screen"),
          h("button", { type: "button", class: "btn small", onclick: () => act(() => placeItem(scene, id, "corner")) }, "Corner"),
          cropBtn,
          h("button", { type: "button", class: "btn small danger", onclick: () => {
            if (confirm(`Remove "${it.sourceName}" from ${scene}?`)) act(() => call("RemoveSceneItem", { sceneName: scene, sceneItemId: id }));
          } }, "Remove")),
        crop);
    }

    async function buildCrop(id, box) {
      const t = (await call("GetSceneItemTransform", { sceneName: scene, sceneItemId: id })).sceneItemTransform;
      const dims = { cropTop: t.sourceHeight, cropBottom: t.sourceHeight, cropLeft: t.sourceWidth, cropRight: t.sourceWidth };
      const vals = { cropTop: t.cropTop, cropBottom: t.cropBottom, cropLeft: t.cropLeft, cropRight: t.cropRight };
      const inputs = {};
      let pending = null, last = 0;
      const send = () => {
        const wait = 66 - (Date.now() - last); // ~15 updates per second
        if (pending) return;
        pending = setTimeout(async () => {
          pending = null; last = Date.now();
          await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: id, sceneItemTransform: { ...vals } }).catch(() => {});
        }, Math.max(0, wait));
      };
      for (const [k, name] of [["cropTop", "Top"], ["cropBottom", "Bottom"], ["cropLeft", "Left"], ["cropRight", "Right"]]) {
        const out = h("output", {}, `${vals[k]} px`);
        const r = h("input", { type: "range", id: `ed-${k}-${id}`, min: 0, max: Math.max(0, Math.floor(dims[k] * 0.9)), step: 1, value: vals[k] });
        r.addEventListener("input", () => { vals[k] = +r.value; out.textContent = `${r.value} px`; send(); });
        inputs[k] = [r, out];
        box.append(h("div", { class: "field" }, h("label", { for: `ed-${k}-${id}` }, name), h("div", { class: "row" }, r, out)));
      }
      if (!t.sourceWidth) box.prepend(h("p", { class: "muted" }, "This source has no size yet (is the window open?)."));
      box.append(h("button", { type: "button", class: "btn small", onclick: () => {
        for (const k in vals) { vals[k] = 0; inputs[k][0].value = 0; inputs[k][1].textContent = "0 px"; }
        send();
      } }, "Reset crop"));
    }

    dlg.showModal();
    render();
  }

  window.Editor = { openNew, openEdit, listItems, placeItem };
})();
