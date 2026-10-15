// Opt-in integration test: local Supabase only, real Auth/RLS and two isolated browsers.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppClient } from "../public/jarvis-runner.mjs";
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
      await page.getByText("합성 회사 결과 수정됨", { exact: true }).waitFor();
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
  const workClaim = { space: "company", projectIds: [projectId], provider: "codex", workVersion: 1 };
  assert.equal((await api("/api/automation/claim", b.token, "POST", workClaim)).status, 403);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...workClaim, space: "personal" })).status, 400);
  assert.equal((await api("/api/automation/claim", a.token, "POST", { ...workClaim, workVersion: undefined })).body.job, null);
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
