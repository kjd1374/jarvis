import { test, expect, ready, seed, state } from "../support/fixtures";
import { serviceWorkroomFixture } from "../support/service-workroom";

test("서비스별 작업판은 기록·출처를 구분하고 메모 초안을 유지하며 저장 범위를 바꾸지 않는다", async ({ page }, info) => {
  const data = serviceWorkroomFixture(); await seed(page, data);
  const before = structuredClone((await state(page))!);
  const calls: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url()); });
  const memo = page.getByRole("region", { name: "빠른 메모", exact: true }), board = page.getByRole("region", { name: "서비스별 업무 현황", exact: true });
  await expect(memo.getByRole("region", { name: "저장한 메모", exact: true })).toBeVisible();
  await expect(memo.getByRole("heading", { name: /저장한 메모/ })).toHaveText("저장한 메모 35");
  await expect(page.getByLabel("프로젝트 범위")).toHaveCount(0);
  await expect(board).toContainText("연결 없는 합성 할 일");
  await memo.getByLabel("빠른 메모 내용").fill("서비스를 바꿔도 남는 합성 메모 초안");
  await board.getByRole("button", { name: "합성 서비스 A 현황 보기", exact: true }).click();
  const work = board.getByRole("tabpanel", { name: /^확인할 일/ });
  await expect(work).toContainText("합성 A 개발 요청"); await expect(work).not.toContainText("합성 B 개발 요청");
  await expect(work).toContainText("연결 프로젝트의 합성 할 일"); await expect(work).not.toContainText("연결 없는 합성 할 일");
  await expect(board.getByRole("status", { name:"업무 자료 상태" })).toContainText("업무 자료 연결 필요");
  const recordsTab = board.getByRole("tab", { name: /^가져온 기록/ });
  await recordsTab.focus(); await page.keyboard.press("Home"); await page.keyboard.press("End"); await expect(recordsTab).toBeFocused();
  await expect(board.getByRole("tabpanel", { name: /^가져온 기록/ })).toContainText("업무 자료 연결이 필요합니다.");
  await board.getByRole("button", { name: "합성 서비스 B 현황 보기", exact: true }).click();
  await expect(board.getByRole("status", { name:"업무 자료 상태" })).toContainText("업무 자료 수집됨");
  await info.attach("service-layout.json", { contentType:"application/json",body:JSON.stringify(await page.evaluate(() => {
    const selectors = ['main','[aria-label="빠른 메모"]','[aria-label="서비스별 업무 현황"]','[aria-label="서비스 선택"]','[aria-label="서비스별 현황 선택"]','[role="tabpanel"]:not([hidden])','button[aria-label="업무 기록 읽기: 합성 B 원본 기록"]'];
    return {viewport:{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollX,scrollY,visualWidth:visualViewport?.width},elements:selectors.map(selector=>{const node=document.querySelector(selector);if(!node)return{selector};const box=node.getBoundingClientRect(),css=getComputedStyle(node);return{selector,x:box.x,y:box.y,width:box.width,height:box.height,display:css.display,columns:css.gridTemplateColumns,minWidth:css.minWidth,overflow:css.overflow};})};
  })) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await board.getByRole("button", { name: "업무 기록 읽기: 합성 B 원본 기록", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "업무 기록 읽기", exact: true });
  await expect(reader.getByText(data.sourceRecords[0].content, { exact: true })).toBeVisible();
  await expect(reader.locator("img")).toHaveCount(0); await page.keyboard.press("Escape");
  await board.getByRole("button", { name: "합성 이전 자료 서비스 현황 보기", exact: true }).click();
  await expect(board.getByRole("status", { name:"업무 자료 상태" })).toContainText("자료 수집 오류");
  await expect(board.getByRole("button", { name: "업무 기록 읽기: 합성 마지막 정상 기록", exact: true })).toBeVisible();
  await expect(memo.getByLabel("빠른 메모 내용")).toHaveValue("서비스를 바꿔도 남는 합성 메모 초안");
  expect(await state(page)).toEqual(before); expect(calls).toEqual([]);
  await board.getByRole("button", { name: "전체 업무", exact: false }).click();
  await board.getByRole("tab", { name: /^프로젝트/ }).click();
  await expect(board).toContainText("연결 없는 합성 아이디어"); await expect(board).not.toContainText("개인 전용 프로젝트");
  await board.getByRole("button", { name:"합성 서비스 A 현황 보기",exact:true }).click();
  await board.getByRole("tab", { name:/^확인할 일/ }).click();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0,0); });
  if (info.project.name === "desktop") {
    for (const viewport of [{ width:1440,height:900 }, { width:1280,height:800 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 220);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.screenshot({ path:info.outputPath("service-workroom.png"),fullPage:true });
  await page.getByRole("button", { name:"개인",exact:true }).click(); await ready(page);
  await expect(board.getByRole("button", { name:"개인 전용 서비스 현황 보기",exact:true })).toBeVisible();
  await expect(board).not.toContainText("합성 A 개발 요청"); await expect(board).toContainText("개인 전용 비밀 업무");
  await expect(memo).toContainText("개인 전용 비밀 메모");
  expect((await state(page))!.notes).toEqual(before.notes); expect((await state(page))!.activeProjects).toEqual(before.activeProjects);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForLoadState("networkidle");
});

test("서비스 전환 중에도 오래된 메모 검색·전문 읽기·저장·새로고침이 보존된다", async ({ page }) => {
  const data = serviceWorkroomFixture(); await seed(page,data);
  const memo = page.getByRole("region", { name:"빠른 메모",exact:true }), saved = memo.getByRole("region", { name:"저장한 메모",exact:true });
  await saved.getByLabel("저장한 메모 검색").fill("오래된찾기검증");
  await saved.getByRole("button", { name:"메모 읽기: 기존 합성 메모 34",exact:true }).click();
  await expect(page.getByRole("dialog", { name:"메모 읽기",exact:true }).getByText(data.notes[34].content,{exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await memo.getByLabel("빠른 메모 내용").fill("서비스 보드에서 저장한 새 합성 기록");
  await memo.getByLabel("메모 연결 프로젝트").selectOption("service-project");
  await page.getByRole("button", { name:"합성 서비스 B 현황 보기",exact:true }).click();
  await memo.getByRole("button", { name:"메모 저장",exact:true }).click();
  await expect(saved).toContainText("서비스 보드에서 저장한 새 합성 기록");
  expect((await state(page))!.notes.slice(0,data.notes.length)).toEqual(data.notes);
  expect((await state(page))!.notes.at(-1)).toMatchObject({content:"서비스 보드에서 저장한 새 합성 기록",projectId:"service-project",space:"company"});
  await page.waitForLoadState("networkidle"); await page.reload(); await ready(page);
  await expect(saved).toContainText("서비스 보드에서 저장한 새 합성 기록");
  expect((await state(page))!.notes).toHaveLength(data.notes.length+1);
  expect((await state(page))!.activeProjects).toEqual(data.activeProjects);
  await page.waitForLoadState("networkidle");
});
