import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const port = Number(process.env.E2E_PORT ?? 31023);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public";
const resendApiKeyEnvironmentName = ["RESEND", "API", "KEY"].join("_");
const emailFromEnvironmentName = ["EMAIL", "FROM"].join("_");

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) {
  process.env.DATABASE_URL = localPostgresUrl;
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_URL: baseURL,
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? "demo",
      // 空字串也視為未設定；E2E 僅使用明確標註的測試密鑰。
      JOB_SECRET: process.env.JOB_SECRET || "e2e-job-secret-at-least-16-chars",
      CSRF_SECRET: process.env.CSRF_SECRET || "e2e-csrf-secret-at-least-16-chars",
      [resendApiKeyEnvironmentName]: "",
      [emailFromEnvironmentName]: "",
    } as Record<string, string>,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
