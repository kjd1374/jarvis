import { test as base, expect, type Page } from "@playwright/test";
import type { WorkspaceData } from "../../src/lib/workspace/types";

// Every test gets a fresh browser profile and synthetic records only.
export const test = base.extend<{ offlineGuard: void }>({
  offlineGuard: [
    async ({ context }, use, testInfo) => {
      const failures: string[] = [];
      const logs: string[] = [];
      context.on("page", (page) => {
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("console", (message) =>
          logs.push(`[${message.type()}] ${message.text()}`),
        );
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === "http://127.0.0.1:4317") return route.continue();
        failures.push(`Unexpected external request: ${url.origin}`);
        await route.abort("blockedbyclient");
      });
      await use();
      await testInfo.attach("browser.log", {
        body: [...logs, ...failures].join("\n"),
        contentType: "text/plain",
      });
      expect(
        failures,
        "No browser errors or external services allowed",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
export async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "회사", exact: true }),
  ).toBeEnabled();
  const together = page.getByRole("navigation", { name: "개발 작업 보기" }).getByRole("button", { name: "함께 보기", exact: true });
  if (await together.isVisible()) await together.click();
}
export async function state(page: Page): Promise<WorkspaceData | undefined> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("jarvis-workspace", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("workspace")
            .objectStore("workspace")
            .get("current");
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
}
export async function projectForm(page: Page, name: string) {
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "프로젝트 만들기" });
  await modal.getByRole("radio", { name: /개발 시작·이어가기/ }).check();
  await modal.getByLabel("프로젝트 이름").fill(name);
  await modal.getByLabel("프로젝트 설명").fill("자동 회귀 테스트용 합성 자료");
  return modal;
}

// Synthetic test fixtures only; never reads a user's browser profile.
export async function seed(page: Page, data: WorkspaceData) {
  await page.goto("/");
  await ready(page);
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("jarvis-workspace", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("workspace", "readwrite");
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
    data,
  );
  await page.reload();
  await ready(page);
}

export async function openDetails(page: Page, title: string) {
  const summary = page.locator("summary").filter({ hasText: title }).first();
  await expect(summary).toBeVisible();
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
}
