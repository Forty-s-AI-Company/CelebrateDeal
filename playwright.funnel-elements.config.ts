import { defineConfig, devices } from "@playwright/test";

/** Browser-only security/interaction contract. It deliberately uses
 * `page.setContent`, so it needs neither application secrets nor a database. */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "funnel-advanced-elements.spec.ts",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:31025" },
  webServer: { command: "npx next dev --hostname 127.0.0.1 --port 31025", url: "http://127.0.0.1:31025/browser-qa/funnel-elements", timeout: 120_000, reuseExistingServer: false, env: { ...process.env, E2E_TEST_MODE: "true", FUNNEL_ELEMENTS_E2E: "true" } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
