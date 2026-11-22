"use strict";
/* Instant replay through OBS's replay buffer: save the last seconds, show them on an "Instant Replay" scene,
   then go back to the scene that was live. Works from any connected JhemsStream; the clip lives on the OBS PC. */
(() => {
  const { h, $, store, S, call, toast, obs } = window.JS;
  const T = window.__TAURI__;
  const SCENE = "Instant Replay", INPUT = "JS Replay", BAR = "JS Replay Bar", LABEL = "JS Replay Label";
  const R = {
    on: false, available: false, busy: false, playing: false, from: null, fallback: null,
    len: store.get("rbLen", 20), slow: store.get("rbSlow", false), last: store.get("rbLast", 0),
    auto: store.get("rbAuto", true), duck: store.get("rbDuck", true), stinger: store.get("rbStinger", ""),
    list: store.get("rbList", []),
  };
  const box = $("#replayBox"); if (!box) return;
  const P = async n => (await call("GetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: n })).parameterValue;
  const SP = (n, v) => call("SetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: n, parameterValue: String(v) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // music.js declares a top-level const, which isn't a window property
  const M = () => (typeof Music !== "undefined" ? Music : null);
  const outputsBusy = () => S.streaming || S.recording;

  /* OBS only builds the replay buffer output when it (re)loads the profile, so after changing RecRB/RecRBTime we
     switch to a throwaway profile and back. ponytail: this can't run while streaming or recording; turn the buffer on first. */
  async function reloadOutputs() {
    const cur = (await call("GetProfileList")).currentProfileName, tmp = "_JhemsStream reload";
    await call("CreateProfile", { profileName: tmp });
    await wait(600);
    await call("SetCurrentProfile", { profileName: cur });
    await wait(900);
    await obs.call("RemoveProfile", { profileName: tmp }).catch(() => {});
  }
  async function status() {
    try { R.on = (await obs.call("GetReplayBufferStatus")).outputActive; R.available = true; }
    catch { R.on = false; R.available = false; }
    render();
  }
  async function setBuffer(on) {
    if (R.busy) return; R.busy = true; render();
    try {
      if (!on) { if (R.on) await call("StopReplayBuffer"); return; }
      const needs = (await P("RecRB")) !== "true" || +(await P("RecRBTime")) !== R.len || !R.available;
      if (needs) {
        if (outputsBusy()) { toast("Turn the replay buffer on before going live or recording. OBS can't change it while it's sending video.", "warn"); return; }
        await SP("RecRB", "true"); await SP("RecRBTime", R.len);
        await reloadOutputs();
      }
      await call("StartReplayBuffer");
      toast(`Replay buffer on: keeping the last ${R.len} seconds.`);
    } catch (e) { toast("Couldn't start the replay buffer: " + e.message, "bad"); }
    finally { R.busy = false; await status(); }
  }

  async function save() {
    const got = new Promise(res => {
      const f = d => { obs.off("ReplayBufferSaved", f); res(d.savedReplayPath); };
      obs.on("ReplayBufferSaved", f); setTimeout(() => { obs.off("ReplayBufferSaved", f); res(null); }, 6000);
    });
    await call("SaveReplayBuffer");
    return (await got) || (await call("GetLastReplayBufferReplay")).savedReplayPath;
  }

  /* the Instant Replay scene: the clip filling the canvas, a small dark bar and label in the corner */
  async function ensureScene(path) {
    const { w, h: H } = S.canvas;
    const scenes = (await call("GetSceneList")).scenes.map(s => s.sceneName);
    if (!scenes.includes(SCENE)) await call("CreateScene", { sceneName: SCENE });
    const inputs = new Set((await call("GetInputList")).inputs.map(i => i.inputName));
    const media = { is_local_file: true, local_file: path, looping: false, restart_on_activate: true, close_when_inactive: true, hw_decode: true, speed_percent: R.slow ? 50 : 100 };
    if (inputs.has(INPUT)) await call("SetInputSettings", { inputName: INPUT, inputSettings: media });
    else {
      const { sceneItemId } = await call("CreateInput", { sceneName: SCENE, inputName: INPUT, inputKind: "ffmpeg_source", inputSettings: media });
      await call("SetSceneItemTransform", { sceneName: SCENE, sceneItemId, sceneItemTransform: { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w, boundsHeight: H, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 } });
    }
    if (!inputs.has(BAR)) {
      // OBS content, not app UI: 50% black bar, white label (ABGR colours)
      const { sceneItemId } = await call("CreateInput", { sceneName: SCENE, inputName: BAR, inputKind: "color_source_v3", inputSettings: { color: 0x80000000, width: 330, height: 64 } });
      await call("SetSceneItemTransform", { sceneName: SCENE, sceneItemId, sceneItemTransform: { alignment: 5, positionX: 40, positionY: 40 } });
    }
    if (!inputs.has(LABEL)) {
      const { sceneItemId } = await call("CreateInput", { sceneName: SCENE, inputName: LABEL, inputKind: "text_gdiplus_v3", inputSettings: { text: "Instant replay", font: { face: "Segoe UI", size: 40, style: "Bold", flags: 1 }, color: 0xFFFFFFFF } });
      await call("SetSceneItemTransform", { sceneName: SCENE, sceneItemId, sceneItemTransform: { alignment: 5, positionX: 64, positionY: 46 } });
    }
    // the clip stays under the bar and label
    const items = (await call("GetSceneItemList", { sceneName: SCENE })).sceneItems;
    const clip = items.find(i => i.sourceName === INPUT);
    if (clip && clip.sceneItemIndex !== 0) await call("SetSceneItemIndex", { sceneName: SCENE, sceneItemId: clip.sceneItemId, sceneItemIndex: 0 });
  }

  async function go(scene) {
    // a chosen stinger (or the selected custom transition) runs through transitions.js; otherwise plain OBS switching
    if (window.Transitions?.toScene && (R.stinger || window.Transitions.isCustom?.())) return Transitions.toScene(scene, R.stinger ? { stingerId: R.stinger } : undefined);
    if (S.studio) { await call("SetCurrentPreviewScene", { sceneName: scene }); await call("TriggerStudioModeTransition"); }
    else await call("SetCurrentProgramScene", { sceneName: scene });
  }

  async function showClip(path) {
    await ensureScene(path);
    if (S.program !== SCENE) R.from = S.program;
    R.playing = true; render();
    if (R.duck) M()?.setDuck(true, 0.3);
    await go(SCENE);
    // fallback only if OBS never reports the end: remaining media time at the chosen speed, plus a generous margin
    clearTimeout(R.fallback);
    setTimeout(async () => {
      try {
        const st = await call("GetMediaInputStatus", { inputName: INPUT });
        const left = Math.max(0, (st.mediaDuration || 0) - (st.mediaCursor || 0));
        if (left && R.playing) R.fallback = setTimeout(() => R.playing && finish(), left * (R.slow ? 2 : 1) + 6000);
      } catch {}
    }, 3000);
  }
  async function instantReplay() {
    if (R.busy || !S.connected) return;
    if (!R.on) return toast("Turn on the replay buffer first. It needs a few seconds of video before a replay.", "warn");
    R.busy = true; render();
    try {
      const path = await save();
      if (!path) throw new Error("OBS didn't report a saved clip");
      R.list = [path, ...R.list.filter(p => p !== path)].slice(0, 5); store.set("rbList", R.list);
      await showClip(path);
    } catch (e) { toast("Instant replay failed: " + e.message, "bad"); R.playing = false; }
    finally { R.busy = false; render(); }
  }
  async function finish() {
    clearTimeout(R.fallback);
    if (!R.playing) return;
    R.playing = false; render();
    if (R.duck) M()?.setDuck(false);
    if (R.from && S.program === SCENE) await go(R.from).catch(e => toast("Couldn't go back: " + e.message, "bad"));
  }

  // "Last N s": OBS reports the duration a moment after playback starts, so poll briefly before seeking
  obs.on("MediaInputPlaybackStarted", async ({ inputName }) => {
    if (inputName !== INPUT || !R.playing || !R.last) return;
    for (let i = 0; i < 20; i++) {
      try {
        const st = await obs.call("GetMediaInputStatus", { inputName: INPUT });
        if (st.mediaDuration) {
          if (st.mediaDuration > R.last * 1000) await obs.call("SetMediaInputCursor", { inputName: INPUT, mediaCursor: st.mediaDuration - R.last * 1000 });
          return;
        }
      } catch {}
      await wait(100);
    }
  });
  // the mic ducker releases the music when casters stop talking; keep it down while a replay runs
  setInterval(() => { const m = M(); if (R.playing && R.duck && m && m.st.duck > 0.3) m.setDuck(true, 0.3); }, 400);
  obs.on("MediaInputPlaybackEnded", ({ inputName }) => { if (inputName === INPUT && R.playing && R.auto) finish(); });
  obs.on("ReplayBufferStateChanged", ({ outputActive }) => { R.on = outputActive; R.available = true; render(); });
  window.JS.onReady(status);

  document.addEventListener("keydown", e => {
    if (e.key.toLowerCase() !== "r" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || !S.connected) return;
    if (e.target.closest("input, select, textarea, dialog, [contenteditable]")) return;
    e.preventDefault(); instantReplay();
  });

  /* UI */
  const opt = (key, label) => {
    const cb = h("input", { type: "checkbox" }); cb.checked = R[key];
    cb.addEventListener("change", () => { R[key] = cb.checked; store.set("rb" + key[0].toUpperCase() + key.slice(1), cb.checked); });
    return h("label", { class: "inline" }, cb, label);
  };
  function stingers() {
    try { return window.Transitions?.list?.() || []; } catch { return []; }
  }
  function render() {
    box.textContent = "";
    const sw = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": "Replay buffer", disabled: R.busy });
    sw.checked = R.on; sw.addEventListener("change", () => setBuffer(sw.checked));
    const len = h("select", { "aria-label": "Replay length", disabled: R.on || R.busy });
    for (const s of [15, 20, 30, 60]) len.append(h("option", { value: s }, `${s} s`));
    len.value = String(R.len); len.addEventListener("change", () => { R.len = +len.value; store.set("rbLen", R.len); });
    const last = h("select", { "aria-label": "How much to show" });
    for (const [v, t] of [[0, "Whole clip"], [5, "Last 5 s"], [10, "Last 10 s"]]) last.append(h("option", { value: v }, t));
    last.value = String(R.last); last.addEventListener("change", () => { R.last = +last.value; store.set("rbLast", R.last); });
    const list = stingers();
    const sting = list.length ? h("select", { "aria-label": "Transition into the replay" }, h("option", { value: "" }, "Current transition"), ...list.map(s => h("option", { value: s.id }, s.name))) : null;
    if (sting) { sting.value = R.stinger; sting.addEventListener("change", () => { R.stinger = sting.value; store.set("rbStinger", R.stinger); }); }

    box.append(
      h("div", { class: "rb-head" }, h("span", { class: "muted small grow" }, "Instant replay"),
        h("label", { class: "inline director", title: "Keeps the last seconds of the program ready to replay" }, sw, "Buffer"), h("span", { class: "director" }, len)),
      R.playing
        ? h("button", { class: "btn rb-go on", type: "button", onclick: finish }, "Back to live")
        : h("button", { class: "btn rb-go", type: "button", disabled: !R.on || R.busy, title: "R", onclick: instantReplay }, R.busy ? "Saving…" : "Instant replay"),
      h("details", { class: "rb-opts" }, h("summary", { class: "small" }, "Replay options"),
        h("div", { class: "rb-col" },
          last, opt("slow", "Slow motion (half speed)"), opt("auto", "Go back when it ends"), opt("duck", "Lower music during replay"),
          sting,
          h("p", { class: "muted small" }, "The buffer uses extra CPU or GPU and memory while it's on. Clips save to OBS's recording folder. Press R for a replay."),
          R.list.length ? h("div", { class: "rb-list" }, h("span", { class: "muted small" }, "Recent clips"),
            ...R.list.map(p => h("div", { class: "rb-item" },
              h("span", { class: "small grow", title: p }, p.split(/[\\/]/).pop()),
              h("button", { class: "btn small", type: "button", onclick: () => showClip(p).catch(e => toast(e.message, "bad")) }, "Replay"),
              T?.opener?.revealItemInDir ? h("button", { class: "btn small", type: "button", onclick: () => T.opener.revealItemInDir(p).catch(() => {}) }, "Show") : null))) : null)));
  }
  render();
  window.Replay = { instantReplay, finish, setBuffer, status, state: R };
})();
