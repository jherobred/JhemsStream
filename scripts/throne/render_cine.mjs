// Renders cinematic.html to an MP4 (and a PNG of the final frame) per team.
// node scripts/throne/render_cine.mjs <outdir> <seconds> "Team|val|Head|Extra|Label" ...
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [outdir, secs, ...jobs] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const FPS = 30, EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", FFMPEG = process.env.FFMPEG || "ffmpeg";
const PORT = 9300 + Math.floor(Math.random() * 150), prof = mkdtempSync(join(tmpdir(), "edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1920,1080", "--allow-file-access-from-files", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tg; for (let i = 0; i < 50 && !tg; i++) { await sleep(200); try { tg = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === "page"); } catch {} }
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); ws.addEventListener("message", e => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
for (const job of jobs) {
  const [team, cine, head = "", extra = "", label = "", file = team] = job.split("|");
  const url = pathToFileURL(resolve("scripts/throne/cinematic.html")).href + "?" + new URLSearchParams({ team, cine, head, extra, label });
  await call("Page.navigate", { url });
  for (let i = 0; i < 100 && !(await ev("window.ready ? window.ready.then(() => true) : false")); i++) await sleep(200);
  if (secs.startsWith("@")) { // stills at given times: @0,2,3.5
    for (const t of secs.slice(1).split(",")) { await ev(`frameAt(${t})`); const r = await call("Page.captureScreenshot", { format: "jpeg", quality: 85 }); writeFileSync(join(outdir, `${file}_t${t}.jpg`), Buffer.from(r.result.data, "base64")); }
    console.log("stills", file); continue;
  }
  const fr = mkdtempSync(join(tmpdir(), "cf-")), N = Math.round(FPS * +secs);
  for (let i = 0; i < N; i++) {
    await ev(`frameAt(${i / FPS})`);
    const r = await call("Page.captureScreenshot", { format: "jpeg", quality: 92 });
    writeFileSync(join(fr, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(r.result.data, "base64"));
  }
  execFileSync(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(fr, "f%04d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow", join(outdir, `${file}.mp4`)]);
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", join(fr, `f${String(N - 1).padStart(4, "0")}.jpg`), join(outdir, `${file}.png`)]);
  rmSync(fr, { recursive: true, force: true });
  console.log("wrote", file);
}
ws.close(); edge.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch {}
