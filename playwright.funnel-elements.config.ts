import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Deliberately pass only process-launch essentials. Browser QA must not inherit
// application credentials, database URLs, cookies, or provider configuration.
const safeServerEnv = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  ComSpec: process.env.ComSpec ?? "",
  PATHEXT: process.env.PATHEXT ?? "",
  TEMP: process.env.TEMP ?? "",
  TMP: process.env.TMP ?? "",
  E2E_TEST_MODE: "true",
  FUNNEL_ELEMENTS_E2E: "true",
};
const mirrorRoot = process.env.FUNNEL_ELEMENTS_MIRROR_ROOT;
if (!mirrorRoot || !path.isAbsolute(mirrorRoot)) {
  throw new Error("Run this suite through node scripts/funnel-elements-browser-qa.mjs");
}
const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

/** Browser-only security/interaction contract. It deliberately uses
 * `page.setContent`, so it needs neither application secrets nor a database. */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "funnel-advanced-elements.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:31025" },
  webServer: { command: `"${process.execPath}" "${nextCli}" dev --webpack --hostname 127.0.0.1 --port 31025`, cwd: mirrorRoot, url: "http://127.0.0.1:31025/browser-qa/funnel-elements", timeout: 120_000, reuseExistingServer: false, env: safeServerEnv },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
