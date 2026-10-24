import type { Locator, Page } from "@playwright/test";
import { test, expect, ready, seed, state } from "../support/fixtures";
import { sheetWorkspace } from "../support/sheets";
import { emptyWorkspace, type Space } from "../../src/lib/workspace/types";
import { claimDocumentQuestion, reportDocumentQuestion } from "../../src/lib/sheets/questions";

async function cloud(page: Page) {
  const remote = { company: { data: sheetWorkspace(), revision: 1 }, personal: { data: emptyWorkspace(), revision: 1 } };
  remote.personal.data.activeSpace = "personal";
  await page.route("**/api/account", route => route.fulfill({ json: { enabled: true, configured: true, authenticated: true, accountId: "11111111-1111-4111-8111-111111111111", deviceId: "synthetic-device" } }));
  await page.route("**/api/workspace?*", route => route.fulfill({ json: remote[new URL(route.request().url()).searchParams.get("space") as Space] }));
  await page.route("**/api/workspace", route => {
    const body = route.request().postDataJSON(), target = remote[body.space as Space];
    if (body.revision !== target.revision) return route.fulfill({ status: 409, json: { code: "revision_conflict", error: "합성 충돌" } });
    target.data = body.data; target.revision++; return route.fulfill({ json: { revision: target.revision } });
  });
  await page.route("**/api/sheets/config", route => route.fulfill({ json: { configured: false } }));
  return remote;
}
async function mockGoogle(page: Page) {
  await page.route("**/api/sheets/config", route => route.fulfill({ json: { configured: true, clientId: "synthetic.apps.googleusercontent.com", apiKey: "AIzaSyntheticBrowserKey", projectNumber: "12345" } }));
  await page.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "application/javascript", body: `window.google = { accounts: { oauth2: { initTokenClient: (options) => ({ requestAccessToken: () => { window.oauthCalls = (window.oauthCalls || 0) + 1; options.callback({ access_token: "synthetic-memory-only-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.file" }); } }) } } };` }));
  await page.route("https://apis.google.com/js/api.js", route => route.fulfill({ contentType: "application/javascript", body: `window.gapi = { load: (_name, options) => {
    class View { setMimeTypes() { return this; } setMode() { return this; } }
    class Builder { addView() { return this; } setLocale() { return this; } setTitle() { return this; } setSize() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; } setAppId() { return this; } setOrigin() { return this; } setCallback(callback) { this.callback = callback; return this; } build() { return { setVisible: () => setTimeout(() => this.callback({ action: "picked", docs: [{ id: "synthetic_sheet_123", mimeType: "application/vnd.google-apps.spreadsheet" }] }), 0), dispose() {} }; } }
    window.google.picker = { DocsView: View, ViewId: { SPREADSHEETS: "spreadsheets" }, DocsViewMode: { LIST: "list" }, PickerBuilder: Builder }; options.callback();
  } };` }));
}
test("stored sheet connections remain visible across local project filters and remote preference refreshes", async ({ page }, info) => {
  const remote = await cloud(page), original = remote.company.data.documents[0];
  remote.company.data.projects.push({ id: "empty-sheet-project", space: "company", name: "시트 없는 합성 프로젝트", description: "합성", createdAt: original.createdAt });
  remote.company.data.activeProjects.company = "empty-sheet-project";
  const common = { ...structuredClone(original), id: "common-sheet", projectId: null, name: "합성 공통 시트" };
  const archived = { ...structuredClone(original), id: "archived-sheet", name: "합성 보관 시트" };
  archived.sheet!.archivedAt = original.createdAt;
  remote.company.data.documents.push(common, archived);
  const personal = { ...structuredClone(original), id: "personal-sheet", space: "personal" as const, projectId: null, name: "개인 전용 합성 시트" };
  personal.sheet!.snapshots[0].values = [["개인 영역 보관 값"]];
  remote.personal.data.documents.push(personal);
  const before = structuredClone(remote);
  let writes = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/workspace" && request.method() === "PUT") writes++; });
  await page.goto("/tasks"); await ready(page);
  const list = page.getByRole("complementary", { name: "시트 목록", exact: true });
  await expect(page.getByLabel("프로젝트 범위")).toHaveValue("");
  await expect(list.getByRole("button", { name: /합성 공통 시트/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /합성 업무 시트/ })).toBeVisible();
  await expect(list).not.toContainText("개인 전용 합성 시트");
  await expect(list).not.toContainText("합성 보관 시트");
  await list.getByRole("button", { name: /합성 공통 시트/ }).click();
  await expect(page.getByRole("cell", { name: "합성 일정", exact: true })).toBeVisible();
  const question = page.getByLabel("문서 AI 문답").getByRole("textbox");
  await question.fill("프로젝트 갱신에도 보존할 합성 입력");
  remote.company.data.activeProjects.company = "sheet-project"; remote.company.revision++;
  await page.getByRole("button", { name: "문답 상태 새로고침", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 공통 시트", exact: true })).toBeVisible();
  await expect(question).toHaveValue("프로젝트 갱신에도 보존할 합성 입력");
  await page.getByLabel("프로젝트 범위").selectOption("empty-sheet-project");
  await expect(list).toContainText("이 프로젝트 밖에 연결한 시트 2개가 있습니다.");
  await list.getByRole("button", { name: "모든 프로젝트 시트 보기", exact: true }).click();
  await expect(page.getByLabel("프로젝트 범위")).toHaveValue("");
  await page.getByLabel("프로젝트 범위").selectOption("sheet-project");
  await expect(list.getByRole("button", { name: /합성 공통 시트/ })).toHaveCount(0);
  expect(remote.company.data.activeProjects.company).toBe("sheet-project");
  expect(remote.company.data.documents).toEqual(before.company.data.documents);
  expect(remote.personal).toEqual(before.personal);
  expect(writes).toBe(0);
  await page.waitForLoadState("networkidle"); await page.reload(); await ready(page);
  await expect(page.getByLabel("프로젝트 범위")).toHaveValue("");
  await expect(list.getByRole("button", { name: /합성 공통 시트/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("restored-sheet-discovery.png"), fullPage: true });
  await page.getByRole("button", { name: "개인", exact: true }).click(); await ready(page);
  await expect(page.getByRole("heading", { name: "개인 전용 합성 시트", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "개인 영역 보관 값", exact: true })).toBeVisible();
  await expect(list).not.toContainText("합성 업무 시트");
  await page.getByRole("button", { name: "회사", exact: true }).click(); await ready(page);
  await page.waitForLoadState("networkidle"); await page.goto("/tasks?document=archived-sheet"); await ready(page);
  await expect(page.getByRole("heading", { name: "합성 보관 시트", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 일정", exact: true })).toBeVisible();
  expect(remote.company.data.documents).toEqual(before.company.data.documents);
  expect(remote.personal.data.documents).toEqual(before.personal.data.documents);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForLoadState("networkidle");
});

test("changing the local sheet project filter fences delayed reads and preserves new sheet project binding", async ({ page }) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  remote.company.data.projects.push({ id: "other-sheet-project", space: "company", name: "다른 합성 프로젝트", description: "합성", createdAt: "2026-10-17T00:00:00Z" });
  await mockGoogle(page);
  let reads = 0, release: (() => void) | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://sheets.googleapis.com/**", async route => {
    if (route.request().url().includes("/values/")) {
      const first = ++reads === 1;
      if (first) await delayed;
      return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { values: [[first ? "이전 필터의 늦은 값" : "현재 필터에서 다시 읽은 값"]] } });
    }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "필터 경계 합성 시트" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByLabel("프로젝트 범위").selectOption("sheet-project");
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await page.getByLabel("프로젝트 범위").selectOption("other-sheet-project");
  const response = page.waitForResponse(r => r.url().includes("sheets.googleapis.com") && r.url().includes("/values/"));
  release!(); await response;
  expect(remote.company.data.documents[0].projectId).toBe("sheet-project");
  expect(remote.company.data.documents[0].sheet!.snapshots).toHaveLength(0);
  expect(remote.company.data.activeProjects.company).toBe("sheet-project");
  await page.getByLabel("프로젝트 범위").selectOption("sheet-project");
  await expect(page.getByRole("cell", { name: "현재 필터에서 다시 읽은 값", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "이전 필터의 늦은 값", exact: true })).toHaveCount(0);
  await expect.poll(() => remote.company.data.documents[0].sheet!.snapshots.length).toBe(1);
  expect(remote.company.data.documents[0].projectId).toBe("sheet-project");
  expect(remote.company.data.activeProjects.company).toBe("sheet-project");
  expect(reads).toBe(2);
  await page.waitForLoadState("networkidle");
});

test("moving a sheet to another project during a read preserves the document and rejects stale success", async ({ page }) => {
  const remote = await cloud(page);
  remote.company.data.projects.push({ id: "moved-sheet-project", space: "company", name: "이동 대상 합성 프로젝트", description: "합성", createdAt: "2026-10-17T00:00:00Z" });
  await mockGoogle(page);
  let reads = 0, release: (() => void) | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://sheets.googleapis.com/**", async route => {
    if (route.request().url().includes("/values/")) {
      reads++; await delayed;
      return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { values: [["이동 전 요청의 늦은 값"]] } });
    }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "이동 전 읽기 제목" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  let writes = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/workspace" && request.method() === "PUT") writes++; });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "탭 전체 불러오기", exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  const moved = remote.company.data.documents[0];
  moved.projectId = "moved-sheet-project"; moved.name = "다른 기기에서 옮긴 합성 시트";
  const expected = structuredClone(moved); remote.company.revision++;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: moved.name, exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().includes("sheets.googleapis.com") && r.url().includes("/values/"));
  release!(); await response;
  await expect(page.getByRole("status").filter({ hasText: "시트 연결이 바뀌어 이번에 읽은 내용은 저장하지 않았습니다." })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 일정", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "이동 전 요청의 늦은 값", exact: true })).toHaveCount(0);
  expect(remote.company.data.documents[0]).toEqual(expected);
  expect(writes).toBe(0);
  await page.waitForLoadState("networkidle");
});

test("sheet layout preserves legacy tasks, scopes and archived content across reload", async ({ page }, info) => {
  const data = sheetWorkspace();
  data.tasks.push({ id: "old-task", title: "보존할 이전 할 일", space: "company", projectId: "sheet-project", status: "todo", dueDate: "", createdAt: "2026-10-17T00:00:00Z" });
  await seed(page, data); await page.goto("/tasks"); await ready(page);
  await expect(page.getByRole("heading", { name: "합성 업무 시트", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 일정", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "B", exact: true })).toBeVisible();
  await expect(page.getByLabel("문서 AI 문답")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("sheet-workspace.png"), fullPage: true });
  await page.getByLabel("시트 폴더").fill("자주 보는 자료"); await page.getByRole("button", { name: "이동", exact: true }).click();
  await expect(page.locator("summary").filter({ hasText: "자주 보는 자료" })).toBeVisible();
  await page.getByRole("button", { name: "자료실로 보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "업무로 복귀", exact: true })).toBeVisible();
  await page.goto("/library"); await page.getByRole("link", { name: "합성 업무 시트 보기·질문" }).click();
  await expect(page.getByRole("cell", { name: "합성 일정", exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  await page.getByRole("button", { name: "업무로 복귀", exact: true }).click();
  await page.getByRole("link", { name: "기존 할 일", exact: true }).click();
  await expect(page.getByText("보존할 이전 할 일", { exact: true })).toBeVisible();
  await page.goto("/tasks"); await ready(page); await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 업무 시트", exact: true })).toHaveCount(0);
  expect((await state(page))!.documents[0].sheet!.snapshots[0].values[1][0]).toBe("합성 일정");
});
test("selected-range questions persist, receive scoped CLI replies and remain usable after archive", async ({ page }) => {
  const remote = await cloud(page);
  await page.goto("/tasks"); await ready(page);
  const panel = page.getByLabel("문서 AI 문답");
  await panel.getByRole("textbox").fill("가장 빠른 일정은?"); await panel.getByRole("button", { name: "질문 보내기 ↗" }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions.length).toBe(1);
  await expect(panel.getByText("실행기 응답 대기", { exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  const stamp = new Date().toISOString(), claimed = claimDocumentQuestion(remote.company.data, { space: "company", projectIds: ["sheet-project"], deviceId: "synthetic-runner" }, stamp), job = claimed.job!;
  expect(job.snapshot.range).toBe("B10:D20");
  remote.company.data = reportDocumentQuestion(claimed.data, "company", { documentId: job.documentId, projectId: job.projectId, snapshotId: job.snapshot.id, jobId: job.id, leaseToken: job.leaseToken, phase: "result", answer: { reply: "합성 일정의 마감은 10월 20일입니다.", rows: [11], limitation: "선택한 범위만 읽었습니다." } }, "synthetic-runner", stamp); remote.company.revision++;
  await page.getByRole("button", { name: "문답 상태 새로고침" }).click();
  await expect(panel.getByText("합성 일정의 마감은 10월 20일입니다.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "11행 ↗" })).toHaveAttribute("href", /gid=7&range=B11$/);
  await panel.getByRole("button", { name: "문서에 물어보기 접기" }).click();
  await expect(panel.getByText("합성 일정의 마감은 10월 20일입니다.", { exact: true })).toBeHidden();
  await panel.getByRole("button", { name: "문서에 물어보기 열기" }).click();
  await expect(panel.getByText("합성 일정의 마감은 10월 20일입니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료실로 보내기", exact: true }).click();
  await panel.getByRole("textbox").fill("보관한 내용에서 다음 일정은?"); await panel.getByRole("button", { name: "질문 보내기 ↗" }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions.length).toBe(2);
  await panel.getByRole("button", { name: "질문 취소", exact: true }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions[1].status).toBe("cancelled");
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(panel.getByText("합성 일정의 마감은 10월 20일입니다.", { exact: true })).toHaveCount(0);
});
test("Google Picker grants a selected file, reads the whole selected tab and never persists the browser token", async ({ page }) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  await mockGoogle(page);
  let failValues = false, reads = 0;
  await page.route("https://sheets.googleapis.com/**", route => {
    expect(route.request().headers().authorization).toBe("Bearer synthetic-memory-only-token");
    if (route.request().url().includes("/values/")) { reads++; expect(decodeURIComponent(route.request().url())).toContain("/values/'일정'?"); return route.fulfill({ status: failValues ? 403 : 200, headers: { "Access-Control-Allow-Origin": "*" }, json: failValues ? { error: "synthetic" } : { values: [["항목", "마감", "상태"], ["합성 Google 값", "10월 20일", "진행"]] } }); }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "선택한 합성 시트" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect(page.getByRole("heading", { name: "선택한 합성 시트", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "전체 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  await expect.poll(() => reads).toBe(2); expect(JSON.stringify(remote)).not.toContain("synthetic-memory-only-token");
  failValues = true; await page.getByRole("button", { name: "전체 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "파일 권한" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("synthetic-memory-only-token");
});

test("selected tabs load once, failed reads require retry and late results cannot replace the selected tab", async ({ page }) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  await mockGoogle(page);
  const reads: string[] = [];
  let fail = true, release: (() => void) | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://sheets.googleapis.com/**", async route => {
    expect(route.request().method()).toBe("GET");
    const url = decodeURIComponent(route.request().url());
    if (url.includes("/values/")) {
      const title = url.includes("'다음 탭'") ? "다음 탭" : url.includes("'마지막 탭'") ? "마지막 탭" : "일정";
      reads.push(title);
      if (title === "다음 탭") await delayed;
      const failed = title === "마지막 탭" && fail;
      return route.fulfill({ status: failed ? 403 : 200, headers: { "Access-Control-Allow-Origin": "*" }, json: failed ? { error: "synthetic" } : { values: [[`${title} 자동 값`]] } });
    }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "자동 읽기 합성 시트" }, sheets: ["일정", "다음 탭", "마지막 탭"].map((title, i) => ({ properties: { sheetId: 7 + i, title, sheetType: "GRID" } })) } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect(page.getByRole("cell", { name: "일정 자동 값", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "다음 탭" });
  await expect.poll(() => reads).toEqual(["일정", "다음 탭"]);
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "마지막 탭" });
  release!();
  await expect(page.getByRole("alert").filter({ hasText: "파일 권한" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "다음 탭 자동 값", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "일정" });
  await expect(page.getByRole("cell", { name: "일정 자동 값", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "다음 탭" });
  await expect(page.getByRole("cell", { name: "다음 탭 자동 값", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "마지막 탭" });
  await expect(page.getByRole("button", { name: "탭 전체 불러오기", exact: true })).toBeEnabled();
  expect(reads).toEqual(["일정", "다음 탭", "마지막 탭"]);
  fail = false;
  await page.getByRole("button", { name: "탭 전체 불러오기", exact: true }).click();
  await expect(page.getByRole("cell", { name: "마지막 탭 자동 값", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { oauthCalls?: number }).oauthCalls)).toBe(1);
  await expect.poll(() => remote.company.data.documents[0].sheet!.snapshots.length).toBe(3);
  await page.reload(); await ready(page);
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "마지막 탭" });
  await expect(page.getByRole("cell", { name: "마지막 탭 자동 값", exact: true })).toBeVisible();
  expect(reads).toHaveLength(4);
  expect(await page.evaluate(() => (window as Window & { oauthCalls?: number }).oauthCalls ?? 0)).toBe(0);
});

test("sheet dimensions survive tab switches and reload while question collapse preserves the draft and widens the table", async ({ page }, info) => {
  await cloud(page); await page.goto("/tasks"); await ready(page);
  async function dragSize(control: Locator, dx: number, dy: number) {
    await control.scrollIntoViewIfNeeded(); const box = (await control.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (info.project.name === "mobile") {
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
    }
  }
  const panel = page.getByLabel("문서 AI 문답"), sheet = page.getByLabel("선택한 시트");
  await panel.getByRole("textbox").fill("접어도 남을 합성 질문");
  const originalWidth = (await sheet.boundingBox())!.width;
  const column = page.getByRole("separator", { name: "B열 너비", exact: true });
  await dragSize(column, 80, 0);
  await expect(column).toHaveAttribute("aria-valuenow", "260");
  await column.press("ArrowLeft"); await expect(column).toHaveAttribute("aria-valuenow", "250");
  const row = page.getByRole("separator", { name: "11행 높이", exact: true });
  await dragSize(row, 0, 60);
  await expect(row).toHaveAttribute("aria-valuenow", "100");
  await row.press("ArrowUp"); await expect(row).toHaveAttribute("aria-valuenow", "96");
  expect((await page.getByRole("columnheader", { name: "B", exact: true }).boundingBox())!.width).toBeCloseTo(250, 0);
  expect((await page.getByRole("rowheader", { name: "11행", exact: true }).boundingBox())!.height).toBeCloseTo(96, 0);
  await panel.getByRole("button", { name: "문서에 물어보기 접기" }).click();
  await expect(panel.getByRole("textbox")).toBeHidden();
  if (info.project.name === "desktop") expect((await sheet.boundingBox())!.width).toBeGreaterThan(originalWidth + 150);
  await panel.getByRole("button", { name: "문서에 물어보기 열기" }).click();
  await expect(panel.getByRole("textbox")).toHaveValue("접어도 남을 합성 질문");
  await panel.getByRole("button", { name: "문서에 물어보기 접기" }).click();
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "다음 탭" });
  await page.getByRole("combobox", { name: "시트 탭", exact: true }).selectOption({ label: "일정" });
  await expect(column).toHaveAttribute("aria-valuenow", "250");
  await page.reload(); await ready(page);
  await expect(panel.getByRole("button", { name: "문서에 물어보기 열기" })).toHaveAttribute("aria-expanded", "false");
  await expect(column).toHaveAttribute("aria-valuenow", "250"); await expect(row).toHaveAttribute("aria-valuenow", "96");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "업무", exact: true }).click();
  await page.screenshot({ path: info.outputPath("sheet-resized-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "크기 초기화", exact: true }).click();
  await expect(column).toHaveAttribute("aria-valuenow", "180"); await expect(row).toHaveAttribute("aria-valuenow", "40");
});

test("changing workspace during an automatic read discards the delayed values", async ({ page }) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  await mockGoogle(page);
  let reads = 0, release: (() => void) | undefined;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://sheets.googleapis.com/**", async route => {
    if (route.request().url().includes("/values/")) {
      const first = ++reads === 1;
      if (first) await delayed;
      return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { values: [[first ? "이전 영역의 늦은 합성 값" : "돌아와서 새로 읽은 합성 값"]] } });
    }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "영역 전환 합성 시트" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "업무의 중심에 시트를 두세요", exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().includes("sheets.googleapis.com") && r.url().includes("/values/"));
  release!(); await response;
  await expect(page.getByRole("heading", { name: "업무의 중심에 시트를 두세요", exact: true })).toBeVisible();
  expect(remote.company.data.documents[0].sheet!.snapshots).toHaveLength(0);
  await page.getByRole("button", { name: "회사", exact: true }).click();
  await expect(page.getByRole("heading", { name: "영역 전환 합성 시트", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "돌아와서 새로 읽은 합성 값", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "이전 영역의 늦은 합성 값", exact: true })).toHaveCount(0);
  await expect.poll(() => remote.company.data.documents[0].sheet!.snapshots.map(s => s.values)).toEqual([[["돌아와서 새로 읽은 합성 값"]]]);
  expect(reads).toBe(2);
  expect(remote.personal.data.documents).toHaveLength(0);
});

test("whole tab reads include rows after 200 and columns after T, with scoped paging, reload and atomic failure", async ({ page }, info) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  await mockGoogle(page);
  let tooLarge: false | "cells" | "bytes" = false;
  const values = Array.from({ length: 205 }, (_, r) => Array.from({ length: 21 }, (_, c) => r === 204 && c === 20 ? "끝 행 끝 열 값" : c === 0 ? `합성 ${r + 1}행` : ""));
  await page.route("https://sheets.googleapis.com/**", route => {
    expect(route.request().method()).toBe("GET");
    if (route.request().url().includes("/values/")) {
      expect(decodeURIComponent(route.request().url())).toContain("/values/'일정'?valueRenderOption");
      return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { values: tooLarge === "cells" ? Array.from({ length: 501 }, () => Array(1000).fill("")) : tooLarge === "bytes" ? Array.from({ length: 140 }, () => ["가".repeat(10_000)]) : values } });
    }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "전체 읽기 합성 시트" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect(page.getByText(/탭 전체 · 205행 × 21열/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "불러올 범위" })).toHaveCount(0);
  await page.getByRole("button", { name: "다음 구간", exact: true }).click();
  await expect(page.getByRole("cell", { name: "끝 행 끝 열 값", exact: true })).toBeAttached();
  await expect(page.getByRole("rowheader", { name: "205행", exact: true })).toBeAttached();
  const panel = page.getByLabel("문서 AI 문답");
  await expect(panel.getByText(/다른 구간·탭은 포함하지 않습니다/)).toBeVisible();
  await panel.getByRole("textbox").fill("이 구간의 끝 값은?");
  await panel.getByRole("button", { name: "질문 보내기 ↗" }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions.length).toBe(1);
  const doc = remote.company.data.documents[0], question = doc.sheet!.questions[0];
  expect(doc.sheet!.snapshots.find(s => s.id === question.snapshotId)!.range).toBe("A201:U205");
  const previous = structuredClone(doc.sheet!.tabs[0].wholeRead);
  await page.screenshot({ path: info.outputPath("whole-sheet-page.png"), fullPage: true });
  tooLarge = "cells";
  await page.getByRole("button", { name: "전체 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "한도" })).toBeVisible();
  expect(remote.company.data.documents[0].sheet!.tabs[0].wholeRead).toEqual(previous);
  tooLarge = "bytes";
  await page.getByRole("button", { name: "전체 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "서버 저장 한도" }).first()).toBeVisible();
  expect(remote.company.data.documents[0].sheet!.tabs[0].wholeRead).toEqual(previous);
  await expect(page.getByRole("cell", { name: "끝 행 끝 열 값", exact: true })).toBeAttached();
  await page.reload(); await ready(page);
  await page.getByRole("button", { name: "다음 구간", exact: true }).click();
  await expect(page.getByRole("cell", { name: "끝 행 끝 열 값", exact: true })).toBeAttached();
  await page.getByRole("button", { name: "자료실로 보내기", exact: true }).click();
  await page.getByRole("button", { name: "이전 구간", exact: true }).click();
  await page.getByRole("button", { name: "다음 구간", exact: true }).click();
  await expect(page.getByRole("cell", { name: "끝 행 끝 열 값", exact: true })).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("removing a sheet requires confirmation, preserves another sheet and stays removed after reload", async ({ page }, info) => {
  const remote = await cloud(page), target = remote.company.data.documents[0];
  remote.company.data.documents.push({ ...structuredClone(target), id: "other-sheet", name: "후속 보존 시트" });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "자비스에서 제거", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "시트 연결을 제거할까요?" });
  await expect(dialog.getByText(/Google 원본 파일은 그대로 남습니다/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("remove-sheet-dialog.png"), fullPage: true });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(remote.company.data.documents).toHaveLength(2);
  await page.getByRole("button", { name: "자비스에서 제거", exact: true }).click();
  await dialog.getByRole("button", { name: "연결과 보관 내용 제거", exact: true }).click();
  await expect.poll(() => remote.company.data.documents.map(d => d.id)).toEqual(["other-sheet"]);
  await expect(page.getByRole("heading", { name: "후속 보존 시트", exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  await expect(page.getByRole("heading", { name: "후속 보존 시트", exact: true })).toBeVisible();
  await expect(page.getByLabel("시트 목록").getByText("합성 업무 시트", { exact: false })).toHaveCount(0);
});
