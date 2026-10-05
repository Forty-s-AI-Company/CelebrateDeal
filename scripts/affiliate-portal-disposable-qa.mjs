import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = { schemaVersion: "affiliate-portal-disposable/v1", status: "NOT_STARTED", tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, cleanup: null, startedAt: new Date().toISOString(), finishedAt: null };
const migration = await runMigration({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const output = path.join(tempRoot, "course-vitest.json");
  const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.affiliate-portal-db.config.ts", "--reporter=json", "--outputFile", output], {
    cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, COURSE_LEARNING_DISPOSABLE: "verified-loopback", CSRF_SECRET: "synthetic-course-database-encryption-secret-32-bytes" },
  });
  if (!fs.existsSync(output)) throw new Error("course-vitest-receipt-missing");
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  receipt.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
  receipt.failedTitles = report.testResults.flatMap((suite) => suite.assertionResults.filter((test) => test.status === "failed").map((test) => test.title));
  // Diagnostics expose only exception classes, source locations and known
  // invariant categories; never copy raw database/client messages.
  receipt.failureDiagnostics = report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").map(test => {
    const detail = (test.failureMessages ?? []).join("\n");
    return { locations: [...new Set(detail.match(/affiliate-portal(?:\.db\.test)?\.ts:\d+:\d+/gu) ?? [])], exception: ["PrismaClientValidationError", "PrismaClientKnownRequestError", "ZodError", "AssertionError", "TypeError"].find(name => detail.includes(name)) ?? "UNCLASSIFIED", invariant: ["append-only", "immutable", "Invalid", "expected"].filter(term=>detail.includes(term)) };
  }));
  const exactSuite = report.testResults?.length === 1 && report.testResults[0].name.replaceAll("\\", "/").endsWith("/src/lib/affiliate-portal.db.test.ts");
  if (child.status !== 0 || !report.success || !exactSuite || report.numTotalTests !== 6 || report.numPassedTests !== 6 || report.numPendingTests !== 0) throw new Error("course-database-gate-failed");

} });
receipt.status = migration.status;
receipt.cleanup = migration.cleanup;
receipt.finishedAt = new Date().toISOString();
const destination = path.join(root, ".ai-team/reports/affiliate-portal-disposable-receipt.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.status !== "PASS") process.exitCode = 1;
