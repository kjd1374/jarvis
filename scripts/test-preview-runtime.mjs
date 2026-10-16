// Disposable synthetic Docker/browser integration; no GitHub, model, account or production data.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { runCommand } from "../public/jarvis-runner.mjs";
import { startMacPreview, createPreviewBridge } from "../public/jarvis-preview.mjs";
const dir = await mkdtemp(join(tmpdir(), "jarvis-preview-smoke-")), identity = randomUUID();
const name = `jarvis-preview-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
let browser, activeBridge;
try {
  const cwd = join(dir, "repo"); await mkdir(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module", scripts: { start: "node server.mjs" } }));
  await writeFile(join(cwd, ".env"), "SYNTHETIC_SECRET=must-not-enter-container");
  await writeFile(join(cwd, "server.mjs"), `import http from 'node:http';
import { mkdirSync } from 'node:fs'; import { DatabaseSync } from 'node:sqlite';
mkdirSync(process.env.DATA_DIR,{recursive:true});const db=new DatabaseSync(process.env.DATA_DIR+'/test.db');
db.exec('CREATE TABLE IF NOT EXISTS counter(n INTEGER)');db.exec('INSERT INTO counter VALUES(0)');
http.createServer((req,res)=>{
 if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-site request rejected');return;}
 if(req.url==='/api') { if(req.method==='POST') {if(req.headers.origin!=='http://127.0.0.1:3000'){res.writeHead(403);res.end();return;}db.exec('UPDATE counter SET n=n+1');}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(db.prepare('SELECT n FROM counter').get()));return;}
 res.setHeader('Content-Type','text/html');res.end('<h1>Synthetic preview</h1><button>Save</button><output></output><script>document.querySelector("button").onclick=async()=>{const r=await fetch("/api",{method:"POST"});document.querySelector("output").textContent=(await r.json()).n}</script>');
}).listen(Number(process.env.PORT),process.env.HOST);`);
  const result = await startMacPreview({ cwd, files: ["package.json", "server.mjs", ".env"], sha: "a".repeat(40), stateDir: dir, identity, run: runCommand,
    bridge: async (...args) => activeBridge = await createPreviewBridge(...args) });
  assert.equal(result.state, "ready", result.message);
  const info = JSON.parse((await runCommand("docker", ["inspect", name])).out)[0];
  assert.equal(info.HostConfig.NetworkMode, "none"); assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(info.Config.User, "node"); assert(!info.Mounts.some(m => m.Type === "bind"));
  const isolation = await runCommand("docker", ["exec", name, "node", "--input-type=module", "-e", `import {existsSync} from 'node:fs';import net from 'node:net';
if(existsSync('/app/.env')||process.env.GH_TOKEN||process.env.OPENAI_API_KEY)process.exit(1);
const s=net.connect(443,'203.0.113.1');s.on('connect',()=>process.exit(2));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(3),3000);`]);
  assert.equal(isolation.code, 0, "no credentials or external network available");
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext(), source = await context.newPage(), errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await source.route("https://jarvis-preview.invalid/", route => route.fulfill({ contentType: "text/html",
    body: `<a href="${result.url}" target="_blank" rel="noopener noreferrer">Open preview</a>` }));
  await source.goto("https://jarvis-preview.invalid/");
  const opening = source.waitForEvent("popup");
  const loading = context.waitForEvent("response", { predicate: response => response.url() === result.url });
  await source.getByRole("link", { name: "Open preview" }).click();
  const page = await opening, response = await loading;
  const entryHeaders = await response.request().allHeaders();
  assert.equal(entryHeaders["sec-fetch-site"], "cross-site", "reproduce entry from the hosted Jarvis button");
  assert.equal(response.status(), 200, "user-initiated cross-site document entry opens the preview");
  await page.waitForLoadState("domcontentloaded");
  assert.equal(await page.locator("h1").textContent(), "Synthetic preview");
  await page.getByRole("button", { name: "Save" }).click(); await page.waitForFunction(() => document.querySelector("output").textContent === "1");
  await page.reload();
  assert.equal(await page.evaluate(async () => (await (await fetch("/api")).json()).n), 1);
  const crossSite = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" };
  for (const { path = "", method = "GET", headers } of [
    { path: "api", method: "POST", headers: { ...crossSite, origin: "https://jarvis-preview.invalid" } },
    { method: "POST", headers: { ...crossSite, origin: "https://jarvis-preview.invalid" } },
    { method: "POST", headers: crossSite },
    { headers: { ...crossSite, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } },
    { headers: { ...crossSite, "sec-fetch-dest": "iframe" } },
    { headers: { ...crossSite, "sec-fetch-user": "" } },
    { headers: { ...crossSite, origin: "https://jarvis-preview.invalid" } },
    { path: "api", headers: crossSite },
    { path: "?action=change", headers: crossSite },
  ]) {
    const blocked = await context.request.fetch(result.url + path, { method, headers });
    assert.equal(blocked.status(), 403, "cross-site API, writes, frames and automatic navigation remain blocked");
  }
  await page.goto(result.url); assert.equal(await page.locator("h1").textContent(), "Synthetic preview");
  assert.equal(await page.evaluate(async () => (await (await fetch("/api")).json()).n), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: hosted-page link → real Docker preview; SQLite write/reload; cross-site writes/API/frames blocked; no host mounts, credentials or external network.");
} finally {
  await browser?.close(); activeBridge?.close();
  await runCommand("docker", ["rm", "-f", name]).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
