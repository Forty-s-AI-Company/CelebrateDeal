import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";
import { captureCanonicalMigrationFingerprint, assertCanonicalMigrationStable,
  assertAppliedCanonicalMigrations } from "./canonical-migration-source-fingerprint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summary = { schemaVersion: "pending-refund-disposable/v1", scope: "real database; simulated provider transport; external sandbox NOT_VERIFIED", status: "NOT_STARTED", tests: null, cleanup: null };
const expectedSuites = ["payuni-pending-refund-proof.db.test.ts", "payuni-refund-execution-full.db.test.ts", "payuni-refund-execution.db.test.ts", "payuni-refund-ambiguous.db.test.ts"];
// Bind the actual proof, refund, source/environment guards, test configuration
// and every forward migration. Never load dotenv or the developer database.
const sourceFiles = ["prisma/schema.prisma", "prisma.playwright.config.ts", "vitest.pending-refund-db.config.ts",
  "scripts/pending-refund-disposable-qa.mjs", "scripts/prisma-loopback-disposable-migration-runner.mjs",
  "scripts/qa-source-fingerprint.mjs", "scripts/qa-source-fingerprint.test.mjs", "scripts/local-database-safety.ts",
  "scripts/canonical-migration-source-fingerprint.mjs", "scripts/canonical-migration-source-fingerprint.test.mjs",
  "scripts/payuni-sandbox-payment-handoff.mjs", "scripts/payuni-sandbox-payment-handoff.test.mjs",
  "scripts/payuni-sandbox-pending-refund-consumer.mjs", "scripts/payuni-sandbox-pending-refund-consumer.test.mjs",
  "scripts/payuni-sandbox-external-qa.mjs", "scripts/payuni-credit-refund-query-contract.mjs",
  "src/lib/payment-providers/payuni.test.ts", "src/app/api/admin/ops/payuni/pending-refund-proof/route.ts",
  "src/app/api/admin/ops/payuni/pending-refund-proof/route.test.ts", "src/lib/payuni-pending-refund-proof.ts",
  "src/lib/payuni-refund-execution.ts", "src/lib/payuni-refund-reconciliation.ts", "src/lib/payment-refund-accounting.ts",
  "src/lib/payment-webhooks.ts", "src/lib/platform-subscription-refund.ts", "src/lib/wp4-runtime-boundary.ts",
  "src/lib/wp4-preview-runtime.ts", "src/lib/wp4-payuni-sandbox-reconciliation.ts", "src/lib/wp4-sandbox-fixture.ts",
  "src/lib/database-identity.ts", "src/lib/api-security.ts", "src/lib/auth.ts", "src/lib/csrf.ts",
  "src/app/actions.ts", "src/lib/payment-providers/payuni.ts", "src/lib/payment-providers/types.ts",
  "package.json", "package-lock.json", ...expectedSuites.map(file => `src/lib/${file}`)];
const before = captureCanonicalMigrationFingerprint(root, sourceFiles);
const migration = await runMigration({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const environmentForTests = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
    PENDING_REFUND_DISPOSABLE: "verified-loopback", CSRF_SECRET: "synthetic-refund-database-secret-32-bytes" };
  const generated = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"),
    "generate", "--config", "prisma.playwright.config.ts"], {
    cwd: root, env: environmentForTests, windowsHide: true, stdio: "ignore",
  });
  if (generated.status !== 0) throw new Error("refund-client-generation-failed");
  const output = path.join(tempRoot, "pending-refund-tests.json");
  const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.pending-refund-db.config.ts", "--reporter=json", "--outputFile", output], {
    cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: environmentForTests,
  });
  if (!fs.existsSync(output)) throw new Error("refund-test-receipt-missing");
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  summary.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
  const suites = report.testResults.map((suite) => path.basename(suite.name));
  if (child.status !== 0 || !report.success || report.numPendingTests !== 0 || report.numTotalTests !== 11
    || suites.length !== expectedSuites.length || expectedSuites.some((suite) => !suites.includes(suite))) throw new Error("refund-db-gate-failed");
  assertCanonicalMigrationStable(before, captureCanonicalMigrationFingerprint(root, sourceFiles));
} });
summary.status = migration.status;
summary.cleanup = migration.cleanup;
summary.migrations = migration.migrationNames.length;
summary.sourceRevision = `sha256:${createHash("sha256").update(JSON.stringify(before)).digest("hex")}`;
summary.sourceFiles = before.sourceFiles;
summary.migrationNames = before.migrationNames;
summary.failure = migration.failure;
if (summary.status === "PASS") {
  try {
    assertCanonicalMigrationStable(before, captureCanonicalMigrationFingerprint(root, sourceFiles));
    assertAppliedCanonicalMigrations(before, migration.migrationNames);
  } catch {
    summary.status = "FAIL";
    summary.failure = { category: "migration-source-or-applied-set-mismatch", errorCode: null, rootCauseConfirmed: true };
  }
}
const output = path.join(root, ".ai-team/reports/pending-refund-disposable-receipt.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ schemaVersion: summary.schemaVersion, scope: summary.scope,
  status: summary.status, tests: summary.tests, cleanup: summary.cleanup, migrations: summary.migrations,
  sourceRevision: summary.sourceRevision, failure: summary.failure })}\n`);
if (summary.status !== "PASS") process.exitCode = 1;
