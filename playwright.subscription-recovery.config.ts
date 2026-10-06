import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const mirror = process.env.Q2_BROWSER_MIRROR, report = process.env.Q2_BROWSER_REPORT;
const source = process.env.Q2_BROWSER_SOURCE_SHA;
if (!mirror || !report || !path.isAbsolute(mirror) || !path.isAbsolute(report) || !source || !/^[a-f0-9]{40}$/.test(source)) throw new Error("Requires owned Q2 mirror/report/source");
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Requires one isolated server");
// These fixed synthetic credentials only construct local forms. Browser blocks provider requests.
const environment = { ...server.env, VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "", VERCEL_GIT_COMMIT_SHA: source, WP4_EXPECTED_SOURCE_SHA: source,
 PAYUNI_ENV: "sandbox", PAYMENT_PROVIDER: "payuni", WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback", WP4_SANDBOX_EXECUTOR_ENABLED: "true",
 JOB_SECRET: "synthetic-q2-browser-job-secret", PAYUNI_SANDBOX_MERCHANT_ID: "SYNTHETIC", PAYUNI_SANDBOX_HASH_KEY: "0123456789abcdef0123456789abcdef", PAYUNI_SANDBOX_HASH_IV: "0123456789abcdef" };
Object.assign(process.env, environment);
export default defineConfig({ ...base, testMatch: "native-subscription-recovery.spec.ts", timeout: 120000,
 reporter: [["./scripts/playwright-ci-reporter.ts"], ["json", { outputFile: report }]], webServer: { ...server, cwd: mirror, env: environment } });
