import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { fixture, appOrigin, remoteUrl, expected } from "./support/remote-preview.mjs";

test("two browsers use real HTTPS redirects and host cookies: approved viewer interacts; copied link and revoked viewer are denied", async () => fixture(async f => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-preview-tls-"));
  const sockets = new Set();
  let browser, web, proxy;
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "key"), "-out", join(directory, "cert"), "-days", "1", "-subj", "/CN=synthetic-preview.invalid"], { stdio: "ignore" });
    web = https.createServer({ key: await readFile(join(directory, "key")), cert: await readFile(join(directory, "cert")) }, async (req, res) => {
      if (req.headers.host === new URL(appOrigin).host) {
        res.setHeader("Content-Type", "text/html"); res.setHeader("Referrer-Policy", "strict-origin");
        res.end(`<form method="post" action="${remoteUrl}_jarvis/open"><input type="hidden" name="ticket" value="${f.ticket()}"><button>Open screen</button></form><script>document.forms[0].submit()</script>`); return;
      }
      if (req.headers.host !== new URL(remoteUrl).host) { res.writeHead(403); res.end(); return; }
      const target = new URL(f.gate.localUrl);
      const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      }); upstream.on("error", () => res.destroy()); req.pipe(upstream);
    });
    await new Promise(r => web.listen(0, "127.0.0.1", r));
    // A local test-only CONNECT proxy maps precisely two synthetic hosts. No
    // application request can leave this fixture; HTTPS behavior remains real.
    proxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
    proxy.on("connect", (req, socket, head) => {
      if (![`${new URL(appOrigin).host}:443`, `${new URL(remoteUrl).host}:443`].includes(req.url)) { socket.destroy(); return; }
      const upstream = net.connect(web.address().port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      for (const peer of [socket, upstream]) { sockets.add(peer); peer.on("close", () => sockets.delete(peer)); peer.on("error", () => { socket.destroy(); upstream.destroy(); }); }
    });
    await new Promise(r => proxy.listen(0, "127.0.0.1", r));
    browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const authorized = await browser.newContext({ ignoreHTTPSErrors: true }), other = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await authorized.newPage(); await page.goto(appOrigin, { waitUntil: "commit" });
    await page.waitForURL(remoteUrl);
    assert.equal(await page.locator("h1").textContent(), "Synthetic remote preview");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "1");
    assert(!(await page.evaluate(() => document.cookie)).includes("jarvis-preview"));
    assert.equal(new URL(page.url()).origin, expected.origin);
    await page.reload(); assert.equal(await page.locator("h1").textContent(), "Synthetic remote preview");
    const unauthenticated = await other.newPage(); assert.equal((await unauthenticated.goto(remoteUrl)).status(), 403);
    f.revoke(); f.advance(10_001); assert.equal((await page.reload()).status(), 403);
  } finally {
    await browser?.close(); for (const socket of sockets) socket.destroy();
    if (proxy) await new Promise(r => proxy.close(r));
    if (web) { web.closeAllConnections(); await new Promise(r => web.close(r)); }
    await rm(directory, { recursive: true, force: true });
  }
}));
