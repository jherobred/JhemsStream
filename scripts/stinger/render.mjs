// Renders coderain.html to PNG frames in headless Edge, then encodes a VP9 alpha webm with ffmpeg.
// node scripts/stinger/render.mjs <out.webm> [title]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [out, title = ""] = process.argv.slice(2);
const FPS = 60, DUR = 1.75, PORT = 9344 + Math.floor(Math.random() * 500);
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const page = pathToFileURL(resolve("scripts/stinger/coderain.html")).href + (title ? "?title=" + encodeURIComponent(title) : "");
const prof = mkdtempSync(join(tmpdir(), "edge-")), frames = mkdtempSync(join(tmpdir(), "frames-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1920,1080", "--allow-file-access-from-files", page]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
const ev = expr => new Promise(r => { const i = ++id; pending.set(i, m => r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
while (!(await ev("typeof window.render === 'function' && document.fonts.ready.then(() => true)"))) await sleep(100);
const N = Math.round(FPS * DUR);
for (let i = 0; i < N; i++) {
  const url = await ev(`render(${i}, ${FPS})`);
  writeFileSync(join(frames, `f${String(i).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
}
const cov = []; for (const t of [0.70, 0.76, 0.80, 0.84, 0.88, 0.92]) cov.push(`${t}s ${(await ev(`coverage(${Math.round(t * FPS)}, ${FPS})`) * 100).toFixed(2)}%`);
console.log("coverage", cov.join("  "));
ws.close(); edge.kill();
execFileSync(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", out], { stdio: "inherit" });
console.log("wrote", out, N, "frames from", frames);
try { rmSync(prof, { recursive: true, force: true }); } catch {}
