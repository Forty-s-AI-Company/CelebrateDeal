import { defineConfig, devices } from "@playwright/test";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const port = Number(process.env.E2E_PORT ?? 31023);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const localE2eCsrfSecret = "celebratedeal-local-playwright-csrf-secret-v1";
const localE2eCronSecret = "celebratedeal-local-playwright-cron-secret-v1";
const localE2eLiveChatIngressSecret = "celebratedeal-local-playwright-live-chat-ingress-secret-v1";
const commerceLoopbackTlsBridgeEnvironmentName = "G7_COMMERCE_LOOPBACK_TLS_BRIDGE";

function isLoopbackE2eUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === value
      && url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

if (!isLoopbackE2eUrl(baseURL)) {
  delete process.env[commerceLoopbackTlsBridgeEnvironmentName];
  throw new Error("Playwright browser QA requires an explicit loopback E2E_BASE_URL.");
}

// The commerce suite has already verified that its Secure-cookie session is
// valid before using the local HTTP bridge. Keep this marker available only
// for the verified loopback E2E runtime; never inherit or expose it elsewhere.
process.env[commerceLoopbackTlsBridgeEnvironmentName] = "1";

// The test process imports server-side commerce code directly. Keep its
// synthetic key identical to the local Next server without ever inheriting a
// configured development, preview, or production secret.
process.env.CSRF_SECRET = localE2eCsrfSecret;
// Browser fixtures may write data, so isolate them from the interactive local
// development database. Provision this database from committed migrations
// before running browser tests.
const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
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

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);

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
  // The local Docker test database intentionally uses a small connection
  // pool. Serial browser workers keep tenant-boundary fixtures deterministic
  // and avoid turning pool contention into false page-loading timeouts.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["./scripts/playwright-ci-reporter.ts"]]
    : [["list"]],
  use: {
    baseURL,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx prisma generate && npx next build --webpack && npx next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
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
      CSRF_SECRET: localE2eCsrfSecret,
      // These are synthetic loopback-only keys. Keep the production-mode
      // browser server aligned with build preflight without reading a user's
      // local or deployed runtime secrets.
      CRON_SECRET: localE2eCronSecret,
      LIVE_CHAT_INGRESS_SECRET: localE2eLiveChatIngressSecret,
      [commerceLoopbackTlsBridgeEnvironmentName]: "1",
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
