/**
 * End-to-end browser tests (Playwright). Separate from the vitest unit tests:
 * these live in tests/e2e/*.spec.ts and drive a running server.
 *
 *   npm run e2e                                             — against http://localhost:3100
 *   BASE_URL=https://example.vercel.app APP_PASSWORD=… npm run e2e   — against any deployment
 *
 * The password comes from APP_PASSWORD (environment first, then .env.local). It is never printed.
 * Every test creates its own data with the "E2E " prefix and deletes it afterwards, so the
 * suite can run against the live site without leaving anything behind.
 */
import { defineConfig } from "@playwright/test";
import { BASE_URL, STORAGE_STATE } from "./tests/e2e/support/env";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "test-results/e2e",
  // One browser at a time: the machine is short on memory and the tests share one database.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: STORAGE_STATE,
      },
    },
  ],
});
