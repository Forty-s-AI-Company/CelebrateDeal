import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
import { captureCanonicalMigrationFingerprint, assertCanonicalMigrationStable, assertAppliedCanonicalMigrations } from "./canonical-migration-source-fingerprint.mjs";
let tests;
const paymentBoundaries = process.argv.includes("--payment-boundaries");
const includeBrowser = process.argv.includes("--browser");
let browserProof = null;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function captureSource() {
  const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (files.status !== 0) throw new Error("tracking-source-inventory-failed");
  const sourceFiles = [...new Set(files.stdout.split(/\r?\n/u).filter(file => file && !file.split(/[\\/]/u).some(part => part.startsWith(".env")) &&
  (file.startsWith("src/") || file.startsWith("public/") || file.startsWith("tests/") || file.startsWith("scripts/") ||
   ["package.json", "package-lock.json", "prisma/schema.prisma", "prisma.playwright.config.ts", "vitest.tracking-settings-db.config.ts", "vitest.tracking-payment-boundaries-db.config.ts", "tsconfig.json", "next.config.ts", ".github/workflows/ci.yml",
    "playwright.config.ts", "playwright.tracking.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts", "vitest.config.ts"].includes(file))))];
  return captureCanonicalMigrationFingerprint(root, sourceFiles);
}
const before = captureSource();
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
if (head.status !== 0) throw new Error("tracking-source-head-unavailable");
const migration = await main({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const env = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, TRACKING_DISPOSABLE: "verified-loopback", CSRF_SECRET: "synthetic-tracking-encryption-key-at-least-32-bytes" };
  const generated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--config", "prisma.playwright.config.ts"], { env, stdio: "ignore", windowsHide: true });
  if (generated.status !== 0) throw new Error("tracking-client-generation-failed");
  const reportPath = path.join(tempRoot, "tracking-settings.json");
  const outcome = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", paymentBoundaries ? "vitest.tracking-payment-boundaries-db.config.ts" : "vitest.tracking-settings-db.config.ts", "--reporter=json", "--outputFile", reportPath], { env, stdio: "ignore", windowsHide: true });
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
  const requiredFiles = paymentBoundaries ? ["payment-webhooks.test.ts", "commerce-orders.db.test.ts"] : ["tracking-settings.db.test.ts", "tracking-purchase-outbox.db.test.ts", "tracking-event-sources.db.test.ts"];
  const verifiedFiles = report.testResults.map(suite => path.basename(suite.name)).sort();
  tests.files = verifiedFiles;
  tests.failedLocations = report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").flatMap(test => (test.failureMessages ?? []).flatMap(message => [...message.matchAll(/(?:payment-webhooks\.test\.ts|commerce-orders\.db\.test\.ts|tracking-purchase-outbox\.db\.test\.ts|tracking-event-sources\.db\.test\.ts):(\d+):(\d+)/gu)].map(match => ({ file: path.basename(suite.name), line: Number(match[1]) })))));
  tests.errorCodes = [...new Set(report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").flatMap(test => (test.failureMessages ?? []).map(message => {
    const value = String(message), prisma = /\bP\d{4}\b/u.exec(value);
    return prisma?.[0] ?? (/Unique constraint/iu.test(value) ? "UNIQUE_CONFLICT" : /secret|key.*required|identity.*key/iu.test(value) ? "SYNTHETIC_KEY_BINDING" : /Unknown argument/iu.test(value) ? "SCHEMA_ARGUMENT" : /AssertionError|expected.*to/iu.test(value) ? "ASSERTION" : "UNCLASSIFIED");
  }))))];
  tests.errorTypes = [...new Set(report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").flatMap(test => (test.failureMessages ?? []).flatMap(message => [...String(message).matchAll(/\b(?:TypeError|RangeError|PrismaClientKnownRequestError|PrismaClientUnknownRequestError|PrismaClientValidationError|AssertionError)\b/gu)].map(match => match[0])))))];
  if (outcome.status !== 0 || !report.success || (!paymentBoundaries && tests.total !== 41) || tests.total < 1 || tests.passed !== tests.total || tests.skipped || JSON.stringify(verifiedFiles) !== JSON.stringify(requiredFiles.sort())) throw new Error("tracking-settings-regression-failed");
  if (includeBrowser) {
    const executable = chromium.executablePath();
    if (!fs.existsSync(executable)) throw new Error("tracking-browser-executable-missing");
    const mirror = path.join(tempRoot, "browser-app"); fs.mkdirSync(mirror, { recursive: true });
    for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: candidate => !path.basename(candidate).startsWith(".env") });
    for (const file of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts", "sentry.edge.config.ts", "prisma.playwright.config.ts"]) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
    fs.mkdirSync(path.join(mirror, "scripts")); fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const browserReport = path.join(tempRoot, "tracking-browser.json");
    const browser = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.tracking.config.ts", "--fail-on-flaky-tests"], {
      cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...env, TRACKING_BROWSER_MIRROR: mirror, TRACKING_BROWSER_REPORT: browserReport, PLAYWRIGHT_EXECUTABLE_PATH: executable,
        E2E_PORT: "31046", E2E_BASE_URL: "http://127.0.0.1:31046", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31046", E2E_TEST_MODE: "true" },
    });
    if (!fs.existsSync(browserReport)) throw new Error("tracking-browser-receipt-missing");
    const report = JSON.parse(fs.readFileSync(browserReport, "utf8"));
    browserProof = { expected: report.stats.expected, unexpected: report.stats.unexpected, skipped: report.stats.skipped, flaky: report.stats.flaky,
      failures: `${browser.stdout ?? ""}\n${browser.stderr ?? ""}`.split(/\r?\n/u).filter(line => /^::error file=tests\/tracking\/native-tracking-settings\.browser\.ts,line=\d+::playwright /u.test(line)).slice(0, 10) };
    const diagnostics = [], errorCodes = new Set();
    function inspect(suites) { for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        for (const annotation of test.annotations ?? []) if (annotation.type === "tracking-diagnostic") {
          try {
            const value = JSON.parse(annotation.description);
            if (value.stage === "stale_save" && Number.isInteger(value.alertCount) && value.alertCount >= 0 && value.alertCount < 100 && [null, "saved", "conflict", "invalid"].includes(value.result)) diagnostics.push({ stage: value.stage, alertCount: value.alertCount, result: value.result });
          } catch { /* Unknown annotations are not diagnostic data. */ }
        }
        for (const result of test.results ?? []) for (const error of result.errors ?? []) {
          const message = String(error.message ?? "");
          errorCodes.add(/strict mode violation/u.test(message) ? "SELECTOR_AMBIGUOUS" : /Timeout|timed out/iu.test(message) ? "TIMEOUT" : /Invalid URL|invalid URL/iu.test(message) ? "INVALID_URL" : /interrupted by another navigation/u.test(message) ? "NAVIGATION_INTERRUPTED" : "UNCLASSIFIED");
        }
      }
      inspect(suite.suites);
    } }
    inspect(report.suites); browserProof.diagnostics = diagnostics; browserProof.errorCodes = [...errorCodes];
    if (browser.status !== 0 || browserProof.expected !== 5 || browserProof.unexpected || browserProof.skipped || browserProof.flaky) throw new Error("tracking-browser-gate-failed");
  }
  assertCanonicalMigrationStable(before, captureSource());
} });
let sourceStable = false;
try {
  assertCanonicalMigrationStable(before, captureSource());
  assertAppliedCanonicalMigrations(before, migration.migrationNames);
  sourceStable = true;
} catch { migration.status = "BLOCKED_OR_FAILED"; migration.failure = { category: "tracking-source-or-migration-changed", errorCode: null, rootCauseConfirmed: true }; }
const receipt = { status: migration.status, migrations: migration.migrationNames.length, tests, browser: browserProof, cleanup: migration.cleanup, failure: migration.failure,
  head: head.stdout.trim(), sourceStable, sourceRevision: `sha256:${createHash("sha256").update(JSON.stringify(before)).digest("hex")}`, sourceSnapshot: before,
  providerNetworkAttempted: false, externalDelivery: "NOT_VERIFIED", acceptance: "NOT_READY" };
fs.mkdirSync(".ai-team/reports", { recursive: true });
fs.writeFileSync(`.ai-team/reports/tracking-${paymentBoundaries ? "payment-boundaries" : "settings"}-${randomUUID()}.json`, JSON.stringify(receipt, null, 2));
fs.writeFileSync(`.ai-team/reports/tracking-${paymentBoundaries ? "payment-boundaries" : "settings"}-disposable-receipt.json`, JSON.stringify(receipt, null, 2));
const summary = { ...receipt };
delete summary.sourceSnapshot;
process.stdout.write(JSON.stringify(summary) + "\n");
process.exitCode = receipt.status === "PASS" ? 0 : 1;
