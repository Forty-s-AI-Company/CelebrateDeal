import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const applicationServer = baseConfig.webServer;
if (!applicationServer || Array.isArray(applicationServer)) {
  throw new Error("SUPPORT_E2E_REQUIRES_SINGLE_APPLICATION_SERVER");
}

// Exercise the configured REST adapter against a synthetic loopback service.
// This does not establish the durability or availability of real Upstash.
export default defineConfig({
  ...baseConfig,
  testDir: "./tests/e2e-support",
  webServer: [
    {
      command: "node scripts/local-support-rate-limit-fixture.mjs",
      url: "http://127.0.0.1:31025/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      ...applicationServer,
      env: {
        ...applicationServer.env,
        RATE_LIMIT_PROVIDER: "upstash_redis",
        UPSTASH_REDIS_REST_URL: "http://127.0.0.1:31025",
        UPSTASH_REDIS_REST_TOKEN: "celebratedeal-local-synthetic-rate-limit-token",
      },
    },
  ],
});
