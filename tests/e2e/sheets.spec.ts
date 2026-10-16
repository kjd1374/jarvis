import type { Page } from "@playwright/test";
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
  await page.getByRole("button", { name: "자료실로 보내기", exact: true }).click();
  await panel.getByRole("textbox").fill("보관한 내용에서 다음 일정은?"); await panel.getByRole("button", { name: "질문 보내기 ↗" }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions.length).toBe(2);
  await panel.getByRole("button", { name: "질문 취소", exact: true }).click();
  await expect.poll(() => remote.company.data.documents[0].sheet!.questions[1].status).toBe("cancelled");
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(panel.getByText("합성 일정의 마감은 10월 20일입니다.", { exact: true })).toHaveCount(0);
});
test("Google Picker grants a selected file, reads a bounded range and never persists the browser token", async ({ page }) => {
  const remote = await cloud(page); remote.company.data.documents = [];
  await page.route("**/api/sheets/config", route => route.fulfill({ json: { configured: true, clientId: "synthetic.apps.googleusercontent.com", apiKey: "AIzaSyntheticBrowserKey", projectNumber: "12345" } }));
  await page.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "application/javascript", body: `window.google = { accounts: { oauth2: { initTokenClient: (options) => ({ requestAccessToken: () => options.callback({ access_token: "synthetic-memory-only-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.file" }) }) } } };` }));
  await page.route("https://apis.google.com/js/api.js", route => route.fulfill({ contentType: "application/javascript", body: `window.gapi = { load: (_name, options) => {
    class View { setMimeTypes() { return this; } }
    class Builder { addView() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; } setAppId() { return this; } setOrigin() { return this; } setCallback(callback) { this.callback = callback; return this; } build() { return { setVisible: () => setTimeout(() => this.callback({ action: "picked", docs: [{ id: "synthetic_sheet_123", mimeType: "application/vnd.google-apps.spreadsheet" }] }), 0), dispose() {} }; } }
    window.google.picker = { DocsView: View, ViewId: { SPREADSHEETS: "spreadsheets" }, PickerBuilder: Builder }; options.callback();
  } };` }));
  let failValues = false, reads = 0;
  await page.route("https://sheets.googleapis.com/**", route => {
    expect(route.request().headers().authorization).toBe("Bearer synthetic-memory-only-token");
    if (route.request().url().includes("/values/")) { reads++; expect(decodeURIComponent(route.request().url())).toContain("'일정'!B10:D20"); return route.fulfill({ status: failValues ? 403 : 200, headers: { "Access-Control-Allow-Origin": "*" }, json: failValues ? { error: "synthetic" } : { values: [["항목", "마감", "상태"], ["합성 Google 값", "10월 20일", "진행"]] } }); }
    return route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { spreadsheetId: "synthetic_sheet_123", properties: { title: "선택한 합성 시트" }, sheets: [{ properties: { sheetId: 7, title: "일정", sheetType: "GRID" } }] } });
  });
  await page.goto("/tasks"); await ready(page);
  await page.getByRole("button", { name: "＋ 시트 연결", exact: true }).click();
  await expect(page.getByRole("heading", { name: "선택한 합성 시트", exact: true })).toBeVisible();
  await page.getByLabel("불러올 범위").fill("B10:D20"); await page.getByRole("button", { name: "불러오기", exact: true }).click();
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  expect(reads).toBe(1); expect(JSON.stringify(remote)).not.toContain("synthetic-memory-only-token");
  failValues = true; await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "파일 권한" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  await expect(page.getByRole("cell", { name: "합성 Google 값", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("synthetic-memory-only-token");
});
