import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { previewFile, previewPlan, findDeploymentPreview, startMacPreview } from "../public/jarvis-preview.mjs";
import { validateConfig, launchAgent, preflight, downloadRuntime, macCommandPath, runSetupCommand, replaceLaunchAgent, installedConfig, downloadTunnel } from "../public/jarvis-mac.mjs";
import { VERSION } from "../public/jarvis-runner.mjs";
const sha = "a".repeat(40);
test("installer and runner start through directory/file symlinks and remain inert when imported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-entrypoint-"));
  try {
    const publicDir = fileURLToPath(new URL("../public", import.meta.url));
    await symlink(publicDir, join(dir, "tmp"), "dir");
    for (const name of ["jarvis-mac.mjs", "jarvis-runner.mjs"]) {
      const direct = join(publicDir, name), alias = join(dir, name);
      await symlink(direct, alias);
      const run = path => spawnSync(process.execPath, [path, "--help"], { encoding: "utf8", timeout: 10_000 });
      const expected = run(direct);
      assert.equal(expected.status, 0); assert.match(expected.stdout, /Jarvis/);
      for (const path of [join(dir, "tmp", name), alias]) {
        const actual = run(path);
        assert.equal(actual.status, 0, actual.stderr);
        assert.equal(actual.stdout, expected.stdout, `silent entrypoint: ${path}`);
      }
      const importer = join(dir, `import-${name}`);
      await writeFile(importer, `await import(${JSON.stringify(pathToFileURL(alias).href)}); console.log('import-only');`);
      const imported = run(importer);
      assert.equal(imported.status, 0, imported.stderr); assert.equal(imported.stdout.trim(), "import-only");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("published runtime manifest matches all shipped executables", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/jarvis-runtime.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, VERSION);
  for (const name of ["jarvis-runner.mjs", "jarvis-preview.mjs", "jarvis-remote-preview.mjs", "jarvis-preview-auth.mjs"]) {
    assert.equal(manifest.files[name], createHash("sha256").update(await readFile(new URL(`../public/${name}`, import.meta.url))).digest("hex"));
  }
});
test("preview recipes exclude credentials and unsupported or private dependencies", () => {
  for (const file of [".env", "data/private.json", "auth.json", "nested/../page.js", "/page.js", "AGENTS.md", ".git/config", "customers/list.json"]) assert.equal(previewFile(file), false, file);
  assert(previewFile("src/server.js")); assert(previewFile("package-lock.json"));
  assert.equal(previewPlan(["public/index.html"], null, null).root, "public");
  assert.equal(previewPlan([], { scripts: { start: "node src/server.js" } }, null).kind, "node");
  assert.equal(previewPlan([], { scripts: { start: "node app.js" }, dependencies: { private: "1" } }, null), null);
  assert.equal(previewPlan([], { scripts: { start: "node app.js" } }, { packages: { x: { resolved: "file:../secret", link: true } } }), null);
  assert.equal(previewPlan([], { scripts: { preview: "vite preview", build: "vite build" } }, null).start[1], "preview");
});
test("deployment previews require exact commit and successful latest status", async () => {
  const get = async path => path.includes("/statuses") ? [{ state: "success", environment_url: "https://synthetic.example/" }] : [{ id: 1, sha: "b".repeat(40) }, { id: 2, sha }];
  const result = await findDeploymentPreview("example/synthetic", sha, get, url => url?.startsWith("https://") ? url : null);
  assert.equal(result.sha, sha); assert.equal(result.kind, "deployment");
  assert.equal(await findDeploymentPreview("example/synthetic", sha, async () => { throw Error("denied"); }, () => null), null);
  assert.equal(await findDeploymentPreview("example/synthetic", sha, async path => path.includes("statuses") ? [{ state: "failure", environment_url: "https://failed.example/" }] : [{ id: 1, sha }], x => x), null);
});
test("preview containers receive only sanitized files and bounded private runtime; cached instance is reused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-preview-test-"));
  try {
    const cwd = join(dir, "repo"); await mkdir(cwd);
    await writeFile(join(cwd, "index.html"), "<h1>synthetic changed</h1>");
    await writeFile(join(cwd, ".env"), "PRIVATE_SECRET");
    await symlink(join(cwd, ".env"), join(cwd, "public.txt"));
    let info, build = 0, starts = 0; const calls = [];
    const run = async (bin, args) => {
      assert.equal(bin, "docker"); calls.push(args);
      if (args[0] === "version") return { code: 0, out: "28" };
      if (args[0] === "inspect") return { code: info ? 0 : 1, out: info ? JSON.stringify([info]) : "" };
      if (args[0] === "network") return { code: 0, out: JSON.stringify([{ Internal: true, Labels: { "jarvis.preview": "true" } }]) };
      if (args[0] === "build") {
        build++; const context = args.at(-1);
        assert((await readFile(join(context, "app/index.html"), "utf8")).includes("synthetic"));
        await assert.rejects(readFile(join(context, "app/.env"))); await assert.rejects(readFile(join(context, "app/public.txt")));
      }
      if (args[0] === "run") {
        starts++; assert(args.includes("--read-only")); assert(args.includes("no-new-privileges")); assert(args.includes("none")); assert(!args.includes("--publish"));
        assert(!args.includes("--privileged")); assert(!args.includes("--volume"));
        const labels = Object.fromEntries(args.flatMap((v, i) => v === "--label" ? [args[i + 1].split(/=(.*)/s).slice(0, 2)] : []));
        info = { State: { Running: true }, Config: { Labels: labels }, NetworkSettings: { Ports: { "3001/tcp": [{ HostIp: "127.0.0.1", HostPort: "45678" }] } } };
      }
      return { code: 0, out: "" };
    };
    const options = { cwd, files: ["index.html", ".env", "public.txt"], sha, stateDir: dir, identity: "synthetic", run,
      bridge: async () => ({ url: "http://127.0.0.1:45678/" }), transport: async () => ({ ok: true, text: async () => info.Config.Labels["jarvis.preview.id"] }), delay: async () => {} };
    const result = await startMacPreview(options); assert.equal(result.state, "ready");
    assert.equal((await startMacPreview(options)).state, "ready"); assert.equal(build, 1); assert.equal(starts, 1);
    assert(!JSON.stringify(calls).includes("PRIVATE_SECRET"));
    const failed = await startMacPreview({ ...options, transport: async () => ({ ok: true, text: async () => "another-instance" }) });
    assert.equal(failed.state, "failed"); assert.equal(failed.url, null);
    assert(calls.some(args => args[0] === "rm" && args[1] === "-f"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("missing Docker returns a useful preparation state without a fake URL", async () => {
  const result = await startMacPreview({ sha, run: async () => ({ code: 1, out: "" }) });
  assert.equal(result.state, "unavailable"); assert.equal(result.url, null); assert.match(result.message, /Docker/);
});
test("Mac setup keeps only selected scopes, escapes paths, and never embeds credentials", async () => {
  const config = validateConfig({ origin: "https://synthetic.example", provider: "codex", scopes: [{ space: "company", projectIds: ["selected"] }], token: "MUST_NOT_COPY" });
  assert.equal(config.preview.enabled, true); assert(!JSON.stringify(config).includes("MUST_NOT_COPY"));
  assert.throws(() => validateConfig({ ...config, origin: "https://user:secret@synthetic.example" }));
  const plist = launchAgent({ node: "/path/with spaces/node", runner: "/A&B/runner.mjs", config: "/config.json", directory: "/safe", path: "/bin" });
  assert(plist.includes("/A&amp;B/runner.mjs")); assert(plist.includes("caffeinate")); assert(!plist.includes("API_KEY"));
  const ready = await preflight(async bin => ({ code: 0, output: bin === "codex" ? "Logged in using an API key" : "ready" }));
  assert.equal(ready.codex, false); assert.equal(ready.docker, true);
});
test("Mac runtime download verifies every hash before writing any executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-install-test-"));
  try {
    const bytes = "// synthetic source", hash = createHash("sha256").update(bytes).digest("hex");
    const manifest = { version: "2.3.0", files: Object.fromEntries(["jarvis-runner.mjs", "jarvis-preview.mjs", "jarvis-remote-preview.mjs", "jarvis-preview-auth.mjs"].map(name => [name, hash])) };
    const transport = async (url, opts) => { assert.equal(opts.redirect, "error"); return new Response(url.endsWith(".json") ? JSON.stringify(manifest) : bytes); };
    await downloadRuntime("https://synthetic.example", join(dir, "good"), transport);
    assert.equal(await readFile(join(dir, "good/jarvis-runner.mjs"), "utf8"), bytes);
    manifest.files["jarvis-preview.mjs"] = "f".repeat(64);
    await assert.rejects(downloadRuntime("https://synthetic.example", join(dir, "bad"), transport), /무결성/);
    await assert.rejects(readFile(join(dir, "bad/jarvis-runner.mjs")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("Mac update resolves the active config and preserves both spaces without reading device credentials", async () => {
  const scopes = [{ space: "company", projectIds: ["work", null] }, { space: "personal", projectIds: ["private-a", "private-b"] }];
  const config = await installedConfig("/synthetic/agent.plist", async (bin, args) => {
    assert.equal(bin, "/usr/bin/plutil"); assert.equal(args.at(-1), "/synthetic/agent.plist");
    return { code: 0, output: JSON.stringify({ ProgramArguments: ["node", "/active/runner.mjs", "--config", "/active/config.json"] }) };
  }, async path => { assert.equal(path, "/active/config.json"); return JSON.stringify({ origin: "https://synthetic.example", provider: "codex", scopes }); });
  assert.deepEqual(config.scopes, scopes); assert.equal(config.preview.remote, true);
  await assert.rejects(installedConfig("/missing", async () => ({ code: 1 })), /기존 자동 실행/);
  await assert.rejects(installedConfig("/bad", async () => ({ code: 0, output: '{"ProgramArguments":[]}' })), /기존 설정 경로/);
});
test("tunnel installer refuses unverified archives before extraction", async () => {
  let extracts = 0;
  await assert.rejects(downloadTunnel("/unused", async () => { extracts++; }, { arch: "arm64", transport: async () => new Response("tampered") }), /무결성/);
  assert.equal(extracts, 0);
});
test("Mac setup finds a user-installed Docker CLI outside the inherited PATH and persists the working lookup", async () => {
  const home = await mkdtemp(join(tmpdir(), "jarvis-mac path-"));
  try {
    const bin = join(home, ".docker", "bin"); await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "docker"), '#!/bin/sh\ncase "$1" in\n--version) echo "Docker version 29.0.0" ;;\nversion) echo "29.0.0" ;;\n*) exit 2 ;;\nesac\n');
    await chmod(join(bin, "docker"), 0o700);
    const inherited = join(home, "empty");
    assert.notEqual((await runSetupCommand("docker", ["--version"], { env: { PATH: inherited } })).code, 0);
    const path = macCommandPath({ home, node: join(home, "node", "bin", "node"), path: inherited });
    const ready = await preflight((command, args) => command === "docker" ? runSetupCommand(command, args, { env: { PATH: path } })
      : Promise.resolve({ code: 0, output: command === "codex" ? "Logged in using ChatGPT" : "ready" }));
    assert.equal(ready.docker, true); assert.equal(ready.dockerProblem, null);
    const plist = launchAgent({ node: process.execPath, runner: "/runner.mjs", config: "/config.json", directory: home, path });
    const storedPath = plist.match(/<key>PATH<\/key><string>([^<]+)<\/string>/)[1];
    assert.equal((await runSetupCommand("docker", ["version"], { env: { PATH: storedPath } })).output.trim(), "29.0.0");
    assert(path.includes("/Applications/Docker.app/Contents/Resources/bin"));
    assert(path.indexOf(inherited) < path.indexOf(bin));
  } finally { await rm(home, { recursive: true, force: true }); }
});
test("Docker diagnosis distinguishes a missing command from a disconnected engine without exposing logs", async () => {
  const missing = await preflight(async bin => ({ code: bin === "docker" ? -1 : 0, output: "private diagnostic" }));
  assert.equal(missing.dockerProblem, "client_unavailable"); assert.equal(missing.docker, false);
  const offline = await preflight(async (bin, args) => ({ code: bin === "docker" && args[0] === "version" ? 1 : 0, output: "private diagnostic" }));
  assert.equal(offline.dockerProblem, "engine_unavailable"); assert.equal(offline.docker, false);
  assert(!JSON.stringify([missing, offline]).includes("private diagnostic"));
});

async function macUpdateFixture(options, check) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-launchd-test-")), plist = join(directory, "app.jarvis.runner.plist");
  if (!options.fresh) await writeFile(plist, "old", { mode: 0o600 });
  let loaded = !options.fresh, unloading = null, unloadingDefinition, attempts = 0;
  const boots = [], calls = [];
  const run = async (bin, args) => {
    assert.equal(bin, "launchctl"); calls.push(args);
    let code = 0;
    if (args[0] === "print" && args[1] === "gui/501") code = options.noSession ? 125 : 0;
    else if (args[0] === "print") {
      if (unloading !== null) {
        assert.equal(await readFile(plist, "utf8"), unloadingDefinition, "do not change a definition while its job is unloading");
        if (unloading-- <= 0) { loaded = false; unloading = null; }
      }
      code = loaded ? 0 : 113;
    } else if (args[0] === "bootout") {
      if (options.stuck) code = 5;
      else { unloading = 2; unloadingDefinition = await readFile(plist, "utf8"); }
    } else if (args[0] === "bootstrap") {
      const contents = await readFile(plist, "utf8"); boots.push(contents);
      code = contents === "new" ? (++attempts <= (options.failNew ?? 0) ? 5 : 0) : (options.failRecovery ? 5 : 0);
      if (code === 0 && !(options.phantomSuccess && contents === "new")) loaded = true;
      if (options.partialNew && contents === "new") loaded = true;
    } else assert.fail("unexpected launchctl command");
    return { code, output: "PRIVATE_DIAGNOSTIC" };
  };
  try { await check({ plist, boots, calls, loaded: () => loaded,
    update: () => replaceLaunchAgent({ domain: "gui/501", plist, contents: "new", run, delay: async () => {} }) }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test("Mac update waits for old registration removal and recovers a transient bootstrap failure", async () => {
  await macUpdateFixture({ failNew: 1 }, async ({ update, plist, boots, loaded }) => {
    await update(); assert.equal(await readFile(plist, "utf8"), "new");
    assert.deepEqual(boots, ["new", "new"]); assert(loaded());
  });
});
test("Mac update preserves the existing job when its login session cannot be checked", async () => {
  await macUpdateFixture({ noSession: true }, async ({ update, plist, calls }) => {
    await assert.rejects(update(), /로그인 세션.*125/);
    assert.equal(await readFile(plist, "utf8"), "old"); assert.equal(calls.length, 1);
  });
});
test("Mac update does not overwrite a job that failed to unload", async () => {
  await macUpdateFixture({ stuck: true }, async ({ update, plist, boots, loaded }) => {
    await assert.rejects(update(), /설정 교체를 중단.*bootout 5/);
    assert.equal(await readFile(plist, "utf8"), "old"); assert.deepEqual(boots, []); assert(loaded());
  });
});
test("Mac update verifies rollback after repeated bootstrap failures without exposing raw diagnostics", async () => {
  await macUpdateFixture({ failNew: 10 }, async ({ update, plist, boots, loaded }) => {
    await assert.rejects(update(), error => /bootstrap 5.*이전 설정과 자동 실행 등록을 복원/.test(error.message) && !error.message.includes("PRIVATE_DIAGNOSTIC"));
    assert.equal(await readFile(plist, "utf8"), "old"); assert.deepEqual(boots, ["new", "new", "new", "old"]); assert(loaded());
  });
});
test("Mac update reports failed recovery instead of claiming the old worker is restored", async () => {
  await macUpdateFixture({ failNew: 10, failRecovery: true }, async ({ update, plist, loaded }) => {
    await assert.rejects(update(), /복구 확인 실패.*기존 설정 파일은 복원했지만 실행기 재등록에 실패/);
    assert.equal(await readFile(plist, "utf8"), "old"); assert.equal(loaded(), false);
  });
});
test("first Mac installation removes a failed new job definition", async () => {
  await macUpdateFixture({ fresh: true, failNew: 10 }, async ({ update, plist, loaded }) => {
    await assert.rejects(update(), /새 자동 실행 설정을 제거/);
    await assert.rejects(readFile(plist), { code: "ENOENT" }); assert.equal(loaded(), false);
  });
});
test("Mac update removes a partially registered replacement before restoring the old job", async () => {
  await macUpdateFixture({ failNew: 10, partialNew: true }, async ({ update, plist, boots, loaded }) => {
    await assert.rejects(update(), /이전 설정과 자동 실행 등록을 복원/);
    assert.deepEqual(boots, ["new", "old"]); assert.equal(await readFile(plist, "utf8"), "old"); assert(loaded());
  });
});
test("Mac update does not claim success from an exit code without a registered job", async () => {
  await macUpdateFixture({ phantomSuccess: true }, async ({ update, plist, loaded }) => {
    await assert.rejects(update(), /자동 시작 등록에 실패.*bootstrap 0/);
    assert.equal(await readFile(plist, "utf8"), "old"); assert(loaded());
  });
});

test("project tests choose actual repository checks and refuse missing/private dependency setup", async () => {
  const { projectTestPlan } = await import("../public/jarvis-preview.mjs");
  assert.deepEqual(projectTestPlan(["app.test.mjs"], null, null).commands[0].args, ["node", "--test", "./app.test.mjs"]);
  assert(projectTestPlan([], { scripts: { start: "node app.js" } }, null).reason);
  assert(projectTestPlan([], { scripts: { test: "node --test" }, dependencies: { library: "1" } }, null).reason);
  assert(projectTestPlan([], { scripts: { test: "node --test" } }, { packages: { x: { resolved: "file:../host", link: true } } }).reason);
  const plan = projectTestPlan([], { scripts: { test: "node --test", lint: "eslint", pretest: "must-not-run" } }, null);
  assert.equal(plan.commands.length, 2); assert(plan.commands.every(c => c.args.includes("--ignore-scripts")));
});
