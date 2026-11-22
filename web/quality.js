"use strict";
/* Stream quality: presets, bitrate, resolution, frame rate and encoder, written to OBS's Simple output settings.
   OBS applies them on the next Start streaming; they can't change while streaming or recording. */
(() => {
  const { call, S, toast } = window.JS;
  const T = window.__TAURI__;
  const PRESETS = [
    { id: "best", label: "Best quality", w: 1920, h: 1080, fps: 60, vb: 6000, ab: 160, up: 8, desc: "1080p at 60 fps, 6000 kbps. Needs about 8 Mbps upload." },
    { id: "balanced", label: "Balanced", w: 1920, h: 1080, fps: 30, vb: 4500, ab: 160, up: 6, desc: "1080p at 30 fps, 4500 kbps. Needs about 6 Mbps upload." },
    { id: "weak", label: "Weak internet", w: 1280, h: 720, fps: 30, vb: 3000, ab: 128, up: 4, desc: "720p at 30 fps, 3000 kbps. Needs about 4 Mbps upload." },
    { id: "veryweak", label: "Very weak internet", w: 1280, h: 720, fps: 30, vb: 1800, ab: 128, up: 2.5, desc: "720p at 30 fps, 1800 kbps. Needs about 2.5 Mbps upload." },
  ];
  // Simple output mode encoder ids (H.264 only: Facebook Live takes H.264)
  const ENCODERS = [
    { id: "nvenc", label: "NVIDIA graphics (NVENC)", gpu: /nvidia/i },
    { id: "qsv", label: "Intel graphics (Quick Sync)", gpu: /intel/i },
    { id: "amd", label: "AMD graphics (AMF)", gpu: /amd|radeon/i },
    { id: "x264", label: "Processor (x264)", gpu: null },
  ];
  const Q = { loaded: false, mode: "Simple", vb: 0, ab: 0, enc: "", w: 0, h: 0, bw: 0, bh: 0, fps: 0, gpus: null };
  const P = async (c, n) => (await call("GetProfileParameter", { parameterCategory: c, parameterName: n })).parameterValue;
  const SP = (c, n, v) => call("SetProfileParameter", { parameterCategory: c, parameterName: n, parameterValue: String(v) });

  async function load() {
    const [mode, vb, ab, enc, v] = await Promise.all([P("Output", "Mode"), P("SimpleOutput", "VBitrate"), P("SimpleOutput", "ABitrate"), P("SimpleOutput", "StreamEncoder"), call("GetVideoSettings")]);
    Object.assign(Q, { loaded: true, mode, vb: +vb, ab: +ab, enc, w: v.outputWidth, h: v.outputHeight, bw: v.baseWidth, bh: v.baseHeight, fps: Math.round(v.fpsNumerator / v.fpsDenominator) });
    if (T && Q.gpus === null) Q.gpus = await T.core.invoke("gpu_names").catch(() => []);
    summary();
    return Q;
  }
  const current = () => PRESETS.find(p => p.w === Q.w && p.h === Q.h && p.fps === Q.fps && p.vb === Q.vb);
  const busy = () => {
    if (S.streaming || S.recording) { toast("Stop streaming and recording first. OBS can't change quality while it's sending video.", "warn"); return true; }
    return false;
  };
  async function ensureSimple() {
    if (Q.mode === "Simple") return true;
    if (!confirm("OBS is in Advanced output mode. Switch it to Simple so JhemsStream can set the quality?")) return false;
    await SP("Output", "Mode", "Simple"); Q.mode = "Simple"; return true;
  }
  async function setVideo(w, h, fps) {
    await call("SetVideoSettings", { outputWidth: w, outputHeight: h, fpsNumerator: fps, fpsDenominator: 1 });
  }
  async function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id); if (!p || busy() || !(await ensureSimple())) return false;
    try {
      await SP("SimpleOutput", "VBitrate", p.vb); await SP("SimpleOutput", "ABitrate", p.ab);
      await setVideo(p.w, p.h, p.fps);
      await load(); toast(`${p.label}: ${p.h}p at ${p.fps} fps, ${p.vb} kbps. Applies on the next Start streaming.`);
      return true;
    } catch (e) { toast("OBS refused the change: " + e.message, "bad"); await load(); return false; }
  }
  async function set(key, value) {
    if (busy() || !(await ensureSimple())) return false;
    try {
      if (key === "vb") await SP("SimpleOutput", "VBitrate", Math.max(500, Math.min(9000, Math.round(+value))));
      if (key === "ab") await SP("SimpleOutput", "ABitrate", value);
      if (key === "enc") await SP("SimpleOutput", "StreamEncoder", value);
      if (key === "res") { const [w, h] = value.split("x").map(Number); await setVideo(w, h, Q.fps); }
      if (key === "fps") await setVideo(Q.w, Q.h, +value);
      await load(); return true;
    } catch (e) { toast("OBS refused the change: " + e.message, "bad"); await load(); return false; }
  }
  function encoders() {
    if (!Q.gpus || !Q.gpus.length) return ENCODERS;
    const list = ENCODERS.filter(e => !e.gpu || Q.gpus.some(g => e.gpu.test(g)) || e.id === Q.enc);
    return list;
  }
  function suggest(mbps) {
    const fit = PRESETS.find(p => mbps >= p.up);
    return fit || PRESETS[PRESETS.length - 1];
  }
  function summary() {
    const el = document.querySelector("#qualitySummary"); if (!el) return;
    const p = current();
    el.textContent = `${p ? p.label : "Custom"}: ${Q.h}p, ${Q.fps} fps, ${Q.vb.toLocaleString()} kbps`;
  }
  window.JS.onReady(() => load().catch(() => {}));
  window.Quality = { Q, PRESETS, ENCODERS, load, current, applyPreset, set, encoders, suggest };
})();
