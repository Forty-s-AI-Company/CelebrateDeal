import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
import { captureCanonicalMigrationFingerprint, assertCanonicalMigrationStable, assertAppliedCanonicalMigrations } from "./canonical-migration-source-fingerprint.mjs";

const unitFiles = ["src/lib/post-purchase-upsell.test.ts", "src/lib/post-purchase-product-policy.test.ts",
  "src/app/api/checkout/upsell/route.test.ts", "src/app/api/payments/checkout/admission/route.test.ts",
  "src/app/api/payments/checkout/recovery/route.test.ts", "src/app/api/payments/checkout/route.test.ts",
  "src/app/actions/product-actions.test.ts", "src/components/product-form.test.tsx",
  "src/components/commerce-checkout-form.test.tsx", "src/app/checkout/[vendorId]/[productId]/page.test.tsx",
  "src/app/checkout/result/page.test.tsx", "src/app/checkout/upsell/route.test.ts", "src/app/api/live-share-commercial-flow.test.ts",
  "src/app/checkout/recover/[grantId]/page.test.tsx"];
const files = ["prisma/schema.prisma", "prisma.playwright.config.ts",
  "src/lib/post-purchase-upsell-access.ts", "src/lib/post-purchase-upsell-access.test.ts",
  "src/lib/post-purchase-upsell.ts", "src/lib/post-purchase-upsell.test.ts", "src/lib/post-purchase-offer.ts",
  "src/lib/post-purchase-credit.ts", "src/lib/post-purchase-credit.db.test.ts", "src/lib/post-purchase-checkout-recovery.ts",
  "src/lib/post-purchase-recovery-entry.ts", "src/components/commerce-checkout-entry.tsx", "src/lib/checkout-idempotency.ts",
  "src/app/checkout/recover/[grantId]/page.tsx",
  "src/lib/payment-providers/types.ts", "src/lib/payment-providers/demo.ts", "src/lib/payment-providers/payuni.ts",
  "src/lib/post-purchase-product-policy.ts", "src/lib/post-purchase-product-policy.test.ts",
  "src/app/actions/product-actions.ts", "src/components/product-form-client.tsx", "src/components/product-form.tsx",
  "src/app/api/payments/checkout/route.ts", "src/app/api/payments/checkout/admission/route.ts",
  "src/app/api/payments/checkout/recovery/route.ts",
  "src/app/api/checkout/upsell/route.ts", "src/lib/commerce-checkout.ts", "src/components/commerce-checkout-form.tsx",
  "src/app/checkout/offer/page.tsx", "src/app/checkout/upsell/route.ts", "src/app/checkout/upsell/route.test.ts", "src/app/checkout/upsell/upsell-offer.tsx",
  "src/app/checkout/[vendorId]/[productId]/page.tsx", "src/app/checkout/result/page.tsx",
  "src/lib/commerce-orders.ts", "src/lib/inventory-reservations.ts", "src/lib/buyer-support-access.ts", "src/lib/product-delivery.ts",
  "vitest.post-purchase-db.config.ts", "scripts/post-purchase-commerce-disposable-qa.mjs",
  "scripts/prisma-loopback-disposable-migration-runner.mjs", "scripts/local-database-safety.ts",
  "playwright.config.ts", "playwright.post-purchase-commerce.config.ts", "tests/e2e/post-purchase-commerce.spec.ts", ...unitFiles];
// Keep every original source and migration; include the actual merchant entry
// pages, reporter and the settings copied into the production-mode mirror.
files.push("src/app/(app)/products/[id]/edit/page.tsx", "src/app/(app)/products/new/page.tsx",
  "src/lib/product-action-state.ts", "scripts/playwright-ci-reporter.ts", "scripts/playwright-ci-reporter.test.ts",
  "scripts/qa-source-fingerprint.mjs", "scripts/qa-source-fingerprint.test.mjs",
  "scripts/canonical-migration-source-fingerprint.mjs", "scripts/canonical-migration-source-fingerprint.test.mjs",
  "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs",
  "sentry.server.config.ts", "sentry.edge.config.ts");
const snapshot = () => captureCanonicalMigrationFingerprint(process.cwd(), files);
const before = snapshot();
let tests; let unit; let browser;
const migration = await main({ afterMigrate: async ({ databaseUrl, environment, tempRoot }) => {
  const env = { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  // Explicit controlled config never loads .env or a developer database.
  const generated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--config", "prisma.playwright.config.ts"],
    { env, stdio: "ignore", windowsHide: true });
  if (generated.status !== 0) throw new Error("client-generation-failed");
  const report = path.join(tempRoot, "post-purchase-tests.json");
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.post-purchase-db.config.ts",
    "--reporter=json", "--outputFile", report], { env, stdio: "ignore", windowsHide: true });
  const raw = JSON.parse(fs.readFileSync(report, "utf8"));
  tests = { total: raw.numTotalTests, passed: raw.numPassedTests, failed: raw.numFailedTests, skipped: raw.numPendingTests };
  // Only closed counts and static code locations leave the owned temporary directory.
  const failures = raw.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed")
    .map(test => ({ codes: [...new Set((test.failureMessages ?? []).join("\n").match(/\bP\d{4}\b/gu) ?? [])],
      locations: [...new Set((test.failureMessages ?? []).join("\n").match(/post-purchase-(?:upsell(?:-access)?|credit)(?:\.db)?(?:\.test)?\.ts:\d+:\d+/gu) ?? [])] })));
  fs.mkdirSync(".ai-team/reports", { recursive: true });
  fs.writeFileSync(".ai-team/reports/post-purchase-failures.json", JSON.stringify({ tests, failures }));
  if (result.status !== 0 || !raw.success || tests.total !== 48 || tests.skipped) throw new Error("post-purchase-tests-failed");
  // Generation writes shared Prisma modules. Run the complete unit slice
  // before browser startup, which generates that same client again.
  const unitReportPath = path.join(tempRoot, "post-purchase-unit.json");
  const unitResult = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...unitFiles,
    "--reporter=json", "--outputFile", unitReportPath], { env, stdio: "ignore", windowsHide: true });
  const unitReport = JSON.parse(fs.readFileSync(unitReportPath, "utf8"));
  unit = { total: unitReport.numTotalTests, passed: unitReport.numPassedTests,
    failed: unitReport.numFailedTests, skipped: unitReport.numPendingTests };
  if (unitResult.status !== 0 || !unitReport.success || unit.total !== 177 || unit.skipped) throw new Error("post-purchase-unit-failed");
  if (process.argv.includes("--browser")) {
    const root = process.cwd(); const mirror = path.join(tempRoot, "post-purchase-browser-app");
    fs.mkdirSync(mirror, { recursive: true });
    for (const directory of ["src", "public", "prisma"]) fs.cpSync(path.join(root, directory), path.join(mirror, directory),
      { recursive: true, filter: candidate => !path.basename(candidate).startsWith(".env") });
    for (const file of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "sentry.server.config.ts",
      "sentry.edge.config.ts", "prisma.playwright.config.ts"]) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
    fs.mkdirSync(path.join(mirror, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/local-database-safety.ts"), path.join(mirror, "scripts/local-database-safety.ts"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(mirror, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const reportPath = path.join(tempRoot, "post-purchase-browser.json");
    const executable = chromium.executablePath();
    if (!fs.existsSync(executable)) throw new Error("browser-executable-missing");
    const outcome = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test",
      "--config", "playwright.post-purchase-commerce.config.ts", "--fail-on-flaky-tests"], { cwd: root, windowsHide: true,
      stdio: "ignore", env: { ...environment, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
        POST_PURCHASE_BROWSER_MIRROR: mirror, POST_PURCHASE_BROWSER_REPORT: reportPath, PLAYWRIGHT_EXECUTABLE_PATH: executable,
        E2E_PORT: "31046", E2E_BASE_URL: "http://127.0.0.1:31046", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31046",
        E2E_TEST_MODE: "true", E2E_RATE_LIMIT_PROVIDER: "memory", PAYMENT_PROVIDER: "demo" } });
    if (!fs.existsSync(reportPath)) throw new Error("browser-receipt-missing");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    browser = { expected: report.stats.expected, unexpected: report.stats.unexpected, skipped: report.stats.skipped,
      flaky: report.stats.flaky, failureLocations: [], failureStatuses: [], stages: [], globalErrorCategories: [], isolationHttpStatuses: [], offerHttpStatuses: [] };
    // Global setup errors may occur before any test starts. Reduce them to
    // closed categories; never preserve raw messages or server output.
    for (const error of report.errors ?? []) {
      const message = String(error.message ?? "");
      browser.globalErrorCategories.push(/Timed out waiting.*webServer/iu.test(message) ? "WEB_SERVER_START_TIMEOUT"
        : /webServer.*(?:exited|exit)/iu.test(message) ? "WEB_SERVER_EXIT"
        : /EADDRINUSE/u.test(message) ? "PORT_IN_USE"
        : /Cannot find module/u.test(message) ? "MODULE_MISSING"
        : /SyntaxError|Transform failed/u.test(message) ? "SOURCE_TRANSFORM"
        : "GLOBAL_SETUP_UNKNOWN");
    }
    const allowedStages = new Set(["fixture", "merchant-login", "merchant-config", "merchant-form-loaded", "merchant-form-filled", "merchant-form-submitted", "settled-source-handoff", "anonymous-isolation",
      "buyer-decline", "buyer-accept", "checkout-submit", "pending-recovery", "synthetic-unissued-preparation-recovery", "synthetic-expired-manual-recovery", "exact-result-entry-recovery", "source-refund"]);
    const visit = suite => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const attempt of test.results ?? []) {
        for (const annotation of test.annotations ?? []) if (annotation.type === "post-purchase-stage" && allowedStages.has(annotation.description)) browser.stages.push(annotation.description);
        for (const annotation of test.annotations ?? []) if (annotation.type === "post-purchase-http-status" && /^[1-5]\d{2}$/u.test(annotation.description ?? "")) browser.isolationHttpStatuses.push(Number(annotation.description));
        for (const annotation of test.annotations ?? []) if (annotation.type === "post-purchase-offer-http-status" && /^[1-5]\d{2}$/u.test(annotation.description ?? "")) browser.offerHttpStatuses.push(Number(annotation.description));
        if (["failed", "timedOut", "interrupted"].includes(attempt.status)) browser.failureStatuses.push(attempt.status);
        for (const error of [...(attempt.errors ?? []), ...(attempt.error ? [attempt.error] : [])]) {
          if (path.basename(error.location?.file ?? "") === "post-purchase-commerce.spec.ts") browser.failureLocations.push({ file: "post-purchase-commerce.spec.ts", line: error.location.line });
          for (const match of (error.stack ?? "").matchAll(/post-purchase-commerce\.spec\.ts:(\d+):\d+/gu))
            browser.failureLocations.push({ file: "post-purchase-commerce.spec.ts", line: Number(match[1]) });
        }
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites ?? []) visit(suite);
    if (outcome.status !== 0 || browser.expected !== 1 || browser.unexpected || browser.skipped || browser.flaky) throw new Error("browser-gate-failed");
  }
  assertCanonicalMigrationStable(before, snapshot());
} });
if (migration.status === "PASS") {
  try {
    assertCanonicalMigrationStable(before, snapshot());
    assertAppliedCanonicalMigrations(before, migration.migrationNames);
  } catch {
    migration.status = "FAIL";
    migration.failure = "migration-source-or-applied-set-changed";
  }
}
const receipt = { taskId: "f2-post-purchase-commerce", status: migration.status, tests, unit, browser,
  migrations: migration.migrationNames.length, failure: migration.failure, cleanup: migration.cleanup,
  sourceFiles: before.sourceFiles, migrationNames: before.migrationNames, sourceRevision: `sha256:${createHash("sha256").update(JSON.stringify(before)).digest("hex")}`,
  scope: "Paid source credit, reservation/refund/recovery; merchant configuration and real buyer upsell/downsell/checkout journey; independent review and acceptance still pending",
  acceptance: "NOT_READY", delivered: false };
fs.mkdirSync(".ai-team/reports", { recursive: true });
fs.writeFileSync(`.ai-team/reports/post-purchase-${randomUUID()}.json`, JSON.stringify(receipt, null, 2));
fs.writeFileSync(".ai-team/reports/post-purchase-receipt.json", JSON.stringify(receipt, null, 2));
process.stdout.write(JSON.stringify({ status: receipt.status, tests, unit, browser, migrations: receipt.migrations,
  failure: receipt.failure, cleanup: receipt.cleanup, sourceRevision: receipt.sourceRevision }) + "\n");
process.exitCode = receipt.status === "PASS" ? 0 : 1;
