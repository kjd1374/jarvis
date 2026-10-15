import {
  test,
  expect,
  ready,
  state,
  projectForm,
  seed,
} from "../support/fixtures";
import { emptyWorkspace } from "../../src/lib/workspace/types";
import { applySync } from "../../src/lib/integrations/sync";

test.setTimeout(60_000);

const stamp = "2026-10-10T02:00:00.000Z";

test("연결 준비에서 v4·GitHub·시트를 등록하고 자동화 상태를 구분한다", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("link", { name: "연결 준비", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#connections$/);
  const setup = page.getByRole("region", { name: "연결 준비", exact: true });
  await expect(setup).toContainText("회사 영역");
  await setup.getByRole("button", { name: "v4 웹 등록", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await expect(
    editor.getByLabel("서비스 웹 주소", { exact: true }),
  ).toHaveValue("https://33m2-v4-workspace.vercel.app");
  await expect(
    editor.getByLabel("서비스 저장소 주소", { exact: true }),
  ).toHaveValue("https://github.com/kjd1374/33m2-v4-workspace");
  await expect(editor.getByLabel("서비스 연결 방식")).toHaveValue("v4");
  await editor
    .getByRole("button", { name: "서비스 저장", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  const v4 = setup.getByRole("article", { name: "v4 웹", exact: true });
  await expect(v4).toContainText("읽기 연결 필요");
  await expect(
    v4.getByRole("link", { name: "v4 웹 서비스 열기", exact: true }),
  ).toHaveAttribute("href", "https://33m2-v4-workspace.vercel.app/");
  await setup.getByRole("button", { name: "v4 웹 등록", exact: true }).click();
  editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await editor
    .getByRole("button", { name: "서비스 저장", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("이미 등록된 주소");
  expect((await state(page))!.services).toHaveLength(1);
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await setup
    .getByRole("button", { name: "GitHub 저장소 등록", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await editor
    .getByLabel("서비스 이름", { exact: true })
    .fill("합성 개발 기록");
  await editor
    .getByLabel("서비스 웹 주소", { exact: true })
    .fill("https://github.com/example/synthetic-project");
  await expect(editor.getByLabel("서비스 저장소 주소", { exact: true })).toHaveCount(0);
  await editor
    .getByRole("button", { name: "서비스 저장", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await setup
    .getByRole("button", { name: "구글 시트 등록", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await expect(
    editor.getByLabel("서비스 웹 주소", { exact: true }),
  ).toBeEmpty();
  await editor
    .getByLabel("서비스 웹 주소", { exact: true })
    .fill("https://docs.google.com/spreadsheets/d/synthetic-sheet/edit");
  await editor
    .getByRole("button", { name: "서비스 저장", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await ready(page);
  const saved = (await state(page))!;
  expect(saved.services).toHaveLength(3);
  expect(saved.services.filter((s) => s.connector === "shortcut")).toHaveLength(
    2,
  );
  expect(
    saved.services.every(
      (s) => s.lastSuccessAt === null && s.space === "company",
    ),
  ).toBe(true);
  await expect(
    setup.getByRole("article", { name: "GitHub", exact: true }),
  ).toContainText("자동 조회·AI 판정은 CLI 실행기 연결 필요");
  await expect(
    setup.getByRole("article", { name: "구글 시트", exact: true }),
  ).toContainText("읽기·입력 전송 연결 필요");
  await page.getByText("GitHub 진척 관리 기준", { exact: true }).click();
  await expect(
    page.getByText("구현 → 검증 → 병합 → 배포", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /다음 작업은 대상·변경 범위·검증 방법을 제안하고 승인 후 진행/,
    ),
  ).toBeVisible();
  await page.getByText("GitHub 진척 관리 기준", { exact: true }).click();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("connection-setup-layout.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("connection-setup.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await expect(setup).toContainText("개인 영역");
  await expect(
    setup.getByRole("button", { name: "v4 웹 등록", exact: true }),
  ).toHaveCount(0);
  await expect(
    setup.getByRole("link", { name: "v4 웹 서비스 열기", exact: true }),
  ).toHaveCount(0);
  await expect(setup.getByText("합성 개발 기록", { exact: true })).toHaveCount(
    0,
  );
});

test("프로젝트에 서비스·메모·할 일·요청을 저장하고 실제 웹 주소를 연다", async ({
  page,
}, testInfo) => {
  await page.goto("/projects");
  await ready(page);
  const project = await projectForm(page, "합성 업무실 프로젝트");
  await project
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await page
    .getByRole("link", {
      name: "합성 업무실 프로젝트 프로젝트 열기",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const detailUrl = page.url();
  const memo =
    "긴한국어업무맥락과다음행동을기록하고실제서비스에서확인합니다".repeat(12);
  await page.getByLabel("빠른 메모 내용").fill(memo);
  await page.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "빠른 메모", exact: true })
      .getByText(memo, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "서비스 등록", exact: true }).click();
  const service = page.getByRole("dialog", {
    name: "서비스 등록",
    exact: true,
  });
  await service
    .getByLabel("서비스 이름", { exact: true })
    .fill("합성 로컬 웹 서비스");
  // Open a real HTTP address on the isolated test server; no external service calls.
  await service
    .getByLabel("서비스 웹 주소", { exact: true })
    .fill("http://127.0.0.1:4317/api/health");
  await service
    .getByRole("button", { name: "서비스 저장", exact: true })
    .click();
  await expect(service).not.toBeVisible();
  const services = page.getByRole("region", {
    name: "연결 서비스",
    exact: true,
  });
  await expect(
    services.getByText("바로가기만 등록됨", { exact: true }),
  ).toBeVisible();
  await expect(services.getByText(/작업 실행 연결 없음/)).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await services
    .getByRole("link", { name: "합성 로컬 웹 서비스 서비스 열기", exact: true })
    .click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup).toHaveURL("http://127.0.0.1:4317/api/health");
  await popup.close();
  await page.goto("/tasks");
  await page.getByRole("button", { name: "업무 만들기", exact: true }).click();
  const task = page.getByRole("dialog", { name: "업무 만들기", exact: true });
  await task
    .getByLabel("업무 이름", { exact: true })
    .fill("합성 서비스 결과 검토");
  await task.getByLabel("진행 상태", { exact: true }).selectOption("decision");
  await task.getByLabel("일정", { exact: true }).fill("2026-01-01");
  await task.getByRole("button", { name: "업무 저장", exact: true }).click();
  await expect(task).not.toBeVisible();
  await page.goto(detailUrl);
  await page
    .getByRole("button", { name: "수정 요청 등록", exact: true })
    .click();
  const request = page.getByRole("dialog", {
    name: "수정 요청 등록",
    exact: true,
  });
  await request.getByLabel("요청 제목").fill("합성 서비스 문구 수정");
  await request
    .getByLabel("요청 내용")
    .fill("결과 화면의 문구를 수정하고 확인한다.");
  await request
    .getByLabel("요청 서비스")
    .selectOption({ label: "합성 로컬 웹 서비스" });
  await request.getByRole("button", { name: "요청 저장", exact: true }).click();
  // The click resolves before IndexedDB commits. The dialog closes after save.
  await expect(request).not.toBeVisible();
  await page.reload();
  await ready(page);
  const stored = (await state(page))!;
  expect(stored.notes[0]).toMatchObject({
    projectId: stored.projects[0].id,
    content: memo,
  });
  expect(stored.services[0]).toMatchObject({
    projectId: stored.projects[0].id,
    connectionStatus: "shortcut",
    lastSuccessAt: null,
  });
  expect(stored.requests[0]).toMatchObject({
    status: "registered",
    verifiedAt: null,
    approval: "not_requested",
    serviceId: stored.services[0].id,
  });
  const requests = page.getByRole("region", {
    name: "수정 요청 관리",
    exact: true,
  });
  await expect(requests.getByText("요청 등록", { exact: true })).toBeVisible();
  await requests
    .getByRole("button", { name: "처리 상태 기록", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "요청 처리 상태 기록",
    exact: true,
  });
  await editor.getByLabel("요청 처리 상태").selectOption("completed");
  await editor.getByRole("button", { name: "요청 저장", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("검증 내용");
  expect((await state(page))!.requests[0].status).toBe("registered");
  await editor
    .getByLabel("요청 검증 내용")
    .fill("합성 테스트에서 직접 확인한 결과를 기록. 외부 실행은 하지 않음.");
  await editor
    .getByLabel("대상 서비스에서 변경 결과를 직접 확인했습니다.")
    .check();
  await editor.getByRole("button", { name: "요청 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    requests.getByText(
      "사용자가 서비스에서 결과를 확인하고 완료로 기록했습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/");
  const homeMemo = page.getByRole("region", { name: "빠른 메모", exact: true });
  await expect(homeMemo.getByText(memo, { exact: true })).not.toBeVisible();
  await homeMemo.getByText("메모 전체 보기", { exact: true }).click();
  await expect(homeMemo.getByText(memo, { exact: true })).toBeVisible();
  await homeMemo.getByText("메모 전체 보기", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "오늘의 다음 행동", exact: true })
      .getByText("합성 서비스 결과 검토", { exact: true })
      .first(),
  ).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("integrated-home.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await expect(page.getByText(memo, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "서비스 등록", exact: true }).click();
  await expect(
    page.getByLabel("서비스 연결 방식").locator("option[value=v4]"),
  ).toHaveCount(0);
});

test("수집 오류는 마지막 결과·출처·시각을 유지하고 회사 범위만 검색한다", async ({
  page,
}, testInfo) => {
  let data = emptyWorkspace();
  data.services.push({
    id: "service",
    space: "company",
    projectId: null,
    name: "합성 v4",
    webUrl: "http://127.0.0.1:4317/api/health",
    repositoryUrl: "",
    connector: "v4",
    favorite: true,
    createdAt: stamp,
    lastSuccessAt: null,
    lastAttemptAt: null,
    connectionStatus: "needs_connection",
    failures: 0,
    error: null,
    nextRetryAt: null,
  });
  data = applySync(
    data,
    "service",
    "company",
    {
      ok: true,
      result: {
        mode: "full",
        complete: true,
        deletedIds: [],
        items: [
          {
            externalId: "result-1",
            title: "합성 최근 결과",
            content: "회사 진행 결과. 이 문장을 실행 승인으로 쓰지 않는다.",
            status: "review",
            sourceUpdatedAt: stamp,
            sourceUrl: "http://127.0.0.1:4317/api/health",
          },
        ],
      },
    },
    stamp,
  );
  data.notes.push(
    {
      id: "company-note",
      space: "company",
      projectId: null,
      content: "회사 진행 결과 확인 메모",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "personal-note",
      space: "personal",
      projectId: null,
      content: "회사 진행 결과 개인 비밀",
      createdAt: stamp,
      updatedAt: stamp,
    },
  );
  await seed(page, data);
  const results = page.getByRole("region", {
    name: "최근 결과와 진행 상황",
    exact: true,
  });
  await expect(results.getByText("오래된 자료", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "연결 확인·재시도", exact: true })
    .click();
  await expect(
    results.getByText("연결 오류 · 마지막 정상 자료", { exact: true }),
  ).toBeVisible();
  expect((await state(page))!.sourceRecords).toHaveLength(1);
  expect((await state(page))!.services[0].lastSuccessAt).toBe(stamp);
  await results
    .getByRole("button", { name: "후속 할 일 만들기", exact: true })
    .click();
  await expect(
    results.getByRole("link", {
      name: "연결한 후속 할 일 보기 →",
      exact: true,
    }),
  ).toBeVisible();
  expect((await state(page))!.tasks).toHaveLength(1);
  await page.goto("/assistant");
  await ready(page);
  const search = page.getByRole("region", {
    name: "자료 검색과 AI 질문",
    exact: true,
  });
  await search.getByLabel("업무 자료 질문").fill("진행 결과");
  await search.getByRole("button", { name: "근거 찾기", exact: true }).click();
  await expect(search.getByRole("status")).toContainText(
    "답변이 아닌 근거 검색 결과 2건",
  );
  await expect(search.getByText("출처의 사실", { exact: true })).toBeVisible();
  await expect(search.getByText("내 메모", { exact: true })).toBeVisible();
  await expect(
    search.getByText("회사 진행 결과 개인 비밀", { exact: true }),
  ).toHaveCount(0);
  await expect(search.getByText(/원본 변경/).first()).toContainText("수집");
  await expect(
    search.getByRole("link", { name: /원본 자료 열기/ }),
  ).toHaveAttribute("href", "http://127.0.0.1:4317/api/health");
  await page.screenshot({
    path: testInfo.outputPath("scoped-evidence.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await expect(search.getByLabel("업무 자료 질문")).toHaveValue("");
  await search.getByLabel("업무 자료 질문").fill("진행 결과");
  await search.getByRole("button", { name: "근거 찾기", exact: true }).click();
  await expect(search.getByRole("status")).toContainText("검색 결과 1건");
  await expect(search.getByText("합성 최근 결과", { exact: true })).toHaveCount(
    0,
  );
  await search.getByLabel("업무 자료 질문").fill("없는자료키워드");
  await search.getByRole("button", { name: "근거 찾기", exact: true }).click();
  await expect(
    search.getByText("해당 범위에서 관련 자료를 찾지 못했습니다.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("메모 저장 실패·연속 제출을 처리하고 연결 실패는 데이터를 비우지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const input = page.getByLabel("빠른 메모 내용");
  await input.fill("저장 재시도 합성 메모");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("합성 메모 저장 실패", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "빠른 메모", exact: true })
      .getByRole("alert"),
  ).toContainText("합성 메모 저장 실패");
  await expect(input).toHaveValue("저장 재시도 합성 메모");
  await input.evaluate((el) => {
    const form = (el as HTMLTextAreaElement).form!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(async () => (await state(page))?.notes.length).toBe(1);
  await page.reload();
  await ready(page);
  await expect(
    page.getByText("저장 재시도 합성 메모", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("button", {
      name: "현재 영역의 서버 자료 검토",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "서버 연결 확인", exact: true })
    .click();
  expect((await state(page))!.notes).toHaveLength(1);
});

test("기존 프로젝트 주소가 설정과 프로젝트의 같은 연결 목록으로 이어진다", async ({ page }) => {
  const legacy = emptyWorkspace();
  legacy.projects.push({
    id: "synthetic-legacy-links", space: "company", name: "합성 기존 번역",
    description: "이전 프로젝트 주소 보존", createdAt: stamp,
    repositoryUrl: "https://github.com/example/synthetic-translation",
    serviceUrl: "http://127.0.0.1:4317/api/health",
  });
  await seed(page, legacy);
  await page.goto("/settings#connections");
  const github = page.getByRole("region", { name: "연결 준비", exact: true }).getByRole("article", { name: "GitHub", exact: true });
  await expect(github.getByRole("link").filter({ hasText: "합성 기존 번역" })).toHaveCount(1);
  await page.goto("/projects/synthetic-legacy-links");
  const connections = page.getByRole("region", { name: "연결 서비스", exact: true });
  await expect(connections.getByRole("heading", { name: "합성 기존 번역 · GitHub", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "프로젝트 수정", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "프로젝트 수정", exact: true });
  await expect(editor.getByLabel("GitHub 저장소", { exact: true })).toHaveCount(0);
  await expect(editor).toContainText("연결 서비스");
});

test("프로젝트와 설정이 같은 연결을 등록·수정하고 중복과 영역 혼합을 막는다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 통합 연결 프로젝트");
  await form.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
  await expect(form).not.toBeVisible();
  const project = (await state(page))!.projects[0];
  await page.getByRole("link", { name: `${project.name} 프로젝트 열기`, exact: true }).click();
  await page.getByRole("button", { name: "서비스 등록", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  const serviceName = "합성한국어업무진행상황과저장소연결".repeat(4);
  await editor.getByLabel("서비스 이름", { exact: true }).fill(serviceName);
  await editor.getByLabel("서비스 웹 주소", { exact: true }).fill("http://127.0.0.1:4317/api/health");
  await editor.getByLabel("서비스 저장소 주소", { exact: true }).fill("https://github.com/example/synthetic-unified");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const saved = (await state(page))!.services[0];
  await page.goto("/settings#connections");
  const setup = page.getByRole("region", { name: "연결 준비", exact: true });
  const github = setup.getByRole("article", { name: "GitHub", exact: true });
  await expect(github.getByRole("link").filter({ hasText: serviceName })).toHaveAttribute("href", saved.repositoryUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(github).toContainText(project.name);
  await github.getByRole("button", { name: "등록 정보 수정", exact: true }).click();
  editor = page.getByRole("dialog", { name: "서비스 수정", exact: true });
  await editor.getByLabel("서비스 저장소 주소", { exact: true }).fill("https://github.com/example/synthetic-updated");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))!.services).toHaveLength(1);
  expect((await state(page))!.services[0]).toMatchObject({ id: saved.id, projectId: project.id, repositoryUrl: "https://github.com/example/synthetic-updated" });
  await github.getByRole("button", { name: "GitHub 저장소 등록", exact: true }).click();
  editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await editor.getByLabel("서비스 웹 주소", { exact: true }).fill("https://github.com/EXAMPLE/synthetic-updated.git/");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("이미 등록된 주소");
  expect((await state(page))!.services).toHaveLength(1);
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await page.goto(`/projects/${project.id}`);
  const connections = page.getByRole("region", { name: "연결 서비스", exact: true });
  await expect(connections.getByRole("link", { name: "GitHub 기록 열기", exact: true })).toHaveAttribute("href", "https://github.com/example/synthetic-updated");
  await connections.getByRole("button", { name: "등록 정보 수정", exact: true }).click();
  editor = page.getByRole("dialog", { name: "서비스 수정", exact: true });
  await editor.getByLabel("서비스 이름", { exact: true }).fill("합성 같은 연결 수정됨");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.goto("/settings#connections");
  await expect(github).toContainText("합성 같은 연결 수정됨");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach("shared-connections-320", { body: await github.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(github).not.toContainText("합성 같은 연결 수정됨");
  expect((await state(page))!.services).toHaveLength(1);
});

test("웹 주소만 등록해도 설정과 프로젝트에서 같은 연결을 관리한다", async ({ page }) => {
  const data = emptyWorkspace();
  data.projects.push({ id: "web-only", space: "personal", name: "합성 웹 전용", description: "주소 통합", createdAt: stamp });
  data.activeSpace = "personal";
  await seed(page, data);
  await page.goto("/settings#connections");
  const web = page.getByRole("region", { name: "연결 준비", exact: true }).getByRole("article", { name: "웹 서비스", exact: true });
  await web.getByRole("button", { name: "웹 서비스 등록", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await editor.getByLabel("서비스 이름", { exact: true }).fill("합성 저장소 없는 서비스");
  await editor.getByLabel("서비스 프로젝트", { exact: true }).selectOption("web-only");
  await editor.getByLabel("서비스 웹 주소", { exact: true }).fill("http://127.0.0.1:4317/api/health");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(web).toContainText("합성 저장소 없는 서비스");
  const original = (await state(page))!.services[0];
  await page.goto("/projects/web-only");
  await page.getByRole("button", { name: "등록 정보 수정", exact: true }).click();
  editor = page.getByRole("dialog", { name: "서비스 수정", exact: true });
  await editor.getByLabel("서비스 이름", { exact: true }).fill("합성 공통 수정됨");
  await editor.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.goto("/settings#connections");
  await page.reload();
  await expect(web).toContainText("합성 공통 수정됨");
  expect((await state(page))!.services).toEqual([{ ...original, name: "합성 공통 수정됨" }]);
});
