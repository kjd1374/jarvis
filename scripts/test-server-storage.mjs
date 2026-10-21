// Opt-in integration test: local Supabase only, real Auth/RLS and two isolated browsers.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppClient, VERSION } from "../public/jarvis-runner.mjs";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { emptyWorkspace } from "../src/lib/workspace/types.ts";
import { createLifecycleNetwork } from "../tests/support/lifecycle-network.mjs";
import { runReleaseLifecycle } from "../tests/support/release-lifecycle.mjs";
import { runProjectLifecycle } from "../tests/support/project-lifecycle.mjs";

try {
  await fetch("http://127.0.0.1:4317/api/health", { signal: AbortSignal.timeout(500) });
  throw new Error("The disposable test port 4317 is occupied. Stop the earlier test server before running storage checks.");
} catch (error) { if (error.message.startsWith("The disposable")) throw error; }
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
  fileURLToPath(new URL("node_modules/.bin/supabase", root)),
  ["migration", "up", "--local"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
function sql(query) {
  return execFileSync(
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
      "-At",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const workspaceId = sql(
  "select workspace_id from public.jarvis_installation where singleton",
);
assert(/^[a-f0-9-]{36}$/.test(workspaceId));
await mkdir(new URL("../test-results", import.meta.url), { recursive: true });
const log = createWriteStream(
  new URL("../test-results/server-storage.log", import.meta.url),
);
const lifecycleNetwork = await createLifecycleNetwork();
const server = spawn(
  process.execPath,
  ["scripts/test-server.mjs", "--local-cloud"],
  {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_TEST_SUPABASE_URL: info.API_URL,
      JARVIS_TEST_SUPABASE_KEY: info.ANON_KEY,
      JARVIS_TEST_PREVIEW_PROXY: lifecycleNetwork.proxy,
      JARVIS_TEST_PREVIEW_CA: lifecycleNetwork.ca,
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
const recordCheck = (check) => {
  checks.push(check);
  console.log(JSON.stringify({ check, status: "passed" }));
};
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
  const first = anon(),
    second = anon();
  const a = await first.auth.signInAnonymously(),
    b = await second.auth.signInAnonymously();
  assert.ifError(a.error);
  assert.ifError(b.error);
  users.push(a.data.user.id, b.data.user.id);
  assert.ifError((await first.rpc("jarvis_register_device")).error);
  assert.ifError((await second.rpc("jarvis_register_device")).error);
  return {
    label,
    client: first,
    id: a.data.user.id,
    secondId: b.data.user.id,
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
  for (const headers of [
    {},
    {
      Origin: "https://untrusted.example.test",
      Authorization: "Bearer forged",
    },
  ]) {
    assert.equal(
      (await fetch(base + "/api/account/device", { method: "POST", headers }))
        .status,
      403,
    );
  }
  recordCheck(
    "device bootstrap rejects absent/foreign origins even with a forged Authorization header",
  );
  const a = await account("owner-a");
  const b = await account("unapproved-device");
  sql(
    `update public.jarvis_devices set approved_at=now() where user_id in ('${a.id}','${a.secondId}')`,
  );
  if (!process.argv.includes("--release-only")) {
  assert.equal((await api("/api/workspace?space=company")).status, 401);
  assert.equal((await api("/api/workspace", a.token)).status, 400);
  assert.equal(
    (await api("/api/workspace?space=company", "invalid-token")).status,
    401,
  );
  recordCheck("real authentication required; explicit server scope required");
  const company = payload("company", "합성 회사 결과와 다음 행동");
  const stamp = new Date().toISOString();
  company.projects.push({
    id: "synthetic-legacy-project", space: "company", name: "합성 기존 프로젝트",
    description: "기존 주소의 공통 연결 보관", createdAt: stamp,
    repositoryUrl: "https://github.com/example/synthetic-legacy",
    serviceUrl: "https://legacy.example.test/",
  });
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
    403,
  );
  const fromSecond = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(fromSecond.status, 200);
  assert.equal(fromSecond.body.data.notes[0].content, company.notes[0].content);
  assert(!JSON.stringify(fromSecond.body).includes("개인 전용 비밀"));
  const unified = fromSecond.body.data;
  assert.equal(unified.projects[0].connectionsUnified, true);
  assert.equal(unified.projects[0].repositoryUrl, company.projects[0].repositoryUrl);
  assert.equal(unified.services.filter((service) => service.projectId === "synthetic-legacy-project").length, 2);
  assert.equal(sql(`select jsonb_array_length(data->'services') from public.jarvis_spaces where owner_id='${workspaceId}' and space='company'`), "3");
  assert.equal((await api("/api/workspace?space=company", a.token)).body.data.services[1].id, unified.services[1].id);
  recordCheck("legacy project addresses persist as the same scoped connections across real server sessions without deleting original references");
  const fromOther = await api("/api/workspace?space=company", b.token);
  assert.equal(fromOther.status, 403);
  const unapproved = b.client;
  const direct = await unapproved.from("jarvis_spaces").select("data");
  assert(direct.error || direct.data?.length === 0);
  assert(
    (
      await unapproved.rpc("jarvis_save_space", {
        p_space: "company",
        p_data: company,
        p_expected_revision: 0,
      })
    ).error,
  );
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
  recordCheck(
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
  recordCheck(
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
  recordCheck(
    "unconfigured v4 preserves last records; server search/grounding scope and provenance; no fake AI response",
  );
  // Private originals are verified separately from metadata and across devices.
  const bytes = Buffer.from("synthetic private original");
  const fileId = "synthetic-private-file";
  const current = await api("/api/workspace?space=company", a.token);
  current.body.data.documents.push({
    id: fileId,
    space: "company",
    projectId: null,
    taskId: null,
    name: "합성-서버원본.txt",
    mime: "text/plain",
    size: bytes.length,
    createdAt: stamp,
  });
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "company",
        revision: current.body.revision,
        data: current.body.data,
      })
    ).status,
    200,
  );
  const fileURL = base + `/api/workspace/files?space=company&id=${fileId}`;
  const fileHeaders = {
    Authorization: `Bearer ${a.token}`,
    "Content-Type": "application/octet-stream",
  };
  assert.equal(
    (await fetch(fileURL, { method: "PUT", headers: fileHeaders, body: bytes }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(fileURL, { method: "PUT", headers: fileHeaders, body: bytes }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(fileURL, {
        method: "PUT",
        headers: fileHeaders,
        body: Buffer.alloc(bytes.length, 65),
      })
    ).status,
    409,
  );
  assert.deepEqual(
    Buffer.from(
      await (await fetch(fileURL, { headers: fileHeaders })).arrayBuffer(),
    ),
    bytes,
  );
  assert.equal(
    (
      await fetch(fileURL.replace("space=company", "space=personal"), {
        headers: fileHeaders,
      })
    ).status,
    404,
  );
  assert.equal(
    (await fetch(fileURL, { headers: { Authorization: `Bearer ${b.token}` } }))
      .status,
    403,
  );
  assert.equal((await fetch(fileURL)).status, 401);
  recordCheck(
    "actual private file API upload/read, idempotent retry, overwrite rejection and scope/device isolation",
  );
  const largeBytes = Buffer.alloc(6 * 1024 * 1024, 71);
  const largeHash = createHash("sha256").update(largeBytes).digest("hex");
  const largeId = "synthetic-large-file";
  const largeSnapshot = await api("/api/workspace?space=company", a.token);
  largeSnapshot.body.data.documents.push({
    id: largeId,
    space: "company",
    projectId: null,
    taskId: null,
    name: "합성-대형원본.bin",
    mime: "application/octet-stream",
    size: largeBytes.length,
    createdAt: stamp,
  });
  assert.equal(
    (
      await api("/api/workspace", a.token, "PUT", {
        space: "company",
        revision: largeSnapshot.body.revision,
        data: largeSnapshot.body.data,
      })
    ).status,
    200,
  );
  const transferPath = `/api/workspace/files?space=company&id=${largeId}`;
  assert.equal(
    (
      await api(transferPath, b.token, "POST", {
        action: "upload",
        sha256: largeHash,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + transferPath, {
        method: "PUT",
        headers: fileHeaders,
        body: largeBytes,
      })
    ).status,
    413,
  );
  const signed = await api(transferPath, a.token, "POST", {
    action: "upload",
    sha256: largeHash,
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.stored, false);
  const transferClient = createClient(info.API_URL, info.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.ifError(
    (
      await transferClient.storage
        .from("jarvis-workspace-files")
        .uploadToSignedUrl(signed.body.path, signed.body.token, largeBytes, {
          contentType: "application/octet-stream",
          upsert: false,
        })
    ).error,
  );
  assert.equal(
    (
      await api(transferPath, a.token, "POST", {
        action: "verify",
        sha256: largeHash,
      })
    ).body.stored,
    true,
  );
  assert.equal(
    (
      await api(transferPath, a.token, "POST", {
        action: "upload",
        sha256: largeHash,
      })
    ).body.stored,
    true,
  );
  assert.equal(
    (
      await api(transferPath, a.token, "POST", {
        action: "verify",
        sha256: "0".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal((await api(transferPath, a.token)).status, 413);
  const signedDownload = await api(
    transferPath + "&transfer=download",
    a.token,
  );
  assert.equal(new URL(signedDownload.body.url).origin, info.API_URL);
  assert.deepEqual(
    Buffer.from(await (await fetch(signedDownload.body.url)).arrayBuffer()),
    largeBytes,
  );
  recordCheck(
    "6 MB originals use scoped signed transfers; function bodies stay small and original SHA-256 is verified",
  );
  const allowStorage = (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) {
      const body = route.request().postDataBuffer();
      assert(
        !body || body.length < 4 * 1024 * 1024,
        "No large file body may travel through the function",
      );
      return route.continue();
    }
    if (url.origin === info.API_URL && url.pathname.startsWith("/storage/v1/"))
      return route.continue();
    return route.abort();
  };
  browser = await chromium.launch();
  for (const label of ["device-a", "device-b", "other-owner"]) {
    const context = await browser.newContext();
    await context.route("**/*", allowStorage);
    const page = await context.newPage();
    await page.goto(base + "/settings");
    await page
      .getByText(/기기 확인 번호:/)
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({
          path: new URL(
            "../test-results/device-registration-failure.png",
            import.meta.url,
          ).pathname,
          fullPage: true,
        });
        console.log(
          JSON.stringify({
            deviceRegistrationStatus: await (
              await context.request.get(base + "/api/account")
            ).json(),
            deviceRegistrationPage: await page.locator("main").innerText(),
          }),
        );
        throw error;
      });
    const status = await (
      await context.request.get(base + "/api/account")
    ).json();
    assert(/^[A-F0-9]{12}$/.test(status.pairingCode));
    const deviceId = sql(
      `select user_id from public.jarvis_devices where request_code='${status.pairingCode}'`,
    );
    assert(/^[a-f0-9-]{36}$/.test(deviceId));
    users.push(deviceId);
    if (label === "other-owner") {
      assert.equal(
        (
          await context.request.get(base + "/api/workspace?space=company")
        ).status(),
        403,
      );
      assert.equal(
        await page.getByText("합성 회사 결과 수정됨", { exact: true }).count(),
        0,
      );
    } else {
      sql(
        `update public.jarvis_devices set approved_at=now() where request_code='${status.pairingCode}'`,
      );
      await page
        .getByRole("button", { name: "기기 연결 다시 확인", exact: true })
        .click();
      await page.getByRole("button", { name: "회사", exact: true }).waitFor();
      await page.goto(base);
      await page.getByText(label === "device-a" ? "합성 회사 결과 수정됨" : "동시 변경에도 보존할 새 메모", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("합성 개인 전용 비밀", { exact: true }).count(),
        0,
      );
      const cookies = await context.cookies();
      const sessionCookies = cookies.filter((c) =>
        c.name.includes("auth-token"),
      );
      assert(
        sessionCookies.length > 0 &&
          sessionCookies.every((c) => c.httpOnly && c.sameSite === "Lax"),
      );
      if (label === "device-a") {
        await page
          .getByLabel("빠른 메모 내용")
          .fill("브라우저에서 실제 서버로 저장한 합성 메모");
        await page
          .getByRole("button", { name: "메모 저장", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "서버에 저장됨" })
          .waitFor();
        const written = await api(
          "/api/workspace?space=company",
          a.secondToken,
        );
        assert(
          written.body.data.notes.some(
            (n) => n.content === "브라우저에서 실제 서버로 저장한 합성 메모",
          ),
        );
        recordCheck(
          "real browser device session automatically saves records visible from a separate approved device",
        );
        const concurrent = structuredClone(written.body.data);
        concurrent.notes.push({ ...concurrent.notes.find(n => n.id === "company-note"), id: "concurrent-note", content: "다른 기기의 동시 저장 결과", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        const concurrentSave = await api("/api/workspace", a.secondToken, "PUT", { space: "company", revision: written.body.revision, data: concurrent });
        assert.equal(concurrentSave.status, 200);
        await page.getByLabel("빠른 메모 내용").fill("동시 변경에도 보존할 새 메모");
        await page.getByRole("button", { name: "메모 저장", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "서버에 저장됨" }).waitFor();
        assert.equal(await page.getByRole("link", { name: "서버 변경 검토", exact: true }).count(), 0);
        const combined = await api("/api/workspace?space=company", a.secondToken);
        assert.equal(combined.body.data.notes.find(n => n.id === "concurrent-note").content, "다른 기기의 동시 저장 결과");
        assert(combined.body.data.notes.some(n => n.content === "동시 변경에도 보존할 새 메모"));
        await page.getByText("다른 기기의 동시 저장 결과", { exact: true }).waitFor();
        recordCheck("real CAS persistence merges concurrent browser input and another approved device's edit without losing either change");
        await page.goto(base + "/library");
        await page
          .getByRole("button", { name: "자료 추가", exact: true })
          .waitFor();
        await page.waitForFunction(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          return buttons.some((button) => button.textContent?.trim() === "자료 추가" && !button.disabled);
        });
        const transferDiagnostics = [];
        page.on("response", (response) => {
          const url = new URL(response.url());
          if (
            url.pathname.includes("/storage/v1/") ||
            url.pathname === "/api/workspace/files"
          )
            transferDiagnostics.push({
              status: response.status(),
              origin: url.origin,
              path: url.pathname,
            });
        });
        page.on("requestfailed", (request) => {
          const url = new URL(request.url());
          transferDiagnostics.push({
            failed: request.failure()?.errorText,
            origin: url.origin,
            path: url.pathname,
          });
        });
        const verifiedUpload = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/workspace/files" &&
            response.request().postDataJSON()?.action === "verify" &&
            response.request().postDataJSON()?.sha256 === largeHash &&
            response.status() === 200,
        );
        await page.getByLabel("자료 파일 선택").setInputFiles({
          name: "합성-브라우저대형.bin",
          mimeType: "application/octet-stream",
          buffer: largeBytes,
        });
        await verifiedUpload.catch(async (error) => {
          await page.screenshot({
            path: new URL(
              "../test-results/large-transfer-failure.png",
              import.meta.url,
            ).pathname,
            fullPage: true,
          });
          console.log(
            JSON.stringify({
              transferDiagnostics,
              transferPage: await page.locator("main").innerText(),
            }),
          );
          throw error;
        });
        await page
          .getByRole("status")
          .filter({ hasText: "서버에 저장됨" })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              Object.keys(localStorage).filter((key) =>
                key.includes("auth-token"),
              ).length,
          ),
          0,
        );
        const savedMetadata = await api(
          "/api/workspace?space=company",
          a.token,
        );
        assert(
          savedMetadata.body.data.documents.some(
            (d) => d.name === "합성-브라우저대형.bin",
          ),
        );
        assert(!JSON.stringify(savedMetadata.body.data).includes('"token":'));
        recordCheck(
          "real browser uploads 6 MB directly with transient capabilities, without storing auth tokens in localStorage",
        );
        const resumed = await browser.newContext({
          storageState: await context.storageState(),
        });
        await resumed.route("**/*", allowStorage);
        const resumedPage = await resumed.newPage();
        await resumedPage.goto(base);
        await resumedPage
          .getByText("브라우저에서 실제 서버로 저장한 합성 메모", {
            exact: true,
          })
          .waitFor();
        assert.equal(
          (await (await resumed.request.get(base + "/api/account")).json())
            .authenticated,
          true,
        );
        await resumed.close();
        recordCheck(
          "existing HttpOnly device session restores records in a fresh browser cache without a login flow",
        );
      } else {
        await page
          .getByText("브라우저에서 실제 서버로 저장한 합성 메모", {
            exact: true,
          })
          .waitFor();
        await page.goto(base + "/library");
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", {
            name: "합성-서버원본.txt 다운로드",
            exact: true,
          })
          .click();
        assert.deepEqual(await readFile(await (await download).path()), bytes);
        const largeDownload = page.waitForEvent("download");
        await page
          .getByRole("button", {
            name: "합성-브라우저대형.bin 다운로드",
            exact: true,
          })
          .click();
        assert.deepEqual(
          await readFile(await (await largeDownload).path()),
          largeBytes,
        );
        await page.reload();
        await page.goto(base + "/settings");
        await page
          .getByRole("button", { name: "이 기기 연결 해제", exact: true })
          .click();
        await page.getByText(/기기 확인 번호:/).waitFor();
        assert.equal(
          await page
            .getByText("브라우저에서 실제 서버로 저장한 합성 메모", {
              exact: true,
            })
            .count(),
          0,
        );
        assert.equal(
          sql(
            `select revoked_at is not null from public.jarvis_devices where user_id='${deviceId}'`,
          ),
          "t",
        );
        assert.equal(
          (
            await context.request.get(base + "/api/workspace?space=company")
          ).status(),
          403,
        );
        const replacement = await (
          await context.request.get(base + "/api/account")
        ).json();
        users.push(
          sql(
            `select user_id from public.jarvis_devices where request_code='${replacement.pairingCode}'`,
          ),
        );
        recordCheck(
          "new browser retrieves private file bytes; device disconnect revokes access and hides cached records",
        );
      }
    }
    await page.screenshot({
      path: new URL(`../test-results/${label}.png`, import.meta.url).pathname,
      fullPage: true,
    });
    await context.close();
  }
  recordCheck(
    "two approved login-free browser devices share one durable workspace; unapproved devices remain blocked",
  );
  // Actual local DB/auth/CAS; GitHub and model payloads below are synthetic.
  const autoStamp = new Date().toISOString(), autoHead = "a".repeat(40);
  const autoSnapshot = await api("/api/workspace?space=company", a.token);
  const autoService = {
    id: "synthetic-auto", space: "company", projectId: null, name: "합성 CLI 점검",
    webUrl: "https://github.com/example/synthetic", repositoryUrl: "https://github.com/example/synthetic",
    connector: "shortcut", favorite: false, createdAt: autoStamp, connectionStatus: "shortcut",
    lastSuccessAt: null, lastAttemptAt: null, error: null, failures: 0, nextRetryAt: null,
    monitoring: { enabled: true, automatic: false, intervalMinutes: 15, repository: "example/synthetic",
      lastSuccessAt: null, lastAttemptAt: null, error: null, nextRetryAt: null, inspection: null, analysis: null, previousAnalyses: [],
      job: { id: "synthetic-job-1", repository: "example/synthetic", requestedAt: autoStamp, status: "queued", phase: "collect", attempt: 0 } },
  };
  autoSnapshot.body.data.services.push(autoService);
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: autoSnapshot.body.data, revision: autoSnapshot.body.revision })).status, 200);
  const runnerFolder = await mkdtemp(join(tmpdir(), "jarvis-local-runner-"));
  try {
    const runner = await createAppClient(base, join(runnerFolder, "device.json"));
    assert.equal((await runner.request("/api/account")).authenticated, false);
    await runner.request("/api/account/device", {});
    const pendingRunner = await runner.request("/api/account");
    assert(/^[A-F0-9]{12}$/.test(pendingRunner.pairingCode));
    const runnerId = sql(`select user_id from public.jarvis_devices where request_code='${pendingRunner.pairingCode}'`);
    assert(/^[a-f0-9-]{36}$/.test(runnerId)); users.push(runnerId);
    sql(`update public.jarvis_devices set approved_at=now() where user_id='${runnerId}'`);
    assert.equal((await runner.request("/api/account")).authenticated, true);
    assert.equal((await runner.request("/api/automation/claim", { space: "personal", projectIds: [null], provider: "codex" })).job, null);
  } finally { await rm(runnerFolder, { recursive: true, force: true }); }
  const claimBody = { space: "company", projectIds: [null], provider: "codex" };
  assert.equal((await api("/api/automation/claim", b.token, "POST", claimBody)).status, 403);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...claimBody, space: "personal" })).body.job, null);
  const claims = await Promise.all([api("/api/automation/claim", a.token, "POST", claimBody), api("/api/automation/claim", a.secondToken, "POST", claimBody)]);
  assert(claims.every(c => c.status === 200)); assert.equal(claims.filter(c => c.body.job).length, 1);
  const winner = claims[0].body.job ? a.token : a.secondToken, loser = winner === a.token ? a.secondToken : a.token;
  const identity = { space: "company", serviceId: autoService.id, jobId: "synthetic-job-1" };
  assert.equal((await api("/api/automation/heartbeat", loser, "POST", identity)).status, 409);
  assert.equal((await api("/api/automation/heartbeat", winner, "POST", identity)).status, 200);
  const afterHeartbeat = await api("/api/workspace?space=company", winner);
  assert(Date.now() - Date.parse(afterHeartbeat.body.data.services.find(s => s.id === autoService.id).monitoring.runnerSeenAt) < 30_000);
  const githubFacts = { items: [{ externalId: "github:example/synthetic:file:README.md", title: "README.md", content: "합성 검증 근거", status: "reviewed", sourceUrl: `https://github.com/example/synthetic/blob/${autoHead}/README.md`, sourceUpdatedAt: autoStamp }], deletedIds: [], unchangedIds: [],
    inspection: { repository: "example/synthetic", branch: "main", headSha: autoHead, filesTotal: 1, treeComplete: true, excludedFiles: 0, reviewedPaths: ["README.md"], fileShas: { "README.md": autoHead }, limitations: ["합성 서버 전송 테스트"] } };
  assert.equal((await api("/api/automation/report", winner, "POST", { ...identity, phase: "facts", result: { ...githubFacts, items: [{ ...githubFacts.items[0], sourceUrl: "https://github.com/other/private" }] } })).status, 400);
  const prepared = await api("/api/automation/report", winner, "POST", { ...identity, phase: "facts", result: githubFacts });
  assert.equal(prepared.status, 200); assert.equal(prepared.body.analysisRequired, true);
  assert(prepared.body.input.facts.every(f => f.sourceUrl.startsWith("https://github.com/example/synthetic/")));
  const sourceId = prepared.body.input.facts[0].id;
  const modelResult = { summary: "합성 분석 결과", currentStatus: "검토 필요", nextAction: "검증 확인", sourceIds: [sourceId], suggestions: [{ kind: "task", title: "합성 검증 확인", reason: "원본 근거", sourceIds: [sourceId], taskId: null }] };
  assert.equal((await api("/api/automation/report", winner, "POST", { ...identity, phase: "analysis", basis: prepared.body.basis, result: { ...modelResult, sourceIds: ["other-space"] } })).status, 400);
  // A human writes while the model runs; completion must preserve that write.
  const whileAnalyzing = await api("/api/workspace?space=company", a.token);
  whileAnalyzing.body.data.notes.push({ id: "human-during-analysis", space: "company", projectId: null, content: "모델 실행 중 사람의 합성 메모", createdAt: autoStamp, updatedAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: whileAnalyzing.body.data, revision: whileAnalyzing.body.revision })).status, 200);
  const finalReport = { ...identity, phase: "analysis", basis: prepared.body.basis, result: modelResult };
  assert.equal((await api("/api/automation/report", winner, "POST", finalReport)).status, 200);
  assert.equal((await api("/api/automation/report", winner, "POST", finalReport)).status, 409);
  const afterAnalysis = await api("/api/workspace?space=company", a.secondToken);
  assert(afterAnalysis.body.data.notes.some(n => n.id === "human-during-analysis"));
  const analyzedService = afterAnalysis.body.data.services.find(s => s.id === autoService.id);
  assert.equal(analyzedService.lastSuccessAt, null); assert.equal(analyzedService.monitoring.job.status, "completed");
  assert.equal(analyzedService.monitoring.analysis.kind, "ai"); assert(analyzedService.monitoring.lastSuccessAt);
  analyzedService.monitoring.job = { ...autoService.monitoring.job, id: "synthetic-job-2" };
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: afterAnalysis.body.data, revision: afterAnalysis.body.revision })).status, 200);
  const next = await api("/api/automation/claim", a.token, "POST", claimBody); assert(next.body.job);
  const unchanged = await api("/api/automation/report", a.token, "POST", { ...identity, jobId: "synthetic-job-2", phase: "facts", result: githubFacts });
  assert.equal(unchanged.status, 200); assert.equal(unchanged.body.analysisRequired, false);
  const retrySnapshot = await api("/api/workspace?space=company", a.token);
  retrySnapshot.body.data.services.find(s => s.id === autoService.id).monitoring.job = { ...autoService.monitoring.job, id: "synthetic-job-3" };
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: retrySnapshot.body.data, revision: retrySnapshot.body.revision })).status, 200);
  assert((await api("/api/automation/claim", a.token, "POST", claimBody)).body.job);
  assert.equal((await api("/api/automation/report", a.token, "POST", { ...identity, jobId: "synthetic-job-3", phase: "error", code: "github_unavailable" })).status, 200);
  const afterFailure = await api("/api/workspace?space=company", a.secondToken);
  const failedService = afterFailure.body.data.services.find(s => s.id === autoService.id);
  assert.equal(failedService.connectionStatus, "shortcut"); assert.equal(failedService.monitoring.analysis.summary, modelResult.summary);
  assert.equal(failedService.monitoring.error, "github_unavailable");
  assert(afterFailure.body.data.sourceRecords.some(f => f.id === sourceId && !f.deletedAt));
  recordCheck("CLI queue is durable and device-fenced; concurrent claims dedupe; scoped facts/citations and human edits survive; unchanged evidence skips AI (synthetic transports)");
  // Project chat work uses the same real owner/device/CAS storage, without external execution.
  const workSnapshot = await api("/api/workspace?space=company", a.token);
  const workId = randomUUID(), projectId = "synthetic-work-project", workServiceId = "synthetic-work-service";
  workSnapshot.body.data.projects.push({ id: projectId, space: "company", name: "합성 실행 프로젝트", description: "합성 목표", createdAt: autoStamp,
    automation: { turns: [{ id: workId, serviceId: workServiceId, repository: "example/synthetic", request: "합성 버튼 수정", mode: "change", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: autoStamp, updatedAt: autoStamp }] } });
  workSnapshot.body.data.services.push({ ...autoService, id: workServiceId, projectId, monitoring: { ...autoService.monitoring, job: null } });
  workSnapshot.body.data.tasks.push({ id: `work-${workId}`, sourceMessageId: workId, space: "company", projectId, title: "합성 버튼 수정", status: "todo", dueDate: "", createdAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: workSnapshot.body.data, revision: workSnapshot.body.revision })).status, 200);
  const workClaim = { space: "company", projectIds: [projectId], provider: "codex", workVersion: 1, runnerVersion: VERSION };
  assert.equal((await api("/api/automation/claim", b.token, "POST", workClaim)).status, 403);
  const wrongSpaceWork = await api("/api/automation/claim", a.token, "POST", { ...workClaim, space: "personal" });
  assert.equal(wrongSpaceWork.status, 200); assert.equal(wrongSpaceWork.body.job, null);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...workClaim, space: "personal", projectScope: "selected" })).status, 400);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...workClaim, workVersion: undefined })).body.job, null);
  for (const runnerVersion of [undefined, "2.9.4"]) {
    assert.equal((await api("/api/automation/claim", a.token, "POST", { ...workClaim, runnerVersion })).body.job, null);
    const waiting = (await api("/api/workspace?space=company", a.token)).body.data.projects.find(p => p.id === projectId).automation.turns[0];
    assert.equal(waiting.status, "queued"); assert.equal(waiting.attempt, 0);
  }
  const workClaims = await Promise.all([api("/api/automation/claim", a.token, "POST", workClaim), api("/api/automation/claim", a.secondToken, "POST", workClaim)]);
  assert(workClaims.every(c => c.status === 200)); assert.equal(workClaims.filter(c => c.body.job?.kind === "work").length, 1);
  const workWinner = workClaims[0].body.job ? a.token : a.secondToken, workLoser = workWinner === a.token ? a.secondToken : a.token;
  const workJob = workClaims.find(c => c.body.job)?.body.job;
  assert.equal(workJob.request, "합성 버튼 수정"); assert.equal(workJob.publish, "pr");
  const workIdentity = { space: "company", projectId, jobId: workId, leaseToken: workJob.leaseToken };
  assert.equal((await api("/api/automation/work", workLoser, "POST", { ...workIdentity, phase: "heartbeat" })).status, 409);
  assert.equal((await api("/api/automation/work", workWinner, "POST", { ...workIdentity, phase: "heartbeat", progress: "coding" })).status, 200);
  const workResult = { reply: "합성 수정 결과", summary: "합성 화면 수정", currentStatus: "PR 검토", nextAction: "검증 범위 확장", changes: ["src/page.tsx"], checks: [{ name: "CI", status: "passed", detail: "합성 검증" }],
    followUps: [{ title: "합성 태블릿 회귀 확인", reason: "추가 범위", kind: "todo" }], outcome: "pr_open", branch: `jarvis/work-${workId}`, baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/example/synthetic/pull/10", deployment: { state: "not_configured", url: null, sha: null } };
  assert.equal((await api("/api/automation/work", workWinner, "POST", { ...workIdentity, phase: "result", result: { ...workResult, prUrl: "https://github.com/other/private/pull/1" } })).status, 400);
  const humanDuringWork = await api("/api/workspace?space=company", a.token);
  humanDuringWork.body.data.notes.push({ id: "human-during-work", space: "company", projectId, content: "실행 중 작성한 합성 메모", createdAt: autoStamp, updatedAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: humanDuringWork.body.data, revision: humanDuringWork.body.revision })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await api("/api/automation/work", workWinner, "POST", { ...workIdentity, phase: "result", result: workResult })).status, 200);
  const workSaved = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(workSaved.body.data.projects.find(p => p.id === projectId).automation.turns[0].result.prUrl, workResult.prUrl);
  assert.equal(workSaved.body.data.tasks.filter(t => t.title === "합성 태블릿 회귀 확인").length, 1);
  assert.equal(workSaved.body.data.tasks.find(t => t.id === `work-${workId}`).status, "decision");
  assert(workSaved.body.data.notes.some(n => n.id === "human-during-work"));
  assert(!(await api("/api/workspace?space=personal", a.token)).body.data.projects.some(p => p.id === projectId));
  recordCheck("project chat queue and automatic follow-ups persist atomically; old runners skip work; device/token/scope fencing and duplicate result recovery hold (synthetic execution)");
  const previewId = randomUUID();
  workSaved.body.data.projects.find(p => p.id === projectId).automation.turns.push({ id: previewId, serviceId: workServiceId, repository: "example/synthetic", request: "합성 화면 준비", mode: "preview", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: autoStamp, updatedAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: workSaved.body.data, revision: workSaved.body.revision })).status, 200);
  assert.notEqual((await api("/api/automation/claim", a.token, "POST", workClaim)).body.job?.mode, "preview");
  const previewClaim = await api("/api/automation/claim", a.token, "POST", { ...workClaim, previewVersion: 1 });
  assert.equal(previewClaim.body.job.mode, "preview");
  const previewIdentity = { space: "company", projectId, jobId: previewId, leaseToken: previewClaim.body.job.leaseToken };
  const previewResult = { ...workResult, changes: [], checks: [], followUps: [], outcome: "answered", branch: null, headSha: null, prUrl: null,
    preview: { state: "ready", kind: "mac", url: "http://127.0.0.1:45678/", sha: "a".repeat(40), checkedAt: autoStamp, expiresAt: new Date(Date.parse(autoStamp) + 3600_000).toISOString(), message: "합성 맥미니 화면" } };
  assert.equal((await api("/api/automation/work", a.secondToken, "POST", { ...previewIdentity, phase: "result", result: previewResult })).status, 409);
  assert.equal((await api("/api/automation/work", a.token, "POST", { ...previewIdentity, phase: "result", result: previewResult })).status, 200);
  const previewSaved = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(previewSaved.body.data.projects.find(p => p.id === projectId).automation.turns.at(-1).result.preview.url, previewResult.preview.url);
  assert(!previewSaved.body.data.tasks.some(t => t.id === `work-${previewId}`));
  recordCheck("preview capability gates old runners; device-fenced exact-commit result persists without a change task (synthetic preview URL)");
  // Remote preview authorization uses real device/RLS state, never an external tunnel.
  const remoteTurn = randomUUID(), remoteId = randomUUID();
  previewSaved.body.data.projects.find(p => p.id === projectId).automation.turns.push({ id: remoteTurn, serviceId: workServiceId, repository: "example/synthetic", request: "합성 원격 화면 준비", mode: "preview", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: autoStamp, updatedAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: previewSaved.body.data, revision: previewSaved.body.revision })).status, 200);
  const remoteClaim = await api("/api/automation/claim", a.token, "POST", { ...workClaim, previewVersion: 1 });
  assert.equal(remoteClaim.body.job.id, remoteTurn);
  const remotePreview = { ...previewResult.preview, kind: "remote", remoteId, url: "https://synthetic-private-preview.trycloudflare.com/" };
  assert.equal((await api("/api/automation/work", a.token, "POST", { ...previewIdentity, jobId: remoteTurn, leaseToken: remoteClaim.body.job.leaseToken, phase: "result", result: { ...previewResult, preview: remotePreview } })).status, 200);
  const access = { space: "company", projectId, turnId: remoteTurn, remoteId, url: remotePreview.url, sha: remotePreview.sha, deviceId: a.secondId };
  assert.equal((await api("/api/preview/config")).status, 401);
  assert.equal((await api("/api/preview/config", b.token)).status, 403);
  const publicConfig = await api("/api/preview/config", a.token);
  assert.equal(publicConfig.status, 200); assert.equal(publicConfig.body.version, 1);
  assert.equal((await api("/api/preview/access", a.token, "POST", access)).body.allowed, true);
  assert.equal((await api("/api/preview/access", a.secondToken, "POST", access)).status, 403);
  assert.equal((await api("/api/preview/access", a.token, "POST", { ...access, space: "personal" })).status, 404);
  assert.equal((await api("/api/preview/access", a.token, "POST", { ...access, remoteId: randomUUID() })).status, 403);
  assert.equal((await api("/api/preview/access", a.token, "POST", { ...access, deviceId: b.id })).body.allowed, false);
  sql(`update public.jarvis_devices set revoked_at=now() where user_id='${a.secondId}'`);
  assert.equal((await api("/api/preview/access", a.token, "POST", access)).body.allowed, false);
  sql(`update public.jarvis_devices set revoked_at=null where user_id='${a.secondId}'`);
  assert.equal((await fetch(base + `/api/preview/open?space=company&projectId=${projectId}&turnId=${remoteTurn}`)).status, 401);
  const remoteSaved = await api("/api/workspace?space=company", a.token);
  const storedRemote = remoteSaved.body.data.projects.find(p => p.id === projectId).automation.turns.find(t => t.id === remoteTurn).result.preview;
  storedRemote.checkedAt = new Date(Date.now() - 120_000).toISOString(); storedRemote.expiresAt = new Date(Date.now() - 60_000).toISOString();
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: remoteSaved.body.data, revision: remoteSaved.body.revision })).status, 200);
  assert.equal((await api("/api/preview/access", a.token, "POST", access)).status, 410);
  assert.equal((await fetch(base + `/api/preview/open?space=company&projectId=${projectId}&turnId=${remoteTurn}`, { headers: { Authorization: `Bearer ${a.token}` } })).status, 410);
  recordCheck("remote preview keys require approval; runner/viewer/project/session bindings, revoked devices and expiry reject access without external requests");
  const testSnapshot = await api("/api/workspace?space=company", a.token), remoteTestId = randomUUID();
  testSnapshot.body.data.projects.find(p => p.id === projectId).automation.turns.push({ id: remoteTestId, serviceId: workServiceId, repository: "example/synthetic", request: "합성 자동 검증", mode: "test", sourceTurnId: workId, publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: autoStamp, updatedAt: autoStamp });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: testSnapshot.body.data, revision: testSnapshot.body.revision })).status, 200);
  assert.notEqual((await api("/api/automation/claim", a.token, "POST", { ...workClaim, runnerVersion: undefined, previewVersion: 1 })).body.job?.mode, "test");
  const oldRunnerState = await api("/api/workspace?space=company", a.token);
  const oldMonitor = oldRunnerState.body.data.services.find(s => s.id === workServiceId).monitoring;
  assert.equal(oldMonitor.runnerConnection.remoteWork, false); assert.equal(oldMonitor.runnerConnection.version, undefined);
  assert.equal(oldMonitor.runnerVersion, undefined);
  assert.equal(oldRunnerState.body.data.projects.find(p => p.id === projectId).automation.turns.at(-1).attempt, 0);
  const remoteTestClaim = await api("/api/automation/claim", a.token, "POST", { ...workClaim, remoteWorkVersion: 1, runnerVersion: "2.4.1" });
  assert.equal(remoteTestClaim.body.job.mode, "test");
  assert.deepEqual(remoteTestClaim.body.job.source, { prUrl: workResult.prUrl, headSha: workResult.headSha, baseSha: workResult.baseSha, branch: workResult.branch });
  const remoteTestIdentity = { space: "company", projectId, jobId: remoteTestId, leaseToken: remoteTestClaim.body.job.leaseToken };
  assert.equal((await api("/api/automation/work", a.token, "POST", { ...remoteTestIdentity, phase: "heartbeat" })).status, 200);
  const newRunnerState = await api("/api/workspace?space=company", a.token);
  const newMonitor = newRunnerState.body.data.services.find(s => s.id === workServiceId).monitoring;
  assert.equal(newMonitor.runnerConnection.remoteWork, true); assert.equal(newMonitor.runnerConnection.version, "2.4.1");
  assert.equal(newMonitor.runnerVersion, undefined);
  const remoteTestResult = { ...previewResult, preview: undefined, baseSha: workResult.headSha, checks: [{ name: "npm run test", status: "failed", detail: "합성 실행 실패" }], outcome: "blocked" };
  assert.equal((await api("/api/automation/work", a.secondToken, "POST", { ...remoteTestIdentity, phase: "result", result: remoteTestResult })).status, 409);
  assert.equal((await api("/api/automation/work", a.token, "POST", { ...remoteTestIdentity, phase: "result", result: remoteTestResult })).status, 200);
  const testSaved = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(testSaved.body.data.projects.find(p => p.id === projectId).automation.turns.at(-1).result.checks[0].status, "failed");
  assert(!testSaved.body.data.tasks.some(t => t.id === `work-${remoteTestId}`));
  recordCheck("remote project tests require capability; selected source and observed failure survive reload with device fencing and no publishing task");
  // Actual private storage and HTTP contracts; synthetic sheet values and model answer only.
  const sheetState = await api("/api/workspace?space=company", a.token);
  const documentId = randomUUID(), documentQuestionId = randomUUID(), snapshotId = randomUUID(), sheetProject = "synthetic-sheet-only";
  sheetState.body.data.projects.push({ id: sheetProject, space: "company", name: "합성 문답 전용", description: "GitHub 연결 없는 범위", createdAt: autoStamp });
  sheetState.body.data.documents.push({ id: documentId, space: "company", projectId: sheetProject, taskId: null, name: "합성 시트", mime: "application/vnd.google-apps.spreadsheet", size: 0, createdAt: autoStamp,
    sourceUrl: "https://docs.google.com/spreadsheets/d/synthetic_sheet_123/edit", sheet: { version: 1, spreadsheetId: "synthetic_sheet_123", folder: "", pinned: false, archivedAt: autoStamp,
      tabs: [{ id: 7, title: "합성 탭", snapshotId, checkedAt: autoStamp }], snapshots: [{ id: snapshotId, tabId: 7, tabTitle: "합성 탭", range: "B10:C12", capturedAt: autoStamp, values: [["항목", "값"], ["합성 일정", "20일"]] }],
      questions: [{ id: documentQuestionId, snapshotId, question: "보관한 합성 일정은?", documentName: "합성 시트", readAt: autoStamp, createdAt: autoStamp, updatedAt: autoStamp, status: "queued", attempt: 0 }] } });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: sheetState.body.data, revision: sheetState.body.revision })).status, 200);
  assert.equal((await api("/api/sheets/config", b.token)).status, 403);
  assert.deepEqual((await api("/api/sheets/config", a.token)).body, { configured: false });
  const sheetClaim = { space: "company", projectIds: [sheetProject], provider: "codex", documentVersion: 1 };
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...sheetClaim, documentVersion: undefined })).body.job, null);
  assert.equal((await api("/api/automation/claim", b.token, "POST", sheetClaim)).status, 403);
  const documentClaims = await Promise.all([api("/api/automation/claim", a.token, "POST", sheetClaim), api("/api/automation/claim", a.secondToken, "POST", sheetClaim)]);
  assert(documentClaims.every(c => c.status === 200)); assert.equal(documentClaims.filter(c => c.body.job?.kind === "document").length, 1);
  const documentJob = documentClaims.find(c => c.body.job)?.body.job, documentWinner = documentClaims[0].body.job ? a.token : a.secondToken;
  const documentLoser = documentWinner === a.token ? a.secondToken : a.token;
  assert.equal(documentJob.snapshot.range, "B10:C12");
  const documentIdentity = { space: "company", projectId: sheetProject, documentId, snapshotId, jobId: documentQuestionId, leaseToken: documentJob.leaseToken };
  assert.equal((await api("/api/automation/document", documentLoser, "POST", { ...documentIdentity, phase: "heartbeat" })).status, 409);
  assert.equal((await api("/api/automation/document", documentWinner, "POST", { ...documentIdentity, phase: "heartbeat" })).status, 200);
  const documentAnswer = { reply: "합성 일정은 20일입니다.", rows: [11], limitation: "저장한 범위만 확인" };
  assert.equal((await api("/api/automation/document", documentWinner, "POST", { ...documentIdentity, phase: "result", answer: { ...documentAnswer, rows: [999] } })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await api("/api/automation/document", documentWinner, "POST", { ...documentIdentity, phase: "result", answer: documentAnswer })).status, 200);
  assert.equal((await api("/api/automation/document", documentLoser, "POST", { ...documentIdentity, phase: "result", answer: documentAnswer })).status, 409);
  const documentSaved = await api("/api/workspace?space=company", a.secondToken);
  assert.deepEqual(documentSaved.body.data.documents.find(d => d.id === documentId).sheet.questions[0].answer, documentAnswer);
  assert(!(await api("/api/workspace?space=personal", a.token)).body.data.documents.some(d => d.id === documentId));
  recordCheck("archived sheet Q&A persists without GitHub; capabilities, concurrent claims, scope/device/snapshot leases and duplicate delivery enforced by real private storage (synthetic Google/model data)");
  const wholeDocument = documentSaved.body.data.documents.find(d => d.id === documentId);
  const firstPage = randomUUID(), lastPage = randomUUID(), wholeQuestion = randomUUID();
  wholeDocument.sheet.archivedAt = null;
  wholeDocument.sheet.snapshots.push(
    { id: firstPage, tabId: 7, tabTitle: "합성 탭", range: "A1:A200", capturedAt: autoStamp, values: Array.from({ length: 200 }, (_, i) => [`합성 ${i + 1}행`]) },
    { id: lastPage, tabId: 7, tabTitle: "합성 탭", range: "A201:A205", capturedAt: autoStamp, values: Array.from({ length: 5 }, (_, i) => [`합성 ${i + 201}행`]) },
  );
  wholeDocument.sheet.tabs[0] = { id: 7, title: "합성 탭", snapshotId: firstPage, checkedAt: autoStamp,
    wholeRead: { snapshotIds: [firstPage, lastPage], rowCount: 205, columnCount: 1, capturedAt: autoStamp } };
  wholeDocument.sheet.questions.push({ id: wholeQuestion, snapshotId: lastPage, question: "마지막 구간의 값은?", documentName: "합성 시트", readAt: autoStamp, createdAt: autoStamp, updatedAt: autoStamp, status: "queued", attempt: 0 });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: documentSaved.body.data, revision: documentSaved.body.revision })).status, 200);
  const wholeSaved = await api("/api/workspace?space=company", a.secondToken);
  assert.deepEqual(wholeSaved.body.data.documents.find(d => d.id === documentId).sheet.tabs[0].wholeRead, wholeDocument.sheet.tabs[0].wholeRead);
  const wholeClaim = await api("/api/automation/claim", a.token, "POST", sheetClaim);
  assert.equal(wholeClaim.body.job.snapshot.range, "A201:A205");
  const beforeRemove = await api("/api/workspace?space=company", a.token), remaining = beforeRemove.body.data.documents.filter(d => d.id !== documentId);
  beforeRemove.body.data.documents = remaining;
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: beforeRemove.body.data, revision: beforeRemove.body.revision })).status, 200);
  const removedIdentity = { ...documentIdentity, jobId: wholeQuestion, snapshotId: lastPage, leaseToken: wholeClaim.body.job.leaseToken };
  assert.equal((await api("/api/automation/document", a.token, "POST", { ...removedIdentity, phase: "heartbeat" })).status, 409);
  assert.equal((await api("/api/automation/document", a.token, "POST", { ...removedIdentity, phase: "result", answer: { reply: "합성 마지막 값", rows: [205], limitation: "현재 구간" } })).status, 409);
  assert.deepEqual((await api("/api/workspace?space=company", a.secondToken)).body.data.documents, remaining);
  recordCheck("whole-tab pages persist across devices; current-page CLI jobs stay compatible and removing a connection fences late heartbeats/results without deleting other documents");
  // Legacy installed 2.5.0 requests discover new projects server-side. All data
  // below belongs to this disposable owner; no real runner or model is invoked.
  const discovery = emptyWorkspace(), discoveredWorkId = randomUUID();
  const addDiscovered = (data, suffix) => {
    const id = `discovered-${suffix}`, serviceId = `discovered-service-${suffix}`;
    data.projects.push({ id, space: "company", name: `합성 자동 연결 ${suffix}`, description: "", createdAt: autoStamp });
    data.services.push({ ...structuredClone(autoService), id: serviceId, projectId: id, monitoring: { ...structuredClone(autoService.monitoring), automatic: false, job: null } });
    return { id, serviceId };
  };
  for (let n = 0; n < 25; n++) addDiscovered(discovery, n);
  discovery.projects[24].automation = { turns: [{ id: discoveredWorkId, serviceId: "discovered-service-24", repository: "example/synthetic", request: "합성 자동 연결 질문", mode: "ask", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: autoStamp, updatedAt: autoStamp }] };
  const discoveryBase = await api("/api/workspace?space=company", a.token), personalBeforeDiscovery = await api("/api/workspace?space=personal", a.token);
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: discovery, revision: discoveryBase.body.revision })).status, 200);
  const legacyScope = { space: "company", projectIds: ["discovered-0"], provider: "codex", runnerVersion: "2.5.0", workVersion: 1, remoteWorkVersion: 1, previewVersion: 1, previewCliVersion: 1 };
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...legacyScope, projectScope: "selected" })).body.job, null);
  assert.equal((await api("/api/automation/claim", b.token, "POST", legacyScope)).status, 403);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...legacyScope, projectScope: "invalid" })).status, 400);
  const automaticClaims = await Promise.all([a.token, a.secondToken].map(token => api("/api/automation/claim", token, "POST", { ...legacyScope, projectIds: ["removed-legacy-project"] })));
  assert(automaticClaims.every(r => r.status === 200)); assert.equal(automaticClaims.filter(r => r.body.job).length, 1);
  const discoveredJob = automaticClaims.find(r => r.body.job).body.job;
  assert.equal(discoveredJob.id, discoveredWorkId); assert.equal(discoveredJob.projectId, "discovered-24");
  const discoveryWinner = automaticClaims[0].body.job ? a.token : a.secondToken, discoveryLoser = discoveryWinner === a.token ? a.secondToken : a.token;
  const discoveredIdentity = { space: "company", projectId: discoveredJob.projectId, jobId: discoveredJob.id, leaseToken: discoveredJob.leaseToken };
  const observedDiscovery = await api("/api/workspace?space=company", a.token);
  assert(observedDiscovery.body.data.services.every(s => s.monitoring.runnerConnection.projectScope === "space" && s.monitoring.runnerConnection.version === "2.5.0"));
  const busyWorkProject = addDiscovered(observedDiscovery.body.data, "during-work");
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: observedDiscovery.body.data, revision: observedDiscovery.body.revision })).status, 200);
  assert.equal((await api("/api/automation/work", discoveryLoser, "POST", { ...discoveredIdentity, phase: "heartbeat" })).status, 409);
  assert.equal((await api("/api/automation/work", discoveryWinner, "POST", { ...discoveredIdentity, phase: "heartbeat", leaseToken: randomUUID() })).status, 409);
  const afterRejectedPresence = await api("/api/workspace?space=company", a.token);
  assert.equal(afterRejectedPresence.body.data.services.find(s => s.id === busyWorkProject.serviceId).monitoring.runnerSeenAt, undefined);
  assert.equal((await api("/api/automation/work", discoveryWinner, "POST", { ...discoveredIdentity, phase: "heartbeat" })).status, 200);
  const afterWorkPresence = await api("/api/workspace?space=company", a.token);
  assert.equal(afterWorkPresence.body.data.services.find(s => s.id === busyWorkProject.serviceId).monitoring.runnerConnection.version, "2.5.0");
  const discoveryDocumentId = randomUUID(), discoveryQuestionId = randomUUID();
  afterWorkPresence.body.data.documents.push({ ...structuredClone(wholeDocument), id: discoveryDocumentId, projectId: discoveredJob.projectId,
    sheet: { ...structuredClone(wholeDocument.sheet), questions: [{ id: discoveryQuestionId, snapshotId: lastPage, question: "합성 자동 문답", documentName: wholeDocument.name, readAt: autoStamp, createdAt: autoStamp, updatedAt: autoStamp, status: "queued", attempt: 0 }] } });
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: afterWorkPresence.body.data, revision: afterWorkPresence.body.revision })).status, 200);
  const automaticDocument = await api("/api/automation/claim", a.token, "POST", { ...legacyScope, documentVersion: 1 });
  assert.equal(automaticDocument.body.job.kind, "document"); assert.equal(automaticDocument.body.job.projectId, discoveredJob.projectId);
  const duringDocument = await api("/api/workspace?space=company", a.token), busyDocumentProject = addDiscovered(duringDocument.body.data, "during-document");
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: duringDocument.body.data, revision: duringDocument.body.revision })).status, 200);
  const automaticDocumentIdentity = { space: "company", projectId: discoveredJob.projectId, documentId: discoveryDocumentId, snapshotId: lastPage, jobId: discoveryQuestionId, leaseToken: automaticDocument.body.job.leaseToken, phase: "heartbeat" };
  assert.equal((await api("/api/automation/document", a.secondToken, "POST", automaticDocumentIdentity)).status, 409);
  assert.equal((await api("/api/automation/document", a.token, "POST", automaticDocumentIdentity)).status, 200);
  const afterDocumentPresence = await api("/api/workspace?space=company", a.token);
  assert.equal(afterDocumentPresence.body.data.services.find(s => s.id === busyDocumentProject.serviceId).monitoring.runnerConnection.projectScope, "space");
  afterDocumentPresence.body.data.services[0].monitoring.job = { ...autoService.monitoring.job, id: "discovered-inspection" };
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: afterDocumentPresence.body.data, revision: afterDocumentPresence.body.revision })).status, 200);
  const automaticInspection = await api("/api/automation/claim", a.token, "POST", { ...legacyScope, projectIds: ["removed-legacy-project"] });
  assert.equal(automaticInspection.body.job.id, "discovered-inspection");
  const duringInspection = await api("/api/workspace?space=company", a.token), busyInspectionProject = addDiscovered(duringInspection.body.data, "during-inspection");
  assert.equal((await api("/api/workspace", a.token, "PUT", { space: "company", data: duringInspection.body.data, revision: duringInspection.body.revision })).status, 200);
  assert.equal((await api("/api/automation/heartbeat", a.token, "POST", { space: "company", serviceId: automaticInspection.body.job.serviceId, jobId: automaticInspection.body.job.id })).status, 200);
  const afterInspectionPresence = await api("/api/workspace?space=company", a.secondToken);
  assert.equal(afterInspectionPresence.body.data.services.find(s => s.id === busyInspectionProject.serviceId).monitoring.runnerConnection.projectScope, "space");
  assert.equal((await api("/api/workspace?space=personal", a.token)).body.revision, personalBeforeDiscovery.body.revision);
  recordCheck("installed 2.5.0 discovers new/25+ projects despite removed legacy IDs; work/document/inspection heartbeats refresh new connections; selected scopes, device leases, concurrent claims and other spaces remain isolated");
  await runProjectLifecycle({ base, api, account: a, sql, users, network: lifecycleNetwork, recordCheck });
  }
  await runReleaseLifecycle({ base, api, account: a, sql, users, network: lifecycleNetwork, recordCheck });
  console.log(
    JSON.stringify(
      {
        passed: checks,
        realDatabase: "local Supabase only",
        physicalDevices: false,
        productionCalls: 0,
        paidModelCalls: 0,
        v4LiveCalls: 0,
        fileStorageAPI:
          "actual local private storage upload/download exercised",
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
  await lifecycleNetwork.close();
  for (const space of ["company", "personal"]) {
    const folder = `${workspaceId}/${space}`;
    const listed = await admin.storage
      .from("jarvis-workspace-files")
      .list(folder);
    if (listed.data?.length)
      await admin.storage
        .from("jarvis-workspace-files")
        .remove(
          listed.data.filter((r) => r.id).map((r) => `${folder}/${r.name}`),
        );
  }
  sql(`delete from public.jarvis_spaces where owner_id='${workspaceId}'`);
  for (const user of users)
    if (/^[a-f0-9-]{36}$/.test(user)) await admin.auth.admin.deleteUser(user);
}
