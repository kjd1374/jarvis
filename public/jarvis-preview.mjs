// Disposable web previews. No model, host credentials, or business data enter containers.
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, realpath, copyFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const IMAGE = "node:24.19.0-bookworm-slim";
const TTL = 2 * 60 * 60_000;
const bridges = new Map();
export function directProbe(url, { signal } = {}) {
  return new Promise((resolveResult, reject) => {
    const request = http.get(url, { signal }, response => {
      let body = "";
      response.on("data", b => { body += b; if (body.length > 4096) request.destroy(new Error("probe_too_large")); });
      response.on("end", () => resolveResult({ ok: response.statusCode === 200, text: async () => body }));
      response.on("error", reject);
    });
    request.setTimeout(3000, () => request.destroy(new Error("probe_timeout"))); request.on("error", reject);
  });
}
export async function createPreviewBridge(name, expiresAt) {
  if (bridges.has(name)) return bridges.get(name);
  if (!/^jarvis-preview-[a-f0-9]{24}$/.test(name)) throw new Error("invalid_preview_name");
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 24) { socket.destroy(); return; }
    sockets.add(socket); socket.setTimeout(60_000, () => socket.destroy());
    const child = spawn("docker", ["exec", "-i", name, "node", "/runtime/bridge.mjs"], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
    child.on("error", () => socket.destroy()); child.on("exit", () => socket.destroy());
    child.stdin.on("error", () => socket.destroy()); socket.on("error", () => child.kill());
    socket.on("close", () => { sockets.delete(socket); child.kill(); });
    socket.pipe(child.stdin); child.stdout.pipe(socket);
  });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
  server.unref();
  const close = () => { clearTimeout(timer); server.close(); for (const socket of sockets) socket.destroy(); bridges.delete(name); };
  const timer = setTimeout(close, Math.max(1, Date.parse(expiresAt) - Date.now())); timer.unref();
  const bridge = { url: `http://127.0.0.1:${server.address().port}/`, close };
  bridges.set(name, bridge); return bridge;
}
const bridgeSource = `import net from 'node:net';
const socket=net.connect(3001,'127.0.0.1');
process.stdin.pipe(socket);socket.pipe(process.stdout);
socket.on('error',()=>process.exit(1));socket.on('close',()=>process.exit(0));
process.stdin.on('error',()=>process.exit(1));`;
const shaPattern = /^[a-f0-9]{40,64}$/;
export function previewFile(path) {
  return typeof path === "string" && path.length <= 450 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".")) &&
    !/(^|\/)(?:AGENTS\.md|node_modules|vendor|dist|build|coverage|uploads?|conversations?|transcripts?|customers?|backups?|data|fixtures?|seeds?|logs?|test-results|playwright-report)(\/|$)/i.test(path) &&
    !/(?:^|\/)(?:[^/]*\.)?env(?:\.|$)|secret|credential|auth\.json|(?:token|password)[^/]*\.(?:json|txt|ya?ml)|\.(?:pem|key|p12|csv|sqlite|db)$/i.test(path);
}
export function previewPlan(files, pkg, lock) {
  if (pkg) {
    const start = typeof pkg.scripts?.start === "string" ? ["start", "--ignore-scripts"]
      : typeof pkg.scripts?.preview === "string" && /\bvite\b/.test(pkg.scripts.preview) ? ["run", "preview", "--ignore-scripts", "--", "--host", "127.0.0.1", "--port", "3000", "--strictPort"] : null;
    if (!start) return null;
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (dependencies.length && !lock) return null;
    if (lock && (!lock.packages || Object.values(lock.packages).some(p => p.link || p.resolved &&
      (!/^https:\/\/registry\.npmjs\.org\//.test(p.resolved) || !p.integrity)))) return null;
    return { kind: "node", start, install: !!lock, build: typeof pkg.scripts.build === "string" };
  }
  const root = files.includes("index.html") ? "." : files.includes("public/index.html") ? "public" : null;
  return root ? { kind: "static", root, install: false, build: false } : null;
}
// The relay permits loopback-only applications to run without changing their source.
// It is inside a network-disabled container; a host loopback bridge uses docker exec stdio.
export const previewServerSource = String.raw`
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const plan=JSON.parse(await readFile('/runtime/plan.json','utf8'));
const token=process.env.JARVIS_PREVIEW_ID;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
const root=resolve('/app',plan.root||'.');
let child;
if(plan.kind==='node') {
  child=spawn('npm',plan.start,{cwd:'/app',env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NODE_ENV:'production',HOST:'127.0.0.1',HOSTNAME:'127.0.0.1',PORT:'3000',DATA_DIR:'/tmp/app-data',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
  child.on('error',()=>process.exit(1)); child.on('exit',()=>process.exit(1));
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const requestUrl=new URL(req.url,'http://preview');
  if(requestUrl.pathname==='/__jarvis_preview_health') {
    if(plan.kind==='static'){res.end(token);return;}
    const check=http.get('http://127.0.0.1:3000/',response=>{
      const valid=response.statusCode>=200&&response.statusCode<400 && (response.statusCode>=300 || /text\/html/i.test(response.headers['content-type']||''));
      response.resume(); res.statusCode=valid?200:503;res.end(valid?token:'not_ready');
    }); check.setTimeout(2000,()=>check.destroy());check.on('error',()=>{res.statusCode=503;res.end('not_ready');});return;
  }
  if(plan.kind==='static') {
    try {
      const path=decodeURIComponent(requestUrl.pathname);
      if(path.split('/').some(p=>p.startsWith('.')||p==='..'))throw Error();
      let file=await realpath(resolve(root,'.'+path));
      if((await stat(file)).isDirectory())file=await realpath(resolve(file,'index.html'));
      if(!file.startsWith(root+'/'))throw Error();
      res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
    }catch{res.statusCode=404;res.end('Not found');}return;
  }
  const headers={...req.headers,host:'127.0.0.1:3000'};
  if(headers.origin){
    if(headers.origin!=='http://'+req.headers.host){res.statusCode=403;res.end();return;}
    headers.origin='http://127.0.0.1:3000';
  }
  delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];delete headers['x-forwarded-for'];
  const upstream=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers},response=>{
    const out={...response.headers};
    if(out.location?.startsWith('http://127.0.0.1:3000/'))out.location=out.location.slice('http://127.0.0.1:3000'.length);
    res.writeHead(response.statusCode,out);response.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Preview starting');});req.pipe(upstream);
});
server.listen(3001,'0.0.0.0');
setTimeout(()=>process.exit(0),Number(process.env.JARVIS_PREVIEW_TTL)||7200000);
process.on('SIGTERM',()=>{child?.kill('SIGTERM');server.close(()=>process.exit(0));});
`;

function unavailable(sha, message, state = "unavailable") {
  return { state, kind: "mac", url: null, sha, checkedAt: new Date().toISOString(), expiresAt: null, message };
}
export async function findDeploymentPreview(repository, sha, get, publicUrl) {
  if (!shaPattern.test(sha)) return null;
  try {
    const entries = await get(`repos/${repository}/deployments?sha=${sha}&per_page=100`);
    const candidates = (Array.isArray(entries) ? entries : []).filter(d => d.sha === sha)
      .sort((a, b) => Number(!!b.production_environment) - Number(!!a.production_environment));
    for (const entry of candidates.slice(0, 10)) {
      const status = (await get(`repos/${repository}/deployments/${entry.id}/statuses?per_page=1`))[0];
      const url = publicUrl(status?.environment_url);
      if (status?.state === "success" && url) return { state: "ready", kind: "deployment", url, sha,
        checkedAt: new Date().toISOString(), expiresAt: null, message: "GitHub에서 이 커밋의 성공한 배포를 확인했습니다." };
    }
  } catch { /* Missing deployment permission does not discard successful code work. */ }
  return null;
}

export async function startMacPreview({ cwd, files, sha, stateDir, identity, group = identity, run, signal, transport = directProbe, bridge = createPreviewBridge, delay = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!shaPattern.test(sha)) throw new Error("invalid_preview_sha");
  const docker = async (args, timeout = 30_000, cleanup = false) => {
    const result = await run("docker", args, { signal: cleanup ? undefined : signal, timeout, maxBytes: 2_000_000 });
    if (result.code !== 0) throw new Error("preview_command_failed");
    return result.out.trim();
  };
  try { await docker(["version", "--format", "{{.Server.Version}}"]); }
  catch { return unavailable(sha, "맥미니에서 Docker Desktop 또는 호환 엔진을 실행한 뒤 화면 준비를 다시 눌러주세요."); }
  const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  const groupKey = createHash("sha256").update(group).digest("hex").slice(0, 24);
  const name = `jarvis-preview-${key}`, image = `${name}:app`;
  const directory = join(stateDir, name), app = join(directory, "app");
  let existing;
  try { existing = JSON.parse(await docker(["inspect", name]))[0]; } catch {}
  const probe = async (info) => {
    if (!info?.State?.Running || info.Config?.Labels?.["jarvis.preview.key"] !== key || info.Config.Labels["jarvis.preview.sha"] !== sha) return null;
    const expiresAt = info.Config.Labels["jarvis.preview.expires"];
    if (!(Date.parse(expiresAt) > Date.now())) return null;
    const { url } = await bridge(name, expiresAt);
    const response = await transport(`${url}__jarvis_preview_health`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    if (!response.ok || await response.text() !== info.Config.Labels["jarvis.preview.id"]) return null;
    return { state: "ready", kind: "mac", url, sha, checkedAt: new Date().toISOString(), expiresAt,
      message: "실행한 맥미니에서 열 수 있습니다. 별도 임시 데이터로 실행하며 실제 AI·외부 서비스는 연결하지 않습니다." };
  };
  if (existing) {
    try { const ready = await probe(existing); if (ready) return ready; } catch {}
    // Only a container bearing our exact request/commit labels may be replaced.
    if (existing.Config?.Labels?.["jarvis.preview.key"] !== key) return unavailable(sha, "같은 이름의 실행 환경이 있어 미리보기를 시작하지 못했습니다.", "failed");
    try { bridges.get(name)?.close(); await docker(["rm", "-f", name]); } catch { return unavailable(sha, "이전 미리보기를 종료하지 못했습니다.", "failed"); }
  }
  const old = [];
  try {
    const ids = (await docker(["ps", "--quiet", "--filter", "label=jarvis.preview.key"])).split("\n").filter(v => /^[a-f0-9]{12,64}$/.test(v));
    const all = ids.length ? JSON.parse(await docker(["inspect", ...ids])) : [];
    for (const item of all) {
      const otherKey = item.Config?.Labels?.["jarvis.preview.key"], otherName = item.Name?.replace(/^\//, "");
      if (/^[a-f0-9]{24}$/.test(otherKey ?? "") && otherName === `jarvis-preview-${otherKey}` && otherName !== name && item.Config.Labels["jarvis.preview.group"] === groupKey) old.push(otherName);
    }
    if (all.length - old.length >= 3) return unavailable(sha, "다른 프로젝트의 미리보기 3개가 실행 중입니다. 만료 후 다시 준비해주세요.");
    await rm(directory, { recursive: true, force: true });
    await mkdir(app, { recursive: true, mode: 0o700 });
    const source = await realpath(cwd);
    let total = 0;
    const copied = [];
    if (files.length > 15_000) return unavailable(sha, "자동 미리보기 파일 한도를 넘었습니다.");
    for (const path of files) {
      if (!previewFile(path)) continue;
      const from = join(cwd, path), info = await lstat(from).catch(() => null);
      if (!info || !info.isFile() || info.isSymbolicLink() || !(await realpath(from)).startsWith(source + "/")) continue;
      total += info.size;
      if (info.size > 10_000_000 || total > 100_000_000) return unavailable(sha, "자동 미리보기 크기 한도를 넘었습니다.");
      const dest = join(app, path); await mkdir(dirname(dest), { recursive: true }); await copyFile(from, dest); copied.push(path);
    }
    const json = async path => JSON.parse(await readFile(join(app, path), "utf8").catch(() => "null"));
    const plan = previewPlan(copied, await json("package.json"), await json("package-lock.json"));
    if (!plan) return unavailable(sha, "자동 실행 방법을 확인하지 못했습니다. 정적 index.html 또는 npm start와 공개 npm 잠금 파일을 준비하거나 기존 웹 배포를 연결해주세요.");
    await writeFile(join(directory, "server.mjs"), previewServerSource);
    await writeFile(join(directory, "bridge.mjs"), bridgeSource);
    await writeFile(join(directory, "plan.json"), JSON.stringify(plan));
    await writeFile(join(directory, "Dockerfile"), [
      `FROM ${IMAGE}`, "WORKDIR /app", "COPY app/ /app/",
      ...(plan.install ? ["RUN npm ci --ignore-scripts --no-audit --no-fund"] : []),
      ...(plan.build ? ["RUN --network=none npm run build --ignore-scripts"] : []),
      "COPY server.mjs bridge.mjs plan.json /runtime/", "RUN chmod -R a+rX /app /runtime", "USER node", 'CMD ["node", "/runtime/server.mjs"]', "",
    ].join("\n"));
    // Only this sanitized context is uploaded to Docker, never the checkout or home directory.
    await docker(["build", "--pull", "--tag", image, directory], 300_000);
    const expiresAt = new Date(Date.now() + TTL).toISOString(), token = randomUUID();
    await docker(["run", "--detach", "--rm", "--name", name, "--label", `jarvis.preview.key=${key}`, "--label", `jarvis.preview.sha=${sha}`,
      "--label", `jarvis.preview.group=${groupKey}`, "--label", `jarvis.preview.expires=${expiresAt}`, "--label", `jarvis.preview.id=${token}`,
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--memory", "1g", "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
      "--env", `JARVIS_PREVIEW_ID=${token}`, "--env", `JARVIS_PREVIEW_TTL=${TTL}`, image]);
    for (let attempt = 0; attempt < 45; attempt++) {
      if (signal?.aborted) throw new Error("preview_cancelled");
      try {
        const ready = await probe(JSON.parse(await docker(["inspect", name]))[0]);
        if (ready) {
          for (const previous of old) { bridges.get(previous)?.close(); await docker(["rm", "-f", previous], 30_000, true).catch(() => {}); }
          return ready;
        }
      } catch {}
      await delay(1000);
    }
    throw new Error("preview_not_ready");
  } catch {
    bridges.get(name)?.close();
    await docker(["rm", "-f", name], 30_000, true).catch(() => {});
    return unavailable(sha, "미리보기 실행 또는 응답 확인에 실패했습니다. 코드·PR 결과는 보존됩니다. 맥미니 실행 환경을 확인한 뒤 다시 준비해주세요.", "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
    // The running container retains its image layers. Avoid accumulating per-request build tags.
    await docker(["image", "rm", "--force", image], 30_000, true).catch(() => {});
  }
}
