import { test, expect, openDetails, ready, state, projectForm } from "../support/fixtures";

const routes = [
  ["업무실", "/"],
  ["업무", "/tasks"],
  ["프로젝트", "/projects"],
  ["자료실", "/library"],
  ["맥락", "/notes"],
  ["설정", "/settings"],
];

test("메뉴 이동, 현재 위치, 모바일 메뉴 닫힘", async ({ page, isMobile }) => {
  const health = await page.request.get("/api/health");
  expect(await health.json()).toMatchObject({
    status: "ok",
    supabaseConfigured: false,
  });
  await page.goto("/");
  await ready(page);
  for (const [name, path] of routes) {
    if (isMobile)
      await page
        .getByRole("button", { name: "메뉴 열기", exact: true })
        .click();
    const scope = isMobile
      ? page.getByRole("dialog", { name: "모바일 메뉴" })
      : page.locator("aside").first();
    await scope.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.locator("h1")).toHaveText(name);
    if (isMobile) await expect(scope).not.toBeVisible();
    else
      await expect(
        scope.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("aria-current", "page");
  }
});

test("공간 검색, 결과 없음, 키보드 열기와 닫기", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "작업 공간 검색", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "작업 공간 검색" });
  const input = dialog.getByRole("textbox", { name: "공간 이름 검색" });
  await expect(input).toBeFocused();
  await input.fill("프로젝트");
  // Search includes each space description, so 자료실 also matches 프로젝트.
  await expect(dialog.getByRole("link")).toHaveCount(2);
  await dialog.getByRole("link", { name: /^프로젝트/ }).click();
  await expect(page).toHaveURL("/projects");
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("Control+k");
  await input.fill("존재하지않는합성검색어");
  await expect(dialog.getByText(/일치하는 공간이 없습니다/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("모든 화면의 좁은 폭과 업무실 패널 전환", async ({ page, isMobile }) => {
  for (const [, path] of [...routes, ["자료 검색 · AI 질문", "/assistant"]]) {
    await page.goto(path);
    await ready(page);
    for (const width of isMobile ? [320, 390, 760] : [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} ${width}px`,
      ).toBe(true);
    }
  }
  if (isMobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/assistant");
    await page
      .getByRole("button", { name: "맥락 · 자료", exact: true })
      .click();
    await expect(page.getByLabel("현재 업무 맥락")).toBeVisible();
    await expect(page.getByLabel("Jarvis에게 전달할 내용")).not.toBeVisible();
    await page.getByRole("button", { name: "AI 대화", exact: true }).click();
    await expect(page.getByLabel("Jarvis에게 전달할 내용")).toBeVisible();
  }
});

test("불러오는 중에는 빈 기록으로 표시하지 않는다", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      Object.defineProperty(request, "onsuccess", {
        set(callback) {
          request.addEventListener("success", (event) => {
            (
              window as typeof window & { releaseRead?: () => void }
            ).releaseRead = () => callback.call(request, event);
          });
        },
      });
      return request;
    };
  });
  await page.goto("/assistant");
  await expect(
    page.getByText("대화와 업무 맥락을 불러오는 중입니다.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("오늘, 어떤 일을 진행할까요?", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Jarvis에게 전달할 내용")).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as typeof window & { releaseRead?: () => void })
            .releaseRead,
      ),
    )
    .toBe("function");
  await page.evaluate(() =>
    (window as typeof window & { releaseRead: () => void }).releaseRead(),
  );
  await ready(page);
  await expect(
    page.getByText("오늘, 어떤 일을 진행할까요?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("AI 연결 대기", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-empty.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "오늘의 업무 정리" }).click();
  await expect(page.getByLabel("Jarvis에게 전달할 내용")).toBeFocused();
  await expect(page.getByLabel("Jarvis에게 전달할 내용")).not.toBeEmpty();
});

test("읽기 오류를 데이터 초기화 없이 다시 불러온다", async ({ page }) => {
  await page.goto("/assistant");
  await ready(page);
  await page
    .getByLabel("Jarvis에게 전달할 내용")
    .fill("다시 불러와도 유지할 합성 기록");
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  await expect(
    page.getByLabel("대화 기록", { exact: true }).locator("article"),
  ).toHaveCount(1);
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === "workspace") {
        IDBObjectStore.prototype.get = get;
        throw new Error("합성 읽기 오류");
      }
      return get.call(this, key);
    };
  });
  await page.goto("/assistant");
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 읽기 오류" }),
  ).toBeVisible();
  await expect(page.getByLabel("Jarvis에게 전달할 내용")).toBeDisabled();
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 읽기 오류" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByLabel("대화 기록", { exact: true })
      .getByText("다시 불러와도 유지할 합성 기록", { exact: true }),
  ).toBeVisible();
});

for (const [path, label, emptyTitle] of [
  ["/projects", "프로젝트", "업무에 하나의 흐름을 만들어주세요"],
  ["/tasks?view=records", "업무", "다음 할 일을 적어주세요"],
]) {
  test(`${label} 읽기 실패는 빈 목록으로 표시하지 않고 재시도한다`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (this.name === "workspace") {
          IDBObjectStore.prototype.get = get;
          throw new Error("합성 프로젝트 읽기 실패");
        }
        return get.call(this, key);
      };
    });
    await page.goto(path);
    await expect(
      page.getByRole("alert").filter({ hasText: "합성 프로젝트 읽기 실패" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: emptyTitle, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: `${label}를 불러오지 못했습니다`,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .click();
    await ready(page);
    await expect(
      page.getByRole("heading", { name: emptyTitle, exact: true }),
    ).toBeVisible();
  });
}

test("저장 진단은 기존 기록을 변경하지 않고 모바일에서도 확인할 수 있다", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 저장 상태 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const original = await state(page);
  await page.goto("/settings#storage-recovery");
  await ready(page);
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  const recovery = page.getByRole("region", {
    name: "브라우저 저장 진단과 복구",
    exact: true,
  });
  await recovery
    .getByRole("button", { name: "이 브라우저 저장 상태 확인", exact: true })
    .click();
  await expect(recovery).toContainText("정상적으로 읽을 수 있음");
  await expect(recovery).toContainText(
    "복구본의 프로젝트: 회사 1개 · 개인 0개",
  );
  await expect(
    recovery.getByRole("button", {
      name: "마지막 정상 저장본 복구",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await state(page)).toEqual(original);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("storage-diagnostics.png"),
    fullPage: true,
  });
});

test("긴 한국어, 줄바꿈, IME 입력과 모바일 전송", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/assistant");
  await ready(page);
  const input = page.getByLabel("Jarvis에게 전달할 내용");
  const content =
    "회사와개인자료를구분하여진행상황과다음행동을확인합니다".repeat(45);
  await input.fill(content);
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toHaveValue(content);
  await input.press("End");
  await input.press("Shift+Enter");
  await page.keyboard.insertText("끝");
  await expect(input).toHaveValue(content + "\n끝");
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  const log = page.getByLabel("대화 기록", { exact: true });
  await expect(log.locator("article")).toHaveCount(1);
  await expect(log.locator("article")).toContainText(content);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await log.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-long-ko.png"),
    fullPage: true,
  });
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await log.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await input.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    const box = await page
      .getByRole("button", { name: "대화 저장", exact: true })
      .boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("프로젝트 카드는 상세 화면을 열고 프로젝트 대화에서 돌아올 수 있다", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/projects");
  await ready(page);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "프로젝트 만들기" });
  await form.getByRole("radio", { name: /개발 시작·이어가기/ }).check();
  await form.getByLabel("프로젝트 이름").fill("합성 한국어 공부");
  await form
    .getByLabel("프로젝트 설명")
    .fill("회화 학습 앱을 만들고 진행 상황을 관리한다.");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const card = page.getByRole("link", {
    name: "합성 한국어 공부 프로젝트 열기",
    exact: true,
  });
  await expect(card).toHaveAttribute("href", /^\/projects\/[^/]+$/);
  await card.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const detailUrl = page.url();
  await expect(page.locator("h1")).toHaveText("합성 한국어 공부");
  await openDetails(page, "프로젝트 정보·연결");
  await expect(
    page.getByText("회화 학습 앱을 만들고 진행 상황을 관리한다.", {
      exact: true,
    }),
  ).toBeVisible();
  if (!isMobile)
    await expect(
      page
        .getByRole("navigation", { name: "주 메뉴" })
        .getByRole("link", { name: "프로젝트", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("합성 한국어 공부");
  await page
    .getByRole("button", { name: "프로젝트 수정", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "프로젝트 수정" });
  await editor
    .getByLabel("프로젝트 이름", { exact: true })
    .fill("합성 한국어 회화 프로젝트");
  await editor
    .getByLabel("프로젝트 설명", { exact: true })
    .fill(
      "긴 한국어 목표와 다음 행동을 프로젝트 안에서 관리합니다. ".repeat(8),
    );
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.locator("h1")).toHaveText("합성 한국어 회화 프로젝트");
  await openDetails(page, "프로젝트 정보·연결");
  await page.getByRole("button", { name: "서비스 등록", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await connection.getByLabel("서비스 이름", { exact: true }).fill("합성 회화 서비스");
  await connection.getByLabel("서비스 웹 주소", { exact: true }).fill("https://synthetic.example.com");
  await connection.getByLabel("서비스 저장소 주소", { exact: true }).fill("https://github.com/example/synthetic-project");
  await connection.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(connection).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "GitHub 기록 열기", exact: true }),
  ).toHaveAttribute("href", "https://github.com/example/synthetic-project");
  await page.reload();
  await openDetails(page, "프로젝트 정보·연결");
  await expect(
    page.getByRole("link", { name: "합성 회화 서비스 서비스 열기", exact: true }),
  ).toHaveAttribute("href", "https://synthetic.example.com/");
  await expect(page.getByLabel("프로젝트 범위")).toHaveValue(
    detailUrl.split("/").at(-1)!,
  );
  await page.screenshot({
    path: testInfo.outputPath("project-detail.png"),
    fullPage: true,
  });
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "AI에게 작업 요청", exact: true }).click();
  await expect(page.getByLabel("AI에게 요청", { exact: true })).toBeFocused();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.locator("h1")).toHaveText("합성 한국어 회화 프로젝트");
  await page.getByRole("link", { name: "프로젝트 목록", exact: true }).click();
  await expect(page).toHaveURL("/projects");
});
