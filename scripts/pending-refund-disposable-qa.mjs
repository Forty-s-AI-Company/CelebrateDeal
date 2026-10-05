import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summary = { schemaVersion: "pending-refund-disposable/v1", scope: "real database; simulated provider transport; external sandbox NOT_VERIFIED", status: "NOT_STARTED", tests: null, cleanup: null };
const expectedSuites = ["payuni-pending-refund-proof.db.test.ts", "payuni-refund-execution-full.db.test.ts", "payuni-refund-execution.db.test.ts", "payuni-refund-ambiguous.db.test.ts"];
const migration = await runMigration({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const output = path.join(tempRoot, "pending-refund-tests.json");
  const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.pending-refund-db.config.ts", "--reporter=json", "--outputFile", output], {
    cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, PENDING_REFUND_DISPOSABLE: "verified-loopback", CSRF_SECRET: "synthetic-refund-database-secret-32-bytes" },
  });
  if (!fs.existsSync(output)) throw new Error("refund-test-receipt-missing");
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  summary.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
  const suites = report.testResults.map((suite) => path.basename(suite.name));
  if (child.status !== 0 || !report.success || report.numPendingTests !== 0 || report.numTotalTests !== 8
    || suites.length !== expectedSuites.length || expectedSuites.some((suite) => !suites.includes(suite))) throw new Error("refund-db-gate-failed");
} });
summary.status = migration.status;
summary.cleanup = migration.cleanup;
const output = path.join(root, ".ai-team/reports/pending-refund-disposable-receipt.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.status !== "PASS") process.exitCode = 1;
