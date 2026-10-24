import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "test-results/artifacts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4317",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    {
      name: "desktop",
      testMatch: /(?:ui|workroom|cloud|automation|sheets|planning|release)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /(?:ui|workroom|cloud|automation|sheets|planning|release)\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "safari",
      testMatch: /(?:automation|workroom|sheets)\.spec\.ts/,
      grep: /개발 작업 공간은 사진과 설명|개발 작업 공간은 실패|AI 없는 화면은 연결 상태|미완료 요청은 원래 내용을 보존|현재 기획안 구현은 마지막 상태 질문|메모 우선 업무실은 단계별로|저장한 메모는 입력창 근처|저장한 메모는 프로젝트 밖|stored sheet connections remain|changing the local sheet project filter/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "storage",
      testMatch: /storage\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
