import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { main as migrate } from "./prisma-loopback-disposable-migration-runner.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tests = null, browserProof = null, browserFailure = null;
const sourceSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
const migration = await migrate({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
 const output = path.join(tempRoot, "subscription-tests.json");
 const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.subscription-recovery-db.config.ts", "--reporter=json", "--outputFile", output], {
  cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback", CSRF_SECRET: "synthetic-subscription-database-secret-32-bytes" },
 });
 if (!fs.existsSync(output)) throw new Error("subscription-test-receipt-missing");
 const result = JSON.parse(fs.readFileSync(output, "utf8"));
 tests = { total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests,
  failedTitles: result.testResults.flatMap(s => s.assertionResults.filter(t => t.status === "failed").map(t => t.title)),
  failedLocations: result.testResults.flatMap(s => s.assertionResults.filter(t => t.status === "failed").flatMap(t =>
   (t.failureMessages ?? []).flatMap(message => [...message.matchAll(/(wp4-buyer-ops\.db\.test\.ts):(\d+):(\d+)/g)].map(match => ({ file: match[1], line: Number(match[2]) }))))) };
 if (child.status !== 0 || !result.success || tests.total !== 62 || tests.passed !== 62 || tests.skipped !== 0) throw new Error("subscription-db-regression-failed");
 if (process.argv.includes("--browser")) {
    // Reuse only the installed executable. The browser profile stays isolated;
    // changing HOME must not hide the installation and fail before the UI runs.
    const executable = chromium.executablePath();
    if (!fs.existsSync(executable)) throw new Error("q2-browser-executable-missing");
    const mirror = path.join(tempRoot, "browser-app");
    fs.mkdirSync(mirror, { recursive: true });
    for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: (candidate) => !path.basename(candidate).startsWith(".env") });
    for (const file of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts", "prisma.playwright.config.ts"]) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
    fs.mkdirSync(path.join(mirror, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const browserReport = path.join(tempRoot, "q2-browser.json");
    const browser = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.subscription-recovery.config.ts", "--fail-on-flaky-tests"], {
      cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, Q2_BROWSER_MIRROR: mirror, Q2_BROWSER_REPORT: browserReport, Q2_BROWSER_SOURCE_SHA: sourceSha, PLAYWRIGHT_EXECUTABLE_PATH: executable, E2E_PORT: "31041", E2E_BASE_URL: "http://127.0.0.1:31041", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31041", E2E_TEST_MODE: "true" },
    });
    if (!fs.existsSync(browserReport)) throw new Error("q2-browser-receipt-missing");
    if (browser.status !== 0) browserFailure = `${browser.stdout ?? ""}\n${browser.stderr ?? ""}`.split(/\r?\n/u).filter((line) => /^::error(?: file=tests\/e2e\/[A-Za-z0-9_.\/-]+,line=\d+)?::playwright /u.test(line)).slice(0, 10);
    const browserResult = JSON.parse(fs.readFileSync(browserReport, "utf8"));
    browserProof = { expected: browserResult.stats.expected, unexpected: browserResult.stats.unexpected, skipped: browserResult.stats.skipped, flaky: browserResult.stats.flaky };
    const diagnostics = [];
    function visit(suites) { for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const annotation of test.annotations ?? []) {
        if (annotation.type !== "q2-fixture-result") continue;
        try { const value = JSON.parse(annotation.description); if (Number.isInteger(value.status) && (value.outcome === null || /^[A-Z_]+$/.test(value.outcome))) diagnostics.push(value); } catch { }
      }
      visit(suite.suites);
    } }
    visit(browserResult.suites); browserProof.diagnostics = diagnostics;
    if (browser.status !== 0 || browserProof.expected !== 1 || browserProof.unexpected !== 0 || browserProof.skipped !== 0 || browserProof.flaky !== 0) throw new Error("q2-browser-gate-failed");
 }
} });
const receipt = { status: migration.status, migration, tests, browser: browserProof, browserFailure, sourceSha, providerNetworkAttempted: false };
fs.mkdirSync(path.join(root, ".ai-team/reports"), { recursive: true });
fs.writeFileSync(path.join(root, ".ai-team/reports/subscription-recovery-db-receipt.json"), JSON.stringify(receipt, null, 2)+"\n");
process.stdout.write(JSON.stringify(receipt)+"\n");
if (receipt.status !== "PASS") process.exitCode = 1;
