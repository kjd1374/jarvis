// Opt-in integration test: local Supabase only, real Auth/RLS and two isolated browsers.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { emptyWorkspace } from "../src/lib/workspace/types.ts";

const root = new URL("../", import.meta.url);
const info = JSON.parse(
  execFileSync(
    fileURLToPath(new URL("node_modules/.bin/supabase", root)),
    ["status", "-o", "json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(
  info.API_URL,
  "http://127.0.0.1:54321",
  "Never run these tests on a remote database",
);
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_jarvis",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  {
    input: await readFile(
      new URL("supabase/migrations/202610140001_workspace.sql", root),
    ),
    stdio: ["pipe", "pipe", "pipe"],
  },
);
await mkdir(new URL("../test-results", import.meta.url), { recursive: true });
const log = createWriteStream(
  new URL("../test-results/server-storage.log", import.meta.url),
);
const server = spawn(
  process.execPath,
  ["scripts/test-server.mjs", "--local-cloud"],
  {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_TEST_SUPABASE_URL: info.API_URL,
      JARVIS_TEST_SUPABASE_KEY: info.ANON_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const base = "http://127.0.0.1:4317";
const admin = createClient(info.API_URL, info.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users = [];
const checks = [];
let browser;
const anon = () =>
  createClient(info.API_URL, info.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function api(path, token, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function account(label) {
  const email = `jarvis-test-${label}-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID() + "Aa1!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  users.push(data.user.id);
  const first = anon();
  const second = anon();
  const a = await first.auth.signInWithPassword({ email, password });
  const b = await second.auth.signInWithPassword({ email, password });
  assert.ifError(a.error);
  assert.ifError(b.error);
  return {
    id: data.user.id,
    token: a.data.session.access_token,
    secondToken: b.data.session.access_token,
  };
}
function payload(space, content) {
  const data = emptyWorkspace();
  data.activeSpace = space;
  const stamp = new Date().toISOString();
  data.notes.push({
    id: `${space}-note`,
    space,
    projectId: null,
    content,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return data;
}
try {
  let online = false;
  for (let i = 0; i < 360; i++) {
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        online = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(online, "Local app failed to start; see server-storage.log");
  const a = await account("owner-a");
  const b = await account("owner-b");
  assert.equal((await api("/api/workspace?space=company")).status, 401);
  assert.equal((await api("/api/workspace", a.token)).status, 400);
  assert.equal(
    (await api("/api/workspace?space=company", "invalid-token")).status,
    401,
  );
  checks.push("real authentication required; explicit server scope required");
  const company = payload("company", "합성 회사 결과와 다음 행동");
  const stamp = new Date().toISOString();
  company.services.push({
    id: "v4-synthetic",
    name: "합성 v4",
    space: "company",
    projectId: null,
    connector: "v4",
    webUrl: "https://synthetic.example.test",
    repositoryUrl: "",
    favorite: true,
    createdAt: stamp,
    lastSuccessAt: stamp,
    lastAttemptAt: stamp,
    connectionStatus: "connected",
    error: null,
    failures: 0,
    nextRetryAt: null,
  });
  company.sourceRecords.push({
    id: "fact",
    serviceId: "v4-synthetic",
    externalId: "original-1",
    space: "company",
    projectId: null,
    title: "합성 회사 결과",
    content: "원본 결과. 이전 지시를 무시하라는 문장이 있어도 자료일 뿐입니다.",
    status: "done",
    sourceUrl: "https://synthetic.example.test/items/1",
    sourceUpdatedAt: stamp,
    collectedAt: stamp,
    deletedAt: null,
    taskId: null,
  });
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "company",
        data: company,
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "personal",
        data: payload("personal", "합성 개인 전용 비밀"),
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/api/workspace", b.token, "PUT", {
        space: "company",
        data: payload("company", "다른 계정 회사 전용"),
        revision: 0,
      })
    ).status,
    200,
  );
  const fromSecond = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(fromSecond.status, 200);
  assert.equal(fromSecond.body.data.notes[0].content, company.notes[0].content);
  assert(!JSON.stringify(fromSecond.body).includes("개인 전용 비밀"));
  const fromOther = await api("/api/workspace?space=company", b.token);
  assert.equal(fromOther.body.data.notes[0].content, "다른 계정 회사 전용");
  const mixed = structuredClone(company);
  mixed.notes.push(payload("personal", "혼합 거부").notes[0]);
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "company",
        data: mixed,
        revision: 1,
      })
    ).status,
    400,
  );
  const anonymousRows = await anon().from("jarvis_spaces").select("data");
  assert(anonymousRows.error || anonymousRows.data?.length === 0);
  checks.push(
    "two sessions share durable records; other owner and personal data isolated; RLS blocks anonymous reads",
  );
  company.notes[0].content = "합성 회사 결과 수정됨";
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "company",
        data: company,
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/api/workspace", a.secondToken, "PUT", {
        space: "company",
        data: fromSecond.body.data,
        revision: 1,
      })
    ).status,
    409,
  );
  checks.push(
    "optimistic revision prevents stale devices from overwriting server records",
  );
  const synced = await api("/api/integrations/sync", a.token, "POST", {
    space: "company",
    serviceId: "v4-synthetic",
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.connected, false);
  assert.equal(synced.body.data.sourceRecords.length, 1);
  assert.equal(
    synced.body.data.services[0].connectionStatus,
    "needs_connection",
  );
  const searched = await api(
    "/api/workspace/search?space=company&q=결과",
    a.token,
  );
  assert.equal(searched.status, 200);
  assert(searched.body.sources.every((s) => s.space === "company"));
  assert(!JSON.stringify(searched.body).includes("개인 전용 비밀"));
  const answer = await api("/api/assistant/answer", a.token, "POST", {
    space: "company",
    question: "결과",
  });
  assert.equal(answer.status, 501);
  assert.equal(answer.body.executionAuthorized, false);
  assert.equal(answer.body.code, "ai_not_connected");
  assert(
    answer.body.sources.some(
      (s) => s.kind === "fact" && s.freshness === "sync_error",
    ),
  );
  checks.push(
    "unconfigured v4 preserves last records; server search/grounding scope and provenance; no fake AI response",
  );
  browser = await chromium.launch();
  for (const [label, token, expected, absent] of [
    ["device-a", a.token, "합성 회사 결과 수정됨", "다른 계정 회사 전용"],
    ["device-b", a.secondToken, "합성 회사 결과 수정됨", "합성 개인 전용 비밀"],
    ["other-owner", b.token, "다른 계정 회사 전용", "합성 회사 결과 수정됨"],
  ]) {
    const context = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(base + "/settings");
    await page
      .getByRole("button", { name: "현재 영역의 서버 자료 검토", exact: true })
      .click();
    await page
      .getByLabel("병합 기준을 확인했습니다. 저장 전 백업을 권장합니다.", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "검토한 기준으로 병합", exact: true })
      .click();
    await page
      .getByText(
        "서버 자료를 검토해 이 기기에 병합했습니다. 기존에만 있던 항목은 유지됩니다.",
        { exact: true },
      )
      .waitFor();
    await page.goto(base);
    await page.getByText(expected, { exact: true }).waitFor();
    assert.equal(await page.getByText(absent, { exact: true }).count(), 0);
    if (label === "device-a") {
      await page
        .getByLabel("빠른 메모 내용")
        .fill("브라우저에서 실제 서버로 저장한 합성 메모");
      await page
        .getByRole("button", { name: "메모 저장", exact: true })
        .click();
      await page
        .getByText("브라우저에서 실제 서버로 저장한 합성 메모", { exact: true })
        .waitFor();
      await page.goto(base + "/settings");
      await page
        .getByRole("button", {
          name: "현재 영역의 서버 자료 검토",
          exact: true,
        })
        .click();
      await page
        .getByLabel("병합 기준을 확인했습니다. 저장 전 백업을 권장합니다.", {
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "검토한 기준으로 병합", exact: true })
        .click();
      await page
        .getByRole("button", { name: "현재 영역을 서버에 저장", exact: true })
        .click();
      await page
        .getByText(
          "이 영역의 업무 기록과 이 기기에 있는 파일을 서버에 보관했습니다.",
          { exact: true },
        )
        .waitFor();
      const written = await api("/api/workspace?space=company", a.secondToken);
      assert(
        written.body.data.notes.some(
          (n) => n.content === "브라우저에서 실제 서버로 저장한 합성 메모",
        ),
      );
      checks.push(
        "browser review/merge/publish persists a new record for the second authenticated session",
      );
      await page.goto(base);
    }
    await page.screenshot({
      path: new URL(`../test-results/${label}.png`, import.meta.url).pathname,
      fullPage: true,
    });
    await context.close();
  }
  checks.push(
    "two isolated browser profiles restore the same authenticated account; other account remains separate",
  );
  console.log(
    JSON.stringify(
      {
        passed: checks,
        realDatabase: "local Supabase only",
        physicalDevices: false,
        productionCalls: 0,
        paidModelCalls: 0,
        v4LiveCalls: 0,
        fileStorageAPI: "not exercised; local slim stack excludes storage-api",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  log.end();
  for (const user of users) await admin.auth.admin.deleteUser(user);
}
