// Renders throne.html once per team to a JPEG in src-tauri/resources/stingers (win-<slug>.jpg).
// node scripts/throne/render.mjs "ITeletubbies" "Stick-O" "Gxt|advance" ...   (|advance: no crown, file advance-<slug>.jpg)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const teams = process.argv.slice(2);
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9800 + Math.floor(Math.random() * 300);
const prof = mkdtempSync(join(tmpdir(), "edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1920,1080",
  "--allow-file-access-from-files", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
const call = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result;
export const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
for (const arg of teams) {
  const [team, mode] = arg.split("|");
  const url = pathToFileURL(resolve("scripts/throne/throne.html")).href + "?" + new URLSearchParams({ team, crown: mode === "advance" ? "0" : "1" });
  await call("Page.navigate", { url });
  let ok = null;
  for (let i = 0; i < 100 && !ok; i++) { await sleep(200); ok = (await ev("window.ready ? window.ready.then(() => true) : false"))?.value; }
  const data = (await ev("window.shot()"))?.value;
  if (!data) { console.log("FAILED", team, JSON.stringify(await ev("String(window.__err || '')"))); continue; }
  const out = resolve("src-tauri/resources/stingers", `${mode === "advance" ? "advance" : "win"}-${slug(team)}.jpg`);
  writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
  console.log("wrote", out);
}
ws.close(); edge.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch {}
