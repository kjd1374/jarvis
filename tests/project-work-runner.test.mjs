import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeProjectWork, runCodexWork, runCommand, allowedWorkPath } from "../public/jarvis-runner.mjs";
const modelResult = { blocked: false, reply: "합성 화면 수정", summary: "합성 결과", currentStatus: "검증 준비", nextAction: "확인", followUps: [] };
const job = { id: "11111111-1111-4111-8111-111111111111", repository: "example/synthetic", projectId: "project", space: "personal", mode: "change", publish: "pr", request: "PRIVATE REQUEST NEVER PUBLISH", leaseToken: "test-lease", attempt: 1 };
async function fixture({ ci = "success", deliveryFails = false, publish = "pr", failPush = false, blocked = false, cancelAtPublish = false, npmProject = false, npmFailure = false, previewOnly = false, previewEnabled = false, testStatus = "passed", imagePayload, copyImage = false, deployed = false, addedFiles = {}, initialFiles = {}, action } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-work-test-")), source = join(dir, "source"), remote = join(dir, "remote.git");
  await mkdir(source); await runCommand("git", ["init", "-b", "main", source]);
  await writeFile(join(source, "page.js"), "export const title = 'before';\n");
  await writeFile(join(source, ".env.local"), "PRIVATE_FIXTURE_DO_NOT_READ=yes\n");
  for (const [path, content] of Object.entries(initialFiles)) { await mkdir(join(source, path, ".."), { recursive: true }); await writeFile(join(source, path), content); }
  if (npmProject) {
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "synthetic-no-dependencies", version: "1.0.0", private: true, scripts: { preinstall: "node -e 'process.exit(42)'" } }));
    await writeFile(join(source, "package-lock.json"), JSON.stringify({ name: "synthetic-no-dependencies", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "synthetic-no-dependencies", version: "1.0.0", hasInstallScript: true } } }));
  }
  await runCommand("git", ["add", "."], { cwd: source });
  await runCommand("git", ["-c", "user.name=Synthetic", "-c", "user.email=test@invalid.test", "commit", "-m", "synthetic"], { cwd: source });
  await runCommand("git", ["clone", "--bare", source, remote]);
  const baseSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: source })).out.trim();
  let headSha, pr, merged = false, modelCalls = 0, deliveries = 0, pushes = 0, testCalls = 0; const reports = [], ghCalls = [], npmCalls = [], modelJobs = [], modelContents = [];
  const get = async path => {
    if (path === "repos/example/synthetic") return { full_name: "example/synthetic", default_branch: "main" };
    if (path.endsWith("/commits/main")) return { sha: baseSha };
    if (path.includes("/pulls?")) return pr ? [pr] : [];
    if (path.endsWith("/pulls/1")) return { ...pr, merged, merge_commit_sha: "c".repeat(40) };
    if (path.includes("/check-runs?")) return { total_count: 1, check_runs: [{ status: "completed", conclusion: ci }] };
    if (path.includes("/status?")) return { statuses: [], total_count: 0 };
    if (path.includes("/deployments?")) return [{ id: 1, sha: "c".repeat(40), environment: "Production", production_environment: true }];
    if (path.includes("/deployments/1/statuses")) return [{ state: "success", environment_url: "https://synthetic-live.vercel.app" }];
    assert.fail(`Unexpected GitHub path ${path}`);
  };
  const run = async (bin, args, opts) => {
    if (bin === "npm") {
      npmCalls.push({ args, env: opts.env });
      if (npmFailure) return { code: 1, out: "", err: "npm error code EAI_AGAIN\nPRIVATE_FIXTURE_TOKEN=never-publish /private/user/.npmrc" };
      return runCommand(bin, args, { ...opts, env: { ...opts.env, NPM_CONFIG_CACHE: join(dir, "npm-cache") } });
    }
    if (bin === "git") {
      args = args.map(a => a === "protocol.file.allow=never" ? "protocol.file.allow=always" : a);
      if (args.includes("clone")) { args = args.map(a => a === "protocol.file.allow=never" ? "protocol.file.allow=always" : a === "https://github.com/example/synthetic.git" ? remote : a); }
      if (args.includes("push")) { pushes++; if (failPush && pushes === 1) return { code: 1, out: "", err: "synthetic outage" }; }
      const result = await runCommand(bin, args, opts);
      if (args.includes("commit")) headSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: opts.cwd })).out.trim();
      if (args.includes("push") && result.code === 0 && pr) pr.head.sha = headSha;
      return result;
    }
    assert.equal(bin, "gh"); ghCalls.push(args);
    if (args[0] === "pr") {
      const body = await readFile(args[args.indexOf("--body-file") + 1], "utf8"); assert(!body.includes(job.request)); assert(!body.includes("PRIVATE_FIXTURE"));
      pr = { number: 1, state: "open", head: { sha: headSha, ref: `jarvis/work-${job.id}`, repo: { full_name: job.repository } }, base: { ref: "main" } };
      return { code: 0, out: "https://github.com/example/synthetic/pull/1\n", err: "" };
    }
    assert(args.includes("PUT")); assert(args.includes(`sha=${headSha}`)); merged = true; return { code: 0, out: "{}", err: "" };
  };
  const model = async (_job, cwd, _control, options) => { if (_job.images?.length) { assert.equal(await readFile(options.imagePaths[0], "utf8"), Buffer.from(imagePayload[0].bytes,"base64").toString()); if (copyImage) await writeFile(join(cwd,copyImage === "base64" ? "copied.js" : "copied.jpg"),copyImage === "base64" ? `export const reference = "${imagePayload[0].bytes}";` : await readFile(options.imagePaths[0])); } modelCalls++; modelJobs.push(_job); modelContents.push(await readFile(join(cwd, "page.js"), "utf8")); await assert.rejects(readFile(join(cwd, ".env.local")), /ENOENT/); for (const [path, content] of Object.entries(initialFiles)) assert.equal(await readFile(join(cwd, path), "utf8"), content); await writeFile(join(cwd, "page.js"), `export const title = 'after ${modelCalls}';\n`); for (const [path, content] of Object.entries(addedFiles)) { await mkdir(join(cwd, path, ".."), { recursive: true }); await writeFile(join(cwd, path), content); } return { ...modelResult, blocked, ...(action ? { action } : {}) }; };
  const client = { request: async (path, body) => {
    assert.equal(path, "/api/automation/work"); reports.push(body);
    if (body.phase === "images") return { images: imagePayload };
    if (cancelAtPublish && body.phase === "heartbeat" && body.progress === "publishing") throw Object.assign(new Error("cancelled"), { code: "stale_job" });
    if (body.phase === "result" && ++deliveries === 1 && deliveryFails) throw new Error("synthetic lost response");
    return { accepted: true };
  } };
  const options = { stateDir: join(dir, "state"), run, get, model, delay: async () => {}, log: () => {}, previewEnabled,
    testTools: { runProjectTests: async () => { testCalls++; return [{ name: "synthetic test", status: testStatus, detail: "Synthetic adapter result" }]; } },
    previewTools: { findDeploymentPreview: async (_repo, sha) => deployed ? { state: "ready", kind: "deployment", sha, url: "https://synthetic-existing.vercel.app/", checkedAt: new Date().toISOString(), expiresAt: null, message: "Observed synthetic deployment" } : null, startMacPreview: async ({ sha, persistent }) => ({ ...(persistent ? { dataPersistence: "project" } : {}), state: "ready", kind: "mac", sha, url: "http://127.0.0.1:45678/", checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), message: "Synthetic preview" }) } };
  const execute = (overrides = {}) => executeProjectWork(client, { ...job, publish, mode: previewOnly ? "preview" : job.mode, ...overrides }, options);
  return { dir, execute, reports, ghCalls, npmCalls, modelJobs, modelContents, testCalls: () => testCalls, counts: () => ({ modelCalls, deliveries, pushes, merged }) };
}
test("real npm prepares a locked dependency-free project without running install hooks, including redelivery", async () => {
  const f = await fixture({ npmProject: true, deliveryFails: true });
  try {
    await f.execute(); await f.execute();
    const result = f.reports.find(r => r.phase === "result")?.result;
    assert.equal(result?.checks.find(c => c.name === "의존성 준비")?.status, "passed");
    assert.equal(f.npmCalls.length, 1);
    const { env, args } = f.npmCalls[0];
    assert(args.includes("--ignore-scripts"));
    assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
    assert.equal(await readFile(env.NPM_CONFIG_USERCONFIG, "utf8"), "");
    assert.equal(await readFile(env.NPM_CONFIG_GLOBALCONFIG, "utf8"), "");
    assert.equal(f.modelJobs[0].context.runnerPreparation.checks[0].status, "passed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("npm failure is explained without exposing logs, informs the model and prevents merge", async () => {
  const f = await fixture({ npmProject: true, npmFailure: true, publish: "merge" });
  try {
    await f.execute();
    const result = f.reports.find(r => r.phase === "result")?.result;
    const check = result?.checks.find(c => c.name === "의존성 준비");
    assert.equal(check?.status, "failed");
    assert.match(check.detail, /EAI_AGAIN/);
    assert(!JSON.stringify(result).includes("PRIVATE_FIXTURE_TOKEN"));
    assert(!JSON.stringify(f.modelJobs).includes("/private/user"));
    assert.deepEqual(f.modelJobs[0].context.runnerPreparation.checks, [check]);
    assert.equal(f.counts().merged, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("CLI work edits a real isolated fixture, commits/pushes once and redelivers without another model call", async () => {
  const f = await fixture({ deliveryFails: true });
  try {
    await f.execute(); await f.execute();
    assert.deepEqual(f.counts(), { modelCalls: 1, deliveries: 2, pushes: 1, merged: false });
    const result = f.reports.find(r => r.phase === "result").result;
    assert.deepEqual(result.changes, ["page.js"]); assert.equal(result.outcome, "pr_open"); assert.equal(result.checks.at(-1).status, "passed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("merge policy requires observed CI success and verifies the exact merged deployment", async () => {
  const f = await fixture({ publish: "merge" });
  try { await f.execute(); const result = f.reports.find(r => r.phase === "result")?.result; assert.equal(result?.outcome, "deployed"); assert.equal(result.deployment.sha, "c".repeat(40)); assert.equal(f.counts().merged, true); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("failed CI keeps the PR open and automatically records a follow-up without merging", async () => {
  const f = await fixture({ publish: "merge", ci: "failure" });
  try { await f.execute(); const result = f.reports.find(r => r.phase === "result")?.result; assert.equal(result?.outcome, "pr_open"); assert.equal(result.checks.at(-1).status, "failed"); assert(result.followUps.length); assert.equal(f.counts().merged, false); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("retry after a push failure reuses the committed change and model result", async () => {
  const f = await fixture({ failPush: true });
  try { await f.execute(); await f.execute(); assert.equal(f.counts().modelCalls, 1); assert.equal(f.reports.at(-1).phase, "result"); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("work Codex uses the user's ChatGPT subscription, isolated writable sandbox and network prohibition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-codex-test-"));
  try {
    await runCodexWork(job, dir, dir, { env: { HOME: "/synthetic", OPENAI_API_KEY: "never-forward" }, run: async (bin, args, opts) => {
      assert.equal(bin, "codex"); assert(!opts.env.OPENAI_API_KEY);
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
      assert(args.includes("workspace-write")); assert(args.includes("sandbox_workspace_write.network_access=false")); assert(args.includes("project_doc_max_bytes=0"));
      assert(!args.includes("--dangerously-bypass-approvals-and-sandbox")); assert(opts.input.includes(job.request));
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(modelResult)); return { code: 0, out: "", err: "" };
    } });
    for (const path of [".git/config", ".github/workflows/ci.yml", "../page.js", "uploads/data.txt", "auth.json", "AGENTS.md"]) assert.equal(allowedWorkPath(path), false);
    await assert.rejects(runCodexWork(job, dir, dir, { run: async () => ({ code: 0, out: "Logged in using API key", err: "" }) }), /cli_login_required/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cancelled lease stops publication even if the model already edited local files", async () => {
  const f = await fixture({ cancelAtPublish: true });
  try { await f.execute(); assert.equal(f.counts().pushes, 0); assert.equal(f.counts().merged, false); assert(!f.reports.some(r => r.phase === "result")); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});

for (const mode of ["ask", "change"]) test(`target-app auth scope reaches the actual CLI developer instructions in ${mode} mode`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-auth-scope-"));
  const request = "Implement the approved project plan.";
  try {
    await runCodexWork({ ...job, mode, request, context: { project: { plan: "Implement target-app login and roles." } } }, dir, dir, {
      env: { HOME: "/synthetic", OPENAI_API_KEY: "never-forward", SUPABASE_SERVICE_ROLE_KEY: "never-forward" },
      run: async (_bin, args, opts) => {
        assert(!opts.env.OPENAI_API_KEY); assert(!opts.env.SUPABASE_SERVICE_ROLE_KEY);
        if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
        if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
        const configured = args.find(value => value.startsWith("developer_instructions="));
        const policy = JSON.parse(configured.slice("developer_instructions=".length));
        assert(opts.input.startsWith(policy + "\nUSER REQUEST:\n" + request));
        assert(policy.includes("Application authentication/authorization source modules are code"));
        assert(policy.includes("credential stores such as auth.json"));
        assert(policy.includes("Never apply migrations or change accounts, roles, grants, RLS or authentication settings on existing external/shared/production"));
        assert(!policy.includes("or modify authentication/access policies"));
        assert(args.includes("sandbox_workspace_write.network_access=false"));
        assert(args.includes(mode === "ask" ? "read-only" : "workspace-write"));
        if (mode === "change") {
          assert(policy.includes("No separate permission waiver is needed"));
          assert(policy.includes("plan the user explicitly asked you to implement"));
          assert(policy.includes("Enforce access on the server"));
          assert(policy.includes("disposable local synthetic data"));
          assert(policy.includes("does not authorize changing Jarvis device approval, owner/space isolation or runner security policy"));
        } else {
          assert(policy.includes("Authentication/authorization questions remain read-only"));
          assert(!policy.includes("No separate permission waiver is needed"));
        }
        await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(modelResult));
        return { code: 0, out: "", err: "" };
      },
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("target-app auth source, tests and migration files survive checkout and publishing gates", async () => {
  const addedFiles = {
    "src/auth/access-control.mjs": "export const canEdit = role => role === 'admin';\n",
    "tests/access-control.test.mjs": "import assert from 'node:assert/strict';\nimport { canEdit } from '../src/auth/access-control.mjs';\nassert(canEdit('admin')); assert(!canEdit('viewer')); assert(!canEdit(undefined));\n",
    "migrations/001-access.sql": "create table app_roles (user_id text primary key, role text not null);\n",
  };
  const f = await fixture({ addedFiles, initialFiles: { "src/auth/access-control.mjs": "export const canEdit = () => false;\n" }, deliveryFails: true });
  try {
    await f.execute(); await f.execute();
    const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.outcome, "pr_open");
    assert.deepEqual(result.changes.sort(), ["page.js", ...Object.keys(addedFiles)].sort());
    assert.equal(f.counts().modelCalls, 1); assert.equal(f.counts().pushes, 1);
    const published = join(f.dir, "published");
    assert.equal((await runCommand("git", ["clone", "--branch", result.branch, join(f.dir, "remote.git"), published])).code, 0);
    for (const [path, content] of Object.entries(addedFiles)) assert.equal(await readFile(join(published, path), "utf8"), content);
    const checks = await runCommand(process.execPath, ["--test", "tests/access-control.test.mjs"], { cwd: published });
    assert.equal(checks.code, 0, checks.err + checks.out);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("target-app implementation does not permit publishing credential stores", async () => {
  const f = await fixture({ addedFiles: { "auth.json": '{"session":"synthetic-private-session"}' } });
  try {
    await f.execute();
    assert.equal(f.reports.at(-1).code, "change_scope_exceeded");
    assert.equal(f.counts().pushes, 0);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("obsolete auth-policy refusal receives one correction in the same sandbox, with no scope expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-auth-correction-"));
  const previous = { ...modelResult, blocked: true, reply: "상위 실행 지침의 인증·접근 정책을 수정하지 말라는 제한으로 권한 기능을 구현하지 않았습니다." };
  let calls = 0, originalArgs;
  try {
    const result = await runCodexWork({ ...job, context: { history: [previous] } }, dir, dir, { run: async (_bin, args, opts) => {
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
      calls++;
      assert.equal(opts.cwd, undefined);
      assert.equal(args[args.indexOf("--cd") + 1], dir);
      assert(args.includes("sandbox_workspace_write.network_access=false"));
      assert(opts.input.includes(job.request));
      if (calls === 1) {
        originalArgs = args;
        await writeFile(join(dir, "partial-code.mjs"), "export const draft = true;");
      } else {
        assert.deepEqual(args, originalArgs);
        assert(opts.input.includes("SCOPE CORRECTION:"));
        assert(opts.input.includes("Preserve all credential, production-service, Jarvis-security and publishing restrictions"));
        assert.equal(await readFile(join(dir, "partial-code.mjs"), "utf8"), "export const draft = true;");
      }
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(calls === 1 ? previous : modelResult));
      return { code: 0, out: "", err: "" };
    } });
    assert.equal(calls, 2); assert.equal(result.blocked, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [mode, reply, expected] of [
  ["change", "인증·접근 정책 변경 금지로 구현할 수 없습니다.", 2],
  ["change", "상위 지침 prohibits: modify authentication/access policies", 2],
  ["change", "외부 운영 DB의 인증·접근 정책 변경 금지입니다.", 1],
  ["change", "역할 요구사항이 없습니다. 담당 범위를 정해주세요.", 1],
  ["change", "인증정보가 없습니다. 인증·접근 정책 변경 금지입니다.", 1],
  ["ask", "인증·접근 정책 변경 금지입니다.", 1],
]) test(`auth correction is bounded and respects genuine blockers: ${mode} ${reply}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-auth-bounded-")); let calls = 0;
  try {
    const task = runCodexWork({ ...job, mode }, dir, dir, { run: async (_bin, args) => {
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
      calls++; await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ ...modelResult, blocked: true, reply }));
      return { code: 0, out: "", err: "" };
    } });
    if (expected === 2) {
      await assert.rejects(task, /cli_policy_conflict/);
      await assert.rejects(readFile(join(dir, "model-result.json")), /ENOENT/);
    } else assert.equal((await task).blocked, true);
    assert.equal(calls, expected);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cancellation fences an auth correction before another model call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-auth-cancel-")), abort = new AbortController(); let calls = 0;
  try {
    await assert.rejects(runCodexWork(job, dir, dir, { signal: abort.signal, run: async (_bin, args) => {
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
      calls++; await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ ...modelResult, blocked: true, reply: "인증·접근 정책 변경 금지입니다." }));
      abort.abort(); return { code: 0, out: "", err: "" };
    } }), /stale_job/);
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(dir, "model-result.json")), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("a blocked model result never publishes a partial implementation", async () => {
  const f = await fixture({ blocked: true, publish: "merge" });
  try { await f.execute(); assert.equal(f.counts().pushes, 0); assert.equal(f.reports.find(r => r.phase === "result").result.outcome, "blocked"); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("preview-only work prepares a pinned screen without model use, code writes, or replay", async () => {
  const f = await fixture({ previewOnly: true, previewEnabled: true, deliveryFails: true });
  try { await f.execute(); await f.execute();
    assert.equal(f.counts().modelCalls, 0); assert.equal(f.counts().pushes, 0);
    const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.preview.state, "ready"); assert.equal(result.preview.sha, result.baseSha);
    assert.equal(result.prUrl, null); assert.equal(result.outcome, "answered");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("code work attaches the changed commit preview without calling the model twice", async () => {
  const f = await fixture({ previewEnabled: true });
  try { await f.execute(); const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.preview.sha, result.headSha); assert.equal(result.outcome, "pr_open"); assert.equal(f.counts().modelCalls, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("remote test-only jobs return observed checks without a model, publication or duplicate execution", async () => {
  const f = await fixture({ deliveryFails: true, testStatus: "failed" });
  try {
    await f.execute({ mode: "test" }); await f.execute({ mode: "test" });
    assert.equal(f.testCalls(), 1); assert.equal(f.counts().modelCalls, 0); assert.equal(f.counts().pushes, 0);
    const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.outcome, "blocked"); assert.equal(result.checks[0].status, "failed"); assert.equal(result.prUrl, null);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("local test failure prevents merge even when GitHub CI passes", async () => {
  const f = await fixture({ publish: "merge", testStatus: "failed" });
  try {
    await f.execute(); assert.equal(f.counts().merged, false);
    assert.equal(f.reports.find(r => r.phase === "result").result.outcome, "pr_open");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("a selected unmerged change is previewed and continued in its existing PR, never replaced with main", async () => {
  const f = await fixture({ previewEnabled: true });
  try {
    await f.execute(); const first = f.reports.find(r => r.phase === "result").result;
    const source = { prUrl: first.prUrl, branch: first.branch, headSha: first.headSha, baseSha: first.baseSha };
    await f.execute({ id: "22222222-2222-4222-8222-222222222222", mode: "preview", source });
    assert.equal(f.reports.at(-1).result.preview.sha, source.headSha);
    await f.execute({ id: "33333333-3333-4333-8333-333333333333", source });
    const continued = f.reports.at(-1).result;
    assert.match(f.modelContents[1], /after 1/);
    assert.equal(continued.prUrl, first.prUrl); assert.equal(continued.branch, first.branch);
    assert.notEqual(continued.headSha, first.headSha); assert.equal(continued.baseSha, first.baseSha);
    assert.equal(f.ghCalls.filter(args => args[0] === "pr").length, 1);
    assert.equal(f.modelJobs[1].context.runnerPreparation.revision.sha, first.headSha);
    await f.execute({ id: "44444444-4444-4444-8444-444444444444", mode: "test", source });
    assert.equal(f.reports.at(-1).code, "work_source_changed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("attached screenshots reach the actual Codex image argument outside Git and are removed afterwards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-image-cli-"));
  try {
    const image = join(dir, "reference.jpg"); await writeFile(image, "synthetic-image-bytes");
    await runCodexWork(job, dir, dir, { imagePaths: [image], run: async (_bin, args) => {
      if (args[0] === "login") return { code:0,out:"Logged in using ChatGPT",err:"" };
      if (args[1] === "--help") return { code:0,out:"--ignore-user-config --ignore-rules --ephemeral --output-schema --image",err:"" };
      assert.equal(args[args.indexOf("--image")+1], image); assert.equal(await readFile(image,"utf8"),"synthetic-image-bytes");
      await writeFile(args[args.indexOf("--output-last-message")+1],JSON.stringify(modelResult)); return {code:0,out:"",err:""};
    }});
  } finally { await rm(dir,{recursive:true,force:true}); }
  const bytes = Buffer.from("synthetic-image-bytes"), sha256=createHash("sha256").update(bytes).digest("hex");
  const imagePayload=[{id:"synthetic-image",sha256,mime:"image/jpeg",bytes:bytes.toString("base64")}], f=await fixture({imagePayload});
  try { await f.execute({images:[{id:"synthetic-image",sha256}]}); assert.equal(f.counts().modelCalls,1); assert.equal(f.reports.at(-1).phase,"result");
    const result=f.reports.at(-1).result; assert.deepEqual(result.changes,["page.js"]);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test("a model cannot publish private screenshots as files or inline base64", async()=>{
 const bytes=Buffer.from("synthetic-image-bytes".repeat(10)),sha256=createHash("sha256").update(bytes).digest("hex"),imagePayload=[{id:"private-image",sha256,mime:"image/jpeg",bytes:bytes.toString("base64")}];
 for(const copyImage of [true,"base64"]){const f=await fixture({imagePayload,copyImage});
 try{await f.execute({images:[{id:"private-image",sha256}]});assert.equal(f.reports.at(-1).phase,"error");assert.equal(f.reports.at(-1).code,"private_image_in_change");assert.equal(f.counts().pushes,0);}finally{await rm(f.dir,{recursive:true,force:true});}}
});

test("explicit development uses project-persistent local execution even when a deployment exists",async()=>{
 for(const stage of [undefined,"development"]){const f=await fixture({previewOnly:true,previewEnabled:true,deployed:true});try{await f.execute({context:{project:{stage}}});const result=f.reports.at(-1).result;assert.equal(result.preview.kind,stage?"mac":"deployment");if(stage)assert.equal(result.preview.dataPersistence,"project");}finally{await rm(f.dir,{recursive:true,force:true});}}
});

test("status question in change mode answers without tests, publication or preview, even if a model edited locally", async () => {
  const f = await fixture({ action: "answer", publish: "merge", previewEnabled: true });
  try {
    await f.execute({ request: "이전 개발이 진행 중인가요?", context: { history: [{ outcome: "blocked" }] } });
    const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.outcome, "answered"); assert.equal(result.blocked, false);
    assert.deepEqual(result.changes, []); assert.equal(result.prUrl, null); assert.equal(result.branch, null);
    assert.equal(result.preview, undefined); assert.equal(f.testCalls(), 0); assert.equal(f.counts().pushes, 0);
    assert.deepEqual(f.ghCalls, []);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("explicit edit action still implements, tests and publishes under the original scope", async () => {
  const f = await fixture({ action: "edit" });
  try { await f.execute(); const result = f.reports.find(r => r.phase === "result").result;
    assert.equal(result.outcome, "pr_open"); assert.equal(f.testCalls(), 1); assert.equal(f.counts().pushes, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("structured current-request intent keeps old development blockers separate from a completed status answer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-intent-test-"));
  try {
    const answer = await runCodexWork({ ...job, request: "지금 작업 중인가요?", context: { history: [{ blocked: true }] } }, dir, dir, { run: async (_bin, args, opts) => {
      if (args[0] === "login") return { code: 0, out: "Logged in using ChatGPT", err: "" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --ephemeral --output-schema", err: "" };
      const schema = JSON.parse(await readFile(args[args.indexOf("--output-schema") + 1], "utf8"));
      assert(schema.required.includes("action")); assert.deepEqual(schema.properties.action.enum, ["answer", "edit"]);
      assert(opts.input.includes("Change mode is a permission ceiling")); assert(opts.input.includes("not whether earlier development finished"));
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ ...modelResult, action: "answer", reply: "이전 개발은 멈췄고 이번에는 상태 질문에 답했습니다." }));
      return { code: 0, out: "", err: "" };
    } });
    assert.equal(answer.action, "answer"); assert.equal(answer.blocked, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ask scope stays read-only for publication even when a model returns edit intent', async () => {
  const f = await fixture({ action: 'edit', publish: 'merge', previewEnabled: true });
  try {
    await f.execute({ mode: 'ask' });
    const result = f.reports.find(r => r.phase === 'result').result;
    assert.equal(result.outcome, 'answered'); assert.deepEqual(result.changes, []);
    assert.equal(f.counts().pushes, 0); assert.equal(f.testCalls(), 0); assert.equal(result.preview, undefined);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
