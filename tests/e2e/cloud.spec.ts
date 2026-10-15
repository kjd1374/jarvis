import type { Page } from "@playwright/test";
import { test, expect, ready, projectForm, state } from "../support/fixtures";
import { emptyWorkspace, type Space } from "../../src/lib/workspace/types";
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
  const control = { failWrites: false, loseAcknowledgement: false, puts: 0 };
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
    if (body.revision !== target.revision)
      return route.fulfill({
        status: 409,
        json: { error: "합성 버전 충돌", code: "revision_conflict" },
      });
    target.data = body.data;
    target.revision++;
    if (control.loseAcknowledgement) {
      control.loseAcknowledgement = false;
      return route.fulfill({
        status: 503,
        json: { error: "합성 응답 유실", code: "save_failed" },
      });
    }
    return route.fulfill({ json: { revision: target.revision } });
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

test("다른 기기의 변경은 검토와 확인 후 병합하고 이전 브라우저 기록은 자동 이관하지 않는다", async ({
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
  await review
    .getByRole("button", { name: "충돌은 서버 내용으로 병합", exact: true })
    .click();
  await expect.poll(() => remote.company.data.projects.length).toBe(2);
  expect(remote.company.data.projects[0].description).toBe(
    "다른 기기에서 바꾼 합성 내용",
  );
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
