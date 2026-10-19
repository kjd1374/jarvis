// Disposable web previews. No model, host credentials, or business data enter containers.
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, realpath, copyFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { previewCliQueueSource, previewCliProfile, startPreviewCliWorker } from "./jarvis-preview-cli.mjs";

const IMAGE = "node:24.19.0-bookworm-slim";
const TTL = 2 * 60 * 60_000;
// A request/commit can outlive a runner update. Reuse only containers built by
// this exact runtime so older static/server recipes cannot survive a retry.
const RUNTIME_ID = createHash("sha256").update(await readFile(new URL(import.meta.url))).update(await readFile(new URL("./jarvis-preview-cli.mjs", import.meta.url))).digest("hex").slice(0, 24);
const bridges = new Map();
export function attachPreviewCleanup(url, cleanup) {
  const bridge = [...bridges.values()].find(item => item.url === url);
  if (!bridge) return false;
  bridge.cleanups.add(cleanup); return true;
}
export function attachPreviewCliAuthorization(url, authorize) {
  const bridge = [...bridges.values()].find(item => item.url === url);
  if (!bridge?.cliWorker) return false;
  bridge.cliWorker.setAuthorization(authorize); return true;
}
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
  const cleanups = new Set();
  const close = () => { clearTimeout(timer); server.close(); for (const socket of sockets) socket.destroy(); bridges.delete(name); for (const cleanup of cleanups) cleanup(); cleanups.clear(); };
  const timer = setTimeout(close, Math.max(1, Date.parse(expiresAt) - Date.now())); timer.unref();
  const bridge = { url: `http://127.0.0.1:${server.address().port}/`, close, cleanups };
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
    !/(^|\/)(?:AGENTS\.md|node_modules|vendor|dist|build|coverage|uploads?|conversations?|transcripts?|customers?|backups?|fixtures?|seeds?|logs?|test-results|playwright-report)(\/|$)/i.test(path) &&
    (!/(^|\/)data(\/|$)/i.test(path) || /^src\/data\/.+\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) &&
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
    return { kind: "node", start, install: !!lock, build: typeof pkg.scripts.build === "string", ...(start[0] === "run" ? { vite: true } : {}) };
  }
  // Dependency-free Node projects do not need an npm manifest. Their public
  // folder is the server's frontend, not proof that the app is a static site.
  const entry = ["server.js", "server.mjs", "server.cjs"].find(path => files.includes(path));
  if (entry) return { kind: "node", entry, install: false, build: false };
  const root = files.includes("index.html") ? "." : files.includes("public/index.html") ? "public" : null;
  return root ? { kind: "static", root, install: false, build: false } : null;
}
async function copyProject(cwd, files, app) {
  await mkdir(app, { recursive: true, mode: 0o700 });
  const source = await realpath(cwd), copied = [];
  let total = 0;
  if (files.length > 15_000) throw new Error("project_too_large");
  for (const path of files) {
    if (!previewFile(path)) continue;
    const from = join(cwd, path), info = await lstat(from).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink() || !(await realpath(from)).startsWith(source + "/")) continue;
    total += info.size;
    if (info.size > 10_000_000 || total > 100_000_000) throw new Error("project_too_large");
    const dest = join(app, path); await mkdir(dirname(dest), { recursive: true }); await copyFile(from, dest); copied.push(path);
  }
  return copied;
}
export function projectTestPlan(files, pkg, lock) {
  const scripts = pkg?.scripts ?? {};
  const names = ["test", "lint", "typecheck"].filter(name => typeof scripts[name] === "string" && scripts[name].trim());
  const commands = names.map(name => ({ name: `npm run ${name}`, args: ["npm", "run", name, "--ignore-scripts"] }));
  if (!commands.length && typeof scripts.check === "string" && scripts.check.trim()) commands.push({ name: "npm run check", args: ["npm", "run", "check", "--ignore-scripts"] });
  if (!commands.length && files.some(path => /(?:\.test|\.spec)\.(?:mjs|cjs|js)$/.test(path))) commands.push({ name: "node --test", args: ["node", "--test", ...files.filter(path => /(?:\.test|\.spec)\.(?:mjs|cjs|js)$/.test(path)).map(path => `./${path}`)] });
  if (!commands.length) return { reason: "자동 검증 명령이 없습니다. Jarvis 수정 요청으로 테스트를 추가한 뒤 다시 실행해주세요." };
  if (commands.some(c => c.args.length > 2048)) return { reason: "테스트 파일 한도를 넘었습니다. 저장소의 test 스크립트로 실행 범위를 정해주세요." };
  if (Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).length && !lock) return { reason: "의존성 잠금 파일이 없어 실행하지 않았습니다. Jarvis 수정 요청으로 실행 조건을 준비해주세요." };
  if (lock && (!lock.packages || Object.values(lock.packages).some(p => !p || p.link || p.resolved && (!/^https:\/\/registry\.npmjs\.org\//.test(p.resolved) || !p.integrity)))) return { reason: "공개 npm 잠금 파일만 자동 설치할 수 있습니다." };
  return { commands, install: !!lock };
}
export async function runProjectTests({ cwd, files, stateDir, identity, run, signal, redact = value => value }) {
  const key = createHash("sha256").update(`${identity}:${randomUUID()}`).digest("hex").slice(0, 24);
  const name = `jarvis-test-${key}`, image = `${name}:app`, directory = join(stateDir, name), app = join(directory, "app");
  const checks = [], omitted = detail => [{ name: "자동 테스트", status: "not_run", detail }];
  const docker = (args, timeout = 30_000, cleanup = false) => run("docker", args, { signal: cleanup ? undefined : signal, timeout, maxBytes: 2_000_000 });
  try {
    if ((await docker(["version", "--format", "{{.Server.Version}}"])).code !== 0) return omitted("실행 서버의 Docker가 응답하지 않습니다. 테스트는 실행되지 않았습니다.");
    await rm(directory, { recursive: true, force: true });
    const copied = await copyProject(cwd, files, app);
    const json = async path => JSON.parse(await readFile(join(app, path), "utf8").catch(() => "null"));
    const plan = projectTestPlan(copied, await json("package.json"), await json("package-lock.json"));
    if (plan.reason) return omitted(plan.reason);
    // PID 1 bounds execution even if the host runner disappears mid-command.
    await writeFile(join(directory, "test-exec.mjs"), "import {spawn} from 'node:child_process';\nconst [bin,...args]=process.argv.slice(2);\nconst child=spawn(bin,args,{stdio:'inherit'});\nchild.on('error',()=>process.exit(127));child.on('exit',code=>process.exit(Number.isInteger(code)?code:1));\nsetTimeout(()=>process.exit(124),285000);\n");
    await writeFile(join(directory, "Dockerfile"), [
      `FROM ${IMAGE}`, "WORKDIR /app", "COPY app/ /app/",
      ...(plan.install ? ["RUN npm ci --ignore-scripts --no-audit --no-fund"] : []),
      "COPY test-exec.mjs /runtime/test-exec.mjs", "RUN chown -R node:node /app && chmod -R a+rX /runtime", "USER node", "",
    ].join("\n"));
    const built = await docker(["build", "--pull", "--tag", image, directory], 300_000);
    if (built.code !== 0) return omitted("격리 테스트 환경 준비에 실패했습니다. 설치 조건·잠금 파일을 확인해야 합니다. 테스트는 실행되지 않았습니다.");
    for (const command of plan.commands) {
      if (signal?.aborted) throw new Error("test_cancelled");
      const result = await docker(["run", "--rm", "--name", name, "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--memory", "1g", "--cpus", "1", "--pids-limit", "128", "--env", "CI=true", "--env", "HOME=/tmp", "--env", "NEXT_TELEMETRY_DISABLED=1", image, "node", "/runtime/test-exec.mjs", ...command.args], 300_000);
      const output = `${result.out ?? ""}\n${result.err ?? ""}`;
      const empty = /(?:^|\n)\s*(?:# |ℹ )?(?:tests\s+0\b|1\.\.0\b)|No tests (?:found|specified)/im.test(output);
      const detail = redact(output.replace(/\x1b\[[0-9;]*m/g, "")).slice(-1600);
      checks.push({ name: command.name, status: empty ? "not_run" : result.code === 0 ? "passed" : "failed", detail: `격리 실행 · 종료 코드 ${result.code ?? "없음"}${empty ? " · 실행한 테스트 없음" : ""}\n${detail}` });
      await docker(["rm", "-f", name], 30_000, true).catch(() => {});
    }
    return checks;
  } catch {
    if (signal?.aborted) throw new Error("test_cancelled");
    return [...checks, { name: "자동 테스트", status: "not_run", detail: "테스트 실행을 완료하지 못했습니다. 시간·자원 한도 또는 실행 조건을 확인해주세요." }];
  } finally {
    await docker(["rm", "-f", name], 30_000, true).catch(() => {});
    await docker(["image", "rm", "--force", image], 30_000, true).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
// The relay permits loopback-only applications to run without changing their source.
// It is inside a network-disabled container; a host loopback bridge uses docker exec stdio.
export const previewServerSource = String.raw`
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, realpath, stat, cp, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { startCliQueue } from '/runtime/cli-queue.mjs';
const plan=JSON.parse(await readFile('/runtime/plan.json','utf8'));
const token=process.env.JARVIS_PREVIEW_ID;
const cli=plan.cli?startCliQueue(process.env.JARVIS_PREVIEW_CLI_TOKEN):null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
const root=resolve('/app',plan.root||'.');
let child;
if(plan.kind==='node') {
  // Standalone apps commonly initialize config/data beside __dirname. Run a
  // disposable copy in bounded tmpfs; the image and original checkout stay read-only.
  const cwd=plan.entry?'/tmp/jarvis-preview-app':'/app';
  if(plan.entry) await cp('/app',cwd,{recursive:true});
  if(plan.cli) await writeFile(cwd+'/config.json',await readFile('/runtime/cli-profile.json'));
  child=spawn(plan.entry?'node':'npm',plan.entry?[plan.entry]:plan.start,{cwd,env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NODE_ENV:'production',HOST:'127.0.0.1',HOSTNAME:'127.0.0.1',PORT:'3000',DATA_DIR:'/tmp/app-data',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
  child.on('error',()=>process.exit(1)); child.on('exit',()=>process.exit(1));
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const requestUrl=new URL(req.url,'http://preview');
  if(cli&&await cli.control(req,res))return;
  if(requestUrl.pathname.startsWith('/__jarvis_cli/')){res.statusCode=404;res.end();return;}
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
  // Treat an explicit top-level click to the preview's bare home URL like address-bar entry.
  // Keep fetch metadata intact for APIs, writes, frames, query actions and automatic navigation.
  if(req.method==='GET' && req.url==='/' && !req.headers.origin &&
    headers['sec-fetch-site']==='cross-site' && headers['sec-fetch-mode']==='navigate' &&
    headers['sec-fetch-dest']==='document' && headers['sec-fetch-user']==='?1') headers['sec-fetch-site']='none';
  delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];delete headers['x-forwarded-for'];
  const upstream=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers},response=>{
    const out={...response.headers};
    if(out.location?.startsWith('http://127.0.0.1:3000/'))out.location=out.location.slice('http://127.0.0.1:3000'.length);
    res.writeHead(response.statusCode,out);response.pipe(res);
  });upstream.on('error',()=>{if(!res.destroyed){if(!res.headersSent)res.writeHead(502);res.end('Preview starting');}});res.once('close',()=>upstream.destroy());req.pipe(upstream);
});
server.listen(3001,'0.0.0.0');
setTimeout(()=>process.exit(0),Number(process.env.JARVIS_PREVIEW_TTL)||7200000);
process.on('SIGTERM',()=>{child?.kill('SIGTERM');server.close(()=>process.exit(0));});
`;

function unavailable(sha, message, state = "unavailable", kind = "mac", diagnostic) {
  return { state, kind, url: null, sha, checkedAt: new Date().toISOString(), expiresAt: null, message, ...(diagnostic ? { diagnostic } : {}) };
}
export function previewFailure(sha, error, stage, remote = false) {
  const stages = ["docker", "build", "application", "configuration", "provisioning", "connection", "health", "module", "ai"];
  stage = stages.includes(error?.stage) ? error.stage : stage;
  const candidate = error?.code ?? error?.message;
  const code = /^[a-z_]{1,80}$/.test(candidate ?? "") ? candidate : "preview_failed";
  const diagnostic = { stage, code };
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) diagnostic.statusCode = error.statusCode;
  if (Number.isInteger(error?.exitCode) && error.exitCode >= 0 && error.exitCode <= 255) diagnostic.exitCode = error.exitCode;
  const messages = {
    docker: "실행 서버의 Docker에 연결하지 못했습니다. Docker가 실행 중인지 확인해주세요.",
    build: "미리보기 실행 환경을 만드는 단계에서 실패했습니다. 자동 테스트 결과와는 별개이며 코드·PR은 보존됩니다.",
    application: "미리보기 앱의 웹 응답을 확인하지 못했습니다. 원격 연결 전 앱 실행 단계에서 실패했습니다.",
    configuration: "Jarvis 서버에서 원격 미리보기 연결 설정을 받지 못했습니다. 실행기 재설치가 필요한 것으로 확인된 것은 아닙니다.",
    provisioning: "Cloudflare에서 임시 접속 주소를 발급받지 못했습니다. 연결 진단에 원인을 기록했습니다. 잠시 후 화면 준비를 다시 시도할 수 있습니다.",
    connection: "맥미니와 Cloudflare 사이의 연결을 완료하지 못했습니다. 연결 진단에 원인을 기록했습니다.",
    health: "임시 주소는 발급됐지만 외부에서 화면 연결을 확인하지 못했습니다. 연결 진단에 응답 상태를 기록했습니다.",
    module: "미리보기 실행 모듈을 불러오지 못했습니다. 실행기 설치 파일을 확인해야 합니다.",
    ai: "구독 CLI의 실제 응답을 확인하지 못했습니다. 연결 진단에 로그인·사용 한도·응답 상태를 기록했습니다. 준비 완료로 처리하지 않았습니다.",
  };
  const message = code === "preview_cli_config_unavailable"
    ? "이 앱은 구독 CLI 미리보기 연결을 지원하지 않습니다. CLI를 호출하기 전에 준비를 중단했습니다. 화면만 확인하려면 미리보기 AI를 ‘연결 안 함’으로 선택해주세요." : messages[stage];
  return unavailable(sha, message, "failed", remote ? "remote" : "mac", diagnostic);
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

export async function startMacPreview({ cwd, files, sha, stateDir, identity, group = identity, run, signal, transport = directProbe, bridge = createPreviewBridge, publish, cliInference, authorizeCliPreparation, delay = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!shaPattern.test(sha)) throw new Error("invalid_preview_sha");
  const docker = async (args, timeout = 30_000, cleanup = false) => {
    const result = await run("docker", args, { signal: cleanup ? undefined : signal, timeout, maxBytes: 2_000_000 });
    if (result.code !== 0) throw Object.assign(new Error("preview_command_failed"), { code: args[0] === "build" ? "preview_build_failed" : args[0] === "run" ? "preview_start_failed" : "preview_command_failed", exitCode: result.code });
    return result.out.trim();
  };
  try { await docker(["version", "--format", "{{.Server.Version}}"]); }
  catch (error) { return { ...previewFailure(sha, error, "docker", !!publish), state: "unavailable" }; }
  const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  const groupKey = createHash("sha256").update(group).digest("hex").slice(0, 24);
  const name = `jarvis-preview-${key}`, image = `${name}:app`;
  const directory = join(stateDir, name), app = join(directory, "app");
  const prepareCli = async (ready, info) => {
    if (!cliInference) return ready;
    const item = bridges.get(name), token = info.Config?.Env?.find(value => value.startsWith("JARVIS_PREVIEW_CLI_TOKEN="))?.slice("JARVIS_PREVIEW_CLI_TOKEN=".length);
    if (!item || !/^[a-f0-9-]{36}$/.test(token ?? "") || typeof authorizeCliPreparation !== "function") throw Object.assign(new Error("preview_cli_unavailable"), { code: "preview_cli_unavailable", stage: "ai" });
    await item.cliWorker?.close();
    const worker = startPreviewCliWorker({ url: ready.url, token, inference: cliInference, authorize: authorizeCliPreparation });
    item.cliWorker = worker; item.cleanups.add(worker.close);
    const stop = () => worker.close(); signal?.addEventListener("abort", stop, { once: true });
    try { const ai = await worker.probe(); worker.setAuthorization(async () => false); return { ...ready, ai }; }
    catch(error) { worker.close(); throw error; }
    finally { signal?.removeEventListener("abort", stop); }
  };
  let existing;
  try { existing = JSON.parse(await docker(["inspect", name]))[0]; } catch {}
  const probe = async (info) => {
    if (!info?.State?.Running || info.Config?.Labels?.["jarvis.preview.key"] !== key || info.Config.Labels["jarvis.preview.sha"] !== sha) return null;
    if (info.Config.Labels["jarvis.preview.runtime"] !== RUNTIME_ID) return null;
    if (info.Config.Labels["jarvis.preview.ai"] !== (cliInference ? "codex" : "none")) return null;
    const expiresAt = info.Config.Labels["jarvis.preview.expires"];
    if (!(Date.parse(expiresAt) > Date.now())) return null;
    const { url } = await bridge(name, expiresAt);
    const response = await transport(`${url}__jarvis_preview_health`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    if (!response.ok || await response.text() !== info.Config.Labels["jarvis.preview.id"]) return null;
    return { state: "ready", kind: "mac", url, sha, checkedAt: new Date().toISOString(), expiresAt,
      message: "실행한 맥미니에서 열 수 있습니다. 별도 임시 데이터로 실행하며 실제 AI·외부 서비스는 연결하지 않습니다." };
  };
  if (existing) {
    let ready;
    try { ready = await probe(existing); } catch {}
    if (ready) {
      try { ready = await prepareCli(ready, existing); return publish ? await publish(ready) : ready; }
      catch (error) { bridges.get(name)?.cliWorker?.close(); return previewFailure(sha, error, "connection", !!publish); }
    }
    // Only a container bearing our exact request/commit labels may be replaced.
    if (existing.Config?.Labels?.["jarvis.preview.key"] !== key) return unavailable(sha, "같은 이름의 실행 환경이 있어 미리보기를 시작하지 못했습니다.", "failed");
    try { bridges.get(name)?.close(); await docker(["rm", "-f", name]); } catch { return unavailable(sha, "이전 미리보기를 종료하지 못했습니다.", "failed"); }
  }
  const old = [];
  let stage = "build";
  try {
    const ids = (await docker(["ps", "--quiet", "--filter", "label=jarvis.preview.key"])).split("\n").filter(v => /^[a-f0-9]{12,64}$/.test(v));
    const all = ids.length ? JSON.parse(await docker(["inspect", ...ids])) : [];
    for (const item of all) {
      const otherKey = item.Config?.Labels?.["jarvis.preview.key"], otherName = item.Name?.replace(/^\//, "");
      if (/^[a-f0-9]{24}$/.test(otherKey ?? "") && otherName === `jarvis-preview-${otherKey}` && otherName !== name && item.Config.Labels["jarvis.preview.group"] === groupKey) old.push(otherName);
    }
    if (all.length - old.length >= 3) return unavailable(sha, "다른 프로젝트의 미리보기 3개가 실행 중입니다. 만료 후 다시 준비해주세요.");
    await rm(directory, { recursive: true, force: true });
    const copied = await copyProject(cwd, files, app);
    const json = async path => JSON.parse(await readFile(join(app, path), "utf8").catch(() => "null"));
    const plan = previewPlan(copied, await json("package.json"), await json("package-lock.json"));
    if (!plan) return unavailable(sha, "자동 실행 방법을 확인하지 못했습니다. 정적 index.html, 단독 Node server.js/server.mjs/server.cjs 또는 npm start와 공개 npm 잠금 파일을 지원합니다. Jarvis 수정 요청으로 실행 조건을 준비할 수 있습니다.");
    let cliProfile = null;
    if (cliInference) {
      if (!plan.entry) throw Object.assign(new Error("preview_cli_config_unavailable"), { code: "preview_cli_config_unavailable", stage: "ai" });
      cliProfile = previewCliProfile(await json("config.example.json")); plan.cli = true;
    }
    await writeFile(join(directory, "server.mjs"), previewServerSource);
    await writeFile(join(directory, "bridge.mjs"), bridgeSource);
    await writeFile(join(directory, "plan.json"), JSON.stringify(plan));
    await writeFile(join(directory, "cli-queue.mjs"), previewCliQueueSource);
    await writeFile(join(directory, "cli-profile.json"), JSON.stringify(cliProfile));
    await writeFile(join(directory, "Dockerfile"), [
      `FROM ${IMAGE}`, "WORKDIR /app", "COPY app/ /app/",
      ...(plan.install ? ["RUN npm ci --ignore-scripts --no-audit --no-fund"] : []),
      ...(plan.build ? ["RUN --network=none npm run build --ignore-scripts"] : []),
      "COPY server.mjs bridge.mjs plan.json cli-queue.mjs cli-profile.json /runtime/", "RUN chmod -R a+rX /app /runtime", "USER node", 'CMD ["node", "/runtime/server.mjs"]', "",
    ].join("\n"));
    // Only this sanitized context is uploaded to Docker, never the checkout or home directory.
    await docker(["build", "--pull", "--tag", image, directory], 300_000);
    stage = "application";
    const expiresAt = new Date(Date.now() + TTL).toISOString(), token = randomUUID(), cliToken = randomUUID();
    await docker(["run", "--detach", "--rm", "--name", name, "--label", `jarvis.preview.key=${key}`, "--label", `jarvis.preview.sha=${sha}`,
      "--label", `jarvis.preview.runtime=${RUNTIME_ID}`,
      "--label", `jarvis.preview.ai=${cliInference ? "codex" : "none"}`,
      "--label", `jarvis.preview.group=${groupKey}`, "--label", `jarvis.preview.expires=${expiresAt}`, "--label", `jarvis.preview.id=${token}`,
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--memory", "1g", "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
      ...(plan.vite ? ["--tmpfs", "/app/node_modules/.vite-temp:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000"] : []),
      "--env", `JARVIS_PREVIEW_ID=${token}`, "--env", `JARVIS_PREVIEW_TTL=${TTL}`, ...(cliInference ? ["--env", `JARVIS_PREVIEW_CLI_TOKEN=${cliToken}`] : []), image]);
    for (let attempt = 0; attempt < 45; attempt++) {
      if (signal?.aborted) throw new Error("preview_cancelled");
      let ready;
      try { ready = await probe(JSON.parse(await docker(["inspect", name]))[0]); } catch {}
      if (ready) {
        stage = "ai";
        ready = await prepareCli(ready, JSON.parse(await docker(["inspect", name]))[0]);
        // Retain the previous screen until the new authenticated HTTPS path works.
        stage = "connection";
        const published = publish ? await publish(ready) : ready;
        for (const previous of old) { bridges.get(previous)?.close(); await docker(["rm", "-f", previous], 30_000, true).catch(() => {}); }
        return published;
      }
      await delay(1000);
    }
    throw new Error("preview_not_ready");
  } catch (error) {
    bridges.get(name)?.close();
    await docker(["rm", "-f", name], 30_000, true).catch(() => {});
    return previewFailure(sha, error, stage, !!publish);
  } finally {
    await rm(directory, { recursive: true, force: true });
    // The running container retains its image layers. Avoid accumulating per-request build tags.
    await docker(["image", "rm", "--force", image], 30_000, true).catch(() => {});
  }
}
