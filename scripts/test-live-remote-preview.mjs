// Opt-in live provider check. Only an ephemeral synthetic page and test keys leave
// this process. No Jarvis production API, database, user repository or model calls.
import assert from "node:assert/strict";
import http from "node:http";
import { lookup, resolve4, resolve6, Resolver } from "node:dns/promises";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { publishRemotePreview, startQuickTunnel, probeRemoteHealth } from "../public/jarvis-remote-preview.mjs";
import { issuePreviewTicket, ticketPublicKey } from "../public/jarvis-preview-auth.mjs";

assert(process.env.JARVIS_LIVE_PREVIEW_CHECK === "1", "Explicit opt-in required");
const binary = process.env.CLOUDFLARED_PATH;
assert(binary, "Verified cloudflared binary required");
const directory = await mkdtemp(join(tmpdir(), "jarvis-live-preview-"));
const appOrigin = "https://jarvis-preview-validation.invalid", viewer = randomUUID();
const key = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicKey = ticketPublicKey(key), sha = "a".repeat(40);
const scope = { space: "personal", projectId: "synthetic-live-check", turnId: randomUUID() };
let approved = true, writes = 0, cleanup, browser, diagnostics = "", syntheticHost, nextDnsEvidence = 0;
async function diagnoseDns(name, label) {
  const authoritative = async () => {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(await resolve4("kevin.ns.cloudflare.com"));
    return resolver.resolve4(name);
  };
  const results = await Promise.allSettled([lookup(name, { all: true }), resolve4(name), resolve6(name),
    ...["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"].map(endpoint => fetch(`${endpoint}?name=${name}&type=A`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(r => ({ status: r.Status, answers: r.Answer?.length ?? 0, negativeTtl: r.Authority?.[0]?.TTL }))), authoritative()]);
  console.log("DNS evidence", label, results.map(r => r.status === "fulfilled" ? (Array.isArray(r.value) ? { answers: r.value.length } : r.value) : { code: r.reason.code ?? r.reason.cause?.code ?? r.reason.name }));
}
const app = http.createServer((req, res) => {
  if (req.url === "/stream") { res.writeHead(200,{"Content-Type":"text/event-stream"});res.write("data: first\n\n");setTimeout(()=>res.end("data: last\n\n"),3000);return; }
  if (req.url === "/api") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ writes: req.method === "POST" ? ++writes : writes })); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<h1>Synthetic provider check</h1><button>Save</button><output></output><script>document.querySelector("button").onclick=async()=>{const r=await fetch("/api",{method:"POST"});document.querySelector("output").textContent=(await r.json()).writes}</script>');
});
app.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/socket'){socket.destroy();return;}
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');let buffer=head;
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length<6)return;const length=buffer[1]&127;if(length>=126||buffer.length<6+length)return;if((buffer[0]&15)===8){socket.end(Buffer.from([136,0]));return;}const data=Buffer.from(buffer.subarray(6,6+length));for(let i=0;i<length;i++)data[i]^=buffer[2+i%4];buffer=buffer.subarray(6+length);socket.write(Buffer.concat([Buffer.from([129,length]),data]));});socket.on('error',()=>{});socket.on('end',()=>socket.destroy());
});
try {
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const result = await publishRemotePreview({ local: { state: "ready", kind: "mac", url: `http://127.0.0.1:${app.address().port}/`, sha, checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() },
    appOrigin, scope, binary, directory, attachCleanup: (_url, close) => { cleanup = close; return true; },
    transport: async (url, options) => {
      try { return await probeRemoteHealth(url, options); }
      catch (error) {
        if (Date.now() >= nextDnsEvidence) {
          nextDnsEvidence = Date.now() + 30_000;
          // Diagnose while the tunnel is alive. Teardown can remove its DNS record.
          await diagnoseDns(new URL(url).hostname, "active-tunnel");
        }
        throw error;
      }
    },
    client: { request: async (path, input) => {
      if (path === "/api/preview/config") return { version: 1, publicKey };
      assert.equal(path, "/api/preview/access"); return { allowed: approved && input.deviceId === viewer };
    } },
    tunnel: async options => {
      const tunnel = await startQuickTunnel({ ...options, launch: (command, args, options) => {
      const child = spawn(command, args, options);
      // This subprocess has only synthetic tunnel state, never user credentials.
      child.stderr.on("data", bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-12_000); });
      return child;
      } });
      syntheticHost = new URL(tunnel.url).hostname;
      console.log("Synthetic allocated hostname", syntheticHost, "provider log hostnames", [...new Set(diagnostics.match(/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/g))]);
      return tunnel;
    },
  });
  console.log("PASS: actual provider allocation, edge connection and public gateway health");
  const ticket = issuePreviewTicket(key, { iss: appOrigin, aud: result.remoteId, origin: new URL(result.url).origin, ...scope, sha, sub: viewer });
  browser = await chromium.launch();
  const authorized = await browser.newContext(), other = await browser.newContext();
  const page = await authorized.newPage();
  await page.route(appOrigin + "/", route => route.fulfill({ contentType: "text/html", headers: { "Referrer-Policy": "strict-origin" },
    body: `<form method="post" action="${result.url}_jarvis/open"><input type="hidden" name="ticket" value="${ticket}"></form><script>document.forms[0].submit()</script>` }));
  await page.goto(appOrigin, { waitUntil: "commit" }); await page.waitForURL(result.url);
  assert.equal(await page.locator("h1").textContent(), "Synthetic provider check");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => document.querySelector("output").textContent === "1");
  await page.reload(); assert.equal(await page.locator("h1").textContent(), "Synthetic provider check");
  await page.waitForFunction(()=>window.__jarvisStreamTransport===true);
  const streamFirst=await page.evaluate(async()=>{const res=await fetch('/stream');window.liveReader=res.body.getReader();const first=await window.liveReader.read();return new TextDecoder().decode(first.value);});
  assert(streamFirst.includes('first')&&!streamFirst.includes('last'));
  const streamRest=await page.evaluate(async()=>{let text='';while(true){const part=await window.liveReader.read();if(part.done)return text;text+=new TextDecoder().decode(part.value);}});assert(streamRest.includes('last'));
  const socketAnswer=await page.evaluate(()=>new Promise((resolve,reject)=>{const socket=new WebSocket(location.origin.replace('https:','wss:')+'/socket'),timer=setTimeout(()=>{socket.close();reject(Error('socket timeout'));},15000);socket.onopen=()=>socket.send('synthetic-live');socket.onmessage=event=>{clearTimeout(timer);socket.close();resolve(event.data);};socket.onerror=()=>{clearTimeout(timer);reject(Error('socket failed'));};}));assert.equal(socketAnswer,'synthetic-live');
  console.log('PASS: actual Quick Tunnel fetch stream is incremental over authenticated JSON polls; WebSocket round trip works; no paid model or user data.');
  assert.equal((await (await other.newPage()).goto(result.url)).status(), 403);
  approved = false;
  await page.waitForTimeout(10_100);
  assert.equal((await page.reload()).status(), 403);
  console.log("PASS: real HTTPS browser entry, write/reload, copied-link denial and viewer revocation; production calls=0");
} catch (error) {
  if (syntheticHost) await diagnoseDns(syntheticHost, "synthetic-host-at-failure");
  console.error(diagnostics.replace(/https?:\/\/\S+/g, "[provider URL]").replace(/\b[a-f0-9-]{32,}\b/gi, "[ephemeral ID]").slice(-8000));
  throw error;
} finally {
  await browser?.close(); cleanup?.(); app.closeAllConnections();
  await new Promise(resolve => app.close(resolve)); await rm(directory, { recursive: true, force: true });
}
