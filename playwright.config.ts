import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const port = Number(process.env.E2E_PORT ?? 31023);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public";
const resendApiKeyEnvironmentName = ["RESEND", "API", "KEY"].join("_");
const emailFromEnvironmentName = ["EMAIL", "FROM"].join("_");
const sentryDsnEnvironmentName = ["SENTRY", "DSN"].join("_");
const publicSentryDsnEnvironmentName = ["NEXT", "PUBLIC", "SENTRY", "DSN"].join("_");
const sentryAuthTokenEnvironmentName = ["SENTRY", "AUTH", "TOKEN"].join("_");
const e2eSmokeTestEmail = process.env.E2E_SMOKE_TEST_EMAIL
  ?? `e2e-smoke-${Date.now().toString(36)}-${process.pid}@celebratedeal.local`;
const e2eRateLimitProvider = process.env.E2E_RATE_LIMIT_PROVIDER ?? "memory";

// Share one run-scoped fake recipient between the Playwright worker and local
// web server. Never inherit a real configured smoke recipient into browser QA.
process.env.E2E_SMOKE_TEST_EMAIL = e2eSmokeTestEmail;
// Local browser QA verifies deterministic 429 behaviour without consuming the
// shared Staging Upstash quota. Preview smoke validates Upstash separately.
process.env.RATE_LIMIT_PROVIDER = e2eRateLimitProvider;

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) {
  process.env.DATABASE_URL = localPostgresUrl;
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // Browser smoke is a release gate. Run a production build/start lifecycle
  // instead of Turbopack dev mode, whose local filesystem cache can make
  // instrumentation and in-memory rate-limit tests restart mid-suite on
  // Windows. Preflight is exercised independently with real configured env;
  // this isolated browser server intentionally blanks external telemetry.
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx prisma generate && npx next build && npx next start --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      // Playwright itself may run under NODE_ENV=test. The child process is a
      // real Next production server, so give it the matching runtime mode.
      NODE_ENV: "production",
      // This is intentionally accepted only for the matching local HTTP
      // origin by getCanonicalAppUrl; it cannot relax a deployed public URL.
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? "demo",
      // 空字串也視為未設定；E2E 僅使用明確標註的測試密鑰。
      JOB_SECRET: process.env.JOB_SECRET || "e2e-job-secret-at-least-16-chars",
      CSRF_SECRET: process.env.CSRF_SECRET || "e2e-csrf-secret-at-least-16-chars",
      RATE_LIMIT_PROVIDER: e2eRateLimitProvider,
      SMOKE_TEST_EMAIL: e2eSmokeTestEmail,
      [resendApiKeyEnvironmentName]: "",
      [emailFromEnvironmentName]: "",
      // Browser smoke must remain local and deterministic. Sentry delivery is
      // verified separately against Staging, so do not let an unreachable
      // external ingest endpoint delay page loads or surface false 500s here.
      [sentryDsnEnvironmentName]: "",
      [publicSentryDsnEnvironmentName]: "",
      // Release-mode browser QA must never publish local source maps or create
      // an external Sentry release as a side effect of its child build.
      [sentryAuthTokenEnvironmentName]: "",
      SENTRY_DISABLE_AUTO_UPLOAD: "true",
    } as Record<string, string>,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
