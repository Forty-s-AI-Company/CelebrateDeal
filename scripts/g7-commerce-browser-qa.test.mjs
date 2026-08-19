import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyPlaywrightFailure,
  classifyNextBuildExecution,
  classifySanitizedFailure,
  copySourceTree,
  evaluateBrowserContracts,
  ignoredMirrorPath,
  isDiagnosticDevFast,
  networkGuardSource,
  normalizeSpawnSyncExecution,
  parseContainerInspection,
  removeMirror,
  sanitizePlaywrightMessage,
  sanitizedBuildDetails,
  sanitizedServerRuntimeDetails,
  summarizePlaywrightReport,
  syntheticEnvironment,
} from "./g7-commerce-browser-qa.mjs";

test("G7-04 diagnostic-dev-fast requires both diagnostic flags and keeps fail-closed status", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");

  assert.equal(isDiagnosticDevFast([]), false);
  assert.equal(isDiagnosticDevFast(["--diagnostic-dev"]), false);
  assert.equal(isDiagnosticDevFast(["--diagnostic-dev-fast"]), false);
  assert.equal(isDiagnosticDevFast(["--diagnostic-dev", "--diagnostic-dev-fast"]), true);
  assert.match(source, /receipt\.phases\.nextBuild = "SKIPPED_DIAGNOSTIC"/u);
  assert.match(source, /receipt\.status = diagnosticDev \? "DIAGNOSTIC_ONLY" : "PASS"/u);
  assert.match(source, /if \(receipt\.status !== "PASS"\) process\.exitCode = 1/u);
  assert.match(source, /if \(diagnosticDevFast\) \{[\s\S]*?\} else \{/u);
  assert.match(source, /const build = run\(process\.execPath, \[nextCli, "build", "--webpack"\], env, mirror\)/u);
  const readinessFailureStart = source.indexOf("if (!server.pid || !(await waitForServer(");
  const serverPass = source.indexOf('receipt.phases.server = "PASS";', readinessFailureStart);
  assert.notEqual(readinessFailureStart, -1, "readiness failure branch must remain explicit");
  assert.notEqual(serverPass, -1, "server PASS must follow the readiness branch");
  const readinessFailureBranch = source.slice(readinessFailureStart, serverPass);
  const serverFail = readinessFailureBranch.indexOf('receipt.phases.server = "FAIL";');
  const sanitizedDetails = readinessFailureBranch.indexOf("receipt.diagnostics.serverRuntimeDetails = sanitizedServerRuntimeDetails(serverRuntimeOutput, tempRoot);");
  const readinessThrow = readinessFailureBranch.indexOf('throw new Error("next-server-not-ready");');
  assert.ok(serverFail >= 0, "readiness failure must mark the server phase FAIL");
  assert.ok(sanitizedDetails > serverFail, "readiness failure must sanitize runtime details after marking FAIL");
  assert.ok(readinessThrow > sanitizedDetails, "readiness failure must throw only after sanitized details are recorded");
  const playwrightRun = source.indexOf("const result = run(process.execPath, playwrightArgs, env, mirror);");
  const playwrightFailure = source.indexOf("if (result.exitCode !== 0) {", playwrightRun);
  const screenshotCollection = source.indexOf("const screenshotEntries", playwrightFailure);
  assert.notEqual(playwrightRun, -1, "Playwright synchronous run must remain explicit");
  assert.ok(playwrightFailure > playwrightRun, "Playwright diagnostics must follow the synchronous run");
  assert.ok(screenshotCollection > playwrightFailure, "screenshot collection must follow Playwright failure diagnostics");
  const playwrightFailureBranch = source.slice(playwrightFailure, screenshotCollection);
  const serverRuntimeSettle = playwrightFailureBranch.indexOf("await new Promise((resolve) => setTimeout(resolve, 250));");
  const serverRuntimeSnapshot = playwrightFailureBranch.indexOf("receipt.diagnostics.serverRuntimeDetails = sanitizedServerRuntimeDetails(serverRuntimeOutput, tempRoot);");
  assert.ok(serverRuntimeSettle >= 0, "failed Playwright runs must settle the event loop before diagnostics");
  assert.ok(serverRuntimeSnapshot > serverRuntimeSettle, "sanitized server runtime snapshot must follow the settle delay");
});

test("G7 commerce network guard parses common overloads and fails closed outside loopback", () => {
  const encodedGuard = Buffer.from(networkGuardSource(), "utf8").toString("base64");
  const probe = [
    `eval(Buffer.from("${encodedGuard}", "base64").toString("utf8"));`,
    "const { allowedHost, targetHost } = module.exports;",
    "const allowed = (kind, args) => allowedHost(targetHost(kind, args));",
    "process.stdout.write(JSON.stringify({",
    "  netLocal: allowed('socket', [5432, '127.0.0.1']),",
    "  netExternal: allowed('socket', [443, 'example.com']),",
    "  tlsOptionsExternal: allowed('socket', [443, { host: 'example.com' }]),",
    "  socketObjectLocal: allowed('socket', [{ port: 5432, host: '::1' }]),",
    "  httpLocal: allowed('http', ['http://127.0.0.1:3000/path']),",
    "  httpOverrideExternal: allowed('http', ['http://127.0.0.1:3000/path', { hostname: 'example.com' }]),",
    "  fetchRequestExternal: allowed('fetch', [{ url: 'https://example.com/path' }]),",
    "  unknown: allowed('http', [{}]),",
    "}));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", windowsHide: true });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    netLocal: true,
    netExternal: false,
    tlsOptionsExternal: false,
    socketObjectLocal: true,
    httpLocal: true,
    httpOverrideExternal: false,
    fetchRequestExternal: false,
    unknown: false,
  });
});

test("summarizePlaywrightReport counts final test results without recursively counting metadata statuses", () => {
  const report = {
    status: "failed",
    suites: [{
      title: "commerce-orders.spec.ts",
      specs: [
        { title: "desktop", tests: [{ expectedStatus: "passed", results: [{ status: "failed", error: { message: "Expected: 200\\nReceived: 500 at C:\\temp\\secret" } }] }] },
        { title: "mobile", tests: [{ expectedStatus: "passed", results: [{ status: "skipped" }] }] },
      ],
    }],
  };

  const summary = summarizePlaywrightReport(report, "C:\\temp");
  assert.deepEqual({ passed: summary.passed, failed: summary.failed, skipped: summary.skipped }, { passed: 0, failed: 1, skipped: 1 });
  assert.equal(summary.diagnostics[0]?.classification, "PLAYWRIGHT_ASSERTION_FAILED");
  assert.match(summary.diagnostics[0]?.details.join("\n") ?? "", /<temp>/u);
  assert.doesNotMatch(summary.diagnostics[0]?.details.join("\n") ?? "", /C:\\temp/u);
});

test("summarizePlaywrightReport redacts synthetic identities and database credentials", () => {
  const report = {
    suites: [{
      specs: [{
        title: "fixture",
        tests: [{
          results: [{
            status: "failed",
            error: { message: "g7-04-local-playwright-session-token postgresql://postgres:password@127.0.0.1/test buyer@example.test 0912345678" },
          }],
        }],
      }],
    }],
  };

  const details = summarizePlaywrightReport(report, "C:\\unused").diagnostics[0]?.details.join("\n") ?? "";
  assert.match(details, /<synthetic-value>/u);
  assert.match(details, /postgresql:\/\/<redacted>@/u);
  assert.match(details, /<redacted-email>/u);
  assert.match(details, /<redacted-phone>/u);
  assert.doesNotMatch(details, /password|example\.test|0912345678/u);
});

test("summarizePlaywrightReport classifies blocking Axe findings without raw page content", () => {
  const report = {
    suites: [{ specs: [{ title: "axe", tests: [{ results: [{
      status: "failed",
      error: { message: 'AXE_BLOCKING:[{"id":"color-contrast","targets":[[".footer-label"]]}]' },
    }] }] }] }],
  };

  const diagnostic = summarizePlaywrightReport(report, "C:\\unused").diagnostics[0];
  assert.equal(diagnostic?.classification, "PLAYWRIGHT_AXE_BLOCKING");
  assert.match(diagnostic?.details.join("\n") ?? "", /color-contrast/u);
});

test("summarizePlaywrightReport classifies sanitized RWD overflow diagnostics", () => {
  const report = {
    suites: [{ specs: [{ title: "mobile", tests: [{ results: [{
      status: "failed",
      error: { message: 'RWD_HORIZONTAL_OVERFLOW:{"overflow":60,"elements":[{"tag":"h1","className":"break-words","right":450}]}' },
    }] }] }] }],
  };

  const diagnostic = summarizePlaywrightReport(report, "C:\\unused").diagnostics[0];
  assert.equal(diagnostic?.classification, "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW");
  assert.match(diagnostic?.details.join("\n") ?? "", /"tag":"h1"/u);
});

test("evaluateBrowserContracts rejects a renamed or missing required browser contract", () => {
  const contracts = ["product desktop", "product mobile"];
  const complete = evaluateBrowserContracts([
    { title: "suite > product desktop", status: "passed" },
    { title: "suite > product mobile", status: "passed" },
  ], contracts);
  assert.equal(complete.passed, true);

  const renamed = evaluateBrowserContracts([
    { title: "suite > product desktop", status: "passed" },
    { title: "suite > mobile product", status: "passed" },
  ], contracts);
  assert.equal(renamed.passed, false);
  assert.equal(renamed.statuses["product mobile"], "MISSING");
});

test("G7-21 keeps the Email reminder contract named and required alongside the existing commerce contracts", () => {
  const contracts = [
    "desktop merchant can recover upload and validation errors, then publish and preview one product",
    "mobile product catalog has no overflow, preserves keyboard entry and passes axe",
    "merchant configures encrypted digital delivery and checkout keeps an immutable order snapshot",
    "buyer order capability shows only exact safe fulfillment projection on desktop and mobile",
    "desktop owner can see only its canonical order, reveal PII safely, and complete physical fulfillment",
    "mobile order detail has no horizontal overflow, keeps keyboard focus visible, and passes axe",
    "public buyer receives a server admission, creates exactly one reserved order, and safely reviews payment status",
    "public checkout recovers one committed order after response loss and page refresh",
    "finance admin payout batch prevents duplicate submission and exposes accessible pending feedback",
    "merchant Email templates keep live reminders scoped, then Live Studio separates registration and reminder templates",
  ];
  const results = contracts.map((title) => ({ title: `commerce-orders.spec.ts > G7-04 商家訂單 UI > ${title}`, status: "passed" }));
  const complete = evaluateBrowserContracts(results);

  assert.equal(Object.keys(complete.statuses).length, 10);
  assert.equal(complete.statuses[contracts[9]], "PASS");
  assert.equal(complete.passed, true);

  const missingEmail = evaluateBrowserContracts(results.slice(0, -1));
  assert.equal(missingEmail.statuses[contracts[9]], "MISSING");
  assert.equal(missingEmail.passed, false);
});

test("G7-45 focused mode keeps the Live Studio contract and both responsive screenshots mandatory", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");

  assert.match(source, /--focus-live-studio/u);
  assert.match(source, /--focus-live-studio-starter/u);
  assert.match(source, /focusStreamRetry \? "G7-51" : focusCheckoutRecovery \? "G7-57" : focusMessageTemplateDraft \? "G7-58" : focusInteractionRole \? "G7-52" : focusLiveStudioStarter \? "G7-46" : "G7-45"/u);
  assert.match(source, /focusStreamRetry \? \[streamRetryContract\][\s\S]*focusCheckoutRecovery \? \[checkoutRecoveryContract\][\s\S]*focusMessageTemplateDraft \? \[messageTemplateDraftContract\][\s\S]*focusInteractionRole \? \[interactionRoleContract\][\s\S]*focusPersistentPlayer \? \[persistentPlayerContract\][\s\S]*focusLiveStudio \? \[liveStudioContract\] : expectedBrowserContracts/u);
  for (const path of ["src/components/use-live-studio-draft.ts", "src/lib/live-studio-draft.ts", "src/lib/live-studio-draft-client.ts"]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["liveStudioDesktop", "liveStudioMobile"\]/u);
  assert.match(source, /--grep", selectedBrowserContracts\[0\]/u);
  assert.match(source, /receipt\.browser\.liveStudio = browserPassed && \(!focused \|\| focusLiveStudio\) \? "PASS" : "NOT_VERIFIED"/u);
});

test("G7-50 focused mode attests exact Stream quota stop, accessibility, RWD, and retry suppression", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-stream-quota/u);
  assert.match(source, /streamQuotaContract/u);
  assert.match(source, /"g7-50-stream-quota-browser-qa"/u);
  for (const path of [
    "src/lib/stream-usage-client.ts",
    "src/app/api/stream-usage/route.ts",
    "src/components/live-playback.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["streamQuotaDesktop", "streamQuotaMobile"\]/u);
  assert.match(source, /receipt\.browser\.streamQuota = focusStreamQuota && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /public playback stops once on exact Stream quota exhaustion and keeps recovery guidance accessible/u);
  assert.match(browserContract, /code: "stream_minutes_exhausted"/u);
  assert.match(browserContract, /expect\(heartbeatRequests\)\.toBe\(1\)/u);
  assert.match(browserContract, /expect\(video\)\.toHaveCount\(0\)/u);
  assert.match(browserContract, /__quotaPauseCalls\)\)\.toBe\(1\)/u);
  assert.match(browserContract, /expectNoBlockingAxeViolations\(page\)/u);
  assert.match(browserContract, /stream-quota-desktop\.png/u);
  assert.match(browserContract, /stream-quota-mobile\.png/u);
});

test("WP6 focused mode proves one persistent video node through checkout on desktop and mobile", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-persistent-player/u);
  assert.match(source, /persistentPlayerContract/u);
  assert.match(source, /"wp6-persistent-player-browser-qa"/u);
  for (const path of [
    "src/app/layout.tsx",
    "src/app/@checkout/default.tsx",
    "src/app/@checkout/(.)checkout/[vendorId]/[productId]/page.tsx",
    "src/app/checkout/[vendorId]/[productId]/page.tsx",
    "src/app/(viewer)/live/[slug]/page.tsx",
    "src/components/checkout-overlay.tsx",
    "src/components/live-playback.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.equal(source.includes('"src/app/(viewer)/layout.tsx"'), false, "viewer layout must not remain source-attested");
  assert.equal(source.includes('"src/app/(viewer)/@checkout/'), false, "viewer checkout paths must not remain source-attested");
  assert.equal(source.includes('"src/app/live/'), false, "legacy live paths must not remain source-attested");
  assert.match(source, /\["persistentPlayerDesktop", "persistentPlayerMobile"\]/u);
  assert.match(source, /receipt\.browser\.persistentPlayer = focusPersistentPlayer && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /public live keeps the same video node, playback state and controls through internal checkout/u);
  assert.match(browserContract, /sameNode: current === browserWindow\.__persistentPlayerNode/u);
  assert.match(browserContract, /currentTime\)\.toBeGreaterThan\(42\)/u);
  assert.match(browserContract, /document\.querySelector\("video"\) ===/u);
  assert.match(browserContract, /persistent-player-desktop\.png/u);
  assert.match(browserContract, /persistent-player-mobile\.png/u);
});

test("G7-51 focused mode attests timeout recovery, bounded retry, and stable event identity", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-stream-retry/u);
  assert.match(source, /streamRetryContract/u);
  assert.match(source, /"g7-51-stream-retry-browser-qa"/u);
  assert.match(source, /\["streamRetryDesktop", "streamRetryMobile"\]/u);
  assert.match(source, /receipt\.browser\.streamRetry = focusStreamRetry && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /public playback retries an ambiguous Stream heartbeat with one stable event identity/u);
  assert.match(browserContract, /body: JSON\.stringify\(\{ error: "Too many requests" \}\)/u);
  assert.match(browserContract, /new Set\(heartbeatPayloads\.map\(\(payload\) => payload\.eventId\)\)/u);
  assert.match(browserContract, /setTimeout\(resolve, 3_300\)/u);
  assert.match(browserContract, /heartbeatPayloads\.length, \{ timeout: 7_000 \}/u);
  assert.match(browserContract, /stream-retry-desktop\.png/u);
  assert.match(browserContract, /stream-retry-mobile\.png/u);
});

test("G7-57 focused mode attests response-loss recovery with one persisted checkout identity", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-checkout-recovery/u);
  assert.match(source, /checkoutRecoveryContract/u);
  assert.match(source, /"g7-57-checkout-recovery-browser-qa"/u);
  for (const path of [
    "src/app/api/payments/checkout/admission/route.ts",
    "src/lib/checkout-admission.ts",
    "src/lib/checkout-idempotency.ts",
    "src/components/commerce-checkout-form.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["checkoutRecoveryDesktop", "checkoutRecoveryMobile"\]/u);
  assert.match(source, /receipt\.browser\.checkoutRecovery = focusCheckoutRecovery && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /public checkout recovers one committed order after response loss and page refresh/u);
  assert.match(browserContract, /await route\.abort\("failed"\)/u);
  assert.match(browserContract, /await page\.reload\(\)/u);
  assert.match(browserContract, /expect\(checkoutIdentities\[1\]\)\.toBe\(checkoutIdentities\[0\]\)/u);
  assert.match(browserContract, /expect\(afterRecovery\)\.toEqual\(afterLostResponse\)/u);
  assert.match(browserContract, /checkout-recovery-desktop\.png/u);
  assert.match(browserContract, /checkout-recovery-mobile\.png/u);
});

test("G7-58 focused mode attests message-template validation and missing-record draft recovery", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-message-template-draft/u);
  assert.match(source, /messageTemplateDraftContract/u);
  assert.match(source, /"g7-58-message-template-draft-browser-qa"/u);
  for (const path of [
    "src/app/actions.ts",
    "src/lib/message-template.ts",
    "src/components/message-template-form.tsx",
    "src/components/message-template-form-client.tsx",
    "src/app/(app)/messages/templates/new/page.tsx",
    "src/app/(app)/messages/templates/[id]/edit/page.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["messageTemplateDraftDesktop", "messageTemplateDraftMobile"\]/u);
  assert.match(source, /receipt\.browser\.messageTemplateDraft = focusMessageTemplateDraft && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /merchant message template keeps every field after server validation and can recover as a new template/u);
  assert.match(browserContract, /\{\{unknown_variable\}\} 必須保留/u);
  assert.match(browserContract, /另一分頁已儲存的伺服器新版/u);
  assert.match(browserContract, /其他分頁已有新版/u);
  assert.match(browserContract, /input\[name="expectedUpdatedAt"\]/u);
  assert.match(browserContract, /await db\.messageTemplate\.delete/u);
  assert.match(browserContract, /再次儲存會建立新模板/u);
  assert.match(browserContract, /input\[name="id"\]/u);
  assert.match(browserContract, /message-template-draft-desktop\.png/u);
  assert.match(browserContract, /message-template-draft-mobile\.png/u);
});

test("G7-52 focused mode attests role preview, transparency, usage impact, Axe, and RWD", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-interaction-role/u);
  assert.match(source, /interactionRoleContract/u);
  assert.match(source, /"g7-52-interaction-role-browser-qa"/u);
  for (const path of [
    "src/lib/interaction-role-usage.ts",
    "src/components/interaction-roles-workbench.tsx",
    "src/app/(app)/interaction-roles/[id]/edit/page.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["interactionRoleDesktop", "interactionRoleMobile"\]/u);
  assert.match(source, /receipt\.browser\.interactionRole = focusInteractionRole && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(source, /focusOnboarding \|\| focusInteractionRole/u);
  assert.match(browserContract, /merchant interaction role previews transparent identity and exact script impact before disabling/u);
  assert.match(browserContract, /getByLabel\("啟用角色"/u);
  assert.match(browserContract, /停用後，下列腳本中 2 個官方留言／提醒事件不會出現在公開直播/u);
  assert.match(browserContract, /G7-52 跨租戶污染直播/u);
  assert.match(browserContract, /page\.waitForEvent\("dialog"\)/u);
  assert.match(browserContract, /interactionRole\.count/u);
  assert.match(browserContract, /expectNoBlockingAxeViolations\(page\)/u);
  assert.match(browserContract, /interaction-role-desktop\.png/u);
  assert.match(browserContract, /interaction-role-mobile\.png/u);
});

test("G7-49 focused mode requires actionable onboarding blockers and both RWD screenshots", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-onboarding/u);
  assert.match(source, /onboardingContract/u);
  assert.match(source, /"g7-49-onboarding-browser-qa"/u);
  for (const path of [
    "src/app/(app)/onboarding/page.tsx",
    "src/lib/merchant-onboarding.ts",
    "src/lib/live-publish-readiness.ts",
    "src/lib/sellable-live.ts",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["onboardingDesktop", "onboardingMobile"\]/u);
  assert.match(source, /receipt\.browser\.onboarding = focusOnboarding && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(source, /receipt\.browser\.tenantIsolation = browserPassed && \(!focused \|\| focusBuyerOrders \|\| focusOnboarding \|\| focusInteractionRole\) \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(source, /receipt\.browser\.productDelivery = browserPassed && \(!focused \|\| focusDelivery\) \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /merchant onboarding shows exact sales-live blockers and skips deferred payment work/u);
  assert.match(browserContract, /外部驗證，可稍後/u);
  assert.match(browserContract, /getByText\("3 \/ 5"/u);
  assert.match(browserContract, /getByText\("4 \/ 5"/u);
  assert.match(browserContract, /getByText\("5 \/ 5"/u);
  assert.match(browserContract, /g7-49-payment-only-/u);
  assert.match(browserContract, /paymentMethodReference\.delete/u);
  assert.match(browserContract, /G7-49 FOREIGN/u);
  assert.match(browserContract, /onboarding-desktop\.png/u);
  assert.match(browserContract, /onboarding-mobile\.png/u);
});

test("G7-47 focused mode requires the buyer order contract, safe source projection, and both RWD screenshots", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-buyer-orders/u);
  assert.match(source, /buyerOrdersContract/u);
  assert.match(source, /"g7-47-buyer-orders-browser-qa"/u);
  for (const path of [
    "src/lib/buyer-support-access.ts",
    "src/app/support/orders/page.tsx",
    "src/app/support/orders/loading.tsx",
    "src/app/support/orders/[grantId]/page.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["buyerOrdersDesktop", "buyerOrdersMobile"\]/u);
  assert.match(source, /receipt\.browser\.buyerOrders = browserPassed && \(!focused \|\| focusBuyerOrders \|\| focusBuyerDelivery\) \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /const fulfillmentRegion = page\.getByRole\("region", \{ name: "商品與履約進度" \}\)/u);
  assert.match(browserContract, /fulfillmentRegion\.getByRole\("definition"\)\.filter\(\{ hasText: \/\^等待處理\$\/u \}\)/u);
  assert.doesNotMatch(browserContract, /page\.getByText\("等待處理", \{ exact: true \}\)/u);
});

test("G7-48A focused mode requires encrypted delivery source, migration, immutable snapshot contract, and RWD screenshots", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-product-delivery/u);
  assert.match(source, /productDeliveryContract/u);
  assert.match(source, /"g7-48a-product-delivery-browser-qa"/u);
  for (const path of [
    "src/lib/product-delivery.ts",
    "src/app/actions/product-actions.ts",
    "src/lib/commerce-orders.ts",
    "prisma/schema.prisma",
    "prisma/migrations/20260809072000_g7_48_product_delivery_snapshot/migration.sql",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["productDeliveryDesktop", "productDeliveryMobile"\]/u);
  assert.match(source, /receipt\.browser\.productDelivery = browserPassed && \(!focused \|\| focusDelivery\) \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /merchant configures encrypted digital delivery and checkout keeps an immutable order snapshot/u);
  assert.match(browserContract, /expect\(JSON\.stringify\(purchasedItem\.deliverySnapshot\)\)\.not\.toContain\(firstDestination\)/u);
  assert.match(browserContract, /toEqual\(immutableSnapshot\)/u);
});

test("G7-48B focused mode requires exact buyer capability, delivery RWD evidence, and full-refund revocation", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const browserContract = fs.readFileSync(new URL("../tests/e2e/commerce-orders.spec.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-buyer-delivery/u);
  assert.match(source, /focusBuyerDelivery \? "G7-48B"/u);
  assert.match(source, /"g7-48b-buyer-delivery-browser-qa"/u);
  for (const path of [
    "src/lib/buyer-support-access.ts",
    "src/app/support/orders/[grantId]/page.tsx",
    "src/app/support/orders/[grantId]/delivery/[itemId]/page.tsx",
    "src/app/support/orders/[grantId]/delivery/[itemId]/not-found.tsx",
    "src/lib/commerce-orders.ts",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  assert.match(source, /\["productDeliveryDesktop", "productDeliveryMobile", "buyerDeliveryDesktop", "buyerDeliveryMobile"\]/u);
  assert.match(source, /receipt\.browser\.buyerDelivery = focusBuyerDelivery && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(browserContract, /開啟付款後內容/u);
  assert.match(browserContract, /reconcileCommerceOrderRefund/u);
  assert.match(browserContract, /accessEncryptedEnvelope: null/u);
  assert.match(browserContract, /buyer-delivery-desktop\.png/u);
  assert.match(browserContract, /buyer-delivery-mobile\.png/u);
});

test("WP7-01 focused mode isolates the one-stop webinar E2E contract", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  const config = fs.readFileSync(new URL("../playwright.g7-commerce.config.ts", import.meta.url), "utf8");

  assert.match(source, /--focus-wp7-one-stop/u);
  assert.match(source, /focusWp7OneStop \? "WP7-01"/u);
  assert.match(source, /wp7OneStopContract/u);
  assert.match(source, /tests\/e2e\/wp7-one-stop-webinar-flow\.spec\.ts/u);
  assert.match(source, /"wp7-one-stop-webinar-flow-browser-qa"/u);
  assert.match(source, /G7_COMMERCE_BROWSER_E2E_TARGET: e2eTarget/u);
  assert.match(source, /E2E_CHROMIUM_EXECUTABLE_PATH/u);
  assert.match(config, /E2E_CHROMIUM_EXECUTABLE_PATH/u);
  assert.match(source, /e2eTarget: focusWp7OneStop \? "wp7-one-stop" : "commerce"/u);
  assert.match(source, /CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA/u);
  assert.match(source, /wp7Registration: path\.join\(screenshots, "wp7-registration\.png"\)/u);
  assert.match(source, /wp7RegistrationMobile: path\.join\(screenshots, "wp7-registration-mobile\.png"\)/u);
  assert.match(source, /wp7Checkout: path\.join\(screenshots, "wp7-checkout\.png"\)/u);
  assert.match(source, /wp7CheckoutMobile: path\.join\(screenshots, "wp7-checkout-mobile\.png"\)/u);
  assert.match(source, /\["wp7Registration", "wp7RegistrationMobile", "wp7Live", "wp7LiveMobile", "wp7Checkout", "wp7CheckoutMobile", "wp7Order", "wp7OrderMobile"\]/u);
  assert.match(source, /receipt\.browser\.wp7OneStop = focusWp7OneStop && browserPassed \? "PASS" : "NOT_VERIFIED"/u);
  assert.match(config, /e2eTarget !== "commerce" && e2eTarget !== "wp7-one-stop"/u);
  assert.match(config, /wp7-one-stop-webinar-flow\.spec\.ts/u);
  for (const path of [
    "src/lib/email-delivery.ts",
    "src/lib/email-delivery-pii.ts",
    "src/lib/form-submission-verification-domain.ts",
    "src/lib/form-submission-verification.ts",
    "src/lib/post-live-followup.ts",
    "src/lib/post-live-followup-identity.ts",
    "src/lib/live-chat-contract.ts",
    "src/app/(viewer)/live/[slug]/page.tsx",
  ]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be source-attested`);
  }
  const browserContract = fs.readFileSync(new URL("../tests/e2e/wp7-one-stop-webinar-flow.spec.ts", import.meta.url), "utf8");
  assert.match(browserContract, /expectNoBlockingAxeViolations/u);
  assert.match(browserContract, /const registrationPayload = revealEmailDeliveryPayload/u);
  assert.match(browserContract, /expect\(registrationPayload\.body\)\.toContain\(`\/live\/\$\{fixture\.slug\}`\)/u);
  assert.match(browserContract, /direct or refreshed checkout does not invent a live playback session/u);
  assert.match(browserContract, /expect\(page\.getByTestId\("persistent-live-player"\)\)\.toHaveCount\(0\)/u);
  assert.match(browserContract, /wp7-registration-mobile\.png/u);
  assert.match(browserContract, /wp7-live-mobile\.png/u);
  assert.match(browserContract, /wp7-checkout-mobile\.png/u);
  assert.match(browserContract, /wp7-order-mobile\.png/u);
});

test("G7-04 build failure classification is deterministic and fail closed", () => {
  const cases = [
    ["G7_COMMERCE_EXTERNAL_NETWORK_DENIED", "EXTERNAL_NETWORK_DENIED"],
    ["Another next build process is already running", "NEXT_BUILD_LOCKED"],
    ["Next.js inferred your workspace root", "NEXT_WORKSPACE_ROOT_INVALID"],
    ["Failed to compile", "NEXT_COMPILE_FAILED"],
    ["Failed to collect page data", "NEXT_PAGE_DATA_COLLECTION_FAILED"],
    ["Error occurred prerendering page", "NEXT_PRERENDER_FAILED"],
    ["Type error: invalid value", "NEXT_TYPECHECK_FAILED"],
    ["Module not found", "MODULE_RESOLUTION_FAILED"],
    ["EACCES: permission denied", "FILESYSTEM_PERMISSION_FAILED"],
    ["JavaScript heap out of memory", "NODE_MEMORY_EXHAUSTED"],
    ["Prisma runtime error", "PRISMA_RUNTIME_FAILED"],
    ["unexpected failure", "NEXT_BUILD_FAILED_UNCLASSIFIED"],
  ];
  for (const [input, expected] of cases) assert.equal(classifySanitizedFailure(input), expected);
});

test("G7-04 spawn execution metadata is allowlisted and preserves null exit status fail closed", () => {
  const secretMessage = "spawn failed at C:\\private\\workspace with TOKEN=secret";
  const cases = [
    {
      name: "status zero",
      input: { status: 0, signal: null },
      expected: { exitCode: 0, signal: null, spawnErrorCode: null, timedOut: false, outcome: "EXITED" },
      pass: true,
    },
    {
      name: "nonzero status",
      input: { status: 7, signal: null },
      expected: { exitCode: 7, signal: null, spawnErrorCode: null, timedOut: false, outcome: "EXITED" },
      pass: false,
    },
    {
      name: "safe signal",
      input: { status: null, signal: "SIGTERM" },
      expected: { exitCode: null, signal: "SIGTERM", spawnErrorCode: null, timedOut: false, outcome: "SIGNALED" },
      pass: false,
    },
    {
      name: "timeout",
      input: { status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT", message: secretMessage } },
      expected: { exitCode: null, signal: "SIGTERM", spawnErrorCode: "ETIMEDOUT", timedOut: true, outcome: "SPAWN_ERROR" },
      pass: false,
    },
    {
      name: "unknown spawn error",
      input: { status: null, signal: "SIGCUSTOM", error: { code: "EPRIVATE", message: secretMessage }, stdout: secretMessage, env: { TOKEN: "secret" } },
      expected: { exitCode: null, signal: null, spawnErrorCode: "UNKNOWN", timedOut: false, outcome: "SPAWN_ERROR" },
      pass: false,
    },
    {
      name: "no exit status",
      input: { status: null, signal: null },
      expected: { exitCode: null, signal: null, spawnErrorCode: null, timedOut: false, outcome: "NO_EXIT_STATUS" },
      pass: false,
    },
  ];

  for (const testCase of cases) {
    const metadata = normalizeSpawnSyncExecution(testCase.input);
    assert.deepEqual(metadata, testCase.expected, testCase.name);
    assert.equal(metadata.exitCode === 0, testCase.pass, `${testCase.name} PASS contract`);
    assert.deepEqual(Object.keys(metadata).sort(), ["exitCode", "outcome", "signal", "spawnErrorCode", "timedOut"]);
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /message|stdout|stderr|path|workspace|env|TOKEN|secret|EPRIVATE|SIGCUSTOM/iu);
  }
});

test("G7-04 next build execution classification prioritizes non-exit outcomes over output", () => {
  const compileOutput = "Failed to compile";
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: 0 }), compileOutput), null);
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: 2 }), compileOutput), "NEXT_COMPILE_FAILED");
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: null, signal: "SIGTERM" }), compileOutput), "NEXT_BUILD_SIGNALED");
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: null, error: { code: "ETIMEDOUT" } }), compileOutput), "NEXT_BUILD_TIMED_OUT");
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: null, error: { code: "EPRIVATE" } }), compileOutput), "NEXT_BUILD_SPAWN_ERROR");
  assert.equal(classifyNextBuildExecution(normalizeSpawnSyncExecution({ status: null }), compileOutput), "NEXT_BUILD_NO_EXIT_STATUS");
});

test("G7-04 receipt source keeps build execution diagnostics optional, allowlisted, and fail closed", () => {
  const source = fs.readFileSync(new URL("./g7-commerce-browser-qa.mjs", import.meta.url), "utf8");
  assert.match(source, /nextBuildExecution: null/u);
  assert.match(source, /receipt\.diagnostics\.nextBuildExecution = \{[\s\S]*?exitCode: build\.exitCode,[\s\S]*?signal: build\.signal,[\s\S]*?spawnErrorCode: build\.spawnErrorCode,[\s\S]*?timedOut: build\.timedOut,[\s\S]*?outcome: build\.outcome,[\s\S]*?\};/u);
  assert.match(source, /receipt\.phases\.nextBuild = build\.exitCode === 0 \? "PASS" : "FAIL"/u);
  assert.match(source, /removed\.exitCode === 0 && absent\.exitCode !== null && absent\.exitCode !== 0/u);
  assert.doesNotMatch(source, /nextBuildExecution\s*=\s*\{[^}]*?(?:message|stdout|stderr|command|cwd|env|path)/su);
});

test("G7-04 playwright failure classification covers product evidence failure modes", () => {
  const cases = [
    ["AXE_BLOCKING:label", "PLAYWRIGHT_AXE_BLOCKING"],
    ["RWD_HORIZONTAL_OVERFLOW:20", "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW"],
    ["PrismaClientInitializationError", "PLAYWRIGHT_DATABASE_UNAVAILABLE"],
    ["Unique constraint failed", "PLAYWRIGHT_FIXTURE_DATABASE_CONSTRAINT"],
    ["beforeAll hook failed", "PLAYWRIGHT_FIXTURE_SETUP_FAILED"],
    ["Timeout 30000ms exceeded", "PLAYWRIGHT_TIMEOUT"],
    ["strict mode violation", "PLAYWRIGHT_LOCATOR_CONTRACT_FAILED"],
    ["Expected: 200 Received: 500", "PLAYWRIGHT_ASSERTION_FAILED"],
    ["browser crashed", "PLAYWRIGHT_TEST_FAILED"],
  ];
  for (const [input, expected] of cases) assert.equal(classifyPlaywrightFailure(input), expected);
});

test("G7-04 sanitizers redact local paths, credentials, identities, and long values", () => {
  const tempRoot = path.join(os.tmpdir(), "g7-commerce-sanitizer-test");
  const longValue = "a".repeat(48);
  const input = `${tempRoot} postgresql://postgres:password@127.0.0.1/test buyer@example.test 0912345678 g7-04-local-synthetic-secret ${longValue}`;
  const build = sanitizedBuildDetails(input, tempRoot).join("\n");
  const browser = sanitizePlaywrightMessage(input, tempRoot).join("\n");

  for (const output of [build, browser]) {
    assert.match(output, /<temp>/u);
    assert.match(output, /postgresql:\/\/<redacted>@/u);
    assert.doesNotMatch(output, /password|buyer@example\.test|a{48}/u);
  }
  assert.match(browser, /<redacted-phone>/u);
});

test("G7-04 Playwright sanitizer redacts verification token query values", () => {
  const tempRoot = path.join(os.tmpdir(), "g7-commerce-token-sanitizer-test");
  const rawToken = "fsv1.submission-1.1787000000.1.signature-value";
  const output = sanitizePlaywrightMessage(
    `request failed: http://127.0.0.1:41234/verify-registration?token=${rawToken}&status=failed`,
    tempRoot,
  ).join("\n");

  assert.match(output, /verify-registration\?token=<redacted>&status=failed/u);
  assert.doesNotMatch(output, new RegExp(rawToken.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("G7-04 server runtime sanitizer redacts headers, short secrets, identities, and bounded diagnostics", () => {
  const tempRoot = path.join(os.tmpdir(), "g7-commerce-server-runtime-sanitizer-test");
  const input = [
    ...Array.from({ length: 30 }, (_, index) => `older diagnostic ${index}`),
    `PrismaClientInitializationError from ${process.cwd()} and ${tempRoot}`,
    "postgresql://postgres:database-password@127.0.0.1/test",
    "buyer@example.test 0912-345-678",
    "Authorization: Bearer auth-short",
    "Bearer standalone-short",
    "Cookie: session=cookie-short; theme=dark",
    "Set-Cookie: session=set-cookie-short; HttpOnly",
    "API_TOKEN=tok",
    "SESSION_SECRET=shh",
    "PRIVATE_KEY=key",
    "DATABASE_PASSWORD=pw",
    "PUBLIC_LIVE_NOT_FOUND_AVAILABILITY buyer@example.test",
    "PUBLIC_LIVE_NOT_FOUND_READINESS media 0912-345-678",
    `NEXT_SERVER_NOT_READY ${"x".repeat(400)}`,
  ].join("\n");
  const details = sanitizedServerRuntimeDetails(input, tempRoot);
  const output = details.join("\n");

  assert.equal(details.length, 24);
  assert.equal(details.every((line) => line.length <= 300), true);
  assert.match(output, /<workspace>/u);
  assert.match(output, /<temp>/u);
  assert.match(output, /postgresql:\/\/<redacted>@/u);
  assert.match(output, /<redacted-email>/u);
  assert.match(output, /<redacted-phone>/u);
  assert.match(output, /Authorization: <redacted>/u);
  assert.match(output, /Bearer <redacted>/u);
  assert.match(output, /Cookie: <redacted>/u);
  assert.match(output, /Set-Cookie: <redacted>/u);
  assert.match(output, /API_TOKEN=<redacted>/u);
  assert.match(output, /SESSION_SECRET=<redacted>/u);
  assert.match(output, /PRIVATE_KEY=<redacted>/u);
  assert.match(output, /DATABASE_PASSWORD=<redacted>/u);
  assert.match(output, /PUBLIC_LIVE_NOT_FOUND_AVAILABILITY <redacted-email>/u);
  assert.match(output, /PUBLIC_LIVE_NOT_FOUND_READINESS media <redacted-phone>/u);
  assert.match(output, /PrismaClientInitializationError|NEXT_SERVER_NOT_READY/u);
  assert.doesNotMatch(output, /database-password|buyer@example\.test|0912-345-678|auth-short|standalone-short|cookie-short|set-cookie-short|=tok|=shh|=key|=pw/u);
});

test("G7-04 mirror exclusion rejects generated, secret, and transient paths", () => {
  for (const relativePath of ["", ".git/config", ".next/server", "node_modules/pkg", ".ai-team/state.json", "test-results/a", "playwright-report/a", "tmp/a", ".env", "nested/.env.local"]) {
    assert.equal(ignoredMirrorPath(relativePath), true, relativePath);
  }
  assert.equal(ignoredMirrorPath("src/app/page.tsx"), false);
  assert.equal(ignoredMirrorPath("docs/environment.md"), false);
});

test("G7-04 source mirror prunes empty route trees while preserving copied files and root", () => {
  const disposableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "g7-commerce-copy-source-tree-"));
  const source = path.join(disposableRoot, "source");
  const mirror = path.join(disposableRoot, "mirror");
  const viewerLivePage = path.join("src", "app", "(viewer)", "live", "[slug]", "page.tsx");
  const rootCheckoutDefault = path.join("src", "app", "@checkout", "default.tsx");
  const viewerLiveContents = "export default function Page() { return null; }\n";
  const rootCheckoutContents = "export default function Default() { return null; }\n";

  try {
    fs.mkdirSync(path.join(source, "src", "app", "live", "[slug]", "@checkout", "legacy"), { recursive: true });
    fs.mkdirSync(path.join(source, "src", "app", "(viewer)", "@checkout", "empty"), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(source, viewerLivePage)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(source, rootCheckoutDefault)), { recursive: true });
    fs.writeFileSync(path.join(source, viewerLivePage), viewerLiveContents, "utf8");
    fs.writeFileSync(path.join(source, rootCheckoutDefault), rootCheckoutContents, "utf8");
    fs.writeFileSync(path.join(source, ".env"), "SYNTHETIC_SECRET=not-a-workspace-value\n", "utf8");
    for (const ignoredDirectory of [".next", "node_modules"]) {
      fs.mkdirSync(path.join(source, ignoredDirectory), { recursive: true });
      fs.writeFileSync(path.join(source, ignoredDirectory, "synthetic.txt"), "ignored\n", "utf8");
    }

    copySourceTree(source, mirror);

    assert.equal(fs.existsSync(path.join(mirror, "src", "app", "live")), false);
    assert.equal(fs.existsSync(path.join(mirror, "src", "app", "(viewer)", "@checkout")), false);
    assert.equal(fs.readFileSync(path.join(mirror, viewerLivePage), "utf8"), viewerLiveContents);
    assert.equal(fs.readFileSync(path.join(mirror, rootCheckoutDefault), "utf8"), rootCheckoutContents);
    assert.equal(fs.existsSync(path.join(mirror, ".env")), false);
    assert.equal(fs.existsSync(path.join(mirror, ".next")), false);
    assert.equal(fs.existsSync(path.join(mirror, "node_modules")), false);
    assert.equal(fs.existsSync(mirror), true);
  } finally {
    fs.rmSync(disposableRoot, { recursive: true, force: true });
  }
});

test("G7-04 synthetic environment uses an explicit allowlist and loopback-only URLs", () => {
  const sentinelName = "G7_COMMERCE_TEST_SENTINEL";
  const previous = process.env[sentinelName];
  process.env[sentinelName] = "must-not-propagate";
  try {
    const env = syntheticEnvironment({
      tempRoot: path.join(os.tmpdir(), "g7-commerce-env-test"),
      port: 41234,
      databaseUrl: "postgresql://synthetic@127.0.0.1/test",
      schema: "g7_04_browser_0123456789abcdef",
      screenshotDirectory: path.join(os.tmpdir(), "screenshots"),
      networkGuard: path.join(os.tmpdir(), "guard.cjs"),
      playwrightBrowsersPath: path.join(os.tmpdir(), "browsers"),
    });
    assert.equal(env[sentinelName], undefined);
    assert.equal(env.HOME, undefined);
    assert.equal(env.CODEX_HOME, undefined);
    assert.equal(env.E2E_BASE_URL, "http://127.0.0.1:41234");
    assert.equal(env.G7_COMMERCE_BROWSER_SCHEMA, "g7_04_browser_0123456789abcdef");
    assert.equal(env.PAYMENT_PROVIDER, "demo");
    assert.equal(env.CRON_SECRET, "g7-04-local-synthetic-cron-secret");
    assert.equal(env.LIVE_CHAT_INGRESS_SECRET, "g7-04-local-synthetic-live-chat-ingress-secret");
    assert.match(env.NODE_OPTIONS, /^--require=/u);
  } finally {
    if (previous === undefined) delete process.env[sentinelName];
    else process.env[sentinelName] = previous;
  }
});

test("G7-04 container inspection parser accepts only the exact five-field shape", () => {
  assert.deepEqual(
    parseContainerInspection("abc\t/celebratedeal-g7-commerce-browser-0123456789abcdef\t0123456789abcdef\tg7-04-browser:0123456789abcdef\ttmpfs=/var/lib/postgresql/data\n"),
    {
      id: "abc",
      name: "celebratedeal-g7-commerce-browser-0123456789abcdef",
      runId: "0123456789abcdef",
      marker: "g7-04-browser:0123456789abcdef",
      mount: "tmpfs=/var/lib/postgresql/data",
    },
  );
  assert.equal(parseContainerInspection("too\tfew"), null);
  assert.equal(parseContainerInspection("too\tmany\tfields\tfor\tthis\tshape"), null);
});

test("G7-04 temporary mirror cleanup requires exact path and marker ownership", () => {
  const runId = crypto.randomBytes(8).toString("hex");
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-g7-commerce-browser-${runId}`);
  const marker = `g7-04-browser:${runId}`;
  fs.mkdirSync(path.join(tempRoot, "mirror", "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".marker"), "wrong-marker", "utf8");
  assert.equal(removeMirror(tempRoot, marker), "CLEANUP_BLOCKED");
  assert.equal(fs.existsSync(tempRoot), true);
  fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
  assert.equal(removeMirror(tempRoot, marker), "PASS");
  assert.equal(fs.existsSync(tempRoot), false);
});
