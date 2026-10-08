import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const mirror = process.env.PRIVATE_COMMERCE_BROWSER_MIRROR;
const report = process.env.PRIVATE_COMMERCE_BROWSER_REPORT;
const server = base.webServer;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)
  || !server || Array.isArray(server)) throw new Error("Private commerce requires an owned source mirror.");

export default defineConfig({
  ...base,
  testMatch: ["wp88-direct-url-guard-matrix.spec.ts", "live-private-commerce-journey.spec.ts", "live-purchase-broadcast-journey.spec.ts"],
  reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]],
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  // The front port belongs to the synthetic trusted ingress; Next binds only
  // the separate loopback upstream. Authentication remains in the application.
  webServer: { ...server, cwd: mirror,
    command: server.command.replace("--port 31044", "--port 31045") },
});
