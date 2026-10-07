import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const mirror = process.env.TEAM_VIDEO_MIRROR;
const report = process.env.TEAM_VIDEO_REPORT;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report)) throw new Error("Workspace browser gate requires its isolated source mirror.");
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Workspace browser gate requires one isolated server.");
export default defineConfig({ ...base, outputDir: path.join(path.dirname(report), "team-video-artifacts"), testMatch: ["team-video-persistence-isolation.spec.ts", "wp86-team-template-direct-url-owner-boundary.spec.ts"], reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]], webServer: { ...server, cwd: mirror } });
