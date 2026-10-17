import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-11/whole-current");
const { main } = await import(pathToFileURL(path.join(root, "scripts/prisma-loopback-disposable-migration-runner.mjs")));
let tests = { status: "NOT_RUN" };
// The canonical runner creates, labels, migrates and removes its own loopback DB.
const receipt = await main({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const report = path.join(tempRoot, "lease-tests.json");
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/app/api/live-admission/route.lease-db.test.ts", "src/lib/automation-voucher-exchange.db.test.ts", "--reporter=json", "--outputFile", report], {
    cwd: root, env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    windowsHide: true, stdio: "ignore", timeout: 180000,
  });
  if (fs.existsSync(report)) {
    const data = JSON.parse(fs.readFileSync(report, "utf8"));
    tests = { status: result.status === 0 && data.success ? "PASS" : "FAIL", total: data.numTotalTests, passed: data.numPassedTests, failed: data.numFailedTests, skipped: data.numPendingTests };
  }
  if (tests.status !== "PASS" || tests.skipped || tests.total < 4) throw new Error("lease-regression-failed");
} });
fs.writeFileSync(path.join(out, "disposable-db-result.json"), JSON.stringify({ status: receipt.status, tests, cleanup: receipt.cleanup, failure: receipt.failure }, null, 2));

if (receipt.status !== "PASS" || tests.status !== "PASS" || tests.skipped || Object.values(receipt.cleanup).some(value => value !== "PASS")) process.exitCode = 1;
