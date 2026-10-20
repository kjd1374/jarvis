import { runAutopilotLifecycle } from "./autopilot-lifecycle.mjs";
import { runPlanningLifecycle } from "./planning-lifecycle.mjs";
// Connected browser -> real private storage -> runner -> Git -> Docker -> TLS
// -> signed viewer ticket -> app persistence. External CLI/provider data is synthetic.
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { createAppClient, executeProjectWork, runCommand, VERSION } from "../../public/jarvis-runner.mjs";
import * as preview from "../../public/jarvis-preview.mjs";
import { lifecycleRemote } from "./lifecycle-network.mjs";

export async function runProjectLifecycle({ base, api, account, sql, users, network, recordCheck }) {
  assert.equal(base, "http://127.0.0.1:4317");
  const directory = await mkdtemp(join(tmpdir(), "jarvis-project-lifecycle-"));
  const seed = join(directory, "seed"), bare = join(directory, "remote.git"), space = "personal", repository = "example/lifecycle-fixture";
  let browser, page, gitServer, bridge, container, modelCalls = 0;
  const nativeFetch = globalThis.fetch, unexpected = [];
  const snapshot = async () => { const result = await api(`/api/workspace?space=${space}`, account.token); assert.equal(result.status, 200); return result.body; };
  const git = args => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: seed,
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const approve = async status => {
    assert.match(status.pairingCode, /^[A-F0-9]{12}$/);
    const deviceId = sql(`select user_id from public.jarvis_devices where request_code='${status.pairingCode}'`);
    assert.match(deviceId, /^[a-f0-9-]{36}$/); users.push(deviceId);
    sql(`update public.jarvis_devices set approved_at=now() where user_id='${deviceId}'`); return deviceId;
  };
  try {
    await mkdir(join(seed, "src/data"), { recursive: true }); await mkdir(join(seed, "data"));
    await writeFile(join(seed, ".env"), "SYNTHETIC_SECRET=must-be-absent");
    await writeFile(join(seed, "data/records.json"), '{"count":999}');
    await writeFile(join(seed, "src/data/label.mjs"), 'export const label="Connected lifecycle ready";');
    await writeFile(join(seed, "server.mjs"), `import http from 'node:http';import fs from 'node:fs';import {label} from './src/data/label.mjs';
if(fs.existsSync('.env'))throw Error('secret copied');
const path='data/records.json';
http.createServer((req,res)=>{
 if(req.url==='/api/count'){let value=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):{count:0};if(req.method==='POST'){value.count++;fs.mkdirSync('data',{recursive:true});fs.writeFileSync(path,JSON.stringify(value));}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;}
 res.setHeader('Content-Type','text/html');res.end('<h1>'+label+'</h1><button>Save temporary record</button><output></output><script>async function load(){document.querySelector("output").textContent=(await(await fetch("/api/count")).json()).count}document.querySelector("button").onclick=async()=>{await fetch("/api/count",{method:"POST"});await load()};load()</script>');
}).listen(Number(process.env.PORT),process.env.HOST);`);
    git(["init", "--initial-branch=main"]); git(["add", "."]);
    git(["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", "Synthetic lifecycle fixture"]);
    const sha = git(["rev-parse", "HEAD"]);
    git(["clone", "--bare", seed, bare]);
    execFileSync("git", ["--git-dir", bare, "update-server-info"], { stdio: "ignore" });
    gitServer = http.createServer(async (req, res) => {
      try {
        const name = decodeURIComponent(new URL(req.url, "http://fixture").pathname);
        assert(name.startsWith("/remote.git/")); assert(!name.includes(".."));
        const path = await realpath(resolve(directory, "." + name)); assert(path.startsWith(bare + sep));
        res.end(await readFile(path));
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => gitServer.listen(0, "127.0.0.1", r));
    const gitUrl = `http://127.0.0.1:${gitServer.address().port}/remote.git`;
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url ?? input);
      if (url.origin === new URL(lifecycleRemote).origin) return network.fetch(url, options);
      assert([base, "http://127.0.0.1:54321"].includes(url.origin), `Unexpected lifecycle outbound origin: ${url.origin}`);
      return nativeFetch(input, options);
    };
    const stateFile = join(directory, "device.json"), runner = await createAppClient(base, stateFile);
    let status = await runner.request("/api/account");
    if (!status.pairingCode) { await runner.request("/api/account/device", {}); status = await runner.request("/api/account"); }
    await approve(status); assert.equal((await runner.request("/api/account")).authenticated, true);
    const installedScope = { space, projectIds: ["removed-installed-project"], provider: "codex", runnerVersion: VERSION, workVersion: 1, remoteWorkVersion: 1, previewVersion: 1, previewCliVersion: 1 };
    assert.equal((await runner.request("/api/automation/claim", installedScope)).job, null);
    const before = await snapshot();
    browser = await chromium.launch({ proxy: { server: network.proxy, bypass: "localhost,127.0.0.1" }, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if ([base, lifecycleRemote.slice(0, -1)].includes(url.origin)) return route.continue();
      unexpected.push(url.origin); return route.abort();
    });
    page = await context.newPage(); await page.goto(base + "/settings");
    await page.getByText(/기기 확인 번호:/).waitFor();
    const viewer = await approve(await (await context.request.get(base + "/api/account")).json());
    await page.getByRole("button", { name: "기기 연결 다시 확인", exact: true }).click();
    await page.getByRole("button", { name: "개인", exact: true }).click();
    await expect(page.getByRole("button", { name: "개인", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.goto(base + "/projects");
    await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
    let form = page.getByRole("dialog", { name: "프로젝트 만들기", exact: true });
    const name = "합성 연결 전체 흐름";
    await form.getByLabel("프로젝트 이름").fill(name);
    await form.getByRole("radio", { name: /개발 시작·이어가기/ }).check();
    await form.getByRole("checkbox", { name: "저장소·실행 환경 자동 준비" }).uncheck();
    await form.getByLabel("프로젝트 설명").fill("등록부터 실제 화면 저장까지 연결 검증");
    await form.getByRole("button", { name: "프로젝트 저장", exact: true }).click(); await expect(form).not.toBeVisible();
    await expect.poll(async () => (await snapshot()).data.projects.find(p => p.name === name)?.id).toBeTruthy();
    const project = (await snapshot()).data.projects.find(p => p.name === name);
    await page.getByRole("link", { name: `${name} 프로젝트 열기`, exact: true }).click();
    await expect(page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true }).getByRole("status").first()).toHaveText("GitHub 저장소 등록 필요");
    await page.getByRole("button", { name: "GitHub 저장소 등록", exact: true }).click();
    form = page.getByRole("dialog", { name: "서비스 등록", exact: true });
    await form.getByLabel("서비스 이름", { exact: true }).fill("합성 GitHub");
    await form.getByLabel("서비스 웹 주소", { exact: true }).fill(`https://github.com/${repository}`);
    await form.getByRole("button", { name: "서비스 저장", exact: true }).click(); await expect(form).not.toBeVisible();
    const agent = page.getByRole("region", { name: "프로젝트 AI 작업실", exact: true });
    await agent.getByLabel("요청 방식", { exact: true }).selectOption("ask");
    await agent.getByLabel("AI에게 요청", { exact: true }).fill("합성 프로젝트의 실행 구조를 확인해주세요.");
    await agent.getByRole("button", { name: "요청 보내기", exact: true }).click();
    await expect.poll(async () => (await snapshot()).data.projects.find(p => p.id === project.id).automation?.turns.at(-1)?.status).toBe("queued");
    const job = (await runner.request("/api/automation/claim", installedScope)).job;
    assert.equal(job.kind, "work"); assert.equal(job.projectId, project.id); assert.equal(job.mode, "ask");
    const run = async (bin, args, options) => {
      if (bin === "git" && args.includes("clone")) { const index = args.indexOf(`https://github.com/${repository}.git`); assert(index >= 0); args = args.with(index, gitUrl); }
      if (bin === "codex") {
        if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
        if (args.includes("--help")) return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
        assert(args.includes("read-only")); assert(args.includes("sandbox_workspace_write.network_access=false"));
        const cwd = args[args.indexOf("--cd") + 1];
        await assert.rejects(readFile(join(cwd, ".env")), /ENOENT/); assert((await readFile(join(cwd, "src/data/label.mjs"), "utf8")).includes("Connected lifecycle"));
        modelCalls++; await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ blocked: false, reply: "합성 CLI 응답이 서버에 도착했습니다.", summary: "실행 구조 확인", currentStatus: "확인", nextAction: "화면 준비", followUps: [] }));
        return { code: 0, out: "", err: "" };
      }
      assert(bin !== "gh"); assert(!(bin === "git" && args.includes("push")));
      return runCommand(bin, args, options);
    };
    const get = async path => {
      assert(path.startsWith(`repos/${repository}`));
      if (path === `repos/${repository}`) return { full_name: repository, default_branch: "main" };
      if (path.endsWith("/commits/main")) return { sha };
      if (path.includes("/deployments?")) return [];
      assert.fail(`Unexpected synthetic GitHub request: ${path}`);
    };
    const options = { stateDir: directory, run, get, log() {}, previewEnabled: true, remotePreview: { origin: base, binary: network.binary },
      previewTools: { ...preview, startMacPreview: opts => preview.startMacPreview({ ...opts, bridge: async (...args) => bridge = await preview.createPreviewBridge(...args) }) } };
    await executeProjectWork(runner, job, options);
    await expect(agent).toContainText("합성 CLI 응답이 서버에 도착했습니다.", { timeout: 40_000 });
    await expect(agent.getByRole("status").first()).toHaveText("Jarvis CLI 연결됨");
    // Reopen the runner's saved device state, preserving automatic project scope.
    const resumed = await createAppClient(base, stateFile);
    const screen = page.getByRole("region", { name: "수정된 화면 확인", exact: true });
    await screen.getByRole("button", { name: "화면 준비", exact: true }).click();
    await expect.poll(async () => (await snapshot()).data.projects.find(p => p.id === project.id).automation.turns.at(-1).mode).toBe("preview");
    const previewJob = (await resumed.request("/api/automation/claim", installedScope)).job;
    assert.equal(previewJob.mode, "preview"); assert.equal(previewJob.previewAI, undefined);
    container = `jarvis-preview-${createHash("sha256").update(`${space}:${project.id}:${previewJob.id}`).digest("hex").slice(0, 24)}`;
    await executeProjectWork(resumed, previewJob, options);
    const saved = await snapshot(), result = saved.data.projects.find(p => p.id === project.id).automation.turns.at(-1).result;
    assert.equal(result.preview?.state, "ready", JSON.stringify(result)); assert.equal(result.preview.kind, "remote"); assert.equal(result.preview.sha, sha); assert.equal(modelCalls, 1);
    await expect(screen).toContainText("원격 미리보기 준비됨", { timeout: 40_000 });
    await page.reload(); await expect(screen).toContainText("원격 미리보기 준비됨");
    const opened = context.waitForEvent("page"); await screen.getByRole("link", { name: "이 PC에서 화면 열기 ↗", exact: true }).click();
    const app = await opened; const errors = []; app.on("pageerror", error => errors.push(error.message));
    await app.waitForURL(lifecycleRemote); await expect(app.getByRole("heading", { name: "Connected lifecycle ready", exact: true })).toBeVisible();
    await expect(app.locator("output")).toHaveText("0"); await app.getByRole("button", { name: "Save temporary record", exact: true }).click();
    await expect(app.locator("output")).toHaveText("1"); await app.reload(); await expect(app.locator("output")).toHaveText("1");
    assert.equal(await readFile(join(seed, "data/records.json"), "utf8"), '{"count":999}'); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await app.screenshot({ path: "test-results/project-lifecycle-preview.png", fullPage: true });
    const reconnect = network.disconnect();
    assert.equal((await context.request.get(`${base}/api/preview/open?space=${space}&projectId=${project.id}&turnId=${previewJob.id}`)).status(), 503); reconnect();
    const other = await browser.newContext({ ignoreHTTPSErrors: true }); const copied = await other.newPage();
    assert.equal((await copied.goto(lifecycleRemote)).status(), 403); await other.close();
    sql(`update public.jarvis_devices set revoked_at=now() where user_id='${viewer}'`);
    await new Promise(r => setTimeout(r, 10_100)); assert.equal((await app.reload()).status(), 403);
    const after = await snapshot(); assert.equal(after.data.projects.filter(p => p.name === name).length, 1);
    assert.deepEqual(after.data.notes, before.data.notes); assert.equal(after.data.projects.find(p => p.id === project.id).automation.turns.length, 2);
    assert(!(await api("/api/workspace?space=company", account.token)).body.data.projects.some(p => p.id === project.id));
    recordCheck("connected lifecycle: browser registration -> existing scoped runner discovery -> synthetic CLI answer -> resumed runner -> real Git/Docker -> persisted result -> real signed-ticket HTTPS open -> isolated app save/reload; outage, copied links, revoked device and cross-space access rejected; no production/model calls");
    await runAutopilotLifecycle({ base, browser, runner: resumed, network, approve, snapshot, recordCheck });
    await runPlanningLifecycle({ base, browser, runner: resumed, approve, snapshot, recordCheck });
  } catch (error) {
    await page?.screenshot({ path: "test-results/project-lifecycle-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    globalThis.fetch = nativeFetch; await browser?.close(); bridge?.close();
    if (container) { await runCommand("docker", ["rm", "-f", container]).catch(() => {}); await runCommand("docker", ["image", "rm", `${container}:app`]).catch(() => {}); }
    if (gitServer) { gitServer.closeAllConnections(); await new Promise(r => gitServer.close(r)); }
    await rm(directory, { recursive: true, force: true });
  }
}
