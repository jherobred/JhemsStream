"use strict";
/* Instant replay through OBS's replay buffer: save the last seconds onto an "Instant Replay" scene, load it into
   Preview so the crew can watch it first, air it on request, then go back to the scene that was live. Works from any connected JhemsStream; the clip lives on the OBS PC. */
(() => {
  const { h, $, store, S, call, toast, obs } = window.JS;
  const JS = window.JS;
  const T = window.__TAURI__;
  const PLAIN = "Instant Replay", INPUT = "JS Replay", BAR = "JS Replay Bar", LABEL = "JS Replay Label";
  const R = {
    on: false, available: false, busy: false, playing: false, ready: false, from: null, fallback: null, stopping: false, died: false,
    direct: store.get("rbDirect", false),
    len: store.get("rbLen", 20), slow: store.get("rbSlow", false), last: store.get("rbLast", 0),
    auto: store.get("rbAuto", true), duck: store.get("rbDuck", true), stinger: store.get("rbStinger", ""),
    list: store.get("rbList", []),
    speed: store.get("rbSpeed", store.get("rbSlow", false) ? 50 : 100),
    mute: store.get("rbMute", false), vol: store.get("rbVol", 100),
    scene: store.get("rbScene", PLAIN),   // the screen the clip airs on: plain, or a SITE replay border
  };
  const SCENE_OF = () => R.scene || PLAIN;
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
    // quiet every JhemsStream's stats polling first, and give polls already in flight (2 s apart) time to finish
    await JS.quiet(9000);
    await wait(2500);
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
      if (!on) { if (R.on) { R.stopping = true; await call("StopReplayBuffer"); } return; }
      R.died = false;
      const needs = (await P("RecRB")) !== "true" || +(await P("RecRBTime")) !== R.len || !R.available;
      if (needs) {
        if (outputsBusy()) { toast("Turn the replay buffer on before going live or recording. OBS can't change it while it's sending video.", "warn"); return; }
        await SP("RecRB", "true"); await SP("RecRBTime", R.len);
        await reloadOutputs();
      }
      // right after a profile reload OBS may not have rebuilt the output yet: retry until it reports active
      let active = false;
      for (let i = 0; i < 8 && !active; i++) {
        await obs.call("StartReplayBuffer").catch(() => {});
        await wait(500);
        active = (await obs.call("GetReplayBufferStatus").catch(() => ({}))).outputActive;
      }
      if (!active) throw new Error("OBS didn't start it. Check OBS → Settings → Output → Replay Buffer");
      toast(`Replay buffer on: keeping the last ${R.len} seconds.`);
    } catch (e) { toast("Couldn't start the replay buffer: " + e.message, "bad"); }
    finally { R.busy = false; await status(); }
  }

  async function save() {
    const got = new Promise(res => {
      const f = d => { obs.off("ReplayBufferSaved", f); res(d.savedReplayPath); };
      obs.on("ReplayBufferSaved", f); setTimeout(() => { obs.off("ReplayBufferSaved", f); res(null); }, 6000);
    });
    try { await obs.call("SaveReplayBuffer"); }
    catch (e) { throw new Error(e.message || (e.code === 501 ? "the replay buffer isn't running" : `OBS error ${e.code}`)); }
    return (await got) || (await call("GetLastReplayBufferReplay")).savedReplayPath;
  }

  /* the Instant Replay scene: the clip filling the canvas, a small dark bar and label in the corner */
  /* Layout is set once, when an item is first made; after that it stays wherever the crew puts it.
     The plain "Instant Replay" scene gets the clip full screen with a small bar and label; a SITE replay border
     already has the clip in its window, so it only needs the input to exist. */
  async function ensureScene(path) {
    const { w, h: H } = S.canvas, scene = SCENE_OF();
    const scenes = (await call("GetSceneList")).scenes.map(s => s.sceneName);
    if (!scenes.includes(scene)) await call("CreateScene", { sceneName: scene });
    const inputs = new Set((await call("GetInputList")).inputs.map(i => i.inputName));
    const media = { is_local_file: true, local_file: path, looping: false, restart_on_activate: true, close_when_inactive: false, hw_decode: true, speed_percent: R.speed };
    const full = { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: w, boundsHeight: H, boundsAlignment: 0, alignment: 5, positionX: 0, positionY: 0 };
    if (inputs.has(INPUT)) await call("SetInputSettings", { inputName: INPUT, inputSettings: media });
    else {
      const { sceneItemId } = await call("CreateInput", { sceneName: scene, inputName: INPUT, inputKind: "ffmpeg_source", inputSettings: media });
      await call("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform: full });
      await call("SetSceneItemIndex", { sceneName: scene, sceneItemId, sceneItemIndex: 0 });
    }
    // the input exists but this scene doesn't show it yet (the crew picked another replay screen)
    if (inputs.has(INPUT) && (await obs.call("GetSceneItemId", { sceneName: scene, sourceName: INPUT }).catch(() => null)) == null) {
      const { sceneItemId } = await call("CreateSceneItem", { sceneName: scene, sourceName: INPUT });
      await call("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform: full });
      await call("SetSceneItemIndex", { sceneName: scene, sceneItemId, sceneItemIndex: 0 });
    }
    await obs.call("SetInputMute", { inputName: INPUT, inputMuted: !!R.mute }).catch(() => {});
    await obs.call("SetInputVolume", { inputName: INPUT, inputVolumeMul: Math.max(0, Math.min(1, R.vol / 100)) }).catch(() => {});
    if (scene !== PLAIN) return;
    if (!inputs.has(BAR)) {
      // OBS content, not app UI: 50% black bar, white label (ABGR colours)
      const { sceneItemId } = await call("CreateInput", { sceneName: SCENE_OF(), inputName: BAR, inputKind: "color_source_v3", inputSettings: { color: 0x80000000, width: 330, height: 64 } });
      await call("SetSceneItemTransform", { sceneName: SCENE_OF(), sceneItemId, sceneItemTransform: { alignment: 5, positionX: 40, positionY: 40 } });
    }
    if (!inputs.has(LABEL)) {
      const { sceneItemId } = await call("CreateInput", { sceneName: SCENE_OF(), inputName: LABEL, inputKind: "text_gdiplus_v3", inputSettings: { text: "Instant replay", font: { face: "Segoe UI", size: 40, style: "Bold", flags: 1 }, color: 0xFFFFFFFF } });
      await call("SetSceneItemTransform", { sceneName: SCENE_OF(), sceneItemId, sceneItemTransform: { alignment: 5, positionX: 64, positionY: 46 } });
    }
  }

  const REPLAY_STINGER = "builtin:instant-replay.webm";
  async function go(scene, intoReplay) {
    // into the replay: the chosen stinger, else the built-in Instant Replay one; back to live: the current transition
    const sid = intoReplay ? (R.stinger || (stingers().some(x => x.id === REPLAY_STINGER) ? REPLAY_STINGER : "")) : "";
    // a stinger that can't run (busy, missing file) returns false: fall back to a plain switch so the show never sticks
    if (window.Transitions?.toScene && (sid || window.Transitions.isCustom?.()) && await Transitions.toScene(scene, sid ? { stingerId: sid } : undefined)) return;
    if (S.studio) { await call("SetCurrentPreviewScene", { sceneName: scene }); await call("TriggerStudioModeTransition"); }
    else await call("SetCurrentProgramScene", { sceneName: scene });
  }

  /* step 1: put the clip in Preview (Studio Mode) so it can be checked before anyone sees it */
  async function cueClip(path) {
    await ensureScene(path);
    if (R.direct) return airClip();
    if (!S.studio) {
      await call("SetStudioModeEnabled", { studioModeEnabled: true });
      for (let i = 0; i < 20 && !S.studio; i++) await wait(50);
    }
    await call("SetCurrentPreviewScene", { sceneName: SCENE_OF() });
    await media(INPUT, "RESTART");
    R.ready = true; render();
    toast("Replay is in Preview. Watch it, then press Air replay (or R).", "ok");
  }
  async function discard() {
    R.ready = false; render();
    await media(INPUT, "STOP");
    if (S.preview === SCENE_OF() && R.from) await call("SetCurrentPreviewScene", { sceneName: R.from }).catch(() => {});
  }
  const media = (inputName, a) => obs.call("TriggerMediaInputAction", { inputName, mediaAction: `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${a}` }).catch(() => {});
  /* step 2: air it with the replay transition; restart_on_activate starts it from the top on Program */
  async function airClip() {
    R.ready = false;
    if (S.program !== SCENE_OF()) R.from = S.program;
    R.playing = true; render();
    if (R.duck) M()?.setDuck(true, 0.3);
    await go(SCENE_OF(), true);
    watchEnd();
  }
  /* A media source goes blank the moment its clip ends, so going back after the end shows black for the length of the
     transition. Start the way back early instead: when the time left (at the chosen speed) is the transition's own
     cover time plus a margin. Stingers cover at their cut point; OBS transitions need their duration. */
  const backLeadMs = () => {
    const t = window.Transitions, sid = t?.isCustom?.() && t.selected, st = sid && t.list.find(x => x.id === sid);
    // margin: OBS reports a 300 ms Fade ending ~1 s after it starts, so leave room rather than risk a blank last frame
    return (st ? (st.cutPointMs ?? 600) + 400 : (S.transFixed ? 700 : S.transDur || 300) + 700);
  };
  function watchEnd() {
    clearTimeout(R.fallback);
    const t0 = performance.now();
    const tick = async () => {
      if (!R.playing) return;
      try {
        const st = await obs.call("GetMediaInputStatus", { inputName: INPUT });
        const left = Math.max(0, (st.mediaDuration || 0) - (st.mediaCursor || 0)) * 100 / (R.speed || 100);
        const live = S.program === SCENE_OF();
        if (R.auto && live && st.mediaDuration && /PLAYING/.test(st.mediaState) && left <= backLeadMs()) return finish();
        if (R.auto && live && /ENDED|STOPPED/.test(st.mediaState) && performance.now() - t0 > 1500) return finish();
      } catch {}
      R.fallback = setTimeout(tick, 80);
    };
    R.fallback = setTimeout(tick, 300);
  }
  async function showClip(path) { R.from = S.program !== SCENE_OF() ? S.program : R.from; await cueClip(path); }
  async function instantReplay() {
    if (R.busy || !S.connected) return;
    if (R.ready) { R.busy = true; render(); try { await airClip(); } catch (e) { toast("Couldn't air the replay: " + e.message, "bad"); R.playing = false; } finally { R.busy = false; render(); } return; }
    if (!R.on) return toast("Turn on the replay buffer first. It needs a few seconds of video before a replay.", "warn");
    R.busy = true; render();
    try {
      const path = await save();
      if (!path) throw new Error("OBS didn't report a saved clip");
      R.list = [path, ...R.list.filter(p => p !== path)].slice(0, 5); store.set("rbList", R.list);
      R.from = S.program !== SCENE_OF() ? S.program : R.from;
      await cueClip(path);
    } catch (e) { toast("Instant replay failed: " + e.message, "bad"); R.playing = false; }
    finally { R.busy = false; render(); }
  }
  async function finish() {
    clearTimeout(R.fallback);
    if (!R.playing) return;
    R.playing = false; render();
    if (R.duck) M()?.setDuck(false);
    if (R.from && S.program === SCENE_OF()) await go(R.from).catch(e => toast("Couldn't go back: " + e.message, "bad"));
  }

  // "Last N s": OBS reports the duration a moment after playback starts, so poll briefly before seeking
  obs.on("MediaInputPlaybackStarted", async ({ inputName }) => {
    if (inputName !== INPUT || !(R.playing || R.ready) || !R.last) return;
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
  // start watching for the end however the replay got on air (Air replay, a scene click, a role button)
  obs.on("CurrentProgramSceneChanged", ({ sceneName }) => { if (sceneName === SCENE_OF() && R.playing) watchEnd(); });
  obs.on("MediaInputPlaybackEnded", ({ inputName }) => { if (inputName === INPUT && R.playing && R.auto) finish(); });
  obs.on("CurrentProgramSceneChanged", ({ sceneName }) => { if (sceneName === SCENE_OF() && R.ready) { R.ready = false; R.playing = true; render(); } });
  /* OBS stops the buffer by itself when its muxer can't write the clip: almost always Windows Controlled folder
     access guarding Videos/Documents, or a missing folder. Say so and offer a folder that works. */
  obs.on("ReplayBufferStateChanged", ({ outputActive, outputState }) => {
    const unexpected = R.on && !outputActive && !R.stopping && /STOPPED/.test(outputState || "STOPPED");
    R.on = outputActive; R.available = true; if (!outputActive) R.stopping = false;
    if (unexpected) { R.died = true; toast("OBS stopped the replay buffer because it couldn't save the clip. See Instant replay for the fix.", "bad"); }
    render();
  });
  async function fixFolder() {
    try {
      const dir = await T.core.invoke("safe_record_dir");
      await call("SetRecordDirectory", { recordDirectory: dir });
      R.died = false; toast(`OBS now saves replays and recordings to ${dir}.`, "ok");
      await setBuffer(true);
    } catch (e) { toast("Couldn't change the folder: " + e.message, "bad"); }
  }
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
    const l = window.Transitions?.list; return Array.isArray(l) ? l : []; // list is a getter, not a function
  }
  const persist = (k, v) => { R[k] = v; store.set("rb" + k[0].toUpperCase() + k.slice(1), v); };
  function speedSel() {
    const s = h("select", { "aria-label": "Replay speed" });
    for (const v of [25, 50, 75, 100]) s.append(h("option", { value: v }, v === 100 ? "Normal" : `${v}% (slow motion)`));
    s.value = String(R.speed); s.addEventListener("change", () => persist("speed", +s.value));
    return s;
  }
  function sceneSel() {
    const names = [...new Set([PLAIN, ...S.scenes.filter(n => /replay/i.test(n)), R.scene].filter(Boolean))];
    const s = h("select", { "aria-label": "Screen the replay airs on" }, ...names.map(n => h("option", { value: n }, n)));
    s.value = R.scene; s.addEventListener("change", () => persist("scene", s.value));
    return s;
  }
  /* commentators often talk over the replay: its own game sound can be muted or turned down */
  function soundRow() {
    const cb = h("input", { type: "checkbox" }); cb.checked = !R.mute;
    const vol = h("input", { type: "range", min: 0, max: 100, step: 1, value: R.vol, "aria-label": "Replay sound level", disabled: R.mute });
    const pct = h("b", { class: "small" }, R.vol + "%");
    const apply = () => S.connected && Promise.all([
      obs.call("SetInputMute", { inputName: INPUT, inputMuted: R.mute }), obs.call("SetInputVolume", { inputName: INPUT, inputVolumeMul: R.vol / 100 })]).catch(() => {});
    cb.addEventListener("change", () => { persist("mute", !cb.checked); vol.disabled = R.mute; apply(); });
    vol.addEventListener("input", () => { persist("vol", +vol.value); pct.textContent = vol.value + "%"; apply(); });
    return h("div", { class: "rb-sound" }, h("label", { class: "inline" }, cb, "Replay sound"), vol, pct);
  }
  function render() {
    box.textContent = "";
    const sw = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": "Replay buffer", disabled: R.busy });
    sw.checked = R.on; sw.addEventListener("change", () => setBuffer(sw.checked));
    const len = h("input", { type: "number", min: 5, max: 300, step: 1, class: "rb-len", "aria-label": "Seconds the buffer keeps", title: "Seconds the buffer keeps (5 to 300). Change it while the buffer is off.", disabled: R.on || R.busy });
    len.value = String(R.len); len.addEventListener("change", () => { R.len = Math.max(5, Math.min(300, Math.round(+len.value) || 20)); len.value = R.len; store.set("rbLen", R.len); });
    const last = h("select", { "aria-label": "How much to show" });
    for (const [v, t] of [[0, "Whole clip"], [3, "Last 3 s"], [5, "Last 5 s"], [8, "Last 8 s"], [10, "Last 10 s"], [15, "Last 15 s"], [20, "Last 20 s"], [30, "Last 30 s"]]) last.append(h("option", { value: v }, t));
    last.value = String(R.last); last.addEventListener("change", () => { R.last = +last.value; store.set("rbLast", R.last); });
    const list = stingers();
    const sting = list.length ? h("select", { "aria-label": "Transition into the replay" }, h("option", { value: "" }, "Instant Replay stinger"), ...list.map(s => h("option", { value: s.id }, s.name))) : null;
    if (sting) { sting.value = R.stinger; sting.addEventListener("change", () => { R.stinger = sting.value; store.set("rbStinger", R.stinger); }); }

    const goBtn = R.playing
      ? h("button", { class: "btn rb-go on", type: "button", onclick: finish }, "Back to live")
      : R.ready
        ? h("div", { class: "rb-row" },
            h("button", { class: "btn rb-go air", type: "button", disabled: R.busy, title: "R", onclick: instantReplay }, "Air replay"),
            h("button", { class: "btn small", type: "button", title: "Play the clip again in Preview", onclick: () => media(INPUT, "RESTART") }, "Watch again"),
            h("button", { class: "btn small", type: "button", onclick: () => discard() }, "Discard"))
        : h("button", { class: "btn rb-go", type: "button", disabled: !R.on || R.busy, title: "R", onclick: instantReplay }, R.busy ? "Saving…" : "Instant replay");
    box.append(...[
      h("div", { class: "rb-head" }, h("span", { class: "muted small grow" }, "Instant replay"),
        h("label", { class: "inline director", title: "Keeps the last seconds of the program ready to replay" }, sw, "Buffer"), h("span", { class: "director" }, len)),
      goBtn,
      R.ready ? h("p", { class: "muted small rb-note" }, "In Preview now. Only you can see it.") : null,
      R.died ? h("div", { class: "rb-warn", role: "alert" },
        h("p", { class: "small" }, "OBS couldn't save the replay. Windows' Controlled folder access usually blocks OBS from Videos and Documents."),
        T ? h("button", { class: "btn small", type: "button", onclick: fixFolder }, "Save to a folder OBS can use") : null) : null,
      h("details", { class: "rb-opts" }, h("summary", { class: "small" }, "Replay options"),
        h("div", { class: "rb-col" },
          h("label", { class: "field compact" }, h("span", {}, "How much to show"), last),
          h("label", { class: "field compact" }, h("span", {}, "Speed"), speedSel()),
          h("label", { class: "field compact" }, h("span", {}, "Replay screen"), sceneSel()),
          soundRow(),
          opt("direct", "Skip Preview and air right away"), opt("auto", "Go back when it ends"), opt("duck", "Lower music during replay"),
          sting ? h("label", { class: "field compact" }, h("span", {}, "Transition into the replay"), sting) : null,
          h("p", { class: "muted small" }, "The buffer uses extra CPU or GPU and memory while it's on. Clips save to OBS's recording folder. Press R for a replay."),
          R.list.length ? h("div", { class: "rb-list" }, h("span", { class: "muted small" }, "Recent clips"),
            ...R.list.map(p => h("div", { class: "rb-item" },
              h("span", { class: "small grow", title: p }, p.split(/[\\/]/).pop()),
              h("button", { class: "btn small", type: "button", onclick: () => showClip(p).catch(e => toast(e.message, "bad")) }, "Replay"),
              T?.opener?.revealItemInDir ? h("button", { class: "btn small", type: "button", onclick: () => T.opener.revealItemInDir(p).catch(() => {}) }, "Show") : null))) : null))].filter(Boolean));
  }
  render();
  window.Replay = { instantReplay, airClip, discard, finish, setBuffer, status, state: R, INPUT, PLAIN,
    setScene: n => { persist("scene", n); render(); }, setMute: m => { persist("mute", m); if (S.connected) obs.call("SetInputMute", { inputName: INPUT, inputMuted: m }).catch(() => {}); render(); } };
})();
