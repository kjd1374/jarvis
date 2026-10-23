import type { Page } from "@playwright/test";
import { test, expect, ready, projectForm, state } from "../support/fixtures";
import { emptyWorkspace, type Space, type WorkspaceData } from "../../src/lib/workspace/types";
import { automationWorkspace } from "../support/automation";
const owner = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const company = emptyWorkspace(),
    personal = emptyWorkspace();
  personal.activeSpace = "personal";
  const stamp = "2026-10-15T00:00:00.000Z";
  company.projects.push({
    id: "company-project",
    space: "company",
    name: "합성 서버 회사 프로젝트",
    description: "서버 초기 내용",
    createdAt: stamp,
  });
  personal.projects.push({
    id: "personal-project",
    space: "personal",
    name: "합성 서버 개인 프로젝트",
    description: "개인 전용",
    createdAt: stamp,
  });
  return {
    company: { data: company, revision: 1 },
    personal: { data: personal, revision: 1 },
  };
}
async function connect(page: Page, remote = fixture()) {
  const control = { afterSave: null as ((data: WorkspaceData) => WorkspaceData) | null, failWrites: false, loseAcknowledgement: false, puts: 0, collideWrites: 0, holdAck: null as Promise<void> | null };
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        configured: true,
        authenticated: true,
        accountId: owner,
        deviceId: "synthetic-device",
      },
    }),
  );
  await page.route("**/api/workspace?*", (route) => {
    const space = new URL(route.request().url()).searchParams.get(
      "space",
    ) as Space;
    return route.fulfill({ json: remote[space] });
  });
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    control.puts++;
    const body = route.request().postDataJSON();
    const target = remote[body.space as Space];
    for (const key of ["projects", "tasks", "notes", "documents", "services"])
      expect(
        body.data[key].every(
          (row: { space: Space }) => row.space === body.space,
        ),
      ).toBe(true);
    if (control.failWrites)
      return route.fulfill({
        status: 503,
        json: { error: "합성 서버 연결 실패", code: "save_failed" },
      });
    if (control.collideWrites > 0) {
      control.collideWrites--;
      target.data.projects[0].nextAction = `실행기 새 진행 ${control.puts}`;
      target.revision++;
    }
    if (body.revision !== target.revision)
      return route.fulfill({
        status: 409,
        json: { error: "합성 버전 충돌", code: "revision_conflict" },
      });
    target.data = control.afterSave ? control.afterSave(body.data) : body.data;
    target.revision++;
    const savedRevision = target.revision;
    if (control.holdAck) {
      const gate = control.holdAck; control.holdAck = null; await gate;
    }
    if (control.loseAcknowledgement) {
      control.loseAcknowledgement = false;
      return route.fulfill({
        status: 503,
        json: { error: "합성 응답 유실", code: "save_failed" },
      });
    }
    return route.fulfill({ json: { revision: savedRevision } });
  });
  return { remote, control };
}
async function create(page: Page, name: string) {
  const form = await projectForm(page, name);
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
}

test("서버 메모 모아보기와 저장 진단은 기록·선택 프로젝트를 서버에 쓰지 않는다", async ({ page }) => {
  const remote = fixture(), at = "2026-10-16T00:00:00.000Z";
  remote.company.data.activeProjects.company = "company-project";
  for (let n = 0; n < 4; n++) remote.company.data.notes.push({ id: `inspection-company-${n}`, space: "company", projectId: n ? null : "company-project", content: `합성 회사 저장 진단 ${n}`, createdAt: at, updatedAt: at });
  for (let n = 0; n < 3; n++) remote.personal.data.notes.push({ id: `inspection-personal-${n}`, space: "personal", projectId: "personal-project", content: `합성 개인 저장 진단 ${n}`, createdAt: at, updatedAt: at });
  const before = structuredClone(remote);
  const { control } = await connect(page, remote);
  await page.goto("/memos"); await ready(page);
  const archive = page.getByRole("region", { name: "저장한 메모", exact: true });
  await expect(archive.getByRole("listitem")).toHaveCount(4);
  await expect(archive).not.toContainText("합성 개인 저장 진단");
  await page.getByLabel("프로젝트 범위").selectOption("company-project");
  await expect(archive.getByRole("listitem")).toHaveCount(1);
  await expect(archive).toContainText("이 프로젝트 밖에 메모 3개가 있습니다.");
  // An ordinary refresh still hydrates the saved project preference, without
  // overriding the archive's independent local view filter.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForLoadState("networkidle");
  await ready(page);
  await archive.getByRole("button", { name: "모든 프로젝트 메모 보기", exact: true }).click();
  await expect(archive.getByRole("listitem")).toHaveCount(4);
  expect(control.puts).toBe(0);
  expect(remote).toEqual(before);
  await page.waitForLoadState("networkidle"); await page.goto("/settings#storage-recovery"); await ready(page); await page.waitForLoadState("networkidle");
  const recovery = page.getByRole("region", { name: "브라우저 저장 진단과 복구", exact: true });
  const stored = () => page.evaluate(owner => new Promise(resolve => {
    const request = indexedDB.open(`jarvis-workspace-owner-${owner}`, 1);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction("workspace", "readonly"), records = transaction.objectStore("workspace").getAll();
      transaction.oncomplete = () => { db.close(); resolve(records.result); };
    };
  }), owner);
  const original = await stored();
  await recovery.getByRole("button", { name: "이 브라우저 저장 상태 확인", exact: true }).click();
  await expect(recovery).toContainText("현재 브라우저 저장본 · 회사 전체 프로젝트: 메모 4개 · 누적 맥락 0개");
  await expect(recovery).toContainText("마지막 정상 저장본 · 회사 전체 프로젝트: 메모 4개 · 누적 맥락 0개");
  await expect(recovery).not.toContainText("합성 회사 저장 진단");
  await expect(recovery).not.toContainText("합성 개인 저장 진단");
  await expect(recovery.getByRole("button", { name: "마지막 정상 저장본 복구", exact: true })).toHaveCount(0);
  expect(await stored()).toEqual(original);
  expect(control.puts).toBe(0);
  expect(remote).toEqual(before);
  await page.waitForLoadState("networkidle");
});

test("확인되지 않은 기기는 로그인 화면 없이 확인 번호만 표시하고 기존 기록을 노출하지 않는다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  await create(page, "노출하면 안 되는 합성 기존 프로젝트");
  let registered = false;
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        configured: true,
        authenticated: false,
        pairingCode: registered ? "SYNTHETIC123" : undefined,
      },
    }),
  );
  await page.route("**/api/account/device", (route) => {
    registered = true;
    return route.fulfill({ json: { registered: true } });
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("region", { name: "이 기기와 서버 저장", exact: true }),
  ).toContainText("SYNTHETIC123");
  await expect(
    page.getByText("노출하면 안 되는 합성 기존 프로젝트", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: /이메일|비밀번호/ }),
  ).toHaveCount(0);
  expect((await state(page))!.projects).toHaveLength(1);
  await page.goto("/projects");
  await expect(
    page.getByRole("button", { name: "프로젝트 만들기", exact: true }),
  ).toBeDisabled();
});

test("등록된 기기는 서버 기록을 불러오고 회사·개인별로 자동 저장한다", async ({
  page,
}) => {
  const { remote } = await connect(page);
  await page.goto("/projects");
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "합성 서버 회사 프로젝트", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "합성 서버 개인 프로젝트", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await create(page, "합성 서버 새 개인 프로젝트");
  await expect.poll(() => remote.personal.data.projects.length).toBe(2);
  await expect(
    page.getByRole("status").filter({ hasText: "서버에 저장됨" }),
  ).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("heading", {
      name: "합성 서버 새 개인 프로젝트",
      exact: true,
    }),
  ).toBeVisible();
  expect(remote.company.data.projects).toHaveLength(1);
});

test("서버 저장 실패는 계정별 대기를 보존하고 새로고침·재시도해도 중복 생성하지 않는다", async ({
  page,
}) => {
  const { remote, control } = await connect(page);
  await page.goto("/projects");
  await ready(page);
  control.failWrites = true;
  await create(page, "합성 서버 저장 대기 프로젝트");
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 서버 연결 실패" }).first(),
  ).toBeVisible();
  expect(remote.company.data.projects).toHaveLength(1);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("heading", {
      name: "합성 서버 저장 대기 프로젝트",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "서버 저장 다시 시도", exact: true }),
  ).toBeVisible();
  control.failWrites = false;
  await page
    .getByRole("button", { name: "서버 저장 다시 시도", exact: true })
    .click();
  await expect.poll(() => remote.company.data.projects.length).toBe(2);
  await expect(
    page.getByRole("status").filter({ hasText: "서버에 저장됨" }),
  ).toBeVisible();
  expect(
    remote.company.data.projects.filter(
      (p) => p.name === "합성 서버 저장 대기 프로젝트",
    ),
  ).toHaveLength(1);
});

test("응답 유실 뒤에는 서버의 같은 내용을 확인하고 중복 전송을 피한다", async ({
  page,
}) => {
  const { remote, control } = await connect(page);
  await page.goto("/projects");
  await ready(page);
  control.loseAcknowledgement = true;
  await create(page, "합성 응답 유실 프로젝트");
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 응답 유실" }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "서버 저장 다시 시도", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "서버에 저장됨" }),
  ).toBeVisible();
  expect(control.puts).toBe(1);
  expect(remote.company.data.projects).toHaveLength(2);
});

test("기준본 없는 기존 저장 대기는 검토 후 갱신 중인 서버에 병합하고 이전 브라우저 기록은 자동 이관하지 않는다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  await create(page, "합성 이전 브라우저 프로젝트");
  const legacy = await state(page);
  const { remote } = await connect(page);
  await page.goto("/projects");
  await ready(page);
  await expect(
    page.getByRole("heading", {
      name: "합성 이전 브라우저 프로젝트",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(owner => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open(`jarvis-workspace-owner-${owner}`, 1);
    opened.onsuccess = () => {
      const db = opened.result, tx = db.transaction("workspace", "readwrite"), store = tx.objectStore("workspace");
      const read = store.get("cloud-sync");
      read.onsuccess = () => { const sync = read.result; delete sync.bases; store.put(sync, "cloud-sync"); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), owner);
  remote.company.data.projects[0].description = "다른 기기에서 바꾼 합성 내용";
  remote.company.revision++;
  await create(page, "충돌에도 보존할 합성 프로젝트");
  await expect(
    page.getByRole("link", { name: "서버 변경 검토", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "서버 변경 검토", exact: true }).click();
  const review = page.getByRole("region", {
    name: "서버 변경 충돌 검토",
    exact: true,
  });
  await expect(
    review.getByRole("button", {
      name: "충돌은 서버 내용으로 병합",
      exact: true,
    }),
  ).toBeDisabled();
  await review.getByLabel("변경 내용과 충돌 처리 기준을 확인했습니다.").check();
  remote.company.data.projects[0].nextAction = "검토 중 갱신된 서버 진행";
  remote.company.revision++;
  await review
    .getByRole("button", { name: "충돌은 서버 내용으로 병합", exact: true })
    .click();
  await expect.poll(() => remote.company.data.projects.length).toBe(2);
  expect(remote.company.data.projects[0].description).toBe(
    "다른 기기에서 바꾼 합성 내용",
  );
  expect(remote.company.data.projects[0].nextAction).toBe("검토 중 갱신된 서버 진행");
  await expect(review).not.toBeVisible();
  await page
    .getByRole("button", { name: "이전 브라우저 기록 확인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "가져오기 확인", exact: true }),
  ).toBeVisible();
  expect(remote.company.data.projects).toHaveLength(2);
  await page.getByLabel("회사·개인 범위와 병합 내용을 확인했습니다.").check();
  await page
    .getByRole("button", { name: "기존 기록을 유지하며 병합", exact: true })
    .click();
  await expect.poll(() => remote.company.data.projects.length).toBe(3);
  expect(await state(page)).toEqual(legacy);
});

test("실행기 갱신과 두 번의 저장 경쟁에도 새 입력·서버 결과·개인 기록을 보존한다", async ({ page }) => {
  const data = fixture(); data.company.data = automationWorkspace();
  const { remote, control } = await connect(page, data);
  await page.goto("/projects"); await ready(page);
  const personal = structuredClone(remote.personal);
  remote.company.data.services[0].monitoring!.runnerSeenAt = "2026-10-15T12:30:00Z";
  remote.company.data.projects[0].currentStatus = "실행기가 기록한 최신 결과";
  remote.company.revision++;
  control.collideWrites = 2;
  await create(page, "동시 갱신 중 새 프로젝트");
  await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
  expect(control.puts).toBe(3);
  expect(remote.company.data.projects).toHaveLength(2);
  expect(remote.company.data.projects[0]).toMatchObject({ currentStatus: "실행기가 기록한 최신 결과", nextAction: "실행기 새 진행 2" });
  expect(remote.company.data.services[0].monitoring!.runnerSeenAt).toBe("2026-10-15T12:30:00Z");
  expect(remote.personal).toEqual(personal);
  await expect(page.getByRole("link", { name: "서버 변경 검토", exact: true })).toHaveCount(0);
  await page.reload(); await ready(page);
  await expect(page.getByRole("heading", { name: "동시 갱신 중 새 프로젝트", exact: true })).toBeVisible();
});

test("실제 같은 필드의 충돌만 검토하고 검토 중 새 편집은 재확인한다", async ({ page }) => {
  const { remote } = await connect(page);
  await page.goto("/projects/company-project"); await ready(page);
  await page.getByRole("button", { name: "프로젝트 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로젝트 수정" });
  await editor.getByLabel("프로젝트 설명", { exact: true }).fill("이 기기의 수정");
  remote.company.data.projects[0].description = "서버의 동시 수정"; remote.company.revision++;
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await page.getByRole("link", { name: "서버 변경 검토", exact: true }).click();
  const review = page.getByRole("region", { name: "서버 변경 충돌 검토", exact: true });
  await expect(review).toContainText("검토할 내용 충돌 1곳");
  await review.getByLabel("변경 내용과 충돌 처리 기준을 확인했습니다.").check();
  remote.company.data.projects[0].description = "검토 이후 다시 수정"; remote.company.revision++;
  await review.getByRole("button", { name: "충돌은 이 기기 내용으로 병합", exact: true }).click();
  await expect(review.getByLabel("변경 내용과 충돌 처리 기준을 확인했습니다.")).not.toBeChecked();
  expect(remote.company.data.projects[0].description).toBe("검토 이후 다시 수정");
  await review.getByLabel("변경 내용과 충돌 처리 기준을 확인했습니다.").check();
  remote.company.data.projects[0].currentStatus = "동시에 도착한 결과"; remote.company.revision++;
  await review.getByRole("button", { name: "충돌은 이 기기 내용으로 병합", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
  expect(remote.company.data.projects[0]).toMatchObject({ description: "이 기기의 수정", currentStatus: "동시에 도착한 결과" });
});

test("저장 응답을 기다리는 동안 추가한 입력과 새 서버 결과도 마지막에 함께 저장된다", async ({ page }) => {
  const { remote, control } = await connect(page);
  await page.goto("/projects"); await ready(page);
  let release!: () => void;
  control.holdAck = new Promise<void>(resolve => { release = resolve; });
  await create(page, "응답 대기 중 첫 입력");
  await expect.poll(() => remote.company.data.projects.length).toBe(2);
  await create(page, "응답 대기 중 둘째 입력");
  remote.company.data.projects[0].currentStatus = "응답 중 도착한 서버 결과"; remote.company.revision++;
  release();
  await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
  expect(remote.company.data.projects).toHaveLength(3);
  expect(remote.company.data.projects[0].currentStatus).toBe("응답 중 도착한 서버 결과");
  await expect(page.getByRole("heading", { name: "응답 대기 중 둘째 입력", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "서버 변경 검토", exact: true })).toHaveCount(0);
  await page.reload(); await ready(page);
  await expect(page.getByRole("heading", { name: "응답 대기 중 첫 입력", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "응답 대기 중 둘째 입력", exact: true })).toBeVisible();
});

test("두 기기가 다른 프로젝트를 선택하고 요청해도 저장 검토로 멈추지 않는다", async ({ page, browser }) => {
  const remote = fixture();
  remote.company.data.projects.push({ ...remote.company.data.projects[0], id: "second-project", name: "두 번째 프로젝트" });
  await connect(page, remote);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const phone = await context.newPage(); await connect(phone, remote);
    await page.goto("/projects"); await ready(page);
    await phone.goto("http://127.0.0.1:4317/projects"); await ready(phone);
    await page.getByRole("combobox", { name: "프로젝트 범위" }).selectOption("company-project");
    await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
    await phone.getByRole("combobox", { name: "프로젝트 범위" }).selectOption("second-project");
    await expect(phone.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
    await create(phone, "휴대폰에서 추가한 요청 프로젝트");
    await expect.poll(() => remote.company.data.projects.length).toBe(3);
    await expect(phone.getByRole("link", { name: "서버 변경 검토", exact: true })).toHaveCount(0);
    expect(remote.personal.data.projects).toHaveLength(1);
  } finally { await context.close(); }
});

test("요청 저장 확인이 유실되어도 실행 중인 같은 요청을 중복 제출하지 않는다", async ({ page }) => {
  const { claimProjectWork } = await import("../../src/lib/automation/work");
  const data = fixture(); data.company.data = automationWorkspace();
  const { remote, control } = await connect(page, data);
  await page.goto("/projects/auto-project"); await ready(page);
  control.afterSave = value => claimProjectWork(value, { space: "company", projectIds: ["auto-project"], deviceId: "runner", previews: true }, new Date().toISOString()).data;
  control.loseAcknowledgement = true;
  await page.getByRole("button", { name: "화면 준비", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "합성 응답 유실" }).first()).toBeVisible();
  await page.getByRole("button", { name: "서버 저장 다시 시도", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
  expect(remote.company.data.projects[0].automation?.turns).toHaveLength(1);
  expect(remote.company.data.projects[0].automation?.turns[0].status).toBe("running");
  await expect(page.getByRole("link", { name: "서버 변경 검토", exact: true })).toHaveCount(0);
});

test("충돌 화면에서 최신 기록을 다시 비교해도 입력을 버리지 않는다", async ({ page }) => {
  const { remote } = await connect(page);
  await page.goto("/projects/company-project"); await ready(page);
  await page.getByRole("button", { name: "프로젝트 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로젝트 수정" });
  await editor.getByLabel("프로젝트 설명", { exact: true }).fill("보존할 휴대폰 입력");
  remote.company.data.projects[0].description = "다른 기기 입력"; remote.company.revision++;
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await page.getByRole("link", { name: "서버 변경 검토", exact: true }).click();
  const review = page.getByRole("region", { name: "서버 변경 충돌 검토", exact: true });
  await review.getByRole("button", { name: "최신 기록과 다시 비교" }).click();
  await expect(review).toBeVisible();
  // Finish the first async recheck before the fixture changes again. A click
  // only waits for dispatch; changing the server early can resolve that recheck.
  await expect(review.getByRole("button", { name: "최신 기록과 다시 비교" })).toBeEnabled();
  expect(remote.company.data.projects[0].description).toBe("다른 기기 입력");
  remote.company.data.projects[0].description = "서버 초기 내용"; remote.company.revision++;
  await review.getByRole("button", { name: "최신 기록과 다시 비교" }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible();
  expect(remote.company.data.projects[0].description).toBe("보존할 휴대폰 입력");
});
