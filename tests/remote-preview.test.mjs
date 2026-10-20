import test from "node:test";
import assert from "node:assert/strict";
import { verifyPreviewTicket, previewOrigin } from "../public/jarvis-preview-auth.mjs";
import { randomUUID } from "node:crypto";
import { fixture, ticket, publicKey, appOrigin, remoteUrl, expected, viewer, enter, cookieOf } from "./support/remote-preview.mjs";
import { startQuickTunnel, tunnelFailure, waitForRemoteHealth, probeRemoteHealth, publishRemotePreview } from "../public/jarvis-remote-preview.mjs";
import http from "node:http";
import https from "node:https";
import { createLifecycleNetwork, lifecycleRemote } from "./support/lifecycle-network.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("macOS health bypasses stale system lookup through real verified HTTPS without priming the OS cache", async () => {
  const network = await createLifecycleNetwork(), server = http.createServer((_req, res) => res.end("fresh-dns-gateway"));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const agent = new https.Agent({ ca: await readFile(network.ca) }), untrusted = new https.Agent(); let tunnel, lookups = 0;
  const request = selected => (url, options, done) => {
    assert.equal(url.hostname, new URL(lifecycleRemote).hostname); assert.equal(options.rejectUnauthorized, undefined);
    return https.get(url, { ...options, port: network.tlsPort, agent: selected, headers: { Host: url.hostname } }, done);
  };
  const options = { platform: "darwin", transport: () => assert.fail("system lookup must not prime a negative cache"),
    resolve: async hostname => { assert.equal(hostname, new URL(lifecycleRemote).hostname); lookups++; return ["127.0.0.1"]; }, request: request(agent) };
  try {
    tunnel = await startQuickTunnel({ binary: network.binary, localUrl: `http://127.0.0.1:${server.address().port}/`, directory: network.directory });
    const response = await probeRemoteHealth(lifecycleRemote + "_jarvis/health", {}, options);
    assert.equal(response.status, 200); assert.equal(await response.text(), "fresh-dns-gateway"); assert(lookups > 0);
    await assert.rejects(probeRemoteHealth(lifecycleRemote + "_jarvis/health", {}, { ...options, request: request(untrusted) }), /self.signed|certificate/i);
    await assert.rejects(probeRemoteHealth("https://untrusted.invalid/_jarvis/health", {}, options), /invalid_remote_health_url/);
  } finally { tunnel?.close(); agent.destroy(); untrusted.destroy(); server.closeAllConnections(); await new Promise(r => server.close(r)); await network.close(); }
});
test("tunnel startup uses a fresh explicit config and environment without provider credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-tunnel-unit-"));
  let child, configFile, killed = false;
  try {
    const tunnel = await startQuickTunnel({ binary: "/synthetic/cloudflared", localUrl: "http://127.0.0.1:45678/", directory,
      launch: (binary, args, options) => {
        assert.equal(binary, "/synthetic/cloudflared"); assert.equal(options.shell, false);
        assert(args.includes("--no-autoupdate")); assert.equal(args[args.indexOf("--metrics") + 1], "127.0.0.1:0");
        configFile = args[args.indexOf("--config") + 1]; assert(configFile.startsWith(options.env.HOME + "/"));
        assert(!Object.keys(options.env).some(k => /TOKEN|SECRET|OPENAI|CODEX|TUNNEL_/.test(k)));
        child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { killed = true; child.emit("exit", 0); };
        queueMicrotask(() => child.stderr.write("https://ignored.trycloudflare.com.evil.invalid\nhttps://synthetic-tunnel.trycloudflare.com\nRegistered tunnel connection\n"));
        return child;
      } });
    assert.equal(await readFile(configFile, "utf8"), "{}\n");
    assert.equal(tunnel.url, "https://synthetic-tunnel.trycloudflare.com/");
    tunnel.close(); assert(killed);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(startQuickTunnel({ signal: cancelled.signal }), /preview_cancelled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an allocated hostname is not ready until the provider registers an edge connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-tunnel-wait-"));
  let child, resolved = false;
  try {
    const promise = startQuickTunnel({ binary: "/synthetic/cloudflared", localUrl: "http://127.0.0.1:45678/", directory,
      launch: () => { child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit("exit", 0); return child; } });
    void promise.then(() => { resolved = true; });
    while (!child) await new Promise(r => setImmediate(r));
    child.stderr.write("https://synthetic-wait.trycloudflare.com\n");
    await new Promise(r => setImmediate(r)); assert.equal(resolved, false);
    child.stderr.write("Registered tunnel connection connIndex=0 protocol=http2\n");
    const result = await promise; assert.equal(resolved, true); result.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("provider failures retain safe stage/code and cancellation settles startup immediately", async () => {
  const error = tunnelFailure('failed to request quick Tunnel: dial tcp: connection refused secret=must-not-report', false, 1);
  assert.equal(error.code, "tunnel_network_failed"); assert.equal(error.stage, "provisioning"); assert(!JSON.stringify(error).includes("secret"));
  assert.equal(tunnelFailure("x509: certificate is not valid", true, 1).code, "tunnel_tls_failed");
  const directory = await mkdtemp(join(tmpdir(), "jarvis-tunnel-cancel-")), controller = new AbortController();
  let child;
  try {
    const promise = startQuickTunnel({ binary: "/synthetic/cloudflared", localUrl: "http://127.0.0.1:45678/", directory, signal: controller.signal,
      launch: () => { child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; return child; } });
    const rejected = assert.rejects(promise, error => error.code === "preview_cancelled");
    while (!child) await new Promise(r => setImmediate(r));
    controller.abort(); await rejected;
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("public health tolerates delayed propagation, records HTTP failures and never accepts a different gateway", async () => {
  let time = 0, requests = 0;
  const options = { url: "https://synthetic-ready.trycloudflare.com/", remoteId: "synthetic-id", clock: () => time, delay: async ms => { time += ms; }, timeoutMs: 60_000 };
  await waitForRemoteHealth({ ...options, transport: async () => { assert(time >= 5000); return ++requests <= 20 ? { ok: false, status: 530 } : { ok: true, status: 200, text: async () => "synthetic-id" }; } });
  assert.equal(requests, 21); // The previous 12-attempt implementation failed here.
  await assert.rejects(waitForRemoteHealth({ ...options, timeoutMs: 2000, transport: async () => ({ ok: false, status: 403 }) }), error => error.stage === "health" && error.statusCode === 403);
  await assert.rejects(waitForRemoteHealth({ ...options, transport: async () => ({ ok: true, status: 200, text: async () => "wrong-gateway" }) }), error => error.code === "remote_health_mismatch");
  const started = time;
  await waitForRemoteHealth({ ...options, timeoutMs: 90_000, transport: async () => {
    if (time - started < 65_000) throw Object.assign(new Error("DNS not visible yet"), { cause: { code: "ENOTFOUND" } });
    return { ok: true, status: 200, text: async () => "synthetic-id" };
  } });
  assert.equal(time - started, 65_000);
  const slowDnsStarted = time;
  await waitForRemoteHealth({ ...options, timeoutMs: undefined, transport: async () => {
    if (time - slowDnsStarted < 125_000) throw Object.assign(new Error("Negative DNS cache"), { code: "ENOTFOUND" });
    return { ok: true, status: 200, text: async () => "synthetic-id" };
  } });
  assert.equal(time - slowDnsStarted, 125_000);
  const unavailableStarted = time;
  await assert.rejects(waitForRemoteHealth({ ...options, timeoutMs: undefined, transport: async () => {
    throw Object.assign(new Error("DNS unavailable"), { code: "ENOTFOUND" });
  } }), error => error.code === "remote_health_dns");
  assert.equal(time - unavailableStarted, 185_000);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(waitForRemoteHealth({ ...options, signal: cancelled.signal, delay: () => assert.fail("cancelled startup must not wait"), transport: () => assert.fail("cancelled startup must not connect") }), error => error.code === "preview_cancelled");
});

test("an unpublished hostname is replaced once with a fresh gateway; permanent failure, mismatch and cancellation stay closed", async () => {
  for (const scenario of ["recover", "permanent", "mismatch", "tls", "cancel", "expiring"]) {
    const allocated = [], cleanups = [], identities = [], controller = new AbortController(); let time = 0;
    const options = {
      local: { state: "ready", kind: "mac", url: "http://127.0.0.1:45678/", sha: "a".repeat(40), expiresAt: new Date(Date.now() + (scenario === "expiring" ? 60_000 : 600_000)).toISOString() },
      appOrigin: "https://jarvis.invalid", scope: { space: "personal", projectId: "synthetic", turnId: randomUUID() }, signal: controller.signal,
      client: { request: async () => ({ version: 1, publicKey }) },
      attachCleanup: (_url, close) => { cleanups.push(close); return true; },
      tunnel: async ({ localUrl }) => {
        if (allocated.length) assert(allocated[0].closed, "old tunnel must close before reallocation");
        const entry = { localUrl, url: `https://synthetic-recovery-${allocated.length}.trycloudflare.com/`, closed: false };
        allocated.push(entry); let onExit;
        return { url: entry.url, onExit(fn) { onExit = fn; }, close() { if (!entry.closed) { entry.closed = true; onExit?.(); } } };
      },
      health: input => {
        identities.push(input.remoteId);
        return waitForRemoteHealth({ ...input, timeoutMs: 10, clock: () => time, delay: async ms => { time += ms; } });
      },
      transport: async url => {
        if (scenario === "mismatch") return new Response("wrong-gateway");
        if (scenario === "tls") throw Object.assign(new Error("certificate failure"), { code: "CERT_HAS_EXPIRED" });
        if (scenario === "cancel") controller.abort();
        if (scenario !== "recover" || allocated.length === 1) throw Object.assign(new Error("unpublished"), { code: "ENOTFOUND" });
        // Real gateway response, bound to the replacement hostname and identity.
        const entry = allocated.at(-1);
        return new Promise((resolve, reject) => {
          http.get(entry.localUrl + "_jarvis/health", { headers: { Host: new URL(url).host } }, response => {
            let body = ""; response.on("data", bytes => { body += bytes; });
            response.on("end", () => resolve(new Response(body, { status: response.statusCode })));
          }).on("error", reject);
        });
      },
    };
    try {
      if (scenario === "recover") {
        const result = await publishRemotePreview(options);
        assert.equal(result.url, allocated[1].url); assert.equal(result.remoteId, identities[1]);
        assert.notEqual(identities[0], identities[1]); assert(allocated[0].closed); assert(!allocated[1].closed);
      } else await assert.rejects(publishRemotePreview(options), e => e.code === ({ mismatch: "remote_health_mismatch", tls: "remote_health_tls", cancel: "preview_cancelled" }[scenario] ?? "remote_health_dns"));
      assert.equal(allocated.length, ["recover", "permanent"].includes(scenario) ? 2 : 1);
    } finally { for (const close of cleanups) close(); }
    assert(allocated.every(item => item.closed));
  }
});

test("preview tickets are short-lived, signed and bound to exact origin, project, commit and viewer", () => {
  const now = Date.now(); assert.equal(verifyPreviewTicket(ticket({}, now), publicKey, expected, now).sub, viewer);
  for (const field of ["iss", "aud", "origin", "space", "projectId", "turnId", "sha"])
    assert.throws(() => verifyPreviewTicket(ticket({ [field]: "different" }, now), publicKey, expected, now));
  assert.throws(() => verifyPreviewTicket(ticket({}, now), publicKey, expected, now + 61_000));
  const token = ticket({}, now); assert.throws(() => verifyPreviewTicket(token.slice(0, -5) + "AAAAA", publicKey, expected, now));
  for (const bad of ["http://synthetic.trycloudflare.com/", "https://trycloudflare.com/", "https://synthetic.trycloudflare.com.evil.invalid/", "https://synthetic.trycloudflare.com/path", "https://user@synthetic.trycloudflare.com/", "https://synthetic.trycloudflare.com/?x=1"])
    assert.equal(previewOrigin(bad), null);
});
test("direct links, wrong devices, cross-project tickets and concurrent replay never reach the app", async () => fixture(async f => {
  assert.equal((await f.request()).status, 403);
  assert.equal((await enter(f, f.ticket({ sub: randomUUID() }))).status, 403);
  assert.equal((await enter(f, f.ticket({ space: "company" }))).status, 403);
  const once = f.ticket(), results = await Promise.all([enter(f, once), enter(f, once)]);
  assert.deepEqual(results.map(r => r.status).sort(), [303, 403]);
  assert.equal(f.reached(), 0);
  const success = results.find(r => r.status === 303);
  assert.match(success.headers["set-cookie"][0], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await f.request("/", { headers: { cookie: cookieOf(success) } })).status, 200);
  assert(!f.forwarded().cookie?.includes("jarvis-preview"));
}));
test("revocation, expiry, cross-site API requests and credential forwarding fail closed", async () => fixture(async f => {
  const cookie = cookieOf(await enter(f));
  assert.equal((await f.request("/api", { method: "POST", headers: { cookie, origin: "https://untrusted.invalid", "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await f.request("/api", { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await f.request("/api", { method: "POST", headers: { cookie, origin: expected.origin, authorization: "Bearer MUST_NOT_FORWARD", "x-forwarded-for": "MUST_NOT_FORWARD" } })).status, 200);
  assert.equal(f.forwarded().authorization, undefined); assert.equal(f.forwarded()["x-forwarded-for"], undefined);
  const reads = await Promise.all(Array.from({ length: 8 }, () => f.request("/api", { headers: { cookie } })));
  assert(reads.every(r => r.status === 200)); assert.equal(f.checks(), 1);
  f.revoke(); f.advance(10_001);
  assert.equal((await f.request("/api", { headers: { cookie } })).status, 403);
  f.advance(120_000); assert.equal((await f.request("/", { headers: { cookie } })).status, 410);
}));

test('signed embedded views use a distinct partitioned cookie and permit only the Jarvis frame ancestor', async () => fixture(async f => {
  const opened = await enter(f, f.ticket({ embed: true }));
  assert.equal(opened.status,303);
  assert.match(opened.headers['set-cookie'][0], /__Host-jarvis-embed=/);
  assert.match(opened.headers['set-cookie'][0], /SameSite=None; Partitioned/);
  const app=await f.request('/',{headers:{cookie:cookieOf(opened),'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'}});
  assert.equal(app.status,200);
  assert(app.headers['content-security-policy'].includes(`frame-ancestors ${appOrigin}`));
  assert(!f.forwarded().cookie?.includes('jarvis-embed'));
  const copied=await f.request('/api',{headers:{cookie:cookieOf(opened),origin:'https://another.invalid','sec-fetch-site':'cross-site'}});
  assert.equal(copied.status,403);
}));

test('authenticated WebSocket carries bidirectional bytes, hides credentials and denies other origins/revoked devices', async()=>fixture(async f=>{
  const opened=await enter(f), cookie=cookieOf(opened);
  const upgrade=(origin,cookie)=>new Promise((resolve,reject)=>{
    const target=new URL(f.gate.localUrl), req=http.request({hostname:target.hostname,port:target.port,path:'/hmr',headers:{host:new URL(remoteUrl).host,origin,cookie,connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ=='} });
    req.on('upgrade',(_res,socket)=>resolve({status:101,socket}));req.on('response',res=>{res.resume();resolve({status:res.statusCode});});req.on('error',reject);req.end();
  });
  const active=await upgrade(expected.origin,cookie);assert.equal(active.status,101);
  try {
    const received=new Promise(resolve=>active.socket.once('data',bytes=>resolve(bytes.toString())));active.socket.write('synthetic-hmr-payload');assert.equal(await received,'synthetic-hmr-payload');
    assert(!f.forwarded().cookie?.includes('jarvis-preview'));assert.equal((await upgrade('https://another.invalid',cookie)).status,403);
    f.revoke();f.advance(10001);assert.equal((await upgrade(expected.origin,cookie)).status,403);
  } finally {active.socket.destroy();}
}));
test('remote HTTP delivers the first streaming chunk before the response ends',async()=>fixture(async f=>{
  const cookie=cookieOf(await enter(f));
  await new Promise((resolve,reject)=>{
    const target=new URL(f.gate.localUrl),req=http.get({hostname:target.hostname,port:target.port,path:'/stream',headers:{host:new URL(remoteUrl).host,cookie,origin:expected.origin}},res=>{
      let first=false,body='';res.on('data',chunk=>{body+=chunk; if(!first){first=true;assert(body.includes('first'));assert(!body.includes('last'));}});res.on('end',()=>{assert(body.includes('last'));resolve();});res.on('error',reject);
    });req.on('error',reject);
  });
}));

test('Quick Tunnel stream chunks use short JSON polls bound to the exact approved session and cancel cleanly',async()=>fixture(async f=>{
 const owner=cookieOf(await enter(f)),other=cookieOf(await enter(f));
 const response=await f.request('/stream',{headers:{cookie:owner,origin:expected.origin,'x-jarvis-stream':'poll-v1'}});
 assert.equal(response.status,200);assert.equal(response.headers['x-jarvis-stream'],'poll-v1');assert.match(response.headers['content-type'],/application\/json/);
 const meta=JSON.parse(response.body),path='/_jarvis/stream/'+meta.id;assert.equal(meta.status,200);
 assert.equal((await f.request(path,{headers:{cookie:other,origin:expected.origin}})).status,404);
 const first=JSON.parse((await f.request(path,{headers:{cookie:owner,origin:expected.origin}})).body);
 assert.equal(Buffer.from(first.chunks[0],'base64').toString(),'data: first\n\n');assert.equal(first.done,false);
 const chunks=[];let done=false;for(let attempt=0;attempt<4&&!done;attempt++){const batch=JSON.parse((await f.request(path,{headers:{cookie:owner,origin:expected.origin}})).body);chunks.push(...batch.chunks);done=batch.done;}
 assert(chunks.some(chunk=>Buffer.from(chunk,'base64').toString().includes('last')));assert.equal(done,true);
 assert.equal((await f.request(path,{headers:{cookie:owner,origin:expected.origin}})).status,404);
 const another=JSON.parse((await f.request('/stream?slow=1',{headers:{cookie:owner,origin:expected.origin,'x-jarvis-stream':'poll-v1'}})).body);
 assert.equal((await f.request('/_jarvis/stream/'+another.id,{method:'DELETE',headers:{cookie:owner,origin:expected.origin}})).status,200);
 assert.equal((await f.request('/_jarvis/stream/'+another.id,{headers:{cookie:owner,origin:expected.origin}})).status,404);
}));
