import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = { schemaVersion: "affiliate-remuneration-disposable/v1", status: "NOT_STARTED", tests: null, cleanup: null, startedAt: new Date().toISOString() };
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
    if (child.status !== 0 || !report.success || report.numTotalTests !== 19 || report.numPendingTests !== 0 || report.testResults.length !== 1 || !report.testResults[0].name.replaceAll("\\", "/").endsWith("/src/lib/affiliate-remuneration.db.test.ts")) throw new Error("database-regression-failed");
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
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.status === "PASS" ? 0 : 1;
}
