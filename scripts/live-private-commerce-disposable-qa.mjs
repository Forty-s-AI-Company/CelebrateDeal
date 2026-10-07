import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { startPrivateChatLoopbackIngress } from "./live-private-loopback-ingress.mjs";
import { createHash, randomUUID } from "node:crypto";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";

const sourceFiles = ["prisma/schema.prisma", "prisma/migrations/20261007110000_live_private_chat_messages/migration.sql", "src/lib/live-private-chat-storage.ts", "src/lib/live-private-chat-storage.db.test.ts", "src/lib/live-chat.ts", "src/components/live-playback.tsx", "src/components/live-purchase-broadcast-panel.tsx", "src/lib/live-purchase-broadcast-contract.ts", "src/lib/live-purchase-broadcasts.ts", "src/lib/live-purchase-broadcasts.test.ts", "src/lib/live-purchase-broadcasts.db.test.ts", "src/app/api/live-purchase-broadcasts/route.ts", "src/app/api/live-purchase-broadcasts/route.test.ts", "vitest.live-private-commerce-db.config.ts", "scripts/live-private-commerce-disposable-qa.mjs", "scripts/prisma-loopback-disposable-migration-runner.mjs", "prisma.playwright.config.ts"];
sourceFiles.push("src/lib/live-private-chat.ts", "src/lib/live-private-chat-contract.ts");
sourceFiles.push("src/lib/live-chat-request-security.ts", "src/app/api/live-chat/messages/route.ts",
  "src/app/api/live-chat/private/route.ts", "src/app/api/live-chat/private/route.test.ts");
sourceFiles.push("src/app/api/live-chat/instructor/route.ts", "src/app/api/live-chat/instructor/route.test.ts");
sourceFiles.push("src/components/live-private-conversation-panel.tsx", "src/components/live-viewer-private-chat.tsx",
  "src/components/live-instructor-private-chat.tsx", "src/components/live-private-chat-ui.test.tsx",
  "src/app/(app)/lives/[id]/chat/page.tsx", "src/app/(app)/lives/page.tsx",
  "src/components/live-playback.test.tsx", "tests/e2e/wp88-direct-url-guard-matrix.spec.ts");
sourceFiles.push("scripts/live-private-loopback-ingress.mjs", "playwright.live-private-commerce.config.ts", "playwright.config.ts",
  "tests/e2e/live-private-commerce-journey.spec.ts", "tests/e2e/live-purchase-broadcast-journey.spec.ts");
const snapshot = () => Object.fromEntries(sourceFiles.map(file => [file, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
const original = snapshot();
let tests;
let browser;
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
    if (result.status !== 0 || !value.success || tests.total !== 25 || tests.skipped) throw new Error("db-tests-failed");
    if (process.argv.includes("--browser")) {
      const root = process.cwd();
      const mirror = path.join(tempRoot, "private-commerce-browser-app");
      fs.mkdirSync(mirror, { recursive: true });
      for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory),
        { recursive: true, filter: candidate => !path.basename(candidate).startsWith(".env") });
      for (const file of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts",
        "sentry.edge.config.ts", "prisma.playwright.config.ts"]) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
      fs.mkdirSync(path.join(mirror, "scripts"));
      fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
      fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      const reportPath = path.join(tempRoot, "private-commerce-browser.json");
      const executable = chromium.executablePath();
      if (!fs.existsSync(executable)) throw new Error("browser-executable-missing");
      const stopIngress = await startPrivateChatLoopbackIngress({ port: 31044, upstreamPort: 31045,
        proof: "celebratedeal-local-playwright-live-chat-ingress-secret-v1" });
      try {
        // Asynchronous spawn is required: the owned ingress must keep serving
        // requests while Playwright builds and exercises the real application.
        const exitCode = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test",
            "--config", "playwright.live-private-commerce.config.ts", "--fail-on-flaky-tests"], {
            cwd: root, windowsHide: true, stdio: "ignore", env: { ...environment,
              DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, PRIVATE_COMMERCE_BROWSER_MIRROR: mirror,
              PRIVATE_COMMERCE_BROWSER_REPORT: reportPath, PLAYWRIGHT_EXECUTABLE_PATH: executable,
              E2E_PORT: "31044", E2E_BASE_URL: "http://127.0.0.1:31044", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31044",
              E2E_TEST_MODE: "true", E2E_RATE_LIMIT_PROVIDER: "cloudflare_waf" } });
          child.once("error", reject);
          child.once("close", resolve);
        });
        if (!fs.existsSync(reportPath)) throw new Error("browser-receipt-missing");
        const result = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        browser = { expected: result.stats.expected, unexpected: result.stats.unexpected,
          skipped: result.stats.skipped, flaky: result.stats.flaky, ingress: "synthetic-loopback-not-cloudflare-validation" };
        const locations = [];
        const visit = suite => {
          for (const spec of suite.specs ?? []) {
            if ((spec.tests ?? []).some(test => test.status !== "expected")) locations.push({
              file: path.basename(spec.file ?? "unknown"), line: spec.line ?? null });
            for (const test of spec.tests ?? []) for (const attempt of test.results ?? []) {
              for (const error of [...(attempt.errors ?? []), ...(attempt.error ? [attempt.error] : [])]) {
                if (error.location?.file && /(?:live-private-commerce-journey|live-purchase-broadcast-journey|wp88-direct-url-guard-matrix)\.spec\.ts$/u.test(error.location.file)) {
                  locations.push({ file: path.basename(error.location.file), line: error.location.line ?? null, kind: "assertion_location" });
                }
                const matches = (error.stack ?? "").matchAll(/(live-private-commerce-journey|live-purchase-broadcast-journey|wp88-direct-url-guard-matrix)\.spec\.ts:(\d+):\d+/gu);
                for (const match of matches) locations.push({ file: `${match[1]}.spec.ts`, line: Number(match[2]), kind: "stack_location" });
              }
            }
          }
          for (const child of suite.suites ?? []) visit(child);
        };
        for (const suite of result.suites ?? []) visit(suite);
        browser.failureLocations = locations;
        if (exitCode !== 0 || browser.expected !== 3 || browser.unexpected || browser.skipped || browser.flaky) throw new Error("browser-gate-failed");
      } finally { await stopIngress(); }
    }
    if (JSON.stringify(snapshot()) !== JSON.stringify(original)) throw new Error("source-changed");
  } });
  const receipt = { taskId: "f2-live-private-chat-purchase-broadcast", status: migration.status, tests, browser, migrations: migration.migrationNames.length,
    failure: migration.failure,
    cleanup: migration.cleanup, sourceFiles: original, sourceRevision: `sha256:${createHash("sha256").update(JSON.stringify(original)).digest("hex")}` };
  fs.mkdirSync(".ai-team/reports", { recursive: true });
  fs.writeFileSync(`.ai-team/reports/live-private-commerce-${randomUUID()}.json`, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(".ai-team/reports/live-private-commerce-receipt.json", JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify({ status: receipt.status, tests, browser, failure: receipt.failure, migrations: receipt.migrations, cleanup: receipt.cleanup, sourceRevision: receipt.sourceRevision }) + "\n");
  process.exitCode = receipt.status === "PASS" ? 0 : 1;
} catch { process.stdout.write(JSON.stringify({ status: "FAIL", tests }) + "\n"); process.exitCode = 1; }
