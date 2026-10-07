import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const mirror = process.env.TRACKING_BROWSER_MIRROR, report = process.env.TRACKING_BROWSER_REPORT;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)) throw new Error("Tracking browser gate requires its isolated source mirror.");
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Tracking browser gate requires one isolated server.");
export default defineConfig({ ...base, testDir: "./tests/tracking", testMatch: "native-tracking-settings.browser.ts", timeout: 120000,
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]],
  webServer: { ...server, cwd: mirror, env: { ...server.env,
    VERCEL_ENV: "preview", META_TRACKING_TEST_DELIVERY_ENABLED: "true", META_GRAPH_API_VERSION: "",
    JOB_SECRET: "synthetic-tracking-browser-job-secret",
  } },
});
