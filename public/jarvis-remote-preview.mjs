// Authenticated HTTPS access to one disposable preview. Never forwards runner credentials.
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { previewOrigin, verifyPreviewTicket } from "./jarvis-preview-auth.mjs";

const cookieName = "__Host-jarvis-preview";
const runningTunnels = new Set();
let signalHandlers = false;
const digest = value => createHash("sha256").update(value).digest("hex");
const errorPage = "<!doctype html><html lang=ko><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Jarvis 미리보기</title><style>body{background:#111;color:#eee;font:16px/1.7 system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:24px}h1{font-size:24px}</style><h1>Jarvis에서 화면을 다시 열어주세요</h1><p>승인된 기기의 프로젝트 화면에서 ‘이 PC에서 화면 열기’를 눌러주세요. 만료됐거나 맥미니가 꺼졌다면 화면을 다시 준비해주세요.</p></html>";
const policy = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function protectedHeaders(response) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", policy);
  response.setHeader("X-Frame-Options", "DENY");
}
async function bodyOf(request, limit) {
  if (Number(request.headers["content-length"] ?? 0) > limit) throw new Error("body_too_large");
  const parts = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("body_too_large");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export async function createRemoteGate({ localUrl, appOrigin, publicKey, remoteId, scope, sha, expiresAt, checkAccess, cli = false, clock = Date.now }) {
  const upstream = new URL(localUrl);
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || !upstream.port || upstream.pathname !== "/" || upstream.username || upstream.password || upstream.search || upstream.hash)
    throw new Error("invalid_preview_upstream");
  let origin = null, closed = false, active = 0;
  const sessions = new Map(), used = new Map(), sockets = new Set();
  const allowed = async session => {
    if (session.until <= clock()) return false;
    if (session.checking) return session.checking;
    if (session.checkedUntil > clock()) return session.allowed;
    // Coalesce asset requests; expiry is measured before the remote check so a
    // slow server cannot extend a stale device approval.
    if (!session.checking) session.checking = (async () => {
      session.checkedUntil = clock() + 10_000;
      let timeout;
      try { session.allowed = await Promise.race([checkAccess(session.deviceId), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 8000); })]) === true; }
      catch { session.allowed = false; }
      finally { clearTimeout(timeout); }
      return session.allowed;
    })().finally(() => { session.checking = null; });
    return session.checking;
  };
  const server = http.createServer({ maxHeaderSize: 16_384, requestTimeout: 30_000 }, async (req, res) => {
    protectedHeaders(res);
    const deny = (status = 403) => { res.statusCode = status; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(errorPage); };
    if (closed || clock() >= Date.parse(expiresAt)) { deny(410); return; }
    if (!origin || req.headers.host !== new URL(origin).host || !req.url?.startsWith("/") || req.url.startsWith("//")) { deny(); return; }
    if (req.method === "GET" && req.url === "/_jarvis/health") { res.setHeader("Content-Type", "text/plain"); res.end(remoteId); return; }
    if (req.url.startsWith("/__jarvis_cli/")) { deny(404); return; }
    if (++active > 32) { active--; deny(429); return; }
    res.once("close", () => { active--; });
    try {
      if (req.url === "/_jarvis/open") {
        if (req.method !== "POST" || req.headers.origin !== appOrigin || !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) { deny(); return; }
        const ticket = new URLSearchParams((await bodyOf(req, 8192)).toString()).get("ticket");
        const claims = verifyPreviewTicket(ticket, publicKey, { iss: appOrigin, aud: remoteId, origin, ...scope, sha }, clock());
        for (const [key, expiry] of used) if (expiry <= clock()) used.delete(key);
        for (const [key, session] of sessions) if (session.until <= clock()) sessions.delete(key);
        if (used.has(claims.jti) || used.size >= 100 || sessions.size >= 50) { deny(); return; }
        // Reserve before awaiting authorization: concurrent redemption cannot replay a ticket.
        used.set(claims.jti, claims.exp * 1000);
        const session = { deviceId: claims.sub, until: Date.parse(expiresAt), checkedUntil: 0, allowed: false, checking: null };
        if (!await allowed(session)) { deny(); return; }
        const token = randomBytes(32).toString("base64url"); sessions.set(digest(token), session);
        res.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((session.until - clock()) / 1000))}`);
        res.writeHead(303, { Location: "/" }); res.end(); return;
      }
      if (req.url.startsWith("/_jarvis/")) { deny(404); return; }
      const cookie = (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const session = cookie && sessions.get(digest(cookie));
      if (!session || !await allowed(session)) { deny(); return; }
      session.seenAt = clock();
      const entry = req.method === "GET" && req.url === "/" && req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document";
      if (req.headers.origin && req.headers.origin !== origin || ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"]) && !entry) { deny(); return; }
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(req.method)) { deny(405); return; }
      const body = await bodyOf(req, 4_000_000);
      const headers = { host: upstream.host };
      for (const key of ["accept", "accept-language", "content-type", "range", "if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "user-agent", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user",
        "rsc", "next-action", "next-router-state-tree", "next-router-prefetch", "next-url", "x-csrf-token", "x-xsrf-token", "x-requested-with"]) {
        if (req.headers[key]) headers[key] = req.headers[key];
      }
      // Only preview-owned cookies reach the app, never the gateway credential.
      const appCookies = (req.headers.cookie ?? "").split(";").map(s => s.trim()).filter(s => s && !s.startsWith(`${cookieName}=`));
      if (appCookies.length) headers.cookie = appCookies.join("; ");
      if (req.headers.origin) headers.origin = upstream.origin;
      headers["sec-fetch-site"] = entry ? "none" : "same-origin";
      if (body.length) headers["content-length"] = String(body.length);
      const request = http.request({ hostname: "127.0.0.1", port: upstream.port, path: req.url, method: req.method, headers }, response => {
        res.statusCode = response.statusCode ?? 502;
        for (const key of ["content-type", "content-encoding", "content-language", "content-disposition", "accept-ranges", "content-range", "vary", "x-action-redirect", "x-action-revalidated"]) {
          if (response.headers[key]) res.setHeader(key, response.headers[key]);
        }
        if (response.headers.location) {
          const destination = new URL(response.headers.location, upstream);
          if (destination.origin !== upstream.origin) { response.resume(); deny(502); return; }
          res.setHeader("Location", destination.pathname + destination.search + destination.hash);
        }
        const cookies = (response.headers["set-cookie"] ?? []).filter(c => !c.trimStart().toLowerCase().startsWith(cookieName.toLowerCase() + "=")).map(c => c.replace(/;\s*domain=[^;]*/ig, ""));
        if (cookies.length) res.setHeader("Set-Cookie", cookies);
        let bytes = 0;
        response.on("data", chunk => { bytes += chunk.length; if (bytes > 32_000_000) { response.destroy(); res.destroy(); } });
        response.on("error", () => res.destroy()); response.pipe(res);
      });
      request.setTimeout(cli ? 75_000 : 30_000, () => request.destroy());
      request.on("error", () => { if (!res.headersSent) deny(502); else res.destroy(); });
      res.once("close", () => request.destroy());
      request.end(body);
    } catch { if (!res.headersSent) deny(); else res.destroy(); }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); server.close(); for (const socket of sockets) socket.destroy(); sessions.clear(); used.clear(); };
  const timer = setTimeout(close, Math.max(1, Date.parse(expiresAt) - clock())); timer.unref();
  return { localUrl: `http://127.0.0.1:${server.address().port}/`, close,
    async authorizeCli() {
      if (!cli || closed || clock() >= Date.parse(expiresAt)) return false;
      for (const session of sessions.values()) if (clock() - (session.seenAt ?? 0) < 120_000 && await allowed(session)) return true;
      return false;
    },
    setOrigin(value) { const checked = previewOrigin(value); if (!checked || origin && origin !== checked) throw new Error("invalid_preview_origin"); origin = checked; } };
}

export function remoteFailure(code, stage, detail = {}) {
  return Object.assign(new Error(code), { code, stage, ...detail });
}
export function tunnelFailure(output, allocated, exitCode) {
  const stage = allocated ? "connection" : "provisioning";
  const code = /no such host|lookup .* (?:failed|timeout)|DNS resolver/i.test(output) ? "tunnel_dns_failed"
    : /x509:|certificate|TLS handshake/i.test(output) ? "tunnel_tls_failed"
    : /429|too many requests/i.test(output) ? "tunnel_rate_limited"
    : /timeout|deadline exceeded/i.test(output) ? "tunnel_timeout"
    : /connection refused|network is unreachable|no route to host/i.test(output) ? "tunnel_network_failed"
    : allocated ? "tunnel_connection_failed" : "tunnel_provision_failed";
  return remoteFailure(code, stage, Number.isInteger(exitCode) ? { exitCode } : {});
}

export async function startQuickTunnel({ binary, localUrl, directory, signal, launch = spawn, timeoutMs = 90_000 }) {
  if (signal?.aborted) throw new Error("preview_cancelled");
  const home = await mkdtemp(join(directory, "tunnel-"));
  const config = join(home, "config.yml");
  await writeFile(config, "{}\n", { mode: 0o600 });
  const proxyEnv = Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  let child;
  try { child = launch(binary, ["tunnel", "--config", config, "--no-autoupdate", "--protocol", "auto", "--url", localUrl, "--metrics", "127.0.0.1:0", "--grace-period", "1s"], {
    shell: false, cwd: home, env: { PATH: process.env.PATH, HOME: home, ...proxyEnv }, stdio: ["ignore", "pipe", "pipe"],
  }); } catch (error) { await rm(home, { recursive: true, force: true }); throw error; }
  let closed = false, exited = false, rejectStartup;
  const close = () => { if (closed) return; closed = true; runningTunnels.delete(close); child.kill("SIGTERM"); void rm(home, { recursive: true, force: true }).catch(() => {}); };
  const abort = () => { rejectStartup?.(remoteFailure("preview_cancelled", "connection")); close(); };
  runningTunnels.add(close);
  signal?.addEventListener("abort", abort, { once: true });
  if (!signalHandlers) {
    signalHandlers = true;
    process.once("exit", () => { for (const stop of runningTunnels) stop(); });
    process.once("SIGINT", () => process.exit(130));
    process.once("SIGTERM", () => process.exit(143));
  }
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "", allocated = null, connected = false, settled = false;
      const timer = setTimeout(() => finish(remoteFailure("tunnel_timeout", allocated ? "connection" : "provisioning")), timeoutMs);
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
      rejectStartup = finish;
      child.once("error", () => finish(remoteFailure("tunnel_executable_unavailable", "provisioning")));
      child.once("exit", code => { exited = true; finish(tunnelFailure(output, !!allocated, code)); close(); });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
        output = (output + bytes.toString()).slice(-16_000);
        const value = output.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=[\s|]|$)/)?.[0];
        if (value && previewOrigin(value + "/")) allocated = value + "/";
        if (/Registered tunnel connection/.test(output)) connected = true;
        // The banner only allocates a hostname. Edge registration can take longer
        // than the old 12-probe window, especially when a transport falls back.
        if (allocated && connected) finish(null, allocated);
      });
      if (signal?.aborted) abort();
    });
    return { url, close, onExit(fn) { if (exited) queueMicrotask(fn); else child.once("exit", fn); } };
  } catch (error) { close(); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}

export async function waitForRemoteHealth({ url, remoteId, signal, transport = fetch, clock = Date.now, delay = ms => sleep(ms, undefined, { signal }), timeoutMs = 90_000, alive = () => true }) {
  if (signal?.aborted) throw remoteFailure("preview_cancelled", "health");
  // Edge registration precedes DNS publication. An immediate NXDOMAIN can stay
  // cached on macOS for the whole probe window, even after the record exists.
  // Allow publication before the first lookup; retain a bounded retry window
  // for slower DNS/cache propagation instead of treating allocation as ready.
  await delay(5000);
  const until = clock() + timeoutMs;
  let statusCode, code = "remote_health_timeout";
  do {
    if (signal?.aborted) throw remoteFailure("preview_cancelled", "health");
    if (!alive()) throw remoteFailure("tunnel_connection_failed", "connection");
    try {
      const response = await transport(`${url}_jarvis/health`, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(5000, until - clock()))), ...(signal ? [signal] : [])]) });
      statusCode = response.status;
      // Ignore provider error pages; no remote content or headers enter reports.
      if (response.ok) {
        let body = "";
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              body += Buffer.from(part.value).toString();
              if (body.length > 1024) { await reader.cancel(); break; }
            }
          } finally { reader.releaseLock(); }
        } else body = (await response.text()).slice(0, 1024);
        if (body === remoteId) return;
        throw remoteFailure("remote_health_mismatch", "health", { statusCode });
      }
      await response.body?.cancel();
      code = statusCode === 403 ? "remote_health_denied" : "remote_health_http";
    } catch (error) {
      if (error.code === "remote_health_mismatch") throw error;
      if (/ENOTFOUND|EAI_AGAIN/.test(error.cause?.code ?? "")) code = "remote_health_dns";
    }
    if (clock() < until) await delay(Math.min(1000, until - clock()));
  } while (clock() < until);
  throw remoteFailure(code, "health", Number.isInteger(statusCode) ? { statusCode } : {});
}

export async function publishRemotePreview({ local, appOrigin, client, scope, binary, directory, attachCleanup, attachCliAuthorization, signal, transport = fetch, tunnel = startQuickTunnel }) {
  const remoteId = randomUUID();
  let config;
  try { config = await client.request("/api/preview/config"); }
  catch (error) { throw remoteFailure(error.code === "preview_unconfigured" ? "preview_unconfigured" : "preview_config_unavailable", "configuration"); }
  if (config.version !== 1 || typeof config.publicKey !== "string") throw remoteFailure("preview_unconfigured", "configuration");
  let remote, gateway;
  const cancel = () => { remote?.close(); gateway?.close(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw new Error("preview_cancelled");
    gateway = await createRemoteGate({ localUrl: local.url, appOrigin, publicKey: config.publicKey, remoteId, scope, sha: local.sha, expiresAt: local.expiresAt, cli: !!local.ai,
      checkAccess: async deviceId => (await client.request("/api/preview/access", { ...scope, remoteId, url: remote.url, sha: local.sha, deviceId })).allowed === true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { remote = await tunnel({ binary, localUrl: gateway.localUrl, directory, signal }); break; }
      catch (error) {
        if (attempt || signal?.aborted || error.stage !== "provisioning" || !["tunnel_timeout", "tunnel_network_failed", "tunnel_provision_failed"].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    gateway.setOrigin(remote.url);
    if (local.ai && !attachCliAuthorization?.(local.url, () => gateway.authorizeCli())) throw remoteFailure("preview_cli_unavailable", "ai");
    let alive = true;
    remote.onExit(() => { alive = false; gateway.close(); });
    const close = () => { remote.close(); gateway.close(); clearTimeout(timer); };
    const timer = setTimeout(close, Math.max(1, Date.parse(local.expiresAt) - Date.now())); timer.unref();
    if (!attachCleanup(local.url, close)) { close(); throw new Error("preview_bridge_missing"); }
    try { await waitForRemoteHealth({ url: remote.url, remoteId, transport, signal, alive: () => alive }); }
    catch (error) { close(); throw error; }
    return { ...local, kind: "remote", remoteId, url: remote.url,
      message: local.ai ? "이 PC에서 열 수 있습니다. 맥미니의 구독 CLI로 실제 번역 응답을 확인했습니다. 앱은 별도 임시 데이터로 실행하며, 요청마다 구독 사용량이 소모됩니다."
        : "이 PC에서 열 수 있습니다. 승인된 Jarvis 기기에서만 접근하며, 맥미니가 켜져 있어야 합니다. 별도 임시 데이터로 화면·기본 기능을 확인하며, 실제 AI·외부 서비스는 연결되지 않습니다." };
  } catch (error) { cancel(); throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
}
