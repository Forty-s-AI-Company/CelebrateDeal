import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";

const sourceFiles = ["prisma/schema.prisma", "prisma/migrations/20261007110000_live_private_chat_messages/migration.sql", "src/lib/live-private-chat-storage.ts", "src/lib/live-private-chat-storage.db.test.ts", "src/lib/live-chat.ts", "src/components/live-playback.tsx", "src/components/live-purchase-broadcast-panel.tsx", "src/lib/live-purchase-broadcast-contract.ts", "src/lib/live-purchase-broadcasts.ts", "src/lib/live-purchase-broadcasts.test.ts", "src/lib/live-purchase-broadcasts.db.test.ts", "src/app/api/live-purchase-broadcasts/route.ts", "src/app/api/live-purchase-broadcasts/route.test.ts", "vitest.live-private-commerce-db.config.ts", "scripts/live-private-commerce-disposable-qa.mjs", "scripts/prisma-loopback-disposable-migration-runner.mjs", "prisma.playwright.config.ts"];
sourceFiles.push("src/lib/live-private-chat.ts", "src/lib/live-private-chat-contract.ts");
sourceFiles.push("src/lib/live-chat-request-security.ts", "src/app/api/live-chat/messages/route.ts",
  "src/app/api/live-chat/private/route.ts", "src/app/api/live-chat/private/route.test.ts");
const snapshot = () => Object.fromEntries(sourceFiles.map(file => [file, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
const original = snapshot();
let tests;
try {
  const migration = await main({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
    const env = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, CSRF_SECRET: "live-private-commerce-disposable-synthetic-csrf-key" };
    const report = path.join(tempRoot, "live-private-commerce-tests.json");
    const generated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--config", "prisma.playwright.config.ts"], { env, encoding: "utf8", windowsHide: true });
    if (generated.status !== 0) throw new Error("client-generation-failed");
    const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.live-private-commerce-db.config.ts", "--reporter=json", "--outputFile", report], { env, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const value = JSON.parse(fs.readFileSync(report, "utf8"));
    tests = { total: value.numTotalTests, passed: value.numPassedTests, failed: value.numFailedTests, skipped: value.numPendingTests };
    const failures = value.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed").map(test => ({ title: test.title,
      codes: [...new Set((test.failureMessages ?? []).join("\n").match(/\bP\d{4}\b/gu) ?? [])],
      locations: [...new Set((test.failureMessages ?? []).join("\n").match(/(?:live-purchase-broadcasts|commerce-orders)\.(?:db\.test\.)?ts:\d+:\d+/gu) ?? [])] })));
    fs.mkdirSync(".ai-team/reports", { recursive: true });
    fs.writeFileSync(".ai-team/reports/live-private-commerce-failures.json", JSON.stringify({ tests, failures }));
    if (result.status !== 0 || !value.success || tests.total !== 16 || tests.skipped) throw new Error("db-tests-failed");
    if (JSON.stringify(snapshot()) !== JSON.stringify(original)) throw new Error("source-changed");
  } });
  const receipt = { taskId: "f2-live-private-chat-purchase-broadcast", status: migration.status, tests, migrations: migration.migrationNames.length,
    cleanup: migration.cleanup, sourceFiles: original, sourceRevision: `sha256:${createHash("sha256").update(JSON.stringify(original)).digest("hex")}` };
  fs.mkdirSync(".ai-team/reports", { recursive: true });
  fs.writeFileSync(`.ai-team/reports/live-private-commerce-${randomUUID()}.json`, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(".ai-team/reports/live-private-commerce-receipt.json", JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify({ status: receipt.status, tests, migrations: receipt.migrations, cleanup: receipt.cleanup, sourceRevision: receipt.sourceRevision }) + "\n");
  process.exitCode = receipt.status === "PASS" ? 0 : 1;
} catch { process.stdout.write(JSON.stringify({ status: "FAIL", tests }) + "\n"); process.exitCode = 1; }
