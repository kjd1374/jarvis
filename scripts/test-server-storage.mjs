// Opt-in integration test: local Supabase only, real Auth/RLS and two isolated browsers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
