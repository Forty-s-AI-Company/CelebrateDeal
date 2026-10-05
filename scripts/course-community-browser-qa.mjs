import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = { schemaVersion: "course-community-browser/v1", status: "NOT_STARTED", tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, cleanup: null, startedAt: new Date().toISOString(), finishedAt: null };
const includeBrowser = process.argv.includes("--browser");
const migration = await runMigration({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const output = path.join(tempRoot, "course-vitest.json");
  const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.course-community-db.config.ts", "--reporter=json", "--outputFile", output], {
    cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, COURSE_LEARNING_DISPOSABLE: "verified-loopback", CSRF_SECRET: "synthetic-course-database-encryption-secret-32-bytes" },
  });
  if (!fs.existsSync(output)) throw new Error("course-vitest-receipt-missing");
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  receipt.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
  receipt.failedTitles = report.testResults.flatMap((suite) => suite.assertionResults.filter((test) => test.status === "failed").map((test) => test.title));
  const exactSuite = report.testResults?.length === 1 && report.testResults[0].name.replaceAll("\\", "/").endsWith("/src/lib/course-community.db.test.ts");
  if (child.status !== 0 || !report.success || !exactSuite || report.numTotalTests !== 9 || report.numPassedTests !== 9 || report.numPendingTests !== 0) throw new Error("course-database-gate-failed");
  if (includeBrowser) {
    // Reuse only the installed executable. The browser profile stays isolated;
    // changing HOME must not hide the installation and fail before the UI runs.
    const executable = chromium.executablePath();
    if (!fs.existsSync(executable)) throw new Error("course-browser-executable-missing");
    const mirror = path.join(tempRoot, "browser-app");
    fs.mkdirSync(mirror, { recursive: true });
    for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: (candidate) => !path.basename(candidate).startsWith(".env") });
    for (const file of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts", "prisma.playwright.config.ts"]) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
    fs.mkdirSync(path.join(mirror, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const browserReport = path.join(tempRoot, "course-browser.json");
    const browser = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.course-community.config.ts", "--fail-on-flaky-tests"], {
      cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, COURSE_BROWSER_MIRROR: mirror, COURSE_BROWSER_REPORT: browserReport, PLAYWRIGHT_EXECUTABLE_PATH: executable, E2E_PORT: "31032", E2E_BASE_URL: "http://127.0.0.1:31032", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31032", E2E_TEST_MODE: "true" },
    });
    if (!fs.existsSync(browserReport)) throw new Error("course-browser-receipt-missing");
    if (browser.status !== 0) receipt.browserFailure = `${browser.stdout ?? ""}\n${browser.stderr ?? ""}`.split(/\r?\n/u).filter((line) => /^::error(?: file=tests\/e2e\/[A-Za-z0-9_.\/-]+,line=\d+)?::playwright /u.test(line)).slice(0, 10);
    const browserResult = JSON.parse(fs.readFileSync(browserReport, "utf8"));
    receipt.browser = { expected: browserResult.stats.expected, unexpected: browserResult.stats.unexpected, skipped: browserResult.stats.skipped, flaky: browserResult.stats.flaky };
    if (browser.status !== 0 || receipt.browser.expected !== 1 || receipt.browser.unexpected !== 0 || receipt.browser.skipped !== 0 || receipt.browser.flaky !== 0) throw new Error("course-browser-gate-failed");
  }
} });
receipt.status = migration.status;
receipt.cleanup = migration.cleanup;
receipt.finishedAt = new Date().toISOString();
const destination = path.join(root, ".ai-team/reports/course-community-browser-receipt.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.status !== "PASS") process.exitCode = 1;
