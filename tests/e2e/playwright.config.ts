import { defineConfig, devices } from "@playwright/test";

/** Board E2E (PLAN.md point 105). Always started through `npm run test:e2e:board`, never directly. */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "../../.scratch/skript-board/e2e-results",
  use: {
    baseURL: process.env.BOARD_E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    locale: "de-DE",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
