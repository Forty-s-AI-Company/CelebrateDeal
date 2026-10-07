import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
import { captureCanonicalMigrationFingerprint, assertCanonicalMigrationStable, assertAppliedCanonicalMigrations } from "./canonical-migration-source-fingerprint.mjs";
let tests;
const paymentBoundaries = process.argv.includes("--payment-boundaries");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function captureSource() {
  const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (files.status !== 0) throw new Error("tracking-source-inventory-failed");
  const sourceFiles = [...new Set(files.stdout.split(/\r?\n/u).filter(file => file && !file.split(/[\\/]/u).some(part => part.startsWith(".env")) &&
  (file.startsWith("src/") || file.startsWith("public/") || file.startsWith("tests/") || file.startsWith("scripts/") ||
   ["package.json", "package-lock.json", "prisma/schema.prisma", "prisma.playwright.config.ts", "vitest.tracking-settings-db.config.ts", "vitest.tracking-payment-boundaries-db.config.ts", "tsconfig.json", "next.config.ts", ".github/workflows/ci.yml"].includes(file))))];
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
  const requiredFiles = paymentBoundaries ? ["payment-webhooks.test.ts", "commerce-orders.db.test.ts"] : ["tracking-settings.db.test.ts", "tracking-purchase-outbox.db.test.ts"];
  const verifiedFiles = report.testResults.map(suite => path.basename(suite.name)).sort();
  tests.files = verifiedFiles;
  tests.failedLocations = report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").flatMap(test => (test.failureMessages ?? []).flatMap(message => [...message.matchAll(/(?:payment-webhooks\.test\.ts|commerce-orders\.db\.test\.ts|tracking-purchase-outbox\.db\.test\.ts):(\d+):(\d+)/gu)].map(match => ({ file: path.basename(suite.name), line: Number(match[1]) })))));
  if (outcome.status !== 0 || !report.success || (!paymentBoundaries && tests.total !== 18) || tests.total < 1 || tests.passed !== tests.total || tests.skipped || JSON.stringify(verifiedFiles) !== JSON.stringify(requiredFiles.sort())) throw new Error("tracking-settings-regression-failed");
  assertCanonicalMigrationStable(before, captureSource());
} });
let sourceStable = false;
try {
  assertCanonicalMigrationStable(before, captureSource());
  assertAppliedCanonicalMigrations(before, migration.migrationNames);
  sourceStable = true;
} catch { migration.status = "BLOCKED_OR_FAILED"; migration.failure = { category: "tracking-source-or-migration-changed", errorCode: null, rootCauseConfirmed: true }; }
const receipt = { status: migration.status, migrations: migration.migrationNames.length, tests, cleanup: migration.cleanup, failure: migration.failure,
  head: head.stdout.trim(), sourceStable, sourceRevision: `sha256:${createHash("sha256").update(JSON.stringify(before)).digest("hex")}`, sourceSnapshot: before,
  providerNetworkAttempted: false, externalDelivery: "NOT_VERIFIED", acceptance: "NOT_READY" };
fs.mkdirSync(".ai-team/reports", { recursive: true });
fs.writeFileSync(`.ai-team/reports/tracking-${paymentBoundaries ? "payment-boundaries" : "settings"}-${randomUUID()}.json`, JSON.stringify(receipt, null, 2));
fs.writeFileSync(`.ai-team/reports/tracking-${paymentBoundaries ? "payment-boundaries" : "settings"}-disposable-receipt.json`, JSON.stringify(receipt, null, 2));
const summary = { ...receipt };
delete summary.sourceSnapshot;
process.stdout.write(JSON.stringify(summary) + "\n");
process.exitCode = receipt.status === "PASS" ? 0 : 1;
