import http from "node:http";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createRemoteGate } from "../../public/jarvis-remote-preview.mjs";
import { issuePreviewTicket, ticketPublicKey } from "../../public/jarvis-preview-auth.mjs";

export const key = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
export const publicKey = ticketPublicKey(key), appOrigin = "https://jarvis.invalid", remoteUrl = "https://synthetic-private-preview.trycloudflare.com/";
export const scope = { space: "personal", projectId: "synthetic", turnId: randomUUID() }, sha = "a".repeat(40), remoteId = randomUUID(), viewer = randomUUID();
export const expected = { iss: appOrigin, aud: remoteId, origin: remoteUrl.slice(0, -1), ...scope, sha };
export const ticket = (claims = {}, clock = Date.now()) => issuePreviewTicket(key, { ...expected, sub: viewer, ...claims }, clock);

export function requestGate(url, path = "/", { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ hostname: target.hostname, port: target.port, path, method,
      headers: { host: new URL(remoteUrl).host, ...headers } }, res => {
      const chunks = []; res.on("data", b => chunks.push(b));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    }); req.on("error", reject); req.end(body);
  });
}
export async function fixture(run) {
  let clock = Date.now(), approved = true, checkCount = 0, reached = 0, writes = 0, forwarded;
  const upstream = http.createServer((req, res) => {
    reached++; forwarded = req.headers;
    if (req.url === "/api") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ writes: req.method === "POST" ? ++writes : writes })); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<h1>Synthetic remote preview</h1><button>Save</button><output></output><script>document.querySelector("button").onclick=async()=>{const r=await fetch("/api",{method:"POST"});document.querySelector("output").textContent=(await r.json()).writes}</script>');
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const gate = await createRemoteGate({ localUrl: `http://127.0.0.1:${upstream.address().port}/`, appOrigin, publicKey, remoteId, scope, sha,
    expiresAt: new Date(clock + 120_000).toISOString(), clock: () => clock,
    checkAccess: async id => { checkCount++; return approved && id === viewer; } });
  gate.setOrigin(remoteUrl);
  try {
    await run({ gate, ticket: claims => ticket(claims, clock), request: (...args) => requestGate(gate.localUrl, ...args),
      advance: ms => { clock += ms; }, revoke: () => { approved = false; }, reached: () => reached, forwarded: () => forwarded, checks: () => checkCount });
  } finally { gate.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
}
export const enter = (f, value = f.ticket()) => f.request("/_jarvis/open", { method: "POST", headers: { origin: appOrigin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket: value }).toString() });
export const cookieOf = r => r.headers["set-cookie"][0].split(";")[0];
