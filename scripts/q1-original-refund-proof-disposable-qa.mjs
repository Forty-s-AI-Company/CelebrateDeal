import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { main as migrate } from "./prisma-loopback-disposable-migration-runner.mjs";

// Only owned loopback PostgreSQL, a dotenv-free test configuration, and synthetic
// fixtures. Persist closed counters; never expose captured child output.
let tests;
const migration = await migrate({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const config = path.join(tempRoot, "original-proof.config.mts"), report = path.join(tempRoot, "tests.json");
  const files = ["src/lib/q1-original-refund-proof.db.test.ts", "src/lib/payuni-pending-refund-proof.db.test.ts"];
  fs.writeFileSync(config, `export default {envDir:false,resolve:{alias:{"@":${JSON.stringify(path.resolve("src").replaceAll("\\", "/"))}}},test:{include:${JSON.stringify(files.map(f => path.resolve(f).replaceAll("\\", "/")))},fileParallelism:false,testTimeout:20000}};`);
  const child = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", config,
    "--reporter=json", "--outputFile", report], { windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl } });
  if (!fs.existsSync(report)) throw new Error("ORIGINAL_PROOF_REPORT_MISSING");
  const result = JSON.parse(fs.readFileSync(report, "utf8"));
  tests = { total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests,
    failedTitles: result.testResults.flatMap(s => s.assertionResults.filter(t => t.status === "failed").map(t => t.title)) };
  if (child.status !== 0 || !result.success || tests.total !== 18 || tests.passed !== 18 || tests.skipped !== 0) throw new Error("ORIGINAL_PROOF_REGRESSION_FAILED");
} });
const receipt = { status: migration.status, tests, migrations: migration.migrationNames.length,
  cleanup: migration.cleanup, failure: migration.failure, providerOperations: false, productionOperations: false };
fs.mkdirSync(".ai-team/reports", { recursive: true });
fs.writeFileSync(".ai-team/reports/q1-original-refund-proof-db.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt)); if (receipt.status !== "PASS") process.exitCode = 1;
