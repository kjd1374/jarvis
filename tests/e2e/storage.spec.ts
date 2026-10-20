import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { test, expect, openDetails, ready, state, projectForm } from "../support/fixtures";

const message = "합성 회사 프로젝트의 다음 기획을 정리한다";

async function replaceCurrent(
  page: Page,
  value: unknown,
  removeCheckpoint = false,
) {
  await page.evaluate(
    ({ value, removeCheckpoint }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("jarvis-workspace", 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("workspace", "readwrite");
          const store = tx.objectStore("workspace");
          if (value === undefined) store.delete("current");
          else store.put(value, "current");
          if (removeCheckpoint) store.delete("last-confirmed");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { value, removeCheckpoint },
  );
}

test("기존 v1 프로젝트는 새 컬렉션·정상 저장본이 없어도 보존하고 다음 저장에 포함한다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 구버전 번역 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const original = (await state(page))!;
  const legacy: Record<string, unknown> = { ...original };
  for (const key of [
    "notes",
    "services",
    "sourceRecords",
    "requests",
    "syncEvents",
  ])
    delete legacy[key];
  await replaceCurrent(page, legacy, true);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("heading", { name: original.projects[0].name, exact: true }),
  ).toBeVisible();
  const second = await projectForm(page, "합성 구버전 이후 프로젝트");
  await second
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(second).not.toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))!.projects[0]).toEqual(original.projects[0]);
  expect((await state(page))!.projects).toHaveLength(2);
});

test("복구 확인 후 다른 탭이 저장한 정상 기록을 덮어쓰지 않는다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 복구 경쟁 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const original = (await state(page))!;
  await replaceCurrent(page, undefined);
  await page.goto("/settings");
  const recovery = page.getByRole("region", {
    name: "브라우저 저장 진단과 복구",
    exact: true,
  });
  await recovery
    .getByRole("button", { name: "이 브라우저 저장 상태 확인", exact: true })
    .click();
  await recovery
    .getByLabel("회사·개인 기록의 복구 범위를 확인했습니다.")
    .check();
  const newer = structuredClone(original);
  newer.projects[0].description = "검토 후 다른 탭에서 저장한 새 내용";
  await replaceCurrent(page, newer);
  await recovery
    .getByRole("button", { name: "마지막 정상 저장본 복구", exact: true })
    .click();
  await expect(recovery.getByRole("alert")).toContainText(
    "정상 기록이 있습니다",
  );
  expect(await state(page)).toEqual(newer);
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await ready(page);
  expect(await state(page)).toEqual(newer);
});

test("개인 프로젝트는 화면 이동·새로고침·브라우저 완전 재시작 뒤에도 유지된다", async ({
  baseURL,
}) => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), "jarvis-persistence-test-"));
  const failures: string[] = [];
  const launch = async () => {
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      serviceWorkers: "block",
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === new URL(baseURL!).origin)
        return route.continue();
      failures.push("Unexpected external request");
      return route.abort();
    });
    context.on("page", (page) =>
      page.on("pageerror", (error) => failures.push(error.message)),
    );
    return context;
  };
  let context = await launch();
  try {
    let page = await context.newPage();
    await page.goto(`${baseURL}/projects`);
    await ready(page);
    await page.getByRole("button", { name: "개인", exact: true }).click();
    await ready(page);
    const form = await projectForm(page, "합성 재시작 번역 프로젝트");
    await form
      .getByRole("button", { name: "프로젝트 저장", exact: true })
      .click();
    await expect(form).not.toBeVisible();
    const original = (await state(page))!.projects;
    for (const path of ["/", "/assistant", "/settings", "/projects"]) {
      await page.goto(`${baseURL}${path}`);
      await ready(page);
    }
    await page.reload();
    await ready(page);
    expect((await state(page))!.projects).toEqual(original);
    await context.close();
    context = await launch();
    page = await context.newPage();
    await page.goto(`${baseURL}/projects`);
    await ready(page);
    await expect(
      page.getByRole("heading", { name: original[0].name, exact: true }),
    ).toBeVisible();
    expect((await state(page))!.projects).toEqual(original);
    await page.getByRole("button", { name: "회사", exact: true }).click();
    await ready(page);
    await expect(
      page.getByRole("heading", { name: original[0].name, exact: true }),
    ).toHaveCount(0);
    expect((await state(page))!.projects).toEqual(original);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const damage of ["missing", "unreadable"] as const) {
  test(`${damage} 현재 기록은 빈 목록으로 덮어쓰지 않고 확인 후 정상본과 파일을 복구한다`, async ({
    page,
  }) => {
    await page.goto("/projects");
    await ready(page);
    const form = await projectForm(page, "합성 복구 번역 프로젝트");
    await form
      .getByRole("button", { name: "프로젝트 저장", exact: true })
      .click();
    await expect(form).not.toBeVisible();
    await page.goto("/library");
    await ready(page);
    const bytes = Buffer.from("복구 후에도 유지할 합성 파일 원본");
    await page
      .getByLabel("자료 파일 선택")
      .setInputFiles({
        name: "합성-복구.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
    await expect(
      page.getByText("합성-복구.txt", { exact: true }),
    ).toBeVisible();
    const original = (await state(page))!;
    await page.evaluate(
      (damage) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("jarvis-workspace", 1);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("workspace", "readwrite");
            const store = tx.objectStore("workspace");
            if (damage === "missing") store.delete("current");
            else
              store.put(
                { version: 999, retained: "합성 손상 기록" },
                "current",
              );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      damage,
    );
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", {
        name: "프로젝트를 불러오지 못했습니다",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "프로젝트 만들기", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("link", { name: "저장 상태 확인", exact: true })
      .click();
    const recovery = page.getByRole("region", {
      name: "브라우저 저장 진단과 복구",
      exact: true,
    });
    await recovery
      .getByRole("button", { name: "이 브라우저 저장 상태 확인", exact: true })
      .click();
    const restore = recovery.getByRole("button", {
      name: "마지막 정상 저장본 복구",
      exact: true,
    });
    await expect(restore).toBeDisabled();
    expect(await state(page)).not.toEqual(original);
    await recovery
      .getByLabel("회사·개인 기록의 복구 범위를 확인했습니다.")
      .check();
    await restore.click();
    await expect(recovery.getByRole("status")).toContainText(
      "정상 저장본을 복구했습니다",
    );
    await ready(page);
    expect(await state(page)).toEqual(original);
    if (damage === "unreadable") {
      const retained = await page.evaluate(
        () =>
          new Promise<unknown[]>((resolve) => {
            const open = indexedDB.open("jarvis-workspace", 1);
            open.onsuccess = () => {
              const db = open.result;
              const read = db
                .transaction("workspace")
                .objectStore("workspace")
                .getAll();
              read.onsuccess = () => {
                db.close();
                resolve(read.result);
              };
            };
          }),
      );
      expect(retained).toContainEqual({
        version: 999,
        retained: "합성 손상 기록",
      });
    }
    await page.goto("/projects");
    await ready(page);
    await expect(
      page.getByRole("heading", {
        name: original.projects[0].name,
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/library");
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "합성-복구.txt 다운로드", exact: true })
      .click();
    expect(await readFile((await (await downloaded).path())!)).toEqual(bytes);
  });
}

test("정상 저장본 쓰기 실패는 프로젝트 추가 전체를 롤백하고 재시도한다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "workspace" && key === "last-confirmed") {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("합성 정상본 저장 실패", "QuotaExceededError");
      }
      return put.call(this, value, key!);
    };
  });
  const form = await projectForm(page, "합성 원자적 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText("합성 정상본 저장 실패");
  expect((await state(page))?.projects ?? []).toHaveLength(0);
  await expect(form.getByLabel("프로젝트 이름")).toHaveValue(
    "합성 원자적 프로젝트",
  );
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))!.projects).toHaveLength(1);
});

test("대화·맥락 이력·업무 저장, 새로고침, 중복 업무 방지와 영역 분리", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 회사 기획");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await page
    .getByLabel("프로젝트 범위")
    .selectOption({ label: "합성 회사 기획" });
  await ready(page);
  await page.goto("/assistant");
  await ready(page);
  for (const content of ["합성 기획 원칙", "합성 기획 원칙\n다음 행동: 검수"]) {
    await page.getByRole("button", { name: "맥락 편집" }).click();
    const editor = page.getByRole("dialog", { name: "업무 맥락 편집" });
    await editor.getByLabel("누적 맥락", { exact: true }).fill(content);
    await editor
      .getByRole("button", { name: "맥락 저장", exact: true })
      .click();
    await expect(editor).not.toBeVisible();
  }
  await page.getByLabel("Jarvis에게 전달할 내용").fill(message);
  await page.getByLabel("Jarvis에게 전달할 내용").press("Enter");
  const log = page.getByLabel("대화 기록", { exact: true });
  await expect(log.locator("article")).toHaveCount(1);
  for (let i = 0; i < 2; i++) {
    await log.getByRole("button", { name: "업무로 연결", exact: true }).click();
    await ready(page);
  }
  await page.reload();
  await ready(page);
  await expect(log.getByText(message, { exact: true })).toBeVisible();
  const stored = (await state(page))!;
  expect(stored.contextRevisions.map((r) => r.content)).toEqual([
    "합성 기획 원칙",
    "합성 기획 원칙\n다음 행동: 검수",
  ]);
  expect(stored.tasks).toHaveLength(1);
  expect(stored.tasks[0].sourceMessageId).toBe(stored.messages[0].id);
  expect(stored.tasks[0].projectId).toBe(stored.projects[0].id);
  await page
    .getByLabel("Jarvis에게 전달할 내용")
    .fill("회사 작성 중인 합성 내용");
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(page.getByLabel("Jarvis에게 전달할 내용")).toHaveValue("");
  await expect(log.locator("article")).toHaveCount(0);
  await expect(
    page
      .getByLabel("현재 업무 맥락")
      .getByText("합성 기획 원칙\n다음 행동: 검수", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "대화에 자료 연결", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "대화에 자료 연결" });
  await expect(picker.getByRole("checkbox")).toHaveCount(0);
  await picker.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("Jarvis에게 전달할 내용").fill("합성 개인 기록");
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  await expect(log.locator("article")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "개인", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(log.getByText("합성 개인 기록", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "회사", exact: true }).click();
  await expect(log.getByText(message, { exact: true })).toBeVisible();
  await expect(log.getByText("합성 개인 기록", { exact: true })).toHaveCount(0);
});

test("저장 중 연속 제출은 한 번만 기록하고 실패한 내용은 재시도한다", async ({
  page,
}) => {
  await page.goto("/assistant");
  await ready(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("합성 저장 실패", "QuotaExceededError");
    };
  });
  const input = page.getByLabel("Jarvis에게 전달할 내용");
  await input.fill(message);
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "저장 다시 시도", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(message);
  expect((await state(page))?.messages ?? []).toHaveLength(0);
  await page
    .getByRole("button", { name: "저장 다시 시도", exact: true })
    .click();
  await expect(
    page.getByLabel("대화 기록", { exact: true }).locator("article"),
  ).toHaveCount(1);
  await input.fill("연속 제출 합성 내용");
  // Hold a real readwrite transaction so the saving state is deterministic.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open("jarvis-workspace", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["workspace", "files"], "readwrite");
          const store = tx.objectStore("workspace");
          const win = window as typeof window & { releaseStorage?: () => void };
          let held = true;
          win.releaseStorage = () => {
            held = false;
          };
          function keepAlive() {
            store.get("hold").onsuccess = () => {
              if (held) keepAlive();
            };
          }
          keepAlive();
          tx.oncomplete = () => db.close();
          resolve();
        };
      }),
  );
  await input.evaluate((element) => {
    const form = (element as HTMLTextAreaElement).form!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page.getByRole("button", { name: "대화 저장 중", exact: true }),
  ).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "새 대화", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as typeof window & { releaseStorage: () => void }).releaseStorage(),
  );
  await expect(input).toHaveValue("");
  await expect.poll(async () => (await state(page))?.messages.length).toBe(2);
  await page.reload();
  await expect(
    page.getByLabel("대화 기록", { exact: true }).locator("article"),
  ).toHaveCount(2);
});

test("파일 원본과 프로젝트·업무 연결, 연결 변경과 대화 첨부를 복원한다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 자료 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await page
    .getByLabel("프로젝트 범위")
    .selectOption({ label: "합성 자료 프로젝트" });
  await ready(page);
  await page.goto("/assistant");
  await ready(page);
  await page.getByLabel("Jarvis에게 전달할 내용").fill(message);
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  await page.getByRole("button", { name: "업무로 연결", exact: true }).click();
  await ready(page);
  await page.goto("/library");
  await ready(page);
  await page
    .getByLabel("새 파일의 연결 업무", { exact: true })
    .selectOption({ label: message });
  const original = Buffer.from(
    "회귀 테스트 전용 합성 문서\n실제 고객 자료 없음",
  );
  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: "합성-기획.txt",
    mimeType: "text/plain",
    buffer: original,
  });
  await expect(page.getByText("합성-기획.txt", { exact: true })).toBeVisible();
  await page.reload();
  await ready(page);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "합성-기획.txt 다운로드", exact: true })
    .click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(original);
  // Existing v1 Blob records remain readable without rewriting the database.
  const fileId = (await state(page))!.documents[0].id;
  await page.evaluate(async ({ fileId, bytes }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("jarvis-workspace", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(new Blob([new Uint8Array(bytes)], { type: "text/plain" }), fileId);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, { fileId, bytes: [...original] });
  await page.reload(); await ready(page);
  const legacyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "합성-기획.txt 다운로드", exact: true }).click();
  expect(await readFile((await (await legacyDownload).path())!)).toEqual(original);
  const stored = (await state(page))!;
  expect(stored.documents[0]).toMatchObject({
    projectId: stored.projects[0].id,
    taskId: stored.tasks[0].id,
    space: "company",
  });
  await page
    .getByRole("button", { name: "합성-기획.txt 연결 설정", exact: true })
    .click();
  let editor = page.getByRole("dialog", { name: "자료 연결 설정" });
  await editor.getByLabel("연결 프로젝트", { exact: true }).selectOption("");
  await editor.getByRole("button", { name: "연결 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect((await state(page))!.documents[0]).toMatchObject({
    projectId: null,
    taskId: null,
  });
  await page.getByLabel("프로젝트 범위").selectOption("");
  await ready(page);
  await page
    .getByRole("button", { name: "합성-기획.txt 연결 설정", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "자료 연결 설정" });
  await editor
    .getByLabel("연결 프로젝트", { exact: true })
    .selectOption({ label: "합성 자료 프로젝트" });
  await editor
    .getByLabel("연결 업무", { exact: true })
    .selectOption({ label: message });
  await editor.getByRole("button", { name: "연결 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))!.documents[0]).toMatchObject({
    projectId: stored.projects[0].id,
    taskId: stored.tasks[0].id,
  });
  await page.goto("/assistant");
  await ready(page);
  await page
    .getByRole("button", { name: "대화에 자료 연결", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "대화에 자료 연결" });
  await picker.getByRole("checkbox", { name: /합성-기획.txt/ }).check();
  await picker.getByRole("button", { name: "연결 적용", exact: true }).click();
  await page.getByLabel("Jarvis에게 전달할 내용").fill("합성 연결 자료 검토");
  await page.getByRole("button", { name: "대화 저장", exact: true }).click();
  await expect
    .poll(async () => (await state(page))?.messages.at(-1)?.fileIds)
    .toEqual([stored.documents[0].id]);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await page.goto("/library");
  await ready(page);
  await expect(page.getByText("합성-기획.txt", { exact: true })).toHaveCount(0);
});

test("파일 저장 실패는 메타데이터도 롤백하고 재업로드는 한 번만 저장한다", async ({
  page,
}) => {
  await page.goto("/library");
  await ready(page);
  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: "기존-합성.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("기존 합성 자료 보존"),
  });
  await expect(page.getByText("기존-합성.txt", { exact: true })).toBeVisible();
  const existing = (await state(page))!.documents[0];
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "files") {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("합성 파일 저장 실패", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
  const file = {
    name: "합성-재시도.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("합성 원본"),
  };
  await page.getByLabel("자료 파일 선택").setInputFiles(file);
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 파일 저장 실패" }).first(),
  ).toBeVisible();
  expect((await state(page))?.documents).toEqual([existing]);
  await page.getByLabel("자료 파일 선택").setInputFiles(file);
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))?.documents).toHaveLength(2);
  expect((await state(page))?.documents[0]).toEqual(existing);
  await page.getByLabel("자료 검색", { exact: true }).fill("재시도");
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  await expect(page.getByText("기존-합성.txt", { exact: true })).toHaveCount(0);
  await page.getByLabel("자료 검색", { exact: true }).fill("없는합성파일");
  await expect(
    page.getByText("검색한 자료가 없습니다", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("자료 검색", { exact: true }).clear();
  await expect(page.getByText("기존-합성.txt", { exact: true })).toBeVisible();
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
});

test("다른 탭의 동시 저장이 서로의 프로젝트를 덮어쓰지 않는다", async ({
  page,
  context,
}) => {
  await page.goto("/projects");
  await ready(page);
  const second = await context.newPage();
  await second.goto("/projects");
  await ready(second);
  const [firstForm, secondForm] = await Promise.all([
    projectForm(page, "합성 동시 A"),
    projectForm(second, "합성 동시 B"),
  ]);
  await Promise.all([
    firstForm
      .getByRole("button", { name: "프로젝트 저장", exact: true })
      .click(),
    secondForm
      .getByRole("button", { name: "프로젝트 저장", exact: true })
      .click(),
  ]);
  await expect(
    page.getByRole("heading", { name: "합성 동시 B", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("heading", { name: "합성 동시 A", exact: true }),
  ).toBeVisible();
  await page.reload();
  await ready(page);
  expect((await state(page))?.projects.map((p) => p.name).sort()).toEqual([
    "합성 동시 A",
    "합성 동시 B",
  ]);
});

test("프로젝트 상세는 다른 프로젝트의 업무·맥락·자료·대화를 섞지 않는다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  for (const name of ["합성 연결 A", "합성 연결 B"]) {
    const form = await projectForm(page, name);
    await form
      .getByRole("button", { name: "프로젝트 저장", exact: true })
      .click();
    await expect(form).not.toBeVisible();
  }
  const original = (await state(page))!;
  const [a, b] = original.projects;
  await page.evaluate(
    ({ data, a, b }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("jarvis-workspace", 1);
        request.onsuccess = () => {
          const db = request.result;
          const stamp = new Date().toISOString();
          const tx = db.transaction("workspace", "readwrite");
          data.activeProjects.company = b.id;
          for (const [project, label] of [
            [a, "A"],
            [b, "B"],
          ] as const) {
            data.tasks.push({
              id: `task-${label}`,
              projectId: project.id,
              space: "company",
              title: `합성 업무 ${label}`,
              status: "decision",
              dueDate: "2026-10-14",
              createdAt: stamp,
            });
            data.documents.push({
              id: `file-${label}`,
              projectId: project.id,
              taskId: `task-${label}`,
              space: "company",
              name: `합성 자료 ${label}.txt`,
              mime: "text/plain",
              size: 10,
              createdAt: stamp,
            });
            data.conversations.push({
              id: `conversation-${label}`,
              projectId: project.id,
              space: "company",
              title: `합성 대화 ${label}`,
              createdAt: stamp,
              updatedAt: stamp,
            });
            data.messages.push({
              id: `message-${label}`,
              conversationId: `conversation-${label}`,
              content: `합성 대화 내용 ${label}`,
              fileIds: [],
              createdAt: stamp,
            });
            data.contexts.push({
              id: `context-${label}`,
              projectId: project.id,
              space: "company",
              content: `합성 프로젝트 맥락 ${label}`,
              revision: 1,
              updatedAt: stamp,
            });
            data.contextRevisions.push({
              id: `revision-${label}`,
              contextId: `context-${label}`,
              content: `합성 프로젝트 맥락 ${label}`,
              revision: 1,
              createdAt: stamp,
            });
          }
          tx.objectStore("workspace").put(data, "current");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { data: original, a, b },
  );
  await page.goto(`/projects/${a.id}`);
  await expect(page.locator("h1")).toHaveText(a.name);
  await expect(page.getByLabel("프로젝트 범위")).toHaveValue(a.id);
  await openDetails(page, "업무·메모·기록");
  for (const [section, own, other] of [
    ["프로젝트 업무", "합성 업무 A", "합성 업무 B"],
    ["프로젝트 자료", "합성 자료 A.txt", "합성 자료 B.txt"],
    ["프로젝트 대화", "합성 대화 A", "합성 대화 B"],
    ["프로젝트 맥락", "합성 프로젝트 맥락 A", "합성 프로젝트 맥락 B"],
  ]) {
    await expect(
      page
        .getByRole("region", { name: section, exact: true })
        .getByText(own, { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: section, exact: true })
        .getByText(other, { exact: true }),
    ).toHaveCount(0);
  }
  await page
    .getByRole("region", { name: "프로젝트 대화", exact: true })
    .getByRole("button", { name: /합성 대화 A/ })
    .click();
  await expect(page).toHaveURL("/assistant");
  await expect(
    page
      .getByLabel("대화 기록", { exact: true })
      .getByText("합성 대화 내용 A", { exact: true }),
  ).toBeVisible();
  expect((await state(page))!.activeProjects.company).toBe(a.id);
  await page
    .getByRole("link", { name: `${a.name}로 돌아가기`, exact: true })
    .click();
  await openDetails(page, "업무·메모·기록");
  await page.getByRole("button", { name: "자료 관리", exact: true }).click();
  await expect(page).toHaveURL("/library");
  await expect(
    page.getByText("합성 자료 A.txt", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("합성 자료 B.txt", { exact: true })).toHaveCount(
    0,
  );
});

test("프로젝트 수정 오류는 입력과 기존 연결을 보존하고 영역 밖 상세는 노출하지 않는다", async ({
  page,
}) => {
  await page.goto("/projects");
  await ready(page);
  const form = await projectForm(page, "합성 수정 전 프로젝트");
  await form
    .getByRole("button", { name: "프로젝트 저장", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const original = (await state(page))!.projects[0];
  await page
    .getByRole("link", { name: `${original.name} 프로젝트 열기`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "프로젝트 수정", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "프로젝트 수정" });
  await editor
    .getByLabel("프로젝트 이름", { exact: true })
    .fill("합성 수정 후 프로젝트");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("합성 프로젝트 저장 실패", "QuotaExceededError");
    };
  });
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "합성 프로젝트 저장 실패",
  );
  await expect(editor.getByLabel("프로젝트 이름", { exact: true })).toHaveValue(
    "합성 수정 후 프로젝트",
  );
  expect((await state(page))!.projects[0]).toEqual(original);
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await openDetails(page, "프로젝트 정보·연결");
  await page.getByRole("button", { name: "서비스 등록", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "서비스 등록", exact: true });
  await connection.getByLabel("서비스 이름", { exact: true }).fill("합성 수정 서비스");
  await connection.getByLabel("서비스 웹 주소", { exact: true }).fill("http://localhost:8765");
  await connection.getByLabel("서비스 저장소 주소", { exact: true }).fill("javascript:alert(1)");
  await connection.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("http/https");
  expect((await state(page))!.services).toHaveLength(0);
  await connection.getByLabel("서비스 저장소 주소", { exact: true }).fill("https://github.com/example/synthetic-repository");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("합성 연결 저장 실패", "QuotaExceededError");
    };
  });
  await connection.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("합성 연결 저장 실패");
  await expect(connection.getByLabel("서비스 저장소 주소", { exact: true })).toHaveValue("https://github.com/example/synthetic-repository");
  expect((await state(page))!.services).toHaveLength(0);
  await connection.getByRole("button", { name: "서비스 저장", exact: true }).click();
  await expect(connection).not.toBeVisible();
  await page.reload();
  await expect(page.locator("h1")).toHaveText("합성 수정 후 프로젝트");
  await openDetails(page, "프로젝트 정보·연결");
  await expect(page.getByRole("link", { name: "합성 수정 서비스 서비스 열기", exact: true })).toHaveAttribute("href", "http://localhost:8765/");
  expect((await state(page))!.projects[0]).toMatchObject({ id: original.id, name: "합성 수정 후 프로젝트" });
  expect((await state(page))!.services[0]).toMatchObject({ projectId: original.id, repositoryUrl: "https://github.com/example/synthetic-repository", webUrl: "http://localhost:8765/" });
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await expect(page).toHaveURL("/projects");
  await page.goto(`/projects/${original.id}`);
  await expect(
    page.getByRole("heading", {
      name: "이 영역에서 프로젝트를 찾을 수 없습니다",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "합성 수정 후 프로젝트", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "합성 수정 서비스 서비스 열기", exact: true }),
  ).toHaveCount(0);
  await page.goto("/projects/missing-synthetic-id");
  await expect(
    page.getByRole("heading", {
      name: "이 영역에서 프로젝트를 찾을 수 없습니다",
      exact: true,
    }),
  ).toBeVisible();
});

test("원본 포함 백업을 새 브라우저로 이관하고 재가져오기·충돌 시 기존 자료를 보존한다", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await ready(page);
  await page.getByLabel("빠른 메모 내용").fill("합성 이관 메모");
  await page.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect.poll(async () => (await state(page))?.notes.length).toBe(1);
  await page.getByRole("button", { name: "개인", exact: true }).click();
  await ready(page);
  await page.getByLabel("빠른 메모 내용").fill("이 백업에서 제외할 개인 자료");
  await page.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect.poll(async () => (await state(page))?.notes.length).toBe(2);
  await page.getByRole("button", { name: "회사", exact: true }).click();
  // A hard navigation can abort the async IndexedDB scope write; wait for the chosen scope.
  await expect.poll(async () => (await state(page))?.activeSpace).toBe("company");
  await page.goto("/library");
  await ready(page);
  const original = Buffer.from("원본 파일 이관 검증용 합성 데이터");
  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: "합성-이관.txt",
    mimeType: "text/plain",
    buffer: original,
  });
  await expect(page.getByText("합성-이관.txt", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "원본 링크 등록", exact: true })
    .click();
  const reference = page.getByRole("dialog", {
    name: "원본 링크 등록",
    exact: true,
  });
  await reference.getByLabel("원본 자료 이름").fill("복제하지 않는 원본 링크");
  await reference
    .getByLabel("원본 자료 주소")
    .fill("http://127.0.0.1:4317/api/health");
  await reference
    .getByRole("button", { name: "원본 링크 저장", exact: true })
    .click();
  await expect(reference).not.toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "복제하지 않는 원본 링크 원본 열기",
      exact: true,
    }),
  ).toHaveAttribute("href", "http://127.0.0.1:4317/api/health");
  await page.goto("/settings");
  await ready(page);
  await expect(page.getByLabel("백업 범위")).toHaveValue("current");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "백업 내보내기", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await downloading).path())!, "utf8"),
  );
  expect(exported.data.notes).toHaveLength(1);
  expect(exported.data.notes[0].space).toBe("company");
  expect(exported.files).toHaveLength(1);
  expect(Buffer.from(exported.files[0].base64, "base64")).toEqual(original);
  const context = await browser.newContext();
  const failures: string[] = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:4317")
      return route.continue();
    failures.push("external request");
    return route.abort();
  });
  const second = await context.newPage();
  second.on("pageerror", (error) => failures.push(error.message));
  try {
    await second.goto("http://127.0.0.1:4317/settings");
    await ready(second);
    const file = {
      name: "synthetic-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    };
    async function chooseAndConfirm(value = file) {
      await second
        .getByLabel("백업 파일 선택", { exact: true })
        .setInputFiles(value);
      await expect(
        second.getByRole("heading", { name: "가져오기 확인", exact: true }),
      ).toBeVisible();
      await second
        .getByLabel("회사·개인 범위와 병합 내용을 확인했습니다.")
        .check();
      await second
        .getByRole("button", { name: "기존 기록을 유지하며 병합", exact: true })
        .click();
    }
    await second
      .getByLabel("백업 파일 선택", { exact: true })
      .setInputFiles(file);
    expect((await state(second))?.notes ?? []).toHaveLength(0); // Preview is not an import.
    await expect(
      second.getByRole("button", {
        name: "기존 기록을 유지하며 병합",
        exact: true,
      }),
    ).toBeDisabled();
    await second
      .getByLabel("회사·개인 범위와 병합 내용을 확인했습니다.")
      .check();
    await second
      .getByRole("button", { name: "기존 기록을 유지하며 병합", exact: true })
      .click();
    await expect.poll(async () => (await state(second))?.notes.length).toBe(1);
    await second.reload();
    await ready(second);
    await chooseAndConfirm();
    await expect(
      second.getByRole("status").filter({ hasText: "0개 항목을 병합" }),
    ).toBeVisible();
    expect((await state(second))!.documents).toHaveLength(2);
    // Same ID but different content must preserve the current record.
    const conflicting = structuredClone(exported);
    conflicting.data.notes[0].content = "덮어쓰면 안 되는 다른 내용";
    await chooseAndConfirm({
      ...file,
      buffer: Buffer.from(JSON.stringify(conflicting)),
    });
    await expect(
      second.getByRole("status").filter({ hasText: "충돌 1개는 현재 기록" }),
    ).toBeVisible();
    expect((await state(second))!.notes[0].content).toBe("합성 이관 메모");
    const corruptFile = structuredClone(exported);
    corruptFile.files[0].base64 = Buffer.alloc(original.length, 65).toString(
      "base64",
    );
    await chooseAndConfirm({
      ...file,
      buffer: Buffer.from(JSON.stringify(corruptFile)),
    });
    await expect(
      second
        .getByRole("alert")
        .filter({ hasText: "같은 ID의 다른 파일 원본" })
        .first(),
    ).toBeVisible();
    await second.goto("http://127.0.0.1:4317/library");
    const downloadPromise = second.waitForEvent("download");
    await second
      .getByRole("button", { name: "합성-이관.txt 다운로드", exact: true })
      .click();
    expect(await readFile((await (await downloadPromise).path())!)).toEqual(
      original,
    );
    await expect(
      second.getByText("복제하지 않는 원본 링크", { exact: true }),
    ).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await context.close();
  }
});
