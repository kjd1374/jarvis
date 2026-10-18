import test from "node:test";
import assert from "node:assert/strict";
import { verifyPreviewTicket, previewOrigin } from "../public/jarvis-preview-auth.mjs";
import { randomUUID } from "node:crypto";
import { fixture, ticket, publicKey, expected, viewer, enter, cookieOf } from "./support/remote-preview.mjs";
import { startQuickTunnel, tunnelFailure, waitForRemoteHealth } from "../public/jarvis-remote-preview.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  await waitForRemoteHealth({ ...options, transport: async () => ++requests <= 20 ? { ok: false, status: 530 } : { ok: true, status: 200, text: async () => "synthetic-id" } });
  assert.equal(requests, 21); // The previous 12-attempt implementation failed here.
  await assert.rejects(waitForRemoteHealth({ ...options, timeoutMs: 2000, transport: async () => ({ ok: false, status: 403 }) }), error => error.stage === "health" && error.statusCode === 403);
  await assert.rejects(waitForRemoteHealth({ ...options, transport: async () => ({ ok: true, status: 200, text: async () => "wrong-gateway" }) }), error => error.code === "remote_health_mismatch");
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
