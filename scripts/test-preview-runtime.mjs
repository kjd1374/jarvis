// Disposable synthetic Docker/browser integration; no GitHub, model, account or production data.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { runCommand } from "../public/jarvis-runner.mjs";
import { startMacPreview, createPreviewBridge, runProjectTests, attachPreviewCliAuthorization } from "../public/jarvis-preview.mjs";
import { createRemoteGate } from "../public/jarvis-remote-preview.mjs";
import { appOrigin, remoteUrl, publicKey, remoteId, scope, viewer, ticket } from "../tests/support/remote-preview.mjs";
import { withPreviewHttps } from "../tests/support/preview-https.mjs";
const dir = await mkdtemp(join(tmpdir(), "jarvis-preview-smoke-")), identity = randomUUID();
const name = `jarvis-preview-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
let browser, activeBridge;
try {
  const cwd = join(dir, "repo"); await mkdir(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test workflow.test.mjs", pretest: "node -e 'process.exit(9)'", lint: "node -e 'process.exit(2)'" } }));
  await writeFile(join(cwd, ".env"), "SYNTHETIC_SECRET=must-not-enter-container");
  await writeFile(join(cwd, "workflow.test.mjs"), `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { existsSync, writeFileSync } from 'node:fs'; import net from 'node:net';
test('isolated project behavior', async()=>{
 assert.notEqual(process.getuid(),0); assert.equal(existsSync('/app/.env'),false); assert.equal(process.env.GH_TOKEN,undefined); assert.equal(process.env.OPENAI_API_KEY,undefined);
 writeFileSync('/app/only-in-container.txt','temporary');
 await new Promise((resolve,reject)=>{const socket=net.connect(443,'203.0.113.1');socket.on('connect',()=>{socket.destroy();reject(Error('network available'));});socket.on('error',()=>resolve());socket.setTimeout(3000,()=>{socket.destroy();reject(Error('network timeout'));});});
});`);
  const checks = await runProjectTests({ cwd, files: ["package.json", "workflow.test.mjs", ".env"], stateDir: dir, identity, run: runCommand });
  assert.deepEqual(checks.map(check => check.status), ["passed", "failed"], JSON.stringify(checks));
  assert.match(checks[0].detail, /tests 1/); assert.match(checks[1].detail, /종료 코드 2/);
  await assert.rejects(readFile(join(cwd, "only-in-container.txt")), /ENOENT/);
  console.log("PASS: actual project tests run in a credential-free/offline Docker container; real success/failure captured; install/pretest hooks skipped; checkout unchanged.");
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
  activeBridge.close(); await runCommand("docker", ["rm", "-f", name]);
  const standalone = join(dir, "standalone");
  await mkdir(join(standalone, "public"), { recursive: true }); await mkdir(join(standalone, "data"));
  await writeFile(join(standalone, "config.example.json"), '{"label":"Backend ready","profiles":{}}');
  await writeFile(join(standalone, ".env"), "SYNTHETIC_SECRET=must-not-enter-container");
  await writeFile(join(standalone, "data/records.json"), '{"n":999}');
  await writeFile(join(standalone, "public/index.html"), `<h1>Loading</h1><button>Save record</button><output></output><button id="translate">Translate</button><p id="translation"></p><script>
async function load(){const config=await(await fetch('/api/config')).json();document.querySelector('h1').textContent=config.label;document.querySelector('output').textContent=(await(await fetch('/api/records')).json()).n;}
document.querySelector('#translate').onclick=async()=>{document.querySelector('#translation').textContent=(await(await fetch('/api/translate',{method:'POST'})).json()).translation;};
document.querySelector('button').onclick=async()=>{await fetch('/api/records',{method:'POST'});await load();};load();</script>`);
  await writeFile(join(standalone, "server.js"), `const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const config=path.join(__dirname,'config.json'),data=path.join(__dirname,'data/records.json');
http.createServer(async(req,res)=>{
 if(req.url==='/api/isolation'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({credentials:!!(process.env.GH_TOKEN||process.env.OPENAI_API_KEY||process.env.JARVIS_PREVIEW_CLI_TOKEN)}));return;}
 if(req.url.startsWith('/api/translate')){const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});try{const profile=JSON.parse(fs.readFileSync(config)).profiles.jarvis;const r=await fetch(profile.baseUrl+'/chat/completions',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:req.url.includes('cancel=1')?'cancel':'안녕하세요'}],stream:false})});const answer=await r.json();res.writeHead(r.status,{'Content-Type':'application/json'});res.end(JSON.stringify(r.ok?{translation:answer.choices[0].message.content}:answer));}catch{if(!res.destroyed){res.writeHead(502,{'Content-Type':'application/json'});res.end('{}');}}return;}
 if(req.url==='/api/config'){if(!fs.existsSync(config))fs.copyFileSync(path.join(__dirname,'config.example.json'),config);res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(config));return;}
 if(req.url==='/api/records'){let value=fs.existsSync(data)?JSON.parse(fs.readFileSync(data)):{n:0};if(req.method==='POST'){value.n++;fs.mkdirSync(path.dirname(data),{recursive:true});fs.writeFileSync(data,JSON.stringify(value));}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;}
 res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(__dirname,'public/index.html')));
}).listen(Number(process.env.PORT),process.env.HOST);`);
  const original = await readFile(join(standalone, "server.js"), "utf8");
  const direct = await startMacPreview({ cwd: standalone, files: ["server.js", "public/index.html", "config.example.json", ".env", "data/records.json"], sha: "b".repeat(40), stateDir: dir, identity, run: runCommand,
    bridge: async (...args) => activeBridge = await createPreviewBridge(...args) });
  assert.equal(direct.state, "ready", direct.message);
  await page.goto(direct.url);
  await page.waitForFunction(() => document.querySelector("h1").textContent === "Backend ready");
  assert.equal(await page.locator("output").textContent(), "0", "existing private records were excluded");
  await page.getByRole("button", { name: "Save record" }).click();
  await page.waitForFunction(() => document.querySelector("output").textContent === "1");
  await page.reload(); await page.waitForFunction(() => document.querySelector("output").textContent === "1");
  assert.equal(await readFile(join(standalone, "server.js"), "utf8"), original);
  await assert.rejects(readFile(join(standalone, "config.json")), /ENOENT/);
  assert.equal(await readFile(join(standalone, "data/records.json"), "utf8"), '{"n":999}');
  const directInfo = JSON.parse((await runCommand("docker", ["inspect", name])).out)[0];
  assert.equal(directInfo.HostConfig.NetworkMode, "none"); assert.equal(directInfo.HostConfig.ReadonlyRootfs, true);
  assert.equal(directInfo.Config.User, "node"); assert(!directInfo.Mounts.some(m => m.Type === "bind"));
  assert.deepEqual(errors, []);
  console.log("PASS: no-manifest Node app renders API-backed content; app-local config and records persist only in bounded temporary storage; original checkout/private records unchanged.");
  await browser.close(); browser = undefined;
  let clock = Date.now(), approved = true;
  const gate = await createRemoteGate({ localUrl: direct.url, appOrigin, publicKey, remoteId, scope, sha: direct.sha,
    expiresAt: direct.expiresAt, clock: () => clock, checkAccess: async id => approved && id === viewer });
  gate.setOrigin(remoteUrl);
  try {
    await withPreviewHttps({ gate, ticket: () => ticket({ sha: direct.sha }) }, async secureBrowser => {
      const approvedContext = await secureBrowser.newContext({ ignoreHTTPSErrors: true }), other = await secureBrowser.newContext({ ignoreHTTPSErrors: true });
      const securePage = await approvedContext.newPage(), failures = [];
      securePage.on("pageerror", error => failures.push(error.message));
      securePage.on("response", response => { if (response.url().startsWith(remoteUrl) && response.status() >= 400) failures.push(String(response.status())); });
      await securePage.goto(appOrigin, { waitUntil: "commit" }); await securePage.waitForURL(remoteUrl);
      await securePage.waitForFunction(() => document.querySelector("h1").textContent === "Backend ready" && document.querySelector("output").textContent === "1");
      await securePage.getByRole("button", { name: "Save record" }).click();
      await securePage.waitForFunction(() => document.querySelector("output").textContent === "2");
      await securePage.reload(); await securePage.waitForFunction(() => document.querySelector("output").textContent === "2");
      assert.deepEqual(failures, [], "authenticated app initialization and writes must not hide HTTP or browser errors");
      assert.equal((await (await other.newPage()).goto(remoteUrl)).status(), 403);
      approved = false; clock += 10_001;
      assert.equal((await securePage.reload()).status(), 403);
    });
  } finally { gate.close(); }
  console.log("PASS: Docker Node server → bridge → authenticated HTTPS → browser initialization and save/reload; copied links and revoked viewers denied.");
  let inferenceCalls = 0, cancelling = false, cancelled = false;
  const cliOptions = { cwd: standalone, files: ["server.js", "public/index.html", "config.example.json", ".env", "data/records.json"], sha: "b".repeat(40), stateDir: dir, identity, run: runCommand,
    cliInference: async (input, { signal }) => { inferenceCalls++;
      if(input.messages.some(m => m.content === "cancel")) { cancelling = true; return await new Promise((_, reject) => signal.addEventListener("abort", () => { cancelled = true; reject(Object.assign(new Error("cancelled"), { code: "preview_cli_cancelled" })); }, { once: true })); }
      return "Xin chào"; }, authorizeCliPreparation: async () => true,
    bridge: async (...args) => activeBridge = await createPreviewBridge(...args) };
  const cliPreview = await startMacPreview(cliOptions);
  assert.equal(cliPreview.state, "ready", JSON.stringify(cliPreview)); assert.equal(cliPreview.ai.sample, "Xin chào");
  assert.equal(inferenceCalls, 1, "explicit CLI preparation must verify an actual inference response through the queue");
  let cliClock = Date.now(), cliApproved = true;
  const cliGate = await createRemoteGate({ localUrl: cliPreview.url, appOrigin, publicKey, remoteId, scope, sha: cliPreview.sha, cli: true,
    expiresAt: cliPreview.expiresAt, clock: () => cliClock, checkAccess: async id => cliApproved && id === viewer });
  cliGate.setOrigin(remoteUrl); assert(attachPreviewCliAuthorization(cliPreview.url, () => cliGate.authorizeCli()));
  try {
    await withPreviewHttps({ gate: cliGate, ticket: () => ticket({ sha: cliPreview.sha }) }, async b => {
      const context = await b.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
      await page.goto(appOrigin, { waitUntil: "commit" }); await page.waitForURL(remoteUrl);
      await page.waitForFunction(() => document.querySelector("h1").textContent === "Backend ready");
      await page.getByRole("button", { name: "Translate", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#translation").textContent === "Xin chào");
      assert.equal(inferenceCalls, 2);
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/isolation')).json()).credentials), false);
      assert.equal((await context.request.get(remoteUrl + '__jarvis_cli/next')).status(), 404);
      await page.evaluate(() => { globalThis.cancelTranslation = new AbortController(); void fetch('/api/translate?cancel=1', { method: 'POST', signal: globalThis.cancelTranslation.signal }).catch(() => {}); });
      for(let i=0; i<60 && !cancelling; i++) await new Promise(r => setTimeout(r,100));
      assert(cancelling, "the test must reach inference before cancelling");
      await page.evaluate(() => globalThis.cancelTranslation.abort());
      for(let i=0; i<60 && !cancelled; i++) await new Promise(r => setTimeout(r,100));
      assert(cancelled, "browser cancellation must reach the host inference signal");
      cliApproved = false; cliClock += 10_001;
      assert.equal((await page.reload()).status(), 403);
      const callsBefore = inferenceCalls, denied = await fetch(cliPreview.url + 'api/translate', { method: 'POST' });
      assert.equal(denied.status, 503); assert.equal(inferenceCalls, callsBefore, "revocation must prevent model invocation, including backend-originated calls");
    });
  } finally { cliGate.close(); }
  let failedCalls = 0;
  const unavailable = await startMacPreview({ ...cliOptions, cliInference: async () => { failedCalls++; throw Object.assign(new Error('private login evidence'), { code: 'cli_login_required', stage: 'ai' }); } });
  console.log('Synthetic failure-path evidence:', JSON.stringify({ calls: failedCalls, diagnostic: unavailable.diagnostic }));
  assert.equal(unavailable.state, "failed"); assert.equal(unavailable.url, null); assert.equal(unavailable.diagnostic.stage, "ai");
  assert.equal(unavailable.diagnostic.code, "cli_login_required"); assert.equal(failedCalls, 1);
  assert(!JSON.stringify(unavailable).includes('private login evidence'));
  console.log("PASS MODEL MOCK: explicit CLI inference probe, app API through authenticated HTTPS, credentials excluded, private controls hidden, revocation blocks model calls, login failure cannot become ready. No real subscription/model used in CI.");
} finally {
  await browser?.close(); activeBridge?.close();
  await runCommand("docker", ["rm", "-f", name]).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
