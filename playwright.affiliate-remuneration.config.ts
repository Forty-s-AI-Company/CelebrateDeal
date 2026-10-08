import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const mirror = process.env.COURSE_BROWSER_MIRROR, report = process.env.COURSE_BROWSER_REPORT;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)) throw new Error("Remuneration browser requires isolated mirror/report.");
if (!base.webServer || Array.isArray(base.webServer)) throw new Error("Remuneration browser requires one isolated server.");
export default defineConfig({ ...base, outputDir: path.join(path.dirname(report), "browser-test-results"), testMatch: "affiliate-remuneration.spec.ts", reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]], webServer: { ...base.webServer, cwd: mirror } });
