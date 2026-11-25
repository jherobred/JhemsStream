// Exports the Ready Player SITE stream screens (screens.html) as PNG stills and MP4/WebM loops for review and for
// use outside JhemsStream. node scripts/screens/export.mjs <outdir> [png|video|both] [only-id]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { SCREENS } = await import(process.env.SCREENS_LIST ? new URL(process.env.SCREENS_LIST, import.meta.url) : "./list.mjs"); // SCREENS_LIST=./list-v3.mjs SCREENS_PAGE=screens-v3.html for the v3 set

const [outdir = "exports", mode = "png", only] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const PORT = 9500 + Math.floor(Math.random() * 200);
const prof = mkdtempSync(join(tmpdir(), "edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1920,1080", "--allow-file-access-from-files", "--hide-scrollbars", "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tg; for (let i = 0; i < 50 && !tg; i++) { await sleep(200); try { tg = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === "page"); } catch {} }
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); ws.addEventListener("message", e => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
const page = resolve("src-tauri/resources/stingers", process.env.SCREENS_PAGE || "screens.html");
const shot = async () => Buffer.from((await call("Page.captureScreenshot", { format: "png" })).result.data, "base64");
for (const s of SCREENS.filter(s => !only || s.id === only)) {
  const q = new URLSearchParams({ ...s.q, render: "1", t: "6" });
  await call("Page.navigate", { url: "about:blank" }); await sleep(150); // a hash-only change would not reload the page
  await call("Page.navigate", { url: pathToFileURL(page).href + "#" + q }); await sleep(900);
  await call("Runtime.evaluate", { expression: "frameAt(6)" }); await sleep(150);
  if (mode !== "video") { writeFileSync(join(outdir, `${s.id}.png`), await shot()); console.log("png", s.id); }
  if (mode !== "png") {
    // 8 s: the entrance and then the calm loop that stays on air
    const fr = mkdtempSync(join(tmpdir(), "fr-")), FPS = 30, N = FPS * 8;
    for (let i = 0; i < N; i++) { await call("Runtime.evaluate", { expression: `frameAt(${i / FPS})` }); writeFileSync(join(fr, `f${String(i).padStart(4, "0")}.png`), await shot()); }
    execFileSync(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(fr, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", join(outdir, `${s.id}.mp4`)]);
    rmSync(fr, { recursive: true, force: true }); console.log("video", s.id);
  }
}
ws.close(); edge.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch {}
