import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeProjectWork, runCodexWork, runCommand, allowedWorkPath } from "../public/jarvis-runner.mjs";
const modelResult = { blocked: false, reply: "합성 화면 수정", summary: "합성 결과", currentStatus: "검증 준비", nextAction: "확인", followUps: [] };
const job = { id: "11111111-1111-4111-8111-111111111111", repository: "example/synthetic", projectId: "project", space: "personal", mode: "change", publish: "pr", request: "PRIVATE REQUEST NEVER PUBLISH", leaseToken: "test-lease", attempt: 1 };
async function fixture({ ci = "success", deliveryFails = false, publish = "pr", failPush = false, blocked = false, cancelAtPublish = false, npmProject = false, npmFailure = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-work-test-")), source = join(dir, "source"), remote = join(dir, "remote.git");
  await mkdir(source); await runCommand("git", ["init", "-b", "main", source]);
  await writeFile(join(source, "page.js"), "export const title = 'before';\n");
  await writeFile(join(source, ".env.local"), "PRIVATE_FIXTURE_DO_NOT_READ=yes\n");
  if (npmProject) {
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "synthetic-no-dependencies", version: "1.0.0", private: true, scripts: { preinstall: "node -e 'process.exit(42)'" } }));
    await writeFile(join(source, "package-lock.json"), JSON.stringify({ name: "synthetic-no-dependencies", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "synthetic-no-dependencies", version: "1.0.0", hasInstallScript: true } } }));
  }
  await runCommand("git", ["add", "."], { cwd: source });
  await runCommand("git", ["-c", "user.name=Synthetic", "-c", "user.email=test@invalid.test", "commit", "-m", "synthetic"], { cwd: source });
  await runCommand("git", ["clone", "--bare", source, remote]);
  const baseSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: source })).out.trim();
  let headSha, pr, merged = false, modelCalls = 0, deliveries = 0, pushes = 0; const reports = [], ghCalls = [], npmCalls = [], modelJobs = [];
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
      return result;
    }
    assert.equal(bin, "gh"); ghCalls.push(args);
    if (args[0] === "pr") {
      const body = await readFile(args[args.indexOf("--body-file") + 1], "utf8"); assert(!body.includes(job.request)); assert(!body.includes("PRIVATE_FIXTURE"));
      pr = { number: 1, head: { sha: headSha, ref: `jarvis/work-${job.id}` }, base: { ref: "main" } };
      return { code: 0, out: "https://github.com/example/synthetic/pull/1\n", err: "" };
    }
    assert(args.includes("PUT")); assert(args.includes(`sha=${headSha}`)); merged = true; return { code: 0, out: "{}", err: "" };
  };
  const model = async (_job, cwd) => { modelCalls++; modelJobs.push(_job); await assert.rejects(readFile(join(cwd, ".env.local")), /ENOENT/); await writeFile(join(cwd, "page.js"), "export const title = 'after';\n"); return { ...modelResult, blocked }; };
  const client = { request: async (path, body) => {
    assert.equal(path, "/api/automation/work"); reports.push(body);
    if (cancelAtPublish && body.phase === "heartbeat" && body.progress === "publishing") throw Object.assign(new Error("cancelled"), { code: "stale_job" });
    if (body.phase === "result" && ++deliveries === 1 && deliveryFails) throw new Error("synthetic lost response");
    return { accepted: true };
  } };
  const options = { stateDir: join(dir, "state"), run, get, model, delay: async () => {}, log: () => {} };
  const execute = () => executeProjectWork(client, { ...job, publish }, options);
  return { dir, execute, reports, ghCalls, npmCalls, modelJobs, counts: () => ({ modelCalls, deliveries, pushes, merged }) };
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
test("a blocked model result never publishes a partial implementation", async () => {
  const f = await fixture({ blocked: true, publish: "merge" });
  try { await f.execute(); assert.equal(f.counts().pushes, 0); assert.equal(f.reports.find(r => r.phase === "result").result.outcome, "blocked"); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});
