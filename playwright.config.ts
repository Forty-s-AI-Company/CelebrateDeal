import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const port = Number(process.env.E2E_PORT ?? 31023);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const useLocalWebServer = !process.env.E2E_BASE_URL;
const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public";

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) {
  process.env.DATABASE_URL = localPostgresUrl;
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  outputDir: "./reports/playwright-results",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  // Deterministic browser failures must be investigated with their artifacts, never retried away.
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/playwright-html", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useLocalWebServer
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: baseURL,
          PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? "demo",
          JOB_SECRET: process.env.JOB_SECRET ?? "e2e-job-secret-at-least-16-chars",
          CSRF_SECRET: process.env.CSRF_SECRET ?? "e2e-csrf-secret-at-least-16-chars",
        },
      }
    : undefined,
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-laptop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "chromium-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
