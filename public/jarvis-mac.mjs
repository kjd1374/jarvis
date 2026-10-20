#!/usr/bin/env node
// One-time, user-owned LaunchAgent installation. Never copies provider credentials.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LABEL = "app.jarvis.runner";
export function macCommandPath({ node = process.execPath, home = homedir(), path = process.env.PATH ?? "" } = {}) {
  // An already-open terminal may not know Docker Desktop's user or bundled CLI location.
  // Keep working shell commands first, then add supported Mac installation locations.
  return [...new Set([dirname(node), ...path.split(":"), join(home, ".docker", "bin"),
    "/Applications/Docker.app/Contents/Resources/bin", join(home, "Applications", "Docker.app", "Contents", "Resources", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])]
    .filter(directory => directory.startsWith("/") && !directory.includes("\0")).join(":");
}
export const xml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export function launchAgent({ node, runner, config, directory, path }) {
  const args = ["/usr/bin/caffeinate", "-is", node, runner, "--config", config];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(directory, "runner.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, "runner-error.log"))}</string>
</dict></plist>\n`;
}
export function validateConfig(config) {
  const url = new URL(config.origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    config.provider !== "codex" || !Array.isArray(config.scopes) || !config.scopes.length || config.scopes.length > 2 ||
    config.scopes.some(s => !["company", "personal"].includes(s.space) || !Array.isArray(s.projectIds) || !s.projectIds.length || s.projectIds.length > 20 ||
      s.projectIds.some(id => id !== null && (typeof id !== "string" || !id || id.length > 200)))) throw new Error("설정 파일의 Jarvis 주소·영역·프로젝트를 확인해주세요.");
  // Copy only explicit non-secret settings. Device cookies and CLI credentials stay where they are.
  return { origin: url.origin, provider: "codex", scopes: config.scopes.map(s => ({ space: s.space, projectIds: s.projectIds })), preview: { enabled: true, remote: true } };
}
export function runSetupCommand(bin, args, { env = process.env } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(bin, args, { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", done = false;
    const finish = code => { if (!done) { done = true; clearTimeout(timer); resolveResult({ code, output }); } };
    const timer = setTimeout(() => { child.kill(); finish(-1); }, 30_000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { if (output.length < 100_000) output += b.toString(); });
    child.on("error", () => finish(-1)); child.on("close", finish);
  });
}
export async function preflight(run = runSetupCommand) {
  const git = await run("gh", ["auth", "status", "--hostname", "github.com"]);
  const codex = await run("codex", ["login", "status"]);
  const dockerClient = await run("docker", ["--version"]);
  const docker = dockerClient.code === 0 ? await run("docker", ["version", "--format", "{{.Server.Version}}"]): dockerClient;
  return { github: git.code === 0, codex: codex.code === 0 && /ChatGPT/i.test(codex.output) && !/API key|workload identity/i.test(codex.output),
    docker: dockerClient.code === 0 && docker.code === 0 && !!docker.output.trim(),
    dockerProblem: dockerClient.code !== 0 ? "client_unavailable" : docker.code !== 0 || !docker.output.trim() ? "engine_unavailable" : null };
}
export async function downloadRuntime(origin, destination, transport = fetch) {
  const get = async name => {
    const response = await transport(`${origin}/${name}`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Jarvis 실행기 파일을 받지 못했습니다. 웹 접속 상태를 확인해주세요.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 1_000_000) throw new Error("실행기 파일 크기를 확인하지 못했습니다.");
    return bytes;
  };
  const manifest = JSON.parse(new TextDecoder().decode(await get("jarvis-runtime.json")));
  if (!/^2\.\d+\.\d+$/.test(manifest.version ?? "")) throw new Error("실행기 버전을 확인하지 못했습니다.");
  const required = ["jarvis-runner.mjs", "jarvis-preview.mjs", "jarvis-development.mjs", "jarvis-stream-transport.mjs", "jarvis-remote-preview.mjs", "jarvis-preview-auth.mjs", "jarvis-preview-cli.mjs", "jarvis-provision.mjs", "jarvis-supervisor.mjs", "jarvis-mac.mjs"];
  const files = Object.keys(manifest.files ?? {});
  if (files.length > 24 || required.some(name => !files.includes(name)) || files.some(name => !/^jarvis-[a-z0-9-]+\.mjs$/.test(name))) throw new Error("실행기 파일 목록을 확인하지 못했습니다. 기존 실행기는 유지됩니다.");
  const downloaded = [];
  for (const name of files) {
    const bytes = await get(name), expected = manifest.files?.[name];
    if (!/^[a-f0-9]{64}$/.test(expected ?? "") || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("실행기 파일 무결성 확인에 실패했습니다. 기존 설정은 유지됩니다.");
    downloaded.push([name, bytes]);
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of downloaded) await writeFile(join(destination, name), bytes, { mode: 0o600 });
  await writeFile(join(destination, "jarvis-runtime.json"), JSON.stringify(manifest), { mode: 0o600 });
  return manifest.version;
}
export async function installedConfig(plist, run, read = readFile) {
  const result = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist]);
  if (result.code !== 0) throw new Error("기존 자동 실행 설정을 찾지 못했습니다. 최초 설치는 install --config 명령을 사용해주세요.");
  const args = JSON.parse(result.output).ProgramArguments, index = args?.indexOf("--config");
  if (!(index >= 0) || typeof args[index + 1] !== "string" || !args[index + 1].startsWith("/")) throw new Error("기존 설정 경로를 확인하지 못했습니다. 실행기를 변경하지 않았습니다.");
  return validateConfig(JSON.parse(await read(args[index + 1], "utf8")));
}
export const TUNNEL_RELEASE = {
  version: "2026.10.1",
  arm64: "647615df99d49cd179ea5e13ef760b9bbfb33630f6ae62f87e33dfadda60adcc",
  x64: "3b0dbaf378337e9d7fb6cd235a76d1d6a7dee434c2d8edf9281164fb6a3837ab",
};
export async function downloadTunnel(destination, run, { arch = process.arch, transport = fetch } = {}) {
  const expected = TUNNEL_RELEASE[arch];
  if (!expected) throw new Error("이 Mac의 CPU에 맞는 원격 연결 프로그램을 확인하지 못했습니다.");
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_RELEASE.version}/cloudflared-darwin-${arch === "x64" ? "amd64" : "arm64"}.tgz`;
  const response = await transport(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 40_000_000) throw new Error("원격 연결 프로그램을 받지 못했습니다. 기존 실행기는 유지됩니다.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("원격 연결 프로그램 응답을 읽지 못했습니다.");
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 40_000_000) { await reader.cancel(); throw new Error("원격 연결 프로그램 크기 한도를 초과했습니다."); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  if (bytes.length > 40_000_000 || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("원격 연결 프로그램 무결성 확인에 실패했습니다. 기존 실행기는 유지됩니다.");
  const archive = join(destination, "cloudflared.tgz");
  await writeFile(archive, bytes, { mode: 0o600 });
  try {
    const extracted = await run("/usr/bin/tar", ["-xzf", archive, "-C", destination, "cloudflared"]);
    if (extracted.code !== 0) throw new Error("원격 연결 프로그램 압축을 풀지 못했습니다. 기존 실행기는 유지됩니다.");
    await chmod(join(destination, "cloudflared"), 0o700);
  } finally { await rm(archive, { force: true }); }
}
export async function replaceLaunchAgent({ domain, plist, contents, run, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const service = `${domain}/${LABEL}`;
  const code = result => Number.isInteger(result?.code) ? result.code : "unknown";
  const session = await run("launchctl", ["print", domain]);
  if (session.code !== 0) throw new Error(`macOS 사용자 로그인 세션을 확인하지 못했습니다 (launchctl ${code(session)}). 기존 설정은 유지됩니다.`);
  const registered = async () => {
    const result = await run("launchctl", ["print", service]);
    if (result.code === 0) return true;
    if ([3, 113].includes(result.code)) return false;
    throw new Error(`자동 실행 등록 상태를 확인하지 못했습니다 (launchctl ${code(result)}).`);
  };
  const stop = async () => {
    if (!await registered()) return;
    const result = await run("launchctl", ["bootout", service]);
    for (let attempt = 0; attempt < 80; attempt++) {
      if (!await registered()) return;
      await delay(250);
    }
    throw new Error(`실행기 등록이 아직 남아 있어 설정 교체를 중단했습니다 (bootout ${code(result)}).`);
  };
  const start = async () => {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await run("launchctl", ["bootstrap", domain, plist]);
      const loaded = await registered();
      if (result.code === 0 && loaded) return { ok: true, code: 0 };
      // Retry transient launchd teardown failures only while no job is registered.
      if (loaded || result.code !== 5) break;
      await delay(1000);
    }
    return { ok: false, code: code(result) };
  };
  const previous = await readFile(plist).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  await stop();
  let failure;
  try {
    await writeFile(plist, contents, { mode: 0o600 }); await chmod(plist, 0o600);
    const result = await start();
    if (result.ok) return;
    failure = `자동 시작 등록에 실패했습니다 (bootstrap ${result.code}).`;
  } catch (error) { failure = error.message; }
  try {
    await stop();
    if (previous) {
      await writeFile(plist, previous, { mode: 0o600 });
      const restored = await start();
      if (!restored.ok) throw new Error(`기존 설정 파일은 복원했지만 실행기 재등록에 실패했습니다 (bootstrap ${restored.code}).`);
    } else await rm(plist, { force: true });
  } catch (error) { throw new Error(`${failure} 복구 확인 실패: ${error.message}`); }
  throw new Error(`${failure} ${previous ? "이전 설정과 자동 실행 등록을 복원했습니다." : "새 자동 실행 설정을 제거했습니다."} 승인·작업 이력은 보존했습니다.`);
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || !args.length) {
    console.log("맥미니 Jarvis 실행기\nnode jarvis-mac.mjs install --config /path/jarvis-runner.json\nnode jarvis-mac.mjs update\nnode jarvis-mac.mjs check\nnode jarvis-mac.mjs stop\nupdate는 현재 회사·개인 프로젝트 범위를 그대로 유지합니다. macOS 사용자 로그인 후 자동 시작합니다. 인증값은 복사하지 않습니다."); return;
  }
  if (process.platform !== "darwin") throw new Error("이 설치 명령은 맥미니의 터미널에서 실행해주세요.");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node 24 이상이 필요합니다.");
  const path = macCommandPath();
  const run = (bin, commandArgs) => runSetupCommand(bin, commandArgs, { env: { ...process.env, PATH: path } });
  const domain = `gui/${process.getuid()}`, directory = join(homedir(), "Library", "Application Support", "Jarvis");
  const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  if (args[0] === "stop") {
    await run("launchctl", ["bootout", `${domain}/${LABEL}`]);
    await rm(plist, { force: true });
    console.log("자동 실행을 중단했습니다. 승인·작업 이력·설정은 보존했습니다. 실행 중인 미리보기는 만료 시 종료됩니다."); return;
  }
  if (!["install", "update", "check"].includes(args[0])) throw new Error("install, update, check, stop 중 하나를 사용해주세요.");
  const ready = await preflight(run);
  console.log(`GitHub ${ready.github ? "준비됨" : "로그인 필요"} · Codex 구독 ${ready.codex ? "준비됨" : "로그인 필요"} · Docker ${ready.docker ? "준비됨" : ready.dockerProblem === "client_unavailable" ? "명령 경로 확인 필요" : "엔진 접속 확인 필요"}`);
  if (args[0] === "check") return;
  if (!ready.github || !ready.codex) throw new Error("맥미니에서 gh auth login 및 codex login을 확인해주세요. 인증값을 채팅에 보내지 마세요.");
  if (!ready.docker) console.log("Docker는 선택 사항입니다. macOS 격리 로컬 서버를 기본 사용합니다.");
  const index = args.indexOf("--config");
  if (args[0] !== "update" && (index < 0 || !args[index + 1])) throw new Error("기존 jarvis-runner.json의 경로를 --config로 지정해주세요.");
  const config = args[0] === "update" ? await installedConfig(plist, run) : validateConfig(JSON.parse(await readFile(resolve(args[index + 1]), "utf8")));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const runtime = join(directory, `runtime-${randomUUID()}`);
  const version = await downloadRuntime(config.origin, runtime);
  console.log("Cloudflare 원격 연결 프로그램을 검증합니다. 미리보기는 Jarvis에서 승인된 기기로 열 때만 접근할 수 있습니다.");
  await downloadTunnel(runtime, run);
  const configPath = join(directory, "jarvis-runner.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await mkdir(dirname(plist), { recursive: true });
  const { launcherSource } = await import(pathToFileURL(join(runtime, "jarvis-supervisor.mjs")));
  const launcher = join(directory, "jarvis-launcher.mjs");
  await writeFile(launcher, launcherSource, { mode: 0o600 });
  await writeFile(join(directory, "runtime-current.json"), JSON.stringify({ runtime }), { mode: 0o600 });
  const contents = launchAgent({ node: process.execPath, runner: launcher, config: configPath, directory, path });
  const staged = join(runtime, "agent.plist"); await writeFile(staged, contents, { mode: 0o600 });
  if ((await run("plutil", ["-lint", staged])).code !== 0) throw new Error("자동 시작 설정 검증에 실패했습니다. 기존 실행기는 유지됩니다.");
  console.log("자동 실행 등록을 갱신합니다. 기존 실행기 종료와 새 등록 상태를 확인합니다.");
  await replaceLaunchAgent({ domain, plist, contents, run });
  console.log(`실행기 ${version} 자동 시작을 등록했습니다. 설정·승인·이력은 기존 것을 사용합니다.\n맥미니에서 로그아웃하지 말고 실행기를 유지해주세요. macOS 로컬 서버는 Docker 없이 실행합니다. 재부팅 뒤 사용자 로그인이 필요합니다.\nJarvis 프로젝트의 ‘화면 준비’를 눌러 실제 연결과 웹 응답을 확인해주세요.\n기기 확인이 필요한 경우 ${join(directory, "runner.log")}에 12자리 번호가 표시됩니다.`);
}
// macOS /tmp aliases /private/tmp; Node resolves the module URL, but not argv.
if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === await realpath(fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
