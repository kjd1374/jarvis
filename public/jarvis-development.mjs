// Managed macOS processes. App code never inherits the runner's home, credentials or network.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, cp, realpath, open } from 'node:fs/promises';
import { dirname, basename, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { constants as osConstants } from 'node:os';
import { copyProject, previewPlan, projectTestPlan, previewServerSource, directProbe, registerDevelopmentBridge, previewFailure } from './jarvis-preview.mjs';
import { previewCliQueueSource, previewCliProfile, startPreviewCliWorker } from './jarvis-preview-cli.mjs';
const servers = new Map(), failures = new Map();
const ttl = 2 * 60 * 60_000;
const keyOf = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => JSON.stringify(value);
let handlers = false;
export function developmentEnvironment(root, port) {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
    PORT: String(port), HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CI: 'true',
    // Homebrew OpenSSL otherwise reads its host configuration outside the sandbox.
    // Use OpenSSL's defaults without importing host paths, engines or credentials.
    OPENSSL_CONF: '/dev/null',
    npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc'), npm_config_cache: join(root, 'npm-cache') };
}
export async function developmentRuntimeLibraries(objects) {
  // Only binaries already loaded by the trusted runner, never project-provided paths.
  // Homebrew may keep Node's dylibs outside the Node installation directory.
  if (objects === undefined) {
    objects = process.report.getReport().sharedObjects;
    if (process.platform === 'darwin') {
      // Also inspect the trusted executable's direct load commands. dyld image
      // reports vary across Node/macOS versions; a required dylib must not be lost.
      try {
        const { stdout } = await promisify(execFile)('/usr/bin/otool', ['-L', await realpath(process.execPath)], { timeout: 10_000, maxBuffer: 256_000 });
        const linked = stdout.split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(isAbsolute);
        objects = [...objects, ...linked];
      } catch { /* Optional load-command inspection; the mandatory sandbox probe still fails closed. */ }
    }
  }
  const libraries = new Set();
  for (const value of Array.isArray(objects) ? objects.slice(0,4096) : []) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) continue;
    let file;
    try {
      const path = await realpath(value); file = await open(path,'r');
      const bytes = Buffer.alloc(4), result = await file.read(bytes,0,4,0);
      if (result.bytesRead === 4 && [0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(bytes.readUInt32BE())) libraries.add(path);
    } catch {} finally { await file?.close(); }
  }
  return [...libraries].sort();
}
export async function developmentRuntimeTools(executable = process.execPath) {
  try {
    const npm = await realpath(join(dirname(executable), 'npm'));
    if (basename(npm) !== 'npm-cli.js' || basename(dirname(npm)) !== 'bin') return [];
    const root = dirname(dirname(npm));
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    return manifest.name === 'npm' && manifest.bin?.npm === 'bin/npm-cli.js' ? [root] : [];
  } catch { return []; }
}
export function developmentSandbox(root, data, ports, executable = process.execPath, libraries = [], tools = []) {
  // No blanket home, /private/var, /Library or outbound-network permission.
  const runtime = dirname(dirname(executable));
  return `(version 1)\n(deny default)\n(allow process-fork process-exec sysctl-read mach-lookup)\n(allow file-read-metadata)\n(allow file-map-executable)\n(allow signal (target self))\n(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath ${quote(runtime)}) (subpath ${quote(root)}) (subpath ${quote(data)}) ${libraries.filter(p=>typeof p==='string'&&isAbsolute(p)&&!p.includes('\0')).map(p=>`(literal ${quote(p)})`).join(' ')} ${tools.filter(p=>typeof p==='string'&&isAbsolute(p)&&!p.includes('\0')).map(p=>`(subpath ${quote(p)})`).join(' ')} (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/private/etc/localtime") (literal "/private/etc/hosts"))\n(allow file-write* (subpath ${quote(root)}) (subpath ${quote(data)}) (literal "/dev/null"))\n${ports.map(p => `(allow network-bind network-inbound (local tcp "localhost:${p}"))\n(allow network-outbound (remote tcp "localhost:${p}"))`).join('\n')}\n`;
}
async function freePort() {
  // Keep app listeners out of macOS's ephemeral client-port range. Health
  // probes and npm can otherwise consume a released port before the app binds.
  for (let attempt = 0; attempt < 32; attempt++) {
    const socket = net.createServer(), port = randomInt(16000, 32000);
    try {
      await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); });
      await new Promise(resolve => socket.close(resolve)); return port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('development_port_unavailable');
}
export function developmentStatus(group, action = 'logs', redact = value => value) {
  const key = keyOf(group), item = servers.get(key);
  if (!item) return { running: false, detail: redact(failures.get(key) ?? '실행 중인 로컬 서버가 없습니다. 화면 준비로 시작할 수 있습니다.').slice(-1600) };
  const detail = redact(failures.has(key) ? '최근 준비 실패 · 이전 서버 실행 중\n' + failures.get(key) : item.log).replace(/\x1b\[[0-9;]*m/g, '').slice(-1600) || '서버가 실행 중입니다. 출력된 로그가 없습니다.';
  if (action === 'stop' || action === 'restart') item.close();
  return { running: action === 'logs', detail: action === 'stop' ? '프로젝트 서버와 원격 연결을 종료했습니다. 프로젝트 데이터는 보존됩니다.' : detail };
}
export async function startDevelopmentPreview(options, { platform = process.platform, launch = spawn, bindAttempt = 0 } = {}) {
  const { cwd, files, sha, stateDir, group, persistent, run, signal, publish, cliInference, aiProvider = 'codex', authorizeCliPreparation } = options;
  if (platform !== 'darwin') return null; // The existing isolated Docker path remains the explicit compatibility path.
  const key = keyOf(group), provider = cliInference ? aiProvider : 'none';
  let previous = servers.get(key);
  if (previous && previous.sha === sha && previous.persistent === !!persistent && previous.provider === provider && Date.parse(previous.ready.expiresAt) > Date.now()) {
    let healthy = false;
    try { const health = await directProbe(`${previous.ready.url}__jarvis_preview_health`); healthy = health.ok && await health.text() === previous.token; }
    catch (error) { if (signal?.aborted) throw error; }
    if (healthy) {
      await authorizeCliPreparation?.();
      const ready = { ...previous.ready, reused: true };
      return publish ? await publish(ready) : ready;
    }
  }
  if (servers.size - Number(!!previous) >= 3) throw Object.assign(new Error('development_capacity'), { stage: 'application' });
  const root = await realpath(stateDir), directory = join(root, `development-${key}-${randomUUID()}`), app = join(directory, 'app');
  const data = join(root, `development-data-${key}`);
  let child, bridge, closed = false, stage = 'build', appLog = '';
  const command = async (...args) => { const result = await run(...args); appLog = (appLog + (result.out ?? '') + (result.err ?? '')).slice(-16_000); return result; }; 
  const close = () => {
    if (closed) return; closed = true;
    bridge?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      // Kill this owned process group while its leader is still live. Never schedule a later kill against a potentially reused PID.
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    if (servers.get(key)?.close === close) servers.delete(key);
    // Durable data and lock-keyed dependency cache are intentionally outside this release.
    void rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of ['tmp', 'home', 'npm-cache']) await mkdir(join(directory, name), { mode: 0o700 });
    await mkdir(data, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'npmrc'), '', { mode: 0o600 }); await writeFile(join(directory, 'global-npmrc'), '', { mode: 0o600 });
    const copied = await copyProject(cwd, files, app);
    const json = async name => JSON.parse(await readFile(join(app, name), 'utf8').catch(() => 'null'));
    const plan = previewPlan(copied, await json('package.json'), await json('package-lock.json'));
    if (!plan) throw new Error('development_start_unsupported');
    const ports = [];
    while (ports.length < 3) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
    const env = developmentEnvironment(directory, ports[0]);
    const executable = await realpath(process.execPath);
    const profile = join(directory, 'sandbox.sb');
    const [libraries, tools] = await Promise.all([developmentRuntimeLibraries(), developmentRuntimeTools()]);
    appLog = `Runtime preflight ${new Date().toISOString()} · Node ${process.version} · ${libraries.length} runtime libraries\n`;
    await writeFile(profile, developmentSandbox(directory, persistent ? data : join(directory, 'tmp', 'app-data'), ports, executable, libraries, tools), { mode: 0o600 });
    // Fail closed if the installed macOS sandbox cannot run. Never silently execute on the host.
    const supported = await command('/usr/bin/sandbox-exec', ['-f', profile, executable, '-e', 'process.stdout.write("sandbox-ready")'], { cwd: app, env, signal, timeout: 10_000 });
    if (supported.code !== 0 || supported.out !== 'sandbox-ready') {
      const signalCode = osConstants.signals[supported.terminationSignal];
      throw Object.assign(new Error('development_sandbox_unavailable'), { exitCode: Number.isInteger(supported.code) ? supported.code : Number.isInteger(signalCode) ? 128 + signalCode : undefined });
    }
    if (plan.install) await prepareDependencies({ app, directory, root, key, run: command, signal });
    const sandboxRun = async (bin, args) => command('/usr/bin/sandbox-exec', ['-f', profile, bin, ...args], { cwd: app, env, signal, timeout: 300_000, maxBytes: 2_000_000 });
    if (plan.build && (await sandboxRun('/usr/bin/env', ['npm', 'run', 'build', '--ignore-scripts'])).code !== 0) throw new Error('development_build_failed');
    // The trusted proxy/queue and untrusted app share only this release and fixed loopback ports.
    plan.persistent = persistent; plan.cli = !!cliInference; plan.aiProvider = aiProvider;
    if (plan.vite) plan.start = plan.start.map(value => value === '3000' ? String(ports[0]) : value);
    const nativeApp = app; // no second copy: this release is already disposable.
    let source = previewServerSource.replace("if(plan.entry) await cp('/app',cwd,{recursive:true});", '').replace(/'\/runtime\/([^']+)'/g, (_match, name) => quote(join(directory, name))).replaceAll("'/app'", quote(app)).replaceAll("'/tmp/jarvis-preview-app'", quote(nativeApp))
      .replace("if(plan.entry) await cp('/app',cwd,{recursive:true});", '')
      .replaceAll("'/persistent'", quote(data)).replaceAll("'/tmp/app-data'", quote(join(directory, 'tmp', 'app-data')))
      .replaceAll("HOME:'/tmp',TMPDIR:'/tmp'", `HOME:${quote(env.HOME)},TMPDIR:${quote(env.TMPDIR)}`)
      .replaceAll('3000', String(ports[0])).replaceAll('3001', String(ports[1])).replaceAll("'0.0.0.0'", "'127.0.0.1'").replace("stdio:'ignore'", "stdio:'inherit'").replace("NEXT_TELEMETRY_DISABLED:'1'", `NEXT_TELEMETRY_DISABLED:'1',OPENSSL_CONF:'/dev/null',npm_config_userconfig:${quote(env.npm_config_userconfig)},npm_config_globalconfig:${quote(env.npm_config_globalconfig)},npm_config_cache:${quote(env.npm_config_cache)}`);
    const token = randomUUID(), cliToken = randomUUID();
    await writeFile(join(directory, 'server.mjs'), source, { mode: 0o600 });
    await writeFile(join(directory, 'plan.json'), JSON.stringify(plan), { mode: 0o600 });
    await writeFile(join(directory, 'cli-queue.mjs'), previewCliQueueSource.replaceAll('3002', String(ports[2])), { mode: 0o600 });
    if (cliInference) {
      if (!plan.entry) throw Object.assign(new Error('preview_cli_config_unavailable'), { stage: 'ai' });
      const config = previewCliProfile(await json('config.example.json'), aiProvider);
      config.profiles.jarvis.baseUrl = `http://127.0.0.1:${ports[2]}/v1`;
      await writeFile(join(directory, 'cli-profile.json'), JSON.stringify(config), { mode: 0o600 });
    }
    if (persistent) await migrateDevelopmentData({ data, key, run: command, signal, legacyDockerData: options.legacyDockerData });
    if (previous && (persistent || previous.persistent)) { previous.close(); previous = undefined; }
    stage = 'application';
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    child = launch('/usr/bin/sandbox-exec', ['-f', profile, executable, join(directory, 'server.mjs')], { cwd: app, env: { ...env, JARVIS_PREVIEW_ID: token, JARVIS_PREVIEW_CLI_TOKEN: cliToken, JARVIS_PREVIEW_TTL: String(ttl) }, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const item = { sha, provider, persistent: !!persistent, token, close, log: '', ready: null };
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { item.log = (item.log + chunk.toString()).slice(-16_000); appLog = item.log; });
    child.on('error', close); child.on('close', close);
    bridge = registerDevelopmentBridge(`development-${key}-${token}`, `http://127.0.0.1:${ports[1]}/`, expiresAt, close);
    let healthy = false;
    for (let attempt = 0; attempt < 100 && !closed; attempt++) {
      if (signal?.aborted) throw new Error('preview_cancelled');
      try { const health = await directProbe(`${bridge.url}__jarvis_preview_health`); if (health.ok && await health.text() === token) { healthy = true; break; } } catch {}
      await sleep(300);
    }
    if (!healthy) throw new Error('development_not_ready');
    let ready = { state: 'ready', kind: 'mac', execution: 'native', reused: false, url: bridge.url, sha, checkedAt: new Date().toISOString(), expiresAt,
      ...(persistent ? { dataPersistence: 'project' } : {}), message: '맥미니 로컬 서버가 실행 중입니다. 같은 코드와 AI 설정은 다시 설치·빌드하지 않고 재사용합니다.' };
    if (cliInference) {
      stage = 'ai'; await authorizeCliPreparation();
      const worker = startPreviewCliWorker({ url: ready.url, token: cliToken, inference: cliInference, authorize: authorizeCliPreparation, provider: aiProvider });
      bridge.cliWorker = worker; bridge.cleanups.add(worker.close);
      ready = { ...ready, ai: await worker.probe() }; worker.setAuthorization(async () => false);
    }
    stage = 'connection';
    const published = publish ? await publish(ready) : ready;
    item.ready = ready; servers.set(key, item); failures.delete(key); previous?.close();
    if (!handlers) { handlers = true; process.once('exit', () => { for (const item of servers.values()) item.close(); }); }
    return published;
  } catch (error) { if (failures.size >= 20) failures.delete(failures.keys().next().value); failures.set(key, (String(error.code ?? error.message) + '\n' + appLog).slice(-16_000)); close();
    if (bindAttempt === 0 && !signal?.aborted && error.message === 'development_not_ready' && /EADDRINUSE|address already in use/i.test(appLog)) return startDevelopmentPreview(options, { platform, launch, bindAttempt: 1 });
    return { ...previewFailure(sha, error, stage, !!publish), execution: 'native' }; }
}

export async function runDevelopmentTests({ cwd, files, stateDir, identity, run, signal, redact = value => value }) {
  if (process.platform !== 'darwin') return null;
  const root = await realpath(stateDir), key = keyOf(identity), directory = join(root, `development-test-${key}-${randomUUID()}`), app = join(directory, 'app');
  try {
    await mkdir(directory, { mode: 0o700 });
    for (const name of ['tmp', 'home', 'npm-cache', 'data']) await mkdir(join(directory, name), { mode: 0o700 });
    for (const name of ['npmrc', 'global-npmrc']) await writeFile(join(directory, name), '', { mode: 0o600 });
    const copied = await copyProject(cwd, files, app), json = async name => JSON.parse(await readFile(join(app, name), 'utf8').catch(() => 'null'));
    const plan = projectTestPlan(copied, await json('package.json'), await json('package-lock.json'));
    if (plan.reason) return [{ name: '자동 테스트', status: 'not_run', detail: plan.reason }];
    const ports = [];
    while (ports.length < 16) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
    const env = developmentEnvironment(directory, ports[0]), profile = join(directory, 'sandbox.sb'), executable = await realpath(process.execPath);
    const locks = join(directory, 'tmp', 'ports'); await mkdir(locks);
    const preload = join(directory, 'test-loopback.mjs');
    await writeFile(preload, `import net from 'node:net';import fs from 'node:fs';const ports=${JSON.stringify(ports)},locks=${JSON.stringify(locks)},listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const options=args[0],ephemeral=options===0||options&&typeof options==='object'&&options.port===0;if(!ephemeral)return listen.apply(this,args);let chosen;for(const port of ports){try{fs.mkdirSync(locks+'/'+port);chosen=port;break;}catch(error){if(error.code!=='EEXIST')throw error;}}if(!chosen)throw Error('test_loopback_capacity');let released=false;const release=()=>{if(released)return;released=true;try{fs.rmdirSync(locks+'/'+chosen)}catch{}};this.once('close',release);this.once('error',release);if(options===0){args[0]=chosen;if(typeof args[1]!=='string')args.splice(1,0,'127.0.0.1');}else args[0]={...options,port:chosen,host:options.host??'127.0.0.1'};try{return listen.apply(this,args)}catch(error){release();throw error;}};`, {mode:0o600});
    await writeFile(profile, developmentSandbox(directory, join(directory, 'data'), ports, executable, await developmentRuntimeLibraries(), await developmentRuntimeTools()), { mode: 0o600 });
    env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
    if (plan.install) await prepareDependencies({ app, directory, root, key: keyOf(identity.replace(/:checks$/, '')), run, signal });
    const checks = [];
    for (const command of plan.commands) {
      const result = await run('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/env', ...command.args], { cwd: app, env, signal, timeout: 300_000, maxBytes: 2_000_000 });
      const output = `${result.out ?? ''}\n${result.err ?? ''}`, empty = /(?:^|\n)\s*(?:# |ℹ )?(?:tests\s+0\b|1\.\.0\b)|No tests (?:found|specified)/im.test(output);
      checks.push({ name: command.name, status: empty ? 'not_run' : result.code === 0 ? 'passed' : 'failed', detail: `macOS 격리 로컬 검사 · 종료 코드 ${result.code}\n${redact(output).slice(-1600)}` });
    }
    return checks;
  } catch { return [{ name: '자동 테스트', status: 'not_run', detail: 'macOS 격리 로컬 검사를 시작하지 못했습니다. 테스트 통과로 처리하지 않았습니다.' }]; }
  finally { await rm(directory, { recursive: true, force: true }); }
}

// Migrate an existing project volume once, before app writes. The original
// volume remains untouched so a failed copy can be retried without data loss.
export async function migrateDevelopmentData({ data, key, run, signal, legacyDockerData }) {
  try { if (await readFile(`${data}.initialized`, 'utf8') === 'ready') return; } catch {}
  if (legacyDockerData) {
    const volume = `jarvis-data-${key}`;
    const inspected = await run('docker', ['volume', 'inspect', volume], { signal, timeout: 15_000 });
    if (inspected.code !== 0) throw new Error('development_data_migration_required');
    const image = 'node:24.19.0-bookworm-slim';
    const cachedImage = await run('docker', ['image', 'inspect', image], { signal, timeout: 15_000 });
    if (cachedImage.code !== 0 && (await run('docker', ['pull', image], { signal, timeout: 180_000, maxBytes: 4096 })).code !== 0) throw new Error('development_data_image_unavailable');
    const listed = await run('docker', ['ps', '--quiet', '--filter', `label=jarvis.preview.group=${key}`], { signal, timeout: 15_000 });
    if (listed.code !== 0) throw new Error('development_data_migration_required');
    const ids = listed.out.trim().split('\n').filter(Boolean);
    if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('development_data_migration_required');
    if (ids.length) {
      const stopped = await run('docker', ['stop', ...ids], { signal, timeout: 30_000 });
      if (stopped.code !== 0) throw new Error('development_data_migration_required');
    }
    const staging = `${data}.migration`;
    await rm(staging, { recursive: true, force: true }); await mkdir(staging, { mode: 0o700 });
    const script = `const fs=require('node:fs');const uid=Number(process.argv[1]),gid=Number(process.argv[2]);let total=0;function copy(from,to){for(const d of fs.readdirSync(from,{withFileTypes:true})){const a=from+'/'+d.name,b=to+'/'+d.name;if(d.isSymbolicLink())throw Error('symlink');if(d.isDirectory()){fs.mkdirSync(b);copy(a,b);fs.chownSync(b,uid,gid)}else if(d.isFile()){total+=fs.statSync(a).size;if(total>1024*1024*1024)throw Error('size');fs.copyFileSync(a,b);fs.chownSync(b,uid,gid)}else throw Error('type')}}copy('/source','/target');`;
    // The fixed official image is loaded only for this one-time legacy volume copy.
    const copied = await run('docker', ['run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges', '--mount', `type=volume,src=${volume},dst=/source,readonly`, '--mount', `type=bind,src=${staging},dst=/target`, 'node:24.19.0-bookworm-slim', 'node', '-e', script, String(process.getuid()), String(process.getgid())], { signal, timeout: 120_000, maxBytes: 4096 });
    if (copied.code !== 0) throw new Error('development_data_migration_required');
    const { readdir, rename } = await import('node:fs/promises');
    if ((await readdir(data)).length) throw new Error('development_data_migration_conflict');
    await rm(data, { recursive: true }); await rename(staging, data);
  }
  await writeFile(`${data}.initialized`, 'ready', { mode: 0o600 });
}

async function prepareDependencies({ app, directory, root, key, run, signal }) {
  const lock = await readFile(join(app, 'package-lock.json'));
  const prefix = `development-deps-${key}-`, cache = join(root, prefix + keyOf(Buffer.concat([lock, Buffer.from(process.version + process.arch)])));
  let cached = false;
  try { cached = await readFile(join(cache, 'complete'), 'utf8') === 'ready'; } catch {}
  if (cached) { await cp(join(cache, 'node_modules'), join(app, 'node_modules'), { recursive: true }); return; }
  const installed = await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, env: developmentEnvironment(directory, 0), signal, timeout: 300_000, maxBytes: 2_000_000 });
  if (installed.code !== 0) throw new Error('development_install_failed');
  // Empty npm projects do not necessarily create node_modules.
  await mkdir(join(app, 'node_modules'), { recursive: true });
  await rm(cache, { recursive: true, force: true }); await mkdir(cache, { mode: 0o700 });
  await cp(join(app, 'node_modules'), join(cache, 'node_modules'), { recursive: true }); await writeFile(join(cache, 'complete'), 'ready');
  const { readdir, stat } = await import('node:fs/promises');
  const prior = await Promise.all((await readdir(root)).filter(name => name.startsWith(prefix) && join(root,name) !== cache).map(async name => ({ path: join(root,name), time: (await stat(join(root,name))).mtimeMs })));
  for (const item of prior.sort((a,b) => b.time-a.time).slice(1)) await rm(item.path, { recursive: true, force: true });
}
