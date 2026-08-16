import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const image = "postgres:16-alpine";
const migrationNamePattern = /^\d{12,14}_[a-z0-9_]+$/u;
const tempNamePattern = /^celebratedeal-g7-commerce-browser-[a-f0-9]{16}$/u;
const containerNamePattern = /^celebratedeal-g7-commerce-browser-[a-f0-9]{16}$/u;
const schemaPattern = /^g7_04_browser_[a-f0-9]{16}$/u;
const evidenceRoot = path.join(root, "docs", "ai-team", "evidence");
const diagnosticDev = process.argv.includes("--diagnostic-dev");
const focusBuyerDelivery = process.argv.includes("--focus-buyer-delivery");
const focusProductDelivery = process.argv.includes("--focus-product-delivery");
const focusBuyerOrders = process.argv.includes("--focus-buyer-orders");
const focusOnboarding = process.argv.includes("--focus-onboarding");
const focusStreamQuota = process.argv.includes("--focus-stream-quota");
const focusStreamRetry = process.argv.includes("--focus-stream-retry");
const focusCheckoutRecovery = process.argv.includes("--focus-checkout-recovery");
const focusMessageTemplateDraft = process.argv.includes("--focus-message-template-draft");
const focusInteractionRole = process.argv.includes("--focus-interaction-role");
const focusPersistentPlayer = process.argv.includes("--focus-persistent-player");
const focusLiveStudioStarter = process.argv.includes("--focus-live-studio-starter");
const focusLiveStudio = focusLiveStudioStarter || process.argv.includes("--focus-live-studio");
const focusDelivery = focusProductDelivery || focusBuyerDelivery;
const focusedWorkPackage = focusPersistentPlayer ? "WP6" : focusBuyerDelivery ? "G7-48B" : focusProductDelivery ? "G7-48A" : focusBuyerOrders ? "G7-47" : focusOnboarding ? "G7-49" : focusStreamQuota ? "G7-50" : focusStreamRetry ? "G7-51" : focusCheckoutRecovery ? "G7-57" : focusMessageTemplateDraft ? "G7-58" : focusInteractionRole ? "G7-52" : focusLiveStudioStarter ? "G7-46" : "G7-45";
const productDeliveryContract = "merchant configures encrypted digital delivery and checkout keeps an immutable order snapshot";
const buyerOrdersContract = "buyer order capability shows only exact safe fulfillment projection on desktop and mobile";
const liveStudioContract = "merchant Email templates keep live reminders scoped, then Live Studio separates registration and reminder templates";
const onboardingContract = "merchant onboarding shows exact sales-live blockers and skips deferred payment work";
const streamQuotaContract = "public playback stops once on exact Stream quota exhaustion and keeps recovery guidance accessible";
const streamRetryContract = "public playback retries an ambiguous Stream heartbeat with one stable event identity";
const interactionRoleContract = "merchant interaction role previews transparent identity and exact script impact before disabling";
const checkoutRecoveryContract = "public checkout recovers one committed order after response loss and page refresh";
const messageTemplateDraftContract = "merchant message template keeps every field after server validation and can recover as a new template";
const persistentPlayerContract = "public live keeps the same video node, playback state and controls through internal checkout";
const expectedBrowserContracts = [
  "desktop merchant can recover upload and validation errors, then publish and preview one product",
  "mobile product catalog has no overflow, preserves keyboard entry and passes axe",
  productDeliveryContract,
  buyerOrdersContract,
  "desktop owner can see only its canonical order, reveal PII safely, and complete physical fulfillment",
  "mobile order detail has no horizontal overflow, keeps keyboard focus visible, and passes axe",
  "public buyer receives a server admission, creates exactly one reserved order, and safely reviews payment status",
  checkoutRecoveryContract,
  "finance admin payout batch prevents duplicate submission and exposes accessible pending feedback",
  liveStudioContract,
];
const selectedBrowserContracts = focusDelivery
  ? [productDeliveryContract]
  : focusBuyerOrders ? [buyerOrdersContract]
  : focusOnboarding ? [onboardingContract]
  : focusStreamQuota ? [streamQuotaContract]
  : focusStreamRetry ? [streamRetryContract]
  : focusCheckoutRecovery ? [checkoutRecoveryContract]
  : focusMessageTemplateDraft ? [messageTemplateDraftContract]
  : focusInteractionRole ? [interactionRoleContract]
  : focusPersistentPlayer ? [persistentPlayerContract]
  : focusLiveStudio ? [liveStudioContract] : expectedBrowserContracts;
const attestedSourcePaths = [
  "scripts/g7-commerce-browser-qa.mjs",
  "playwright.g7-commerce.config.ts",
  "tests/e2e/commerce-orders.spec.ts",
  "src/lib/product-action-state.ts",
  "src/lib/product-delivery.ts",
  "src/lib/external-url.ts",
  "src/app/actions/product-actions.ts",
  "src/components/product-form-client.tsx",
  "src/components/product-form.tsx",
  "src/components/ui.tsx",
  "src/components/media-upload-field.tsx",
  "src/app/(app)/products/page.tsx",
  "src/app/(app)/products/new/page.tsx",
  "src/app/(app)/products/[id]/edit/page.tsx",
  "src/app/(app)/products/[id]/preview/page.tsx",
  "src/app/checkout/[vendorId]/[productId]/page.tsx",
  "src/app/@checkout/default.tsx",
  "src/app/layout.tsx",
  "src/app/live/[slug]/layout.tsx",
  "src/app/live/[slug]/@checkout/default.tsx",
  "src/app/live/[slug]/@checkout/(..)(..)checkout/[vendorId]/[productId]/page.tsx",
  "src/components/checkout-overlay.tsx",
  "src/components/live-playback.tsx",
  "src/app/api/payments/checkout/route.ts",
  "src/app/api/payments/checkout/admission/route.ts",
  "src/lib/checkout-admission.ts",
  "src/lib/checkout-idempotency.ts",
  "src/components/commerce-checkout-form.tsx",
  "src/lib/commerce-orders.ts",
  "prisma/schema.prisma",
  "prisma/migrations/20260809072000_g7_48_product_delivery_snapshot/migration.sql",
  "src/app/api/webhooks/payments/route.ts",
  "src/app/checkout/result/page.tsx",
  "src/app/checkout/result/loading.tsx",
  "src/app/checkout/result/error.tsx",
  "src/components/public-policy.tsx",
  "src/components/form-submit-button.tsx",
  "src/app/admin/billing/loading.tsx",
  "src/app/admin/billing/error.tsx",
  "src/app/(app)/billing/loading.tsx",
  "src/app/(app)/billing/error.tsx",
  "src/app/admin/billing/course-payouts/page.tsx",
  "src/app/admin/billing/platform-referral-payouts/page.tsx",
  "src/app/(app)/billing/payment-methods/page.tsx",
  "src/app/admin/billing/webhooks/page.tsx",
  "src/app/admin/billing/webhooks/[id]/page.tsx",
  "src/app/admin/billing/dashboard/page.tsx",
  "src/lib/buyer-support-access.ts",
  "src/app/support/page.tsx",
  "src/app/support/orders/page.tsx",
  "src/app/support/orders/loading.tsx",
  "src/app/support/orders/[grantId]/page.tsx",
  "src/app/support/orders/[grantId]/delivery/[itemId]/page.tsx",
  "src/app/support/orders/[grantId]/delivery/[itemId]/not-found.tsx",
  "src/lib/payment-return-outcome.ts",
  "vercel.json",
  "prisma/migrations/20260809030000_g7_21_live_reminder_email/migration.sql",
  "src/lib/message-template.ts",
  "src/app/actions.ts",
  "src/lib/email-delivery.ts",
  "src/app/api/jobs/email-deliveries/route.ts",
  "src/components/message-template-form.tsx",
  "src/components/message-template-form-client.tsx",
  "src/app/(app)/messages/templates/new/page.tsx",
  "src/app/(app)/messages/templates/[id]/edit/page.tsx",
  "src/components/live-stepper-form.tsx",
  "src/components/use-live-studio-draft.ts",
  "src/lib/live-studio-draft.ts",
  "src/lib/live-studio-draft-client.ts",
  "src/app/(app)/messages/templates/page.tsx",
  "src/app/(app)/messages/deliveries/page.tsx",
  "src/app/(app)/lives/new/page.tsx",
  "src/app/(app)/onboarding/page.tsx",
  "src/lib/merchant-onboarding.ts",
  "src/lib/live-publish-readiness.ts",
  "src/lib/sellable-live.ts",
  "src/lib/stream-usage-client.ts",
  "src/app/api/stream-usage/route.ts",
  "src/components/live-playback.tsx",
  "src/lib/interaction-role-usage.ts",
  "src/components/interaction-roles-workbench.tsx",
  "src/app/(app)/interaction-roles/[id]/edit/page.tsx",
];

function run(command, args, env, cwd = root) {
  const child = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function classifySanitizedFailure(output) {
  const value = String(output);
  if (/G7_COMMERCE_EXTERNAL_NETWORK_DENIED/u.test(value)) return "EXTERNAL_NETWORK_DENIED";
  if (/Another next build process is already running/u.test(value)) return "NEXT_BUILD_LOCKED";
  if (/inferred your workspace root|couldn't find the Next\.js package/iu.test(value)) return "NEXT_WORKSPACE_ROOT_INVALID";
  if (/Failed to compile/u.test(value)) return "NEXT_COMPILE_FAILED";
  if (/Failed to collect page data/u.test(value)) return "NEXT_PAGE_DATA_COLLECTION_FAILED";
  if (/Error occurred prerendering page|prerender error/iu.test(value)) return "NEXT_PRERENDER_FAILED";
  if (/Type error:|TypeScript/u.test(value)) return "NEXT_TYPECHECK_FAILED";
  if (/Module not found|Cannot find module/u.test(value)) return "MODULE_RESOLUTION_FAILED";
  if (/EACCES|EPERM/u.test(value)) return "FILESYSTEM_PERMISSION_FAILED";
  if (/out of memory|heap out of memory/iu.test(value)) return "NODE_MEMORY_EXHAUSTED";
  if (/prisma/iu.test(value) && /error/iu.test(value)) return "PRISMA_RUNTIME_FAILED";
  return "NEXT_BUILD_FAILED_UNCLASSIFIED";
}

export function sanitizedBuildDetails(output, tempRoot) {
  const escapedTemp = tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return String(output)
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split(/\r?\n/u)
    .map((line) => line
      .replace(new RegExp(escapedTemp, "giu"), "<temp>")
      .replace(new RegExp(escapedRoot, "giu"), "<workspace>")
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://<redacted>@")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
      .replace(/g7-04-local-synthetic-[A-Za-z0-9_-]+/gu, "<synthetic-secret>")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "<redacted-long-value>")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
      .trim()
      .slice(0, 300))
    .filter(Boolean)
    .slice(-24);
}

export function sanitizePlaywrightMessage(output, tempRoot) {
  const escapedTemp = tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return String(output ?? "")
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split(/\r?\n/u)
    .map((line) => line
      .replace(new RegExp(escapedTemp, "giu"), "<temp>")
      .replace(new RegExp(escapedRoot, "giu"), "<workspace>")
      .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://<redacted>@")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
      .replace(/\b09\d{8}\b/gu, "<redacted-phone>")
      .replace(/g7-04-(?:local-)?(?:synthetic-|playwright-session-)?[A-Za-z0-9_-]{8,}/gu, "<synthetic-value>")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "<redacted-long-value>")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
      .trim()
      .slice(0, 320))
    .filter(Boolean)
    .slice(0, 12);
}

export function classifyPlaywrightFailure(message) {
  const value = String(message ?? "");
  if (/AXE_BLOCKING:/u.test(value)) return "PLAYWRIGHT_AXE_BLOCKING";
  if (/RWD_HORIZONTAL_OVERFLOW:/u.test(value)) return "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW";
  if (/PrismaClientInitializationError|Can't reach database server/iu.test(value)) return "PLAYWRIGHT_DATABASE_UNAVAILABLE";
  if (/PrismaClientKnownRequestError|Foreign key constraint|Unique constraint/iu.test(value)) return "PLAYWRIGHT_FIXTURE_DATABASE_CONSTRAINT";
  if (/beforeAll|before all/iu.test(value)) return "PLAYWRIGHT_FIXTURE_SETUP_FAILED";
  if (/Timeout|timed out/iu.test(value)) return "PLAYWRIGHT_TIMEOUT";
  if (/strict mode violation|locator\(/iu.test(value)) return "PLAYWRIGHT_LOCATOR_CONTRACT_FAILED";
  if (/Expected:|Received:|expect\(/u.test(value)) return "PLAYWRIGHT_ASSERTION_FAILED";
  return "PLAYWRIGHT_TEST_FAILED";
}

export function summarizePlaywrightReport(report, tempRoot) {
  const tests = [];
  const visitSuite = (suite, parents = []) => {
    if (!suite || typeof suite !== "object") return;
    const titles = typeof suite.title === "string" && suite.title ? [...parents, suite.title] : parents;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        const results = Array.isArray(test.results) ? test.results : [];
        const finalResult = results.at(-1) ?? {};
        const status = typeof finalResult.status === "string" ? finalResult.status : "unknown";
        const messages = [
          finalResult.error?.message,
          ...(Array.isArray(finalResult.errors) ? finalResult.errors.map((error) => error?.message) : []),
        ].filter((value) => typeof value === "string" && value.length > 0);
        const title = [...titles, typeof spec.title === "string" ? spec.title : "untitled-test"]
          .filter(Boolean)
          .join(" > ")
          .slice(0, 240);
        tests.push({ title, status, message: messages.join("\n") });
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visitSuite(child, titles);
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) visitSuite(suite);

  const failedStatuses = new Set(["failed", "timedOut", "interrupted", "unknown"]);
  const diagnostics = tests
    .filter((test) => failedStatuses.has(test.status))
    .slice(0, 4)
    .map((test) => ({
      title: test.title,
      status: test.status,
      classification: classifyPlaywrightFailure(test.message),
      details: sanitizePlaywrightMessage(test.message, tempRoot),
    }));
  const globalErrors = Array.isArray(report?.errors)
    ? report.errors
      .map((error) => error?.message)
      .filter((value) => typeof value === "string" && value.length > 0)
      .slice(0, 2)
      .flatMap((message) => sanitizePlaywrightMessage(message, tempRoot))
      .slice(0, 12)
    : [];

  return {
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => failedStatuses.has(test.status)).length,
    skipped: tests.filter((test) => ["skipped", "pending"].includes(test.status)).length,
    diagnostics,
    globalErrors,
    results: tests.map(({ title, status }) => ({ title, status })),
  };
}

export function evaluateBrowserContracts(results, contracts = expectedBrowserContracts) {
  const statuses = Object.fromEntries(contracts.map((contract) => {
    const resultForContract = results.find((resultEntry) => resultEntry.title.endsWith(` > ${contract}`));
    return [contract, resultForContract?.status === "passed" ? "PASS" : (resultForContract?.status?.toUpperCase() ?? "MISSING")];
  }));
  return { statuses, passed: Object.values(statuses).every((status) => status === "PASS") };
}

function listCanonicalMigrations() {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && migrationNamePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function ignoredMirrorPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return !relativePath
    || segments.some((segment) => segment === ".git" || segment === ".next" || segment === "node_modules" || segment === ".ai-team")
    || segments.some((segment) => segment === "test-results" || segment === "playwright-report" || segment === "tmp")
    || segments.some((segment) => segment === ".env" || segment.startsWith(".env."));
}

function copySourceTree(source, destination, relative = "") {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (ignoredMirrorPath(childRelative)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const stat = fs.lstatSync(sourcePath);
    // Do not dereference an arbitrary link from a dirty worktree into the
    // hermetic mirror; linked packages are constructed explicitly below.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) copySourceTree(sourcePath, destinationPath, childRelative);
    else if (stat.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function linkNodeModules(mirror) {
  const sourceModules = path.join(root, "node_modules");
  const targetModules = path.join(mirror, "node_modules");
  if (!fs.existsSync(sourceModules)) throw new Error("node-modules-missing");
  fs.mkdirSync(targetModules, { recursive: true });

  for (const entry of fs.readdirSync(sourceModules, { withFileTypes: true })) {
    if (entry.name === ".prisma" || entry.name === "@prisma") continue;
    const sourcePath = path.join(sourceModules, entry.name);
    const targetPath = path.join(targetModules, entry.name);
    const targetStat = fs.statSync(sourcePath);
    // Turbopack uses the physical Next package location to infer the project
    // root. Keep Next inside the mirror; other immutable dependencies remain
    // linked for a fast, non-mutating setup.
    if (entry.name === "next") fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: false });
    else fs.symlinkSync(sourcePath, targetPath, targetStat.isDirectory() ? "junction" : "file");
  }

  // Prisma writes generated client code to node_modules/.prisma. Keep both
  // that output and @prisma/client inside the mirror so generation cannot
  // mutate the shared dependency tree.
  const sourcePrismaScope = path.join(sourceModules, "@prisma");
  const targetPrismaScope = path.join(targetModules, "@prisma");
  fs.mkdirSync(targetPrismaScope, { recursive: true });
  for (const entry of fs.readdirSync(sourcePrismaScope, { withFileTypes: true })) {
    const sourcePath = path.join(sourcePrismaScope, entry.name);
    const targetPath = path.join(targetPrismaScope, entry.name);
    if (entry.name === "client") fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: false });
    else fs.symlinkSync(sourcePath, targetPath, fs.statSync(sourcePath).isDirectory() ? "junction" : "file");
  }
  return fs.existsSync(path.join(targetPrismaScope, "client"));
}

function writePrismaConfig(mirror) {
  const configPath = path.join(mirror, "prisma.g7-commerce.config.mjs");
  fs.writeFileSync(configPath, [
    'import { createRequire } from "node:module";',
    'const require = createRequire(import.meta.url);',
    'const { defineConfig } = require("prisma/config");',
    'export default defineConfig({',
    '  schema: "prisma/schema.prisma",',
    '  engine: "classic",',
    '  migrations: { path: "prisma/migrations" },',
    '  datasource: { url: process.env.DATABASE_URL },',
    '});',
    '',
  ].join("\n"), "utf8");
  return configPath;
}

export function networkGuardSource() {
  return [
    'const loopback = new Set(["127.0.0.1", "localhost", "::1"]);',
    'const normalizeHost = (value) => {',
    '  if (typeof value !== "string" || value.length === 0) return null;',
    '  const text = value.trim().toLowerCase();',
    '  if (!text) return null;',
    '  try { return new URL(text).hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase(); } catch {}',
    '  try { return new URL(`http://${text}`).hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase(); } catch { return null; }',
    '};',
    'const hostFromValue = (value) => {',
    '  if (value instanceof URL) return normalizeHost(value.hostname);',
    '  if (typeof value === "string") return normalizeHost(value);',
    '  if (value && typeof value === "object") {',
    '    if (typeof value.hostname === "string") return normalizeHost(value.hostname);',
    '    if (typeof value.host === "string") return normalizeHost(value.host);',
    '    if (typeof value.url === "string") return normalizeHost(value.url);',
    '  }',
    '  return null;',
    '};',
    'const targetHost = (kind, args) => {',
    '  if (kind === "socket") {',
    '    if (typeof args[0] === "number") {',
    '      if (typeof args[1] === "string") return normalizeHost(args[1]);',
    '      if (args[1] && typeof args[1] === "object") return hostFromValue(args[1]) || "localhost";',
    '      return "localhost";',
    '    }',
    '    if (args[0] && typeof args[0] === "object" && Number.isInteger(args[0].port)) return hostFromValue(args[0]) || "localhost";',
    '    return null;',
    '  }',
    '  if (kind === "http") {',
    '    const override = args[1] && typeof args[1] === "object" ? hostFromValue(args[1]) : null;',
    '    return override || hostFromValue(args[0]);',
    '  }',
    '  return hostFromValue(args[0]);',
    '};',
    'const allowedHost = (candidate) => candidate !== null && loopback.has(candidate);',
    'const deny = () => { throw new Error("G7_COMMERCE_EXTERNAL_NETWORK_DENIED"); };',
    'for (const name of ["http", "https"]) {',
    '  const moduleValue = require(name); const original = moduleValue.request;',
    '  moduleValue.request = function guardedRequest(...args) { if (!allowedHost(targetHost("http", args))) return deny(); return original.apply(this, args); };',
    '  moduleValue.get = function guardedGet(...args) { const request = moduleValue.request.apply(this, args); request.end(); return request; };',
    '}',
    'const net = require("net"); const originalConnect = net.connect;',
    'net.connect = net.createConnection = function guardedConnect(...args) { if (!allowedHost(targetHost("socket", args))) return deny(); return originalConnect.apply(this, args); };',
    'const tls = require("tls"); const originalTlsConnect = tls.connect;',
    'tls.connect = function guardedTlsConnect(...args) { if (!allowedHost(targetHost("socket", args))) return deny(); return originalTlsConnect.apply(this, args); };',
    'const originalFetch = global.fetch; if (originalFetch) global.fetch = function guardedFetch(input, init) { if (!allowedHost(targetHost("fetch", [input, init]))) return Promise.reject(new Error("G7_COMMERCE_EXTERNAL_NETWORK_DENIED")); return originalFetch(input, init); };',
    'module.exports = { allowedHost, hostFromValue, targetHost };',
    '',
  ].join("\n");
}

function writeNetworkGuard(tempRoot) {
  const guardPath = path.join(tempRoot, "loopback-network-guard.cjs");
  fs.writeFileSync(guardPath, networkGuardSource(), "utf8");
  return guardPath;
}

function allocatePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(Number.isInteger(port) ? port : null));
    });
  });
}

export function syntheticEnvironment({ tempRoot, port, databaseUrl, schema, screenshotDirectory, networkGuard, playwrightBrowsersPath }) {
  return {
    PATH: process.env.PATH ?? process.env.Path ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    WINDIR: process.env.WINDIR ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    USERPROFILE: path.join(tempRoot, "home"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "production",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    G7_COMMERCE_BROWSER_SCHEMA: schema,
    E2E_PORT: String(port),
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    E2E_TEST_MODE: "true",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    JOB_SECRET: "g7-04-local-synthetic-job-secret",
    CSRF_SECRET: "g7-04-local-synthetic-csrf-secret",
    G7_COMMERCE_SCREENSHOT_DIR: screenshotDirectory,
    G7_COMMERCE_LOOPBACK_TLS_BRIDGE: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    NODE_OPTIONS: `--require=${networkGuard}`,
  };
}

function waitForPostgres(containerId, env) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env);
    const query = ready.exitCode === 0
      ? run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", "SELECT 1;"], env)
      : null;
    if (ready.exitCode === 0 && query?.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function psql(containerId, sql, env, database = "celebratedeal_test") {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", database, "-c", sql], env);
}

function writeDatabaseMarker(containerId, marker, env) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (psql(containerId, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, env, "postgres").exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return false;
}

function inspectContainer(containerId, env) {
  return run("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    containerId,
  ], env);
}

export function parseContainerInspection(value) {
  const values = String(value).replace(/\r?\n$/u, "").split("\t");
  if (values.length !== 5) return null;
  return { id: values[0], name: values[1].replace(/^\//u, ""), runId: values[2], marker: values[3], mount: values[4] };
}

function migrationRows(containerId, schema, migrations, env) {
  const result = psql(containerId, `SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM "${schema}"._prisma_migrations ORDER BY migration_name;`, env);
  if (result.exitCode !== 0) return false;
  const rows = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/u).map((row) => row.split("|")) : [];
  return rows.length === migrations.length && rows.every(([name, finished, active], index) => name === migrations[index] && finished === "true" && active === "true");
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return true;
    } catch { /* loopback readiness probe */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return "PASS";
  if (process.platform === "win32") {
    const stopped = run("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
    return stopped.exitCode === 0 ? "PASS" : "FAIL";
  }
  server.kill("SIGTERM");
  return "PASS";
}

export function removeMirror(tempRoot, marker) {
  const resolved = path.resolve(tempRoot);
  const safe = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    && tempNamePattern.test(path.basename(resolved))
    && fs.existsSync(path.join(resolved, ".marker"))
    && fs.readFileSync(path.join(resolved, ".marker"), "utf8") === marker;
  if (!safe) return "CLEANUP_BLOCKED";
  const modules = path.join(resolved, "mirror", "node_modules");
  if (fs.existsSync(modules)) fs.rmSync(modules, { recursive: true, force: true, maxRetries: 3 });
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  return fs.existsSync(resolved) ? "FAIL" : "PASS";
}

function writeReceipt(receipt, receiptPath) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, serialized, { encoding: "utf8", flag: "wx" });
  const digest = crypto.createHash("sha256").update(serialized).digest("hex");
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, { encoding: "utf8", flag: "wx" });
  return digest;
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-commerce-browser-${runId}`;
  const schema = `g7_04_browser_${runId}`;
  const marker = `g7-04-browser:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const screenshots = path.join(evidenceRoot, `g7-04-browser-qa-${runId}-screenshots`);
  const focusedReceiptName = focusBuyerDelivery
    ? "g7-48b-buyer-delivery-browser-qa"
    : focusProductDelivery ? "g7-48a-product-delivery-browser-qa"
    : focusBuyerOrders ? "g7-47-buyer-orders-browser-qa"
    : focusOnboarding ? "g7-49-onboarding-browser-qa"
    : focusStreamQuota ? "g7-50-stream-quota-browser-qa"
    : focusStreamRetry ? "g7-51-stream-retry-browser-qa"
    : focusCheckoutRecovery ? "g7-57-checkout-recovery-browser-qa"
    : focusMessageTemplateDraft ? "g7-58-message-template-draft-browser-qa"
    : focusInteractionRole ? "g7-52-interaction-role-browser-qa"
    : focusPersistentPlayer ? "wp6-persistent-player-browser-qa"
    : `${focusedWorkPackage.toLowerCase()}-live-studio-browser-qa`;
  const focused = focusDelivery || focusBuyerOrders || focusOnboarding || focusStreamQuota || focusStreamRetry || focusCheckoutRecovery || focusMessageTemplateDraft || focusInteractionRole || focusPersistentPlayer || focusLiveStudio;
  const receiptPath = path.join(evidenceRoot, `${focused ? focusedReceiptName : "g7-04-browser-qa"}-${runId}.json`);
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "g7-04-commerce-browser-qa/v1",
    workPackage: focused ? focusedWorkPackage : "G7-04",
    status: "BLOCKED_OR_FAILED",
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    serverMode: diagnosticDev ? "DIAGNOSTIC_DEV" : "PRODUCTION",
    sourceLineage: { algorithm: "sha256", files: {} },
    phases: { mirror: "NOT_STARTED", prismaGenerate: "NOT_STARTED", prismaValidate: "NOT_STARTED", prismaDeploy: "NOT_STARTED", prismaStatus: "NOT_STARTED", nextBuild: "NOT_STARTED", server: "NOT_STARTED", browser: "NOT_STARTED" },
    migrations: { count: migrations.length, applied: false },
    browser: { expected: selectedBrowserContracts.length, passed: 0, failed: 0, skipped: 0, contracts: Object.fromEntries(selectedBrowserContracts.map((name) => [name, "NOT_RUN"])), axeCriticalOrSerious: null, rwd: "NOT_RUN", tenantIsolation: "NOT_RUN", piiEnvelopeLeak: "NOT_RUN", productCatalog: "NOT_RUN", productDelivery: "NOT_RUN", buyerDelivery: "NOT_RUN", emailReminder: "NOT_RUN", liveStudio: "NOT_RUN", buyerOrders: "NOT_RUN", onboarding: "NOT_RUN", streamQuota: "NOT_RUN", streamRetry: "NOT_RUN", checkoutRecovery: "NOT_RUN", messageTemplateDraft: "NOT_RUN", interactionRole: "NOT_RUN", persistentPlayer: "NOT_RUN" },
    screenshots: { desktop: null, mobile: null, productDesktop: null, productMobile: null, productDeliveryDesktop: null, productDeliveryMobile: null, buyerDeliveryDesktop: null, buyerDeliveryMobile: null, paymentResult: null, financePending: null, emailTemplates: null, buyerOrdersDesktop: null, buyerOrdersMobile: null, onboardingDesktop: null, onboardingMobile: null, streamQuotaDesktop: null, streamQuotaMobile: null, streamRetryDesktop: null, streamRetryMobile: null, checkoutRecoveryDesktop: null, checkoutRecoveryMobile: null, messageTemplateDraftDesktop: null, messageTemplateDraftMobile: null, interactionRoleDesktop: null, interactionRoleMobile: null, persistentPlayerDesktop: null, persistentPlayerMobile: null },
    cleanup: { server: "NOT_STARTED", container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { dotenvContentsRead: false, mirrorExcludesDotenv: true, loopbackOnly: true, loopbackTlsCookieBridge: true, postgresTmpfs: true, sourceNodeModulesWritten: false, rawOutputPersisted: false, externalOperations: false, productionOperations: false, playwrightBrowserCacheReuseOnly: true, userBrowserProfileRead: false },
    diagnostics: { nextBuild: null, nextBuildDetails: [], browser: null, browserDetails: [], browserGlobalErrors: [], serverRuntimeDetails: [] },
    failure: null,
  };
  let env = null;
  let container = null;
  let server = null;
  let serverRuntimeOutput = "";

  try {
    if ([focusDelivery, focusBuyerOrders, focusOnboarding, focusStreamQuota, focusStreamRetry, focusCheckoutRecovery, focusMessageTemplateDraft, focusInteractionRole, focusPersistentPlayer, focusLiveStudio].filter(Boolean).length > 1 || !tempNamePattern.test(name) || !containerNamePattern.test(name) || !schemaPattern.test(schema) || migrations.length === 0) throw new Error("runner-contract-invalid");
    fs.mkdirSync(tempRoot, { recursive: true });
    for (const directory of ["tmp", "home", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, { encoding: "utf8", flag: "wx" });
    const mirror = path.join(tempRoot, "mirror");
    copySourceTree(root, mirror);
    if (!linkNodeModules(mirror)) throw new Error("node-modules-overlay-failed");
    if (fs.existsSync(path.join(mirror, ".env")) || fs.existsSync(path.join(mirror, ".env.local"))) throw new Error("dotenv-mirror-violation");
    for (const relativePath of attestedSourcePaths) {
      const sourcePath = path.join(root, relativePath);
      const mirrorPath = path.join(mirror, relativePath);
      if (!fs.existsSync(sourcePath) || !fs.existsSync(mirrorPath)) throw new Error("source-lineage-file-missing");
      const sourceDigest = hashFile(sourcePath);
      if (sourceDigest !== hashFile(mirrorPath)) throw new Error("source-lineage-mirror-mismatch");
      receipt.sourceLineage.files[relativePath] = sourceDigest;
    }
    receipt.phases.mirror = "PASS";

    if (run("docker", ["image", "inspect", image], { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" }).exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image,
    ], { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" });
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    container = { id: created.stdout.trim(), name, runId, marker, schema };
    if (!waitForPostgres(container.id, { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" })) throw new Error("database-unreachable");
    const portOutput = run("docker", ["port", container.id, "5432/tcp"], { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" });
    const postgresPort = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(portOutput.stdout)?.[1];
    if (!postgresPort) throw new Error("database-loopback-port-invalid");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/celebratedeal_test?schema=${schema}`;
    const browserPort = await allocatePort();
    if (!browserPort) throw new Error("browser-loopback-port-invalid");
    fs.mkdirSync(screenshots, { recursive: true });
    const networkGuard = writeNetworkGuard(tempRoot);
    const localAppData = process.env.LOCALAPPDATA;
    const playwrightBrowsersPath = localAppData ? path.resolve(localAppData, "ms-playwright") : null;
    if (!playwrightBrowsersPath || path.basename(playwrightBrowsersPath) !== "ms-playwright" || !fs.existsSync(playwrightBrowsersPath)) {
      throw new Error("playwright-browser-cache-missing");
    }
    env = syntheticEnvironment({ tempRoot, port: browserPort, databaseUrl, schema, screenshotDirectory: screenshots, networkGuard, playwrightBrowsersPath });
    if (!writeDatabaseMarker(container.id, marker, env)) throw new Error("database-marker-failed");
    if (psql(container.id, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("schema-marker-failed");

    const prismaConfig = writePrismaConfig(mirror);
    const prismaCli = path.join(mirror, "node_modules", "prisma", "build", "index.js");
    for (const [phase, args] of [["prismaGenerate", ["generate"]], ["prismaValidate", ["validate"]], ["prismaDeploy", ["migrate", "deploy"]], ["prismaStatus", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", prismaConfig], env, mirror);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`);
    }
    if (!migrationRows(container.id, schema, migrations, env)) throw new Error("canonical-migrations-mismatch");
    receipt.migrations.applied = true;

    const nextCli = path.join(mirror, "node_modules", "next", "dist", "bin", "next");
    // Webpack resolves the read-only dependency junctions used by this
    // hermetic mirror. Turbopack intentionally rejects packages whose physical
    // path is outside its inferred root, even though the mirror never writes
    // through those links.
    const build = run(process.execPath, [nextCli, "build", "--webpack"], env, mirror);
    receipt.phases.nextBuild = build.exitCode === 0 ? "PASS" : "FAIL";
    receipt.diagnostics.nextBuild = build.exitCode === 0 ? null : classifySanitizedFailure(`${build.stdout}\n${build.stderr}`);
    receipt.diagnostics.nextBuildDetails = build.exitCode === 0
      ? []
      : sanitizedBuildDetails(`${build.stdout}\n${build.stderr}`, tempRoot);
    if (build.exitCode !== 0) throw new Error("next-build-failed");

    const serverArgs = diagnosticDev
      ? [nextCli, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(browserPort)]
      : [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(browserPort)];
    const serverEnv = diagnosticDev ? { ...env, NODE_ENV: "development" } : env;
    server = spawn(process.execPath, serverArgs, { cwd: mirror, env: serverEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const collectServerRuntime = (chunk) => {
      serverRuntimeOutput = `${serverRuntimeOutput}${String(chunk)}`.slice(-256 * 1024);
    };
    server.stdout?.on("data", collectServerRuntime);
    server.stderr?.on("data", collectServerRuntime);
    if (!server.pid || !(await waitForServer(`http://127.0.0.1:${browserPort}`, server))) throw new Error("next-server-not-ready");
    receipt.phases.server = "PASS";

    const playwrightCli = path.join(mirror, "node_modules", "playwright", "cli.js");
    const playwrightArgs = [playwrightCli, "test", "tests/e2e/commerce-orders.spec.ts", "--config", "playwright.g7-commerce.config.ts", "--project", "chromium", "--reporter", "json"];
    if (focused) playwrightArgs.push("--grep", selectedBrowserContracts[0]);
    const result = run(process.execPath, playwrightArgs, env, mirror);
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      receipt.diagnostics.browser = "PLAYWRIGHT_JSON_REPORT_INVALID";
    }
    const browserSummary = summarizePlaywrightReport(parsed, tempRoot);
    receipt.browser.passed = browserSummary.passed;
    receipt.browser.failed = browserSummary.failed;
    receipt.browser.skipped = browserSummary.skipped;
    const browserContracts = evaluateBrowserContracts(browserSummary.results, selectedBrowserContracts);
    receipt.browser.contracts = browserContracts.statuses;
    receipt.diagnostics.browserDetails = browserSummary.diagnostics;
    receipt.diagnostics.browserGlobalErrors = browserSummary.globalErrors;
    if (result.exitCode !== 0 && !receipt.diagnostics.browser) {
      receipt.diagnostics.browser = browserSummary.diagnostics[0]?.classification ?? "PLAYWRIGHT_FAILED_WITHOUT_DIAGNOSTIC";
    }
    if (result.exitCode !== 0) {
      receipt.diagnostics.serverRuntimeDetails = sanitizedBuildDetails(serverRuntimeOutput, tempRoot);
    }
    const screenshotEntries = {
      desktop: path.join(screenshots, "desktop.png"),
      mobile: path.join(screenshots, "mobile.png"),
      productDesktop: path.join(screenshots, "product-desktop.png"),
      productMobile: path.join(screenshots, "product-mobile.png"),
      paymentResult: path.join(screenshots, "payment-result.png"),
      financePending: path.join(screenshots, "finance-pending.png"),
      emailTemplates: path.join(screenshots, "email-templates.png"),
      liveStudioDesktop: path.join(screenshots, "live-studio-desktop.png"),
      liveStudioMobile: path.join(screenshots, "live-studio-mobile.png"),
      buyerOrdersDesktop: path.join(screenshots, "buyer-orders-desktop.png"),
      buyerOrdersMobile: path.join(screenshots, "buyer-orders-mobile.png"),
      productDeliveryDesktop: path.join(screenshots, "product-delivery-desktop.png"),
      productDeliveryMobile: path.join(screenshots, "product-delivery-mobile.png"),
      buyerDeliveryDesktop: path.join(screenshots, "buyer-delivery-desktop.png"),
      buyerDeliveryMobile: path.join(screenshots, "buyer-delivery-mobile.png"),
      onboardingDesktop: path.join(screenshots, "onboarding-desktop.png"),
      onboardingMobile: path.join(screenshots, "onboarding-mobile.png"),
      streamQuotaDesktop: path.join(screenshots, "stream-quota-desktop.png"),
      streamQuotaMobile: path.join(screenshots, "stream-quota-mobile.png"),
      streamRetryDesktop: path.join(screenshots, "stream-retry-desktop.png"),
      streamRetryMobile: path.join(screenshots, "stream-retry-mobile.png"),
      checkoutRecoveryDesktop: path.join(screenshots, "checkout-recovery-desktop.png"),
      checkoutRecoveryMobile: path.join(screenshots, "checkout-recovery-mobile.png"),
      messageTemplateDraftDesktop: path.join(screenshots, "message-template-draft-desktop.png"),
      messageTemplateDraftMobile: path.join(screenshots, "message-template-draft-mobile.png"),
      interactionRoleDesktop: path.join(screenshots, "interaction-role-desktop.png"),
      interactionRoleMobile: path.join(screenshots, "interaction-role-mobile.png"),
      persistentPlayerDesktop: path.join(screenshots, "persistent-player-desktop.png"),
      persistentPlayerMobile: path.join(screenshots, "persistent-player-mobile.png"),
    };
    for (const [name, screenshotPath] of Object.entries(screenshotEntries)) {
      if (fs.existsSync(screenshotPath)) receipt.screenshots[name] = { filename: path.basename(screenshotPath), sha256: hashFile(screenshotPath) };
    }
    const requiredScreenshots = focusBuyerDelivery
      ? ["productDeliveryDesktop", "productDeliveryMobile", "buyerDeliveryDesktop", "buyerDeliveryMobile"]
      : focusProductDelivery
      ? ["productDeliveryDesktop", "productDeliveryMobile"]
      : focusBuyerOrders ? ["buyerOrdersDesktop", "buyerOrdersMobile"]
      : focusOnboarding ? ["onboardingDesktop", "onboardingMobile"]
      : focusStreamQuota ? ["streamQuotaDesktop", "streamQuotaMobile"]
      : focusStreamRetry ? ["streamRetryDesktop", "streamRetryMobile"]
      : focusCheckoutRecovery ? ["checkoutRecoveryDesktop", "checkoutRecoveryMobile"]
      : focusMessageTemplateDraft ? ["messageTemplateDraftDesktop", "messageTemplateDraftMobile"]
      : focusInteractionRole ? ["interactionRoleDesktop", "interactionRoleMobile"]
      : focusPersistentPlayer ? ["persistentPlayerDesktop", "persistentPlayerMobile"]
      : focusLiveStudio
        ? ["liveStudioDesktop", "liveStudioMobile"]
        : ["desktop", "mobile", "productDesktop", "productMobile", "productDeliveryDesktop", "productDeliveryMobile", "paymentResult", "financePending", "emailTemplates", "buyerOrdersDesktop", "buyerOrdersMobile"];
    const browserPassed = result.exitCode === 0
      && receipt.browser.passed === receipt.browser.expected
      && receipt.browser.failed === 0
      && receipt.browser.skipped === 0
      && browserContracts.passed
      && requiredScreenshots.every((name) => receipt.screenshots[name] !== null && receipt.screenshots[name] !== undefined);
    receipt.phases.browser = browserPassed ? "PASS" : "FAIL";
    receipt.browser.axeCriticalOrSerious = browserPassed ? 0 : -1;
    receipt.browser.rwd = browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.tenantIsolation = browserPassed && (!focused || focusBuyerOrders || focusOnboarding || focusInteractionRole) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.piiEnvelopeLeak = browserPassed && (!focused || focusBuyerOrders || focusBuyerDelivery) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.productCatalog = browserPassed && (!focused || focusProductDelivery) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.productDelivery = browserPassed && (!focused || focusDelivery) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.buyerDelivery = focusBuyerDelivery && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.emailReminder = browserPassed && (!focused || focusLiveStudio) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.liveStudio = browserPassed && (!focused || focusLiveStudio) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.buyerOrders = browserPassed && (!focused || focusBuyerOrders || focusBuyerDelivery) ? "PASS" : "NOT_VERIFIED";
    receipt.browser.onboarding = focusOnboarding && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.streamQuota = focusStreamQuota && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.streamRetry = focusStreamRetry && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.checkoutRecovery = focusCheckoutRecovery && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.messageTemplateDraft = focusMessageTemplateDraft && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.interactionRole = focusInteractionRole && browserPassed ? "PASS" : "NOT_VERIFIED";
    receipt.browser.persistentPlayer = focusPersistentPlayer && browserPassed ? "PASS" : "NOT_VERIFIED";
    if (!browserPassed) throw new Error("commerce-browser-contract-failed");
    if (attestedSourcePaths.some((relativePath) => hashFile(path.join(root, relativePath)) !== receipt.sourceLineage.files[relativePath])) {
      throw new Error("source-lineage-changed-during-run");
    }
    receipt.status = diagnosticDev ? "DIAGNOSTIC_ONLY" : "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "runner-failed";
  } finally {
    receipt.cleanup.server = stopServer(server);
    if (!container) receipt.cleanup.container = "NOT_CREATED";
    else {
      const inspection = inspectContainer(container.id, env ?? { PATH: process.env.PATH ?? "" });
      const actual = inspection.exitCode === 0 ? parseContainerInspection(inspection.stdout) : null;
      const databaseMarker = actual ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test';", env ?? {}, "postgres") : null;
      const schemaMarker = actual ? psql(container.id, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${container.schema}';`, env ?? {}) : null;
      const owned = actual
        && actual.id === container.id && actual.name === container.name && actual.runId === container.runId && actual.marker === container.marker
        && (actual.mount === "" || actual.mount === "tmpfs=/var/lib/postgresql/data")
        && databaseMarker?.stdout.trim() === container.marker && schemaMarker?.stdout.trim() === container.marker;
      if (!owned) receipt.cleanup.container = "CLEANUP_BLOCKED";
      else {
        const removed = run("docker", ["rm", "-f", container.id], env ?? {});
        const absent = run("docker", ["inspect", container.id], env ?? {});
        receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
      }
    }
    receipt.cleanup.tempRoot = removeMirror(tempRoot, marker);
    if (receipt.status === "PASS" && Object.values(receipt.cleanup).some((value) => value !== "PASS")) {
      receipt.status = "BLOCKED_OR_FAILED";
      receipt.failure = "cleanup-invariant-failed";
    }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt, receiptPath);
  }

  process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, phases: receipt.phases, browser: receipt.browser, cleanup: receipt.cleanup, diagnostics: receipt.diagnostics, receipt: path.basename(receiptPath) })}\n`);
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
