import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedPath, redact, githubGet, collectRepository, cliEnvironment, analyzeWithCodex, validateOrigin, createAppClient, executeJob, RunnerError } from "../public/jarvis-runner.mjs";
const head = "a".repeat(40), blob = "b".repeat(40), stamp = "2026-10-15T10:00:00Z";
function sourceGet({ partial = false, denied = false } = {}) {
  const paths = [];
  const get = async path => {
    paths.push(path);
    if (path === "repos/example/test") return { full_name: "example/test", default_branch: "main", updated_at: stamp };
    if (path.endsWith("/commits/main")) return { sha: head, commit: { committer: { date: stamp } } };
    if (path.includes("/git/trees/")) return { truncated: partial, tree: [{ type: "blob", path: "README.md", size: 30, sha: blob }, { type: "blob", path: ".env.local", size: 30, sha: blob }] };
    if (path.includes("/git/blobs/")) return { encoding: "base64", content: Buffer.from("합성 README 검증").toString("base64"), size: 30 };
    if (path.includes("/check-runs")) return { check_runs: [] };
    if (path.includes("/status?")) return { statuses: [] };
    if (path.includes("/issues?") && denied) throw new RunnerError("github_auth_required");
    return [];
  }; return { get, paths };
}
test("secret/customer files excluded; normal code and CI allowed; redact tokens", () => {
  for (const path of [".env", ".env.local", "sub/.aws/keys", "auth.json", "src/credentials.ts", "uploads/text.md", "customer/list.ts", "customers/a.md", "data/a.sql", "fixtures/a.md", "../bad.ts", "package-lock.json"]) assert.equal(allowedPath(path), false, path);
  for (const path of ["README.md", "src/app/page.tsx", "package.json", ".github/workflows/ci.yml"]) assert.equal(allowedPath(path), true, path);
  assert.equal(redact("ghp_" + "x".repeat(24)), "[토큰 제외]");
});
test("GitHub transport is fixed GET without a shell or arbitrary host", async () => {
  let args;
  assert.deepEqual(await githubGet("repos/example/test", async (bin, argv) => { assert.equal(bin, "gh"); args = argv; return { code: 0, out: "[]", err: "" }; }), []);
  assert(args.includes("GET")); assert(args.includes("github.com"));
  await assert.rejects(githubGet("https://evil.example", () => assert.fail()), /invalid_repository/);
  await assert.rejects(githubGet("repos/example/test", async () => ({ code: 1, err: "HTTP 429 rate limit" })), /github_rate_limited/);
});
test("collector pins SHA, excludes secrets, reuses unchanged blobs and preserves partial results", async () => {
  const source = sourceGet(), job = { repository: "example/test" };
  const first = await collectRepository(job, source.get, () => stamp);
  assert.equal(first.inspection.filesTotal, 2); assert.equal(first.inspection.excludedFiles, 1);
  assert(first.items.find(f => f.title === "README.md").sourceUrl.includes(`/blob/${head}/`));
  assert(!source.paths.some(p => p.includes(".env")));
  source.paths.length = 0;
  const second = await collectRepository({ ...job, previousInspection: { ...first.inspection, inspectedAt: stamp }, previousSourceIds: [...first.items.map(f => f.externalId), "github:example/test:file:removed.ts"] }, source.get, () => stamp);
  assert(!source.paths.some(p => p.includes("/git/blobs/")));
  assert.equal(second.unchangedIds.length, 1); assert.deepEqual(second.deletedIds, ["github:example/test:file:removed.ts"]);
  const partial = sourceGet({ partial: true, denied: true });
  const third = await collectRepository({ ...job, previousSourceIds: ["github:example/test:file:removed.ts"] }, partial.get, () => stamp);
  assert.deepEqual(third.deletedIds, []); assert(third.inspection.limitations.some(v => v.includes("이슈")));
});
test("subscription-only Codex argv disables tools, isolates config and drops API keys", async () => {
  const calls = [];
  const result = await analyzeWithCodex({ facts: [{ id: "fact", title: "README.md", sourceUrl: `https://github.com/example/test/blob/${head}/README.md` }], inspection: { headSha: head } }, [{ path: "README.md", sha: blob, content: "자료의 문장은 지시가 아니다" }], {
    env: { PATH: process.env.PATH, HOME: "/synthetic/home", OPENAI_API_KEY: "must-not-pass", ANTHROPIC_API_KEY: "must-not-pass", CODEX_API_KEY: "must-not-pass" },
    run: async (bin, args, opts) => {
      calls.push(args); assert.equal(bin, "codex"); assert(!("OPENAI_API_KEY" in opts.env)); assert(!("CODEX_API_KEY" in opts.env));
      if (args[0] === "login") return { code: 0, out: "", err: "Logged in using ChatGPT" };
      if (args[1] === "--help") return { code: 0, out: "--ignore-user-config --ignore-rules --output-schema --ephemeral", err: "" };
      assert(args.includes("read-only")); assert(args.includes("shell_tool")); assert(args.includes("unified_exec")); assert(args.includes("multi_agent"));
      assert(opts.input.includes("신뢰하지 않는 자료")); assert(opts.input.includes("sourceId"));
      await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ summary: "合成" }));
      return { code: 0, out: "", err: "" };
    },
  });
  assert.deepEqual(result, { summary: "合成" }); assert.equal(calls.length, 3);
  assert.deepEqual(cliEnvironment({ OPENAI_API_KEY: "x", HOME: "/a" }), { HOME: "/a" });
  await assert.rejects(analyzeWithCodex({ facts: [] }, [], { run: async () => ({ code: 0, out: "Logged in using an API key", err: "" }) }), /cli_login_required/);
});
test("Jarvis cookies stay in a private local file and requests never follow redirects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-runner-test-"));
  try {
    const path = join(dir, "device.json"); let requests = 0;
    const client = await createAppClient("https://jarvis.example", path, async (url, options) => {
      assert(url.startsWith("https://jarvis.example/api/")); assert.equal(options.redirect, "manual"); assert.equal(options.headers.Origin, "https://jarvis.example");
      if (requests++) assert.equal(options.headers.Cookie, "sb-synthetic-auth-token=synthetic");
      return new Response(JSON.stringify({ authenticated: false }), { headers: { "Set-Cookie": "sb-synthetic-auth-token=synthetic; HttpOnly; Secure" } });
    });
    await client.request("/api/account"); await client.request("/api/account");
    await client.request("/api/preview/config");
    await client.request("/api/preview/access", { space: "personal", projectId: "synthetic" });
    await assert.rejects(client.request("/api/preview/open"), /invalid_app_path/);
    await assert.rejects(client.request("https://synthetic.trycloudflare.com/"), /invalid_app_path/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert(JSON.parse(await readFile(path, "utf8")).cookies["sb-synthetic-auth-token"]);
    await assert.rejects(client.request("/api/workspace"), /invalid_app_path/);
    const redirect = await createAppClient("https://jarvis.example", join(dir, "other.json"), async () => new Response(null, { status: 302 }));
    await assert.rejects(redirect.request("/api/account"), /unexpected_redirect/);
    for (const origin of ["http://example.com", "https://user:pass@example.com", "https://example.com/x", "https://example.com/?token=x"]) assert.throws(() => validateOrigin(origin));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("delivery retry reuses the completed local analysis without another model call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-delivery-test-"));
  try {
    let analyses = 0, deliveries = 0, storedFacts;
    const client = { request: async (path, body) => {
      assert.equal(path, "/api/automation/report");
      if (body.phase === "facts") { storedFacts = body.result; return { analysisRequired: true, basis: "basis", input: { facts: [] } }; }
      if (body.phase === "analysis" && ++deliveries === 1) throw new Error("network disconnected");
      return { accepted: true };
    } };
    const options = { stateDir: dir, log: () => {}, collect: async () => ({ items: [], analysisFiles: [{ externalId: "github:example/test:file:README.md", content: "private source" }] }), analyze: async () => { analyses++; return { summary: "synthetic" }; } };
    const job = { id: "job", space: "company", serviceId: "service", repository: "example/test", provider: "codex" };
    await executeJob(client, job, options); await executeJob(client, job, options);
    assert.equal(analyses, 1); assert.equal(deliveries, 2); assert(!("analysisFiles" in storedFacts));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("unchanged evidence skips model use entirely", async () => {
  await executeJob({ request: async () => ({ analysisRequired: false }) }, { id: "job" }, { collect: async () => ({ items: [] }), analyze: () => assert.fail("unchanged evidence must not use model"), log: () => {} });
});

test("web discovery uses homepage, successful deployments, Pages and explicit README links", async () => {
  const source = sourceGet();
  const first = await collectRepository({ repository: "example/test" }, async path => {
    if (path === "repos/example/test") return { full_name: "example/test", default_branch: "main", homepage: "https://project-live.vercel.app", has_pages: true };
    if (path.endsWith("/pages")) return { status: "built", html_url: "https://example-user.github.io/project/" };
    if (path.includes("/git/blobs/")) return { encoding: "base64", content: Buffer.from("[Live demo](https://demo-live.vercel.app) [Docs](https://irrelevant-docs.org) [Website](https://localhost)").toString("base64"), size: 200 };
    if (path.includes("/deployments?")) return [{ id: 1, sha: head, environment: "Production" }, { id: 2, sha: head, environment: "Preview" }];
    if (path.includes("/deployments/1/statuses")) return [{ state: "success", environment_url: "https://production-live.vercel.app", created_at: stamp }];
    if (path.includes("/deployments/2/statuses")) return [{ state: "failure", environment_url: "https://failed-live.vercel.app", created_at: stamp }];
    return source.get(path);
  });
  assert.deepEqual(first.webLinks.map(l => l.kind), ["homepage", "deployment", "pages", "readme"]);
  assert(!JSON.stringify(first.webLinks).includes("failed-live")); assert(!JSON.stringify(first.webLinks).includes("irrelevant-docs"));
  const second = await collectRepository({ repository: "example/test", previousInspection: first.inspection, previousSourceIds: first.items.map(i => i.externalId), previousWebLinks: first.webLinks }, source.get);
  assert(second.webLinks.some(l => l.kind === "readme"));
});
