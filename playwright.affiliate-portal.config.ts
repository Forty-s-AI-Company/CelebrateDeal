import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const mirror = process.env.COURSE_BROWSER_MIRROR;
const report = process.env.COURSE_BROWSER_REPORT;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)) throw new Error("Course browser gate requires its isolated source mirror.");
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Course browser gate requires one isolated server.");
export default defineConfig({
  ...base,
  testMatch: "affiliate-portal.spec.ts",
  reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]],
  webServer: { ...server, cwd: mirror },
});
