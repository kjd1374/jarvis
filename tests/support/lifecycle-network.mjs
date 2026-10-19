// Synthetic provider transport only. Real TLS, tunnel process and HTTP proxy;
// no external network, account, signing key or source repository is used.
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const lifecycleRemote = "https://project-lifecycle.trycloudflare.com/";
export async function createLifecycleNetwork() {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-lifecycle-"));
  const host = new URL(lifecycleRemote).hostname, ca = join(directory, "ca.pem"), key = join(directory, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", ca, "-days", "1", "-subj", `/CN=${host}`, "-addext", `subjectAltName=DNS:${host}`], { stdio: "ignore" });
  const certificate = await readFile(ca), sockets = new Set();
  let target = null;
  const track = server => server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const web = https.createServer({ key: await readFile(key), cert: await readFile(ca) }, (req, res) => {
    if (req.headers.host !== host || !target) { res.writeHead(503); res.end(); return; }
    const upstream = http.request({ hostname: "127.0.0.1", port: target.port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.once("close", () => upstream.destroy()); req.pipe(upstream);
  });
  const control = http.createServer(async (req, res) => {
    if (req.url !== "/connect" || req.method !== "POST") { res.writeHead(403); res.end(); return; }
    let raw = ""; for await (const part of req) { raw += part; if (raw.length > 1024) { req.destroy(); return; } }
    try {
      const url = new URL(JSON.parse(raw).url);
      assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert(url.port); assert.equal(url.pathname, "/");
      target = url; res.end("connected");
    } catch { res.writeHead(400); res.end(); }
  });
  const proxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  for (const server of [web, control, proxy]) { track(server); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); }
  proxy.on("connect", (req, socket, head) => {
    if (req.url !== `${host}:443`) { socket.destroy(); return; }
    const upstream = net.connect(web.address().port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.on("close", () => sockets.delete(upstream));
    for (const peer of [socket, upstream]) peer.on("error", () => { socket.destroy(); upstream.destroy(); });
  });
  const binary = join(directory, "synthetic-cloudflared.mjs");
  await writeFile(binary, `#!${process.execPath}
import http from 'node:http';
const args=process.argv.slice(2),url=args[args.indexOf('--url')+1];
if(args[0]!=='tunnel'||!url)process.exit(2);
const request=http.request({hostname:'127.0.0.1',port:${control.address().port},path:'/connect',method:'POST',headers:{'Content-Type':'application/json'}},response=>{
 if(response.statusCode!==200)process.exit(2);response.resume();response.on('end',()=>{console.error('${lifecycleRemote.slice(0, -1)}');console.error('Registered tunnel connection');});
});request.on('error',()=>process.exit(2));request.end(JSON.stringify({url}));
setInterval(()=>{},30000);process.on('SIGTERM',()=>process.exit(0));
`, { mode: 0o700 });
  return {
    ca, directory, binary, proxy: `http://127.0.0.1:${proxy.address().port}`,
    disconnect() { const previous = target; target = null; return () => { target = previous; }; },
    async fetch(url, options = {}) {
      assert.equal(new URL(url).origin, new URL(lifecycleRemote).origin);
      return new Promise((resolve, reject) => {
        const request = https.request({ hostname: "127.0.0.1", port: web.address().port, servername: host,
          // Trust this disposable fixture CA, preserving certificate/host verification.
          ...options, ca: certificate, path: new URL(url).pathname, headers: { Host: host } }, response => {
          const parts = []; response.on("data", b => parts.push(b)); response.on("error", reject);
          response.on("end", () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers: response.headers })));
        }); request.on("error", reject); request.end();
      });
    },
    async close() { for (const socket of sockets) socket.destroy(); await Promise.all([web, control, proxy].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))); await rm(directory, { recursive: true, force: true }); },
  };
}
