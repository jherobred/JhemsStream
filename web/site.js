"use strict";
/* Ready Player SITE finals preset. One button builds every screen the event needs, in the order of the stream
   (from the run sheet "READY PLAYER SITE FLOW"): bumpers, match cards, casters, gameplay borders, win screens on the
   throne, final standings, replay, plus SOURCE scenes the crew fills once (game feeds, cameras) that every border
   reuses. Safe to press again: scenes that already exist are left alone. Also: "Edit screen text" for any SITE screen
   and "Load match" buttons for the scoreboard. Needs window.JS, Borders, Editor, Replay, Transitions. */
(() => {
  const { obs, S, call, h, $, toast, shared, store } = window.JS;
  const T = window.__TAURI__;

  const MATCHES = [
    { id: "m15", game: "Mobile Legends", short: "ML M15", label: "Match 15 · Lower Bracket Final", a: "Gxt", b: "GHETTOBOYS" },
    { id: "m22", game: "Valorant", short: "VAL Finals", label: "Match 22 · Championship Finals", a: "ITeletubbies", b: "Stick-O" },
    // the run sheet says "Winner of Match 22" here, but Match 22 is Valorant; check-in says the winner of Match 15
    { id: "m16", game: "Mobile Legends", short: "ML Finals", label: "Match 16 · Championship Finals", a: "Esmiring Hi", b: "Winner of Match 15" },
  ];
  const SCHEDULE = "3:30 PM~ML · Match 15|4:00 PM~Valorant Finals|7:00 PM~ML Championship";
  const SRC = { ml: "90 · SOURCE · ML Game", val: "91 · SOURCE · Valorant Game", camL: "92 · SOURCE · Cam Left", camR: "93 · SOURCE · Cam Right",
    cast1: "94 · SOURCE · Caster Cam 1", cast2: "95 · SOURCE · Caster Cam 2" };
  const CHAT = "SITE Live Chat";
  const ML_CASTERS = ["Jay Gervacio", "Charles Bagus"], VAL_CASTERS = ["Leoj Zamora", "Abe Policarpio"];
  const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const win = (n, team, game, mode, label, extra) => ({ name: n, type: "screen", q: { kind: "win", img: `${mode === "advance" ? "advance" : "win"}-${slug(team)}.jpg`, game, mode,
    head: mode === "advance" ? "Advances to the Grand Finals" : "Champions", team, label, ...(extra ? { extra } : {}) } });
  const up = (n, m, bg) => ({ name: n, type: "screen", q: { kind: "bumper", bg, game: m.game, label: m.label, a: m.a, b: m.b, sub: "Up next" } });
  const casters = (n, c) => ({ name: n, type: "border", tpl: "casters", fills: { cam1: SRC.cast1, cam2: SRC.cast2 }, plates: { n1: c[0], n2: c[1] } });

  /* the show, in order */
  const SCENES = [
    { name: "01 · Starting Soon", type: "screen", q: { kind: "bumper", bg: 2, kicker: "Ready Player SITE · Esports Finals", title: "Starting Soon", until: "15:30", lines: SCHEDULE } },
    { name: "02 · Welcome · Finals Day", type: "screen", q: { kind: "bumper", bg: 1, kicker: "Society of Information Technology Enthusiasts", title: "Esports Finals", sub: "Ready Player SITE · Finals Day", lines: SCHEDULE } },
    up("03 · ML M15 · Up Next", MATCHES[0], 1),
    casters("04 · ML M15 · Casters", ML_CASTERS),
    { name: "05 · ML M15 · Gameplay", type: "border", tpl: "gameplay", fills: { game: SRC.ml } },
    { name: "06 · ML M15 · Gameplay + Cams", type: "border", tpl: "cams", fills: { game: SRC.ml, camL: SRC.camL, camR: SRC.camR } },
    { name: "07 · ML M15 · Gameplay + Chat", type: "border", tpl: "chat", fills: { game: SRC.ml, chat: CHAT } },
    win("08 · WIN · Gxt · ML Match 15", "Gxt", "Mobile Legends", "advance", "Match 15 · One step from the crown"),
    win("09 · WIN · GHETTOBOYS · ML Match 15", "GHETTOBOYS", "Mobile Legends", "advance", "Match 15 · One step from the crown"),
    up("10 · VAL Finals · Up Next", MATCHES[1], 2),
    casters("11 · VAL Finals · Casters", VAL_CASTERS),
    { name: "12 · VAL Finals · Gameplay", type: "border", tpl: "arena", fills: { game: SRC.val } },
    { name: "13 · VAL Finals · Gameplay + Cams", type: "border", tpl: "arena-cams", fills: { game: SRC.val, camL: SRC.camL, camR: SRC.camR } },
    { name: "14 · VAL Finals · Gameplay + Chat", type: "border", tpl: "chat", fills: { game: SRC.val, chat: CHAT } },
    { name: "15 · VAL Finals · Tactical Pause", type: "screen", q: { kind: "bumper", bg: 2, game: "Valorant", title: "Tactical Pause", sub: "Match 22 resumes shortly" } },
    win("16 · WIN · ITeletubbies · Valorant Champions", "ITeletubbies", "Valorant", "champ", "Match 22 · Valorant Championship Finals", "MAXX WIN!!"),
    win("17 · WIN · Stick-O · Valorant Champions", "Stick-O", "Valorant", "champ", "Match 22 · Valorant Championship Finals"),
    up("18 · ML Finals · Up Next", MATCHES[2], 1),
    casters("19 · ML Finals · Casters", ML_CASTERS),
    { name: "20 · ML Finals · Gameplay", type: "border", tpl: "gameplay", fills: { game: SRC.ml } },
    { name: "21 · ML Finals · Gameplay + Cams", type: "border", tpl: "cams", fills: { game: SRC.ml, camL: SRC.camL, camR: SRC.camR } },
    { name: "22 · ML Finals · Gameplay + Chat", type: "border", tpl: "chat", fills: { game: SRC.ml, chat: CHAT } },
    win("23 · WIN · Esmiring Hi · ML Champions", "Esmiring Hi", "Mobile Legends", "champ", "Match 16 · Mobile Legends Championship Finals"),
    win("24 · WIN · Gxt · ML Champions", "Gxt", "Mobile Legends", "champ", "Match 16 · Mobile Legends Championship Finals"),
    win("25 · WIN · GHETTOBOYS · ML Champions", "GHETTOBOYS", "Mobile Legends", "champ", "Match 16 · Mobile Legends Championship Finals"),
    { name: "26 · Awards · Valorant Standings", type: "screen", q: { kind: "standings", bg: 2, game: "Valorant", title: "Final Standings",
      l1: "Champions", t1: "TBA", l2: "1st Runner-up", t2: "TBA", l3: "2nd Runner-up", t3: "TBA" } },
    { name: "27 · Awards · ML Standings", type: "screen", q: { kind: "standings", bg: 1, game: "Mobile Legends", title: "Final Standings",
      l1: "Champions", t1: "TBA", l2: "1st Runner-up", t2: "TBA", l3: "2nd Runner-up", t3: "TBA", l4: "3rd Runner-up", t4: "TBA", l5: "4th Runner-up", t5: "TBA" } },
    { name: "28 · Instant Replay", type: "border", tpl: "replay" },
    { name: "29 · Be Right Back", type: "screen", q: { kind: "bumper", bg: 1, kicker: "Ready Player SITE · Esports Finals", title: "Be Right Back", sub: "Stay tuned" } },
    { name: "30 · Technical Difficulties", type: "screen", q: { kind: "bumper", bg: 2, kicker: "Ready Player SITE · Esports Finals", title: "Technical Difficulties", sub: "Please stand by" } },
    { name: "31 · Thanks for Watching", type: "screen", q: { kind: "bumper", bg: 1, kicker: "Society of Information Technology Enthusiasts", title: "Thanks for Watching", sub: "Congratulations to every team" } },
  ];
  const SOURCES = [[SRC.ml, "ML GAME"], [SRC.val, "VALORANT GAME"], [SRC.camL, "LEFT CAMERA"], [SRC.camR, "RIGHT CAMERA"], [SRC.cast1, "CASTER CAMERA 1"], [SRC.cast2, "CASTER CAMERA 2"]];
  const isSource = n => / · SOURCE · /.test(n);
  const screenName = scene => `SITE Screen · ${scene}`;

  let dir = null;
  const assetDir = async () => (dir = dir || String(await T.core.invoke("stinger_dir")).replace(/[\\/]+$/, ""));
  const pageUrl = async q => "file:///" + encodeURI((await assetDir()).replace(/\\/g, "/")) + "/site.html#" + new URLSearchParams(q);
  const inputNames = async () => new Set((await call("GetInputList")).inputs.map(i => i.inputName));
  const ABGR = hex => (0xff000000 | parseInt(hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3), 16)) >>> 0;

  /* one browser source per screen, unloaded while hidden so twenty screens don't sit in memory */
  async function addScreen(scene, q, rect) {
    const { w, h: H } = S.canvas, name = screenName(scene);
    const r = rect || { x: 0, y: 0, w, h: H };
    const { sceneItemId } = await call("CreateInput", { sceneName: scene, inputName: name, inputKind: "browser_source",
      inputSettings: { url: await pageUrl(q), width: 1920, height: 1080, fps: 60, shutdown: true, restart_when_active: false, reroute_audio: false } });
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform: { boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: r.w, boundsHeight: r.h, alignment: 5, positionX: r.x, positionY: r.y } });
    return sceneItemId;
  }
  /* SOURCE scenes: what the crew fills once. A placeholder says what goes there and hides itself when a source lands */
  async function makeSource(scene, label) {
    const { w, h: H } = S.canvas;
    await call("CreateScene", { sceneName: scene });
    const bg = (await call("CreateInput", { sceneName: scene, inputName: `Placeholder · ${label}`, inputKind: "color_source_v3",
      inputSettings: { color: ABGR("#1A0B2E"), width: w, height: H } })).sceneItemId;
    const tx = (await call("CreateInput", { sceneName: scene, inputName: `Placeholder text · ${label}`, inputKind: "text_gdiplus_v3",
      inputSettings: { text: `${label}\nRight-click this scene in JhemsStream, then Add source`, align: "center", valign: "center",
        font: { face: "Bahnschrift", size: 64, style: "Bold", flags: 1 }, color: ABGR("#E9C8FF") } })).sceneItemId;
    await call("SetSceneItemTransform", { sceneName: scene, sceneItemId: tx, sceneItemTransform: { alignment: 0, positionX: w / 2, positionY: H / 2 } });
    return [bg, tx];
  }
  obs.on("SceneItemCreated", async ({ sceneName, sourceName }) => {
    if (!isSource(sceneName) || sourceName.startsWith("Placeholder")) return;
    const items = (await call("GetSceneItemList", { sceneName }).catch(() => ({ sceneItems: [] }))).sceneItems;
    for (const it of items.filter(i => i.sourceName.startsWith("Placeholder") && i.sceneItemEnabled))
      call("SetSceneItemEnabled", { sceneName, sceneItemId: it.sceneItemId, sceneItemEnabled: false }).catch(() => {});
  });

  /* ---------- the one button ---------- */
  let busy = false;
  async function setup() {
    if (busy || !S.connected) return;
    if (!T) return toast("The SITE event setup needs the desktop app on the streaming PC.", "warn");
    if (!S.isLocal) return toast("Run the SITE event setup from JhemsStream on the streaming PC. Its files have to be on the PC that runs OBS.", "warn");
    const have = new Set(S.scenes), todo = SCENES.filter(s => !have.has(s.name)).length + SOURCES.filter(([n]) => !have.has(n)).length;
    if (!todo) { toast("Every SITE screen is already here."); return offerTransitions(); }
    if (!confirm(`Set up the Ready Player SITE finals?\n\nAdds ${todo} screens in show order: bumpers, match cards, casters, gameplay borders, win screens, standings, replay and SOURCE scenes for the game feeds and cameras. Screens you already have are left alone.\n\nAfterwards, fill the SOURCE scenes (game feeds and cameras) once; every screen uses them.`)) return;
    busy = true;
    const note = h("div", { class: "toast", role: "status" }, "Setting up…"); $("#toasts").append(note);
    const say = t => { note.textContent = t; };
    try {
      await Borders.ensureScoreInputs();
      // OBS puts each new scene just below the selected one, so the last one made ends up on top: build bottom-up
      for (const [n, label] of [...SOURCES].reverse()) if (!have.has(n)) { say(`Making ${n}`); await makeSource(n, label); }
      if (!(await inputNames()).has(CHAT)) {
        // the chat panel's page: empty until the crew pastes a chat overlay link (Facebook has no official one)
        const tmp = "_JhemsStream site temp";
        await call("CreateScene", { sceneName: tmp }).catch(() => {});
        await call("CreateInput", { sceneName: tmp, inputName: CHAT, inputKind: "browser_source",
          inputSettings: { url: "about:blank", width: 356, height: 761, css: "body{background-color:rgba(0,0,0,0)!important;margin:0;overflow:hidden}", reroute_audio: true } });
        // keep the input alive in the first scene that uses it, then drop the temp scene
        S.__siteTmp = tmp;
      }
      let k = 0;
      for (const sc of [...SCENES].reverse()) {
        k++; if (have.has(sc.name)) continue;
        say(`Making ${sc.name} (${k} of ${SCENES.length})`);
        if (sc.type === "screen") { await call("CreateScene", { sceneName: sc.name }); await addScreen(sc.name, sc.q); }
        else {
          await Borders.build(sc.name, sc.tpl, sc.fills || {});
          if (sc.plates) await addScreen(sc.name, { kind: "plates", ...sc.plates });
        }
      }
      if (S.__siteTmp) { await call("RemoveScene", { sceneName: S.__siteTmp }).catch(() => {}); delete S.__siteTmp; }
      say("Finishing: scoreboard, shortcuts, transition");
      await loadMatch(MATCHES[0], true);
      await shared.set("roles", { main: "05 · ML M15 · Gameplay", nextA: "03 · ML M15 · Up Next", nextB: "10 · VAL Finals · Up Next", win: "08 · WIN · Gxt · ML Match 15" });
      window.Replay?.setScene?.("28 · Instant Replay");
      window.Transitions?.use?.("builtin:site-purple-sweep.webm");
      await JS.refreshScenes(); JS.refreshInputs();
      window.Studio?.reloadRoles?.();
      note.remove();
      toast("SITE screens are ready. Fill the SOURCE scenes (90 to 95) with the game feeds and cameras.", "ok");
      offerTransitions();
    } catch (e) { note.remove(); toast("SITE setup stopped: " + (e.message || e) + ". Press it again to finish; finished screens are kept.", "bad"); }
    finally { busy = false; }
  }
  async function offerTransitions() {
    const m = await window.Transitions?.checkObs?.();
    if (m?.length) toast(`OBS doesn't have the SITE transitions yet (${m.length} missing).`, "warn", { label: "Add to OBS", fn: () => Transitions.addToObs() });
  }

  /* ---------- scoreboard: load a match's teams ---------- */
  async function loadMatch(m, quiet) {
    await Borders.ensureScoreInputs();
    const set = (n, text) => call("SetInputSettings", { inputName: n, inputSettings: { text } });
    await Promise.all([set("Team A Name", m.a), set("Team B Name", m.b), set("Score A", "0"), set("Score B", "0")]);
    await Borders.setBoardOpts({ label: m.label.split(" · ")[0].toUpperCase() });
    if (!quiet) toast(`Scoreboard: ${m.a} vs ${m.b}, scores 0 to 0.`);
  }
  function renderMatches() {
    const box = $("#siteMatches"); if (!box) return;
    box.textContent = "";
    box.append(...MATCHES.map(m => h("button", { type: "button", class: "btn small", title: `${m.game} · ${m.label}: sets both names and resets the scores`,
      onclick: () => { if (confirm(`Load ${m.a} vs ${m.b} (${m.label})? Both scores go back to 0.`)) loadMatch(m); } }, `${m.short}: ${m.a} vs ${m.b}`)));
  }
  renderMatches();

  /* ---------- edit a SITE screen's words ---------- */
  const FIELDS = {
    bumper: [["kicker", "Small line on top"], ["game", "Game badge"], ["title", "Big title"], ["label", "Match line"], ["a", "Team on the left"], ["b", "Team on the right"], ["sub", "Line under it"], ["until", "Countdown to (24 h, e.g. 15:30)"], ["lines", "Schedule (time~what|time~what)"], ["bg", "Background (1 = BG1, 2 = BG2)"]],
    win: [["game", "Game badge"], ["head", "Headline"], ["team", "Team name"], ["extra", "Extra line (e.g. MAXX WIN!!)"], ["label", "Footer line"], ["img", "Throne picture file"]],
    standings: [["game", "Game badge"], ["title", "Title"], ...[1, 2, 3, 4, 5].flatMap(i => [[`l${i}`, `Place ${i}`], [`t${i}`, `Team in place ${i}`]]), ["bg", "Background (1 or 2)"]],
    plates: [["n1", "Left caster"], ["r1", "Left caster's role"], ["n2", "Right caster"], ["r2", "Right caster's role"]],
  };
  async function screenOf(scene) {
    const items = (await call("GetSceneItemList", { sceneName: scene })).sceneItems;
    const it = items.find(i => i.sourceName.startsWith("SITE Screen · ")) || items.find(i => i.sourceName === CHAT);
    return it?.sourceName || null;
  }
  async function editScreen(scene, inputName) {
    inputName = inputName || await screenOf(scene);
    if (!inputName) return toast("This scene has no SITE screen to edit.", "warn");
    const url = (await call("GetInputSettings", { inputName })).inputSettings.url || "";
    const dlg = h("dialog", { class: "editor-dlg" }), body = h("div", { class: "dlg-body" }), foot = h("div", { class: "dlg-foot row" });
    dlg.append(h("div", { class: "dlg-head row" }, h("h3", {}, `Screen text: ${scene}`),
      h("button", { type: "button", class: "btn icon", "aria-label": "Close", onclick: () => dlg.close(), html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' })), body, foot);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    let save;
    if (inputName === CHAT) {
      const inp = h("input", { id: "scUrl", type: "text", value: url === "about:blank" ? "" : url, placeholder: "https://… chat overlay link", autocomplete: "off", spellcheck: "false" });
      body.append(h("p", { class: "tip" }, "Facebook has no official chat overlay link. Paste one from a tool that reads Facebook Live comments (for example Social Stream Ninja with its extension on your Live Producer page). Every chat panel uses this one link."),
        h("div", { class: "field" }, h("label", { for: "scUrl" }, "Chat overlay link"), inp));
      save = () => call("SetInputSettings", { inputName, inputSettings: { url: inp.value.trim() || "about:blank" } });
    } else {
      const [base, hash = ""] = url.split("#"), q = new URLSearchParams(hash), kind = q.get("kind") || "bumper";
      const inputs = {};
      for (const [k, label] of FIELDS[kind] || []) {
        inputs[k] = h("input", { id: `sc-${k}`, type: "text", value: q.get(k) || "", autocomplete: "off" });
        body.append(h("div", { class: "field" }, h("label", { for: `sc-${k}` }, label), inputs[k]));
      }
      save = () => { for (const [k, i] of Object.entries(inputs)) { const v = i.value.trim(); v ? q.set(k, v) : q.delete(k); } return call("SetInputSettings", { inputName, inputSettings: { url: `${base}#${q}` } }); };
    }
    foot.append(h("span", { class: "grow" }), h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancel"),
      h("button", { type: "button", class: "btn primary", onclick: async () => { try { await save(); toast("Screen updated."); dlg.close(); } catch (e) { toast(e.message, "bad"); } } }, "Save"));
    dlg.showModal();
  }

  $("#btnSiteEvent")?.addEventListener("click", setup);
  JS.onReady(renderMatches);
  window.Site = { setup, editScreen, screenOf, loadMatch, MATCHES, SCENES, isSource, CHAT };
})();
