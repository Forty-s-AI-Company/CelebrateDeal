import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = { schemaVersion: "affiliate-remuneration-disposable/v1", status: "NOT_STARTED", tests: null, cleanup: null, startedAt: new Date().toISOString() };
const includeBrowser = process.argv.includes("--browser");
const allowedFiles = ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts", "prisma.playwright.config.ts", "playwright.config.ts", "playwright.affiliate-remuneration.config.ts", "scripts/affiliate-remuneration-disposable-qa.mjs", "scripts/prisma-loopback-disposable-migration-runner.mjs", "scripts/local-database-safety.ts", "scripts/playwright-ci-reporter.ts", "vitest.affiliate-remuneration-db.config.ts"];
function sourceSnapshot() {
  const files = [...allowedFiles];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".env")) continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name); else if (entry.isFile()) files.push(name);
    }
  }
  for (const directory of ["src", "public", "prisma", "tests"]) walk(directory);
  return Object.fromEntries(files.sort().map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
}
const snapshot = sourceSnapshot();
receipt.sourceFiles = snapshot;
receipt.sourceRevision = `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
try {
  const migration = await runMigration({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
    // The shared migration runner intentionally does not regenerate the host
    // client. Generate explicitly with its verified URL and no dotenv config.
    const generated = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "generate", "--config", "prisma.playwright.config.ts"], {
      cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
      env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    });
    if (generated.status !== 0) throw new Error("client-generation-failed");
    const output = path.join(tempRoot, "remuneration-vitest.json");
    const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.affiliate-remuneration-db.config.ts", "--reporter=json", "--outputFile", output], {
      cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
      env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, COURSE_LEARNING_DISPOSABLE: "verified-loopback" },
    });
    if (!fs.existsSync(output)) throw new Error("receipt-missing");
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    receipt.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
    // Keep provider/database messages in memory; persist closed diagnostics only.
    receipt.failures = report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").map(test => ({
      title: test.title,
      codes: [...new Set((test.failureMessages ?? []).join("\n").match(/\bP\d{4}\b/gu) ?? [])],
      locations: [...new Set((test.failureMessages ?? []).join("\n").match(/affiliate-remuneration\.db\.test\.ts:\d+:\d+/gu) ?? [])],
    })));
    if (child.status !== 0 || !report.success || report.numTotalTests !== 29 || report.numPendingTests !== 0 || report.testResults.length !== 1 || !report.testResults[0].name.replaceAll("\\", "/").endsWith("/src/lib/affiliate-remuneration.db.test.ts")) throw new Error("database-regression-failed");
    if (includeBrowser) {
      const executable = chromium.executablePath();
      if (!fs.existsSync(executable)) throw new Error("browser-executable-missing");
      const mirror = path.join(tempRoot, "browser-app");
      fs.mkdirSync(mirror, { recursive: true });
      for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: candidate => !path.basename(candidate).startsWith(".env") });
      for (const file of allowedFiles.slice(0, 7)) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
      fs.mkdirSync(path.join(mirror, "scripts"));
      fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
      fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      const output = path.join(tempRoot, "remuneration-browser.json");
      const browser = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.affiliate-remuneration.config.ts", "--fail-on-flaky-tests"], {
        cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
        env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, COURSE_BROWSER_MIRROR: mirror, COURSE_BROWSER_REPORT: output, PLAYWRIGHT_EXECUTABLE_PATH: executable, E2E_PORT: "31040", E2E_BASE_URL: "http://127.0.0.1:31040", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31040", E2E_TEST_MODE: "true", SENTRY_DISABLE_AUTO_UPLOAD: "true" },
      });
      if (!fs.existsSync(output)) throw new Error("browser-report-missing");
      const result = JSON.parse(fs.readFileSync(output, "utf8"));
      receipt.browser = { expected: result.stats.expected, unexpected: result.stats.unexpected, skipped: result.stats.skipped, flaky: result.stats.flaky };
      const locations = [];
      function collect(suites) { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const item of test.results ?? []) for (const error of item.errors ?? []) locations.push(...String(error.message ?? "").matchAll(/affiliate-remuneration\.spec\.ts:\d+:\d+/gu)); collect(suite.suites); } }
      collect(result.suites);
      receipt.browserFailureLocations = [...new Set(locations.map(value => value[0]))];
      if (browser.status !== 0 || receipt.browser.expected !== 1 || receipt.browser.unexpected || receipt.browser.skipped || receipt.browser.flaky) throw new Error("browser-regression-failed");
    }
    receipt.sourceUnchanged = JSON.stringify(sourceSnapshot()) === JSON.stringify(snapshot);
    if (!receipt.sourceUnchanged) throw new Error("source-changed-during-run");
  } });
  receipt.cleanup = migration.cleanup;
  receipt.migrationCount = migration.migrationNames.length;
  receipt.status = migration.status === "PASS" ? "PASS" : "FAIL";
} catch {
  receipt.status = "FAIL";
  // The shared disposable runner retains its own cleanup receipt on failure.
} finally {
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.join(root, ".ai-team/reports"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ai-team/reports/affiliate-remuneration-disposable-receipt.json"), JSON.stringify(receipt, null, 2));
  fs.writeFileSync(path.join(root, `.ai-team/reports/affiliate-remuneration-${randomUUID()}.json`), JSON.stringify(receipt, null, 2));
  process.stdout.write(`${JSON.stringify({ status: receipt.status, tests: receipt.tests, browser: receipt.browser, migrationCount: receipt.migrationCount, cleanup: receipt.cleanup, sourceRevision: receipt.sourceRevision, sourceUnchanged: receipt.sourceUnchanged, browserFailureLocations: receipt.browserFailureLocations })}\n`);
  process.exitCode = receipt.status === "PASS" ? 0 : 1;
}
