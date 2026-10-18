import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const mirror = process.env.POST_PURCHASE_BROWSER_MIRROR;
const report = process.env.POST_PURCHASE_BROWSER_REPORT;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)
  || !base.webServer || Array.isArray(base.webServer)) throw new Error("Post purchase requires an owned disposable mirror.");
export default defineConfig({ ...base,
  testMatch: ["post-purchase-commerce.spec.ts"],
  reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]],
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  webServer: { ...base.webServer, cwd: mirror },
});
