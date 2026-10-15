import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/domain",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  outputDir: "test-results/domain",
});
