import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertStaticSafety,
  canonicalMigrations,
  classifyFailure,
  ignoredMirrorPath,
  isOwnedContainerInspection,
  parseContainerInspection,
  removeTempRoot,
  safeEnvironment,
  safeSourceDigest,
  sanitize,
  summarizePlaywrightReport,
  validateReceipt,
  validateSubmissionsReceipt,
} from "./g7-form-builder-browser-qa.mjs";

test("G7-53 runner fails closed for incomplete or unsafe receipts", () => {
  const safe = {
    schemaVersion: "celebratedeal-g7-53-form-draft-browser-qa/v1", workPackage: "G7-53", status: "PASS", startedAt: "2026-08-08T00:00:00.000Z", finishedAt: "2026-08-08T00:01:00.000Z", sourceDigest: "a".repeat(64), commands: [],
    expected: { browserTests: 9, operations: ["draft-autosave"] },
    phases: { mirror: "PASS", prismaGenerate: "PASS", prismaValidate: "PASS", prismaDeploy: "PASS", prismaStatus: "PASS", nextBuild: "PASS", server: "PASS", browser: "PASS" },
    browser: { passed: 9, failed: 0, skipped: 0, axeCriticalOrSerious: 0, draftRecovery: { autosave: "PASS", restore: "PASS", discard: "PASS", clearAfterSave: "PASS", failureRecovery: "PASS", crossTenant: "PASS", conflict: "PASS", staleConflict: "PASS" } },
    cleanup: { syntheticRows: "PASS", server: "PASS", container: "PASS", tempRoot: "PASS" },
    screenshots: { desktop: { sha256: "b".repeat(64) }, mobile: { sha256: "c".repeat(64) } },
    safety: { dotenvContentsRead: false, userBrowserProfileRead: false, externalOperations: false, productionOperations: false },
  };
  assert.equal(validateReceipt(safe), true);
  assert.equal(validateReceipt({ ...safe, workPackage: "G7-04" }), false);
  assert.equal(validateReceipt({ ...safe, safety: { ...safe.safety, dotenvContentsRead: true } }), false);
  assert.equal(validateReceipt({ ...safe, safety: { ...safe.safety, userBrowserProfileRead: true } }), false);
  assert.equal(validateReceipt({ ...safe, safety: { ...safe.safety, externalOperations: true } }), false);
  assert.equal(validateReceipt({ ...safe, safety: { ...safe.safety, productionOperations: true } }), false);
  assert.equal(validateReceipt({ ...safe, sourceDigest: "invalid" }), false);
  assert.equal(validateReceipt({ ...safe, commands: {} }), false);
  assert.equal(validateReceipt({ ...safe, expected: {} }), false);
  assert.equal(validateReceipt({ ...safe, cleanup: {} }), false);
  assert.equal(validateReceipt({ ...safe, screenshots: {} }), false);
  assert.equal(validateReceipt({ ...safe, browser: { passed: "8", failed: 0, skipped: 0 } }), false);
});

test("G7-54 submissions receipt requires every browser, database, safety, and cleanup gate", () => {
  const safe = {
    schemaVersion: "celebratedeal-g7-54-form-submissions-browser-qa/v1", workPackage: "G7-54", status: "PASS", startedAt: "2026-08-10T00:00:00.000Z", finishedAt: "2026-08-10T00:01:00.000Z", sourceDigest: "a".repeat(64), commands: [],
    expected: { browserTests: 5, databaseRows: 55, pageSize: 25 },
    phases: { mirror: "PASS", prismaGenerate: "PASS", prismaValidate: "PASS", prismaDeploy: "PASS", prismaStatus: "PASS", nextBuild: "PASS", server: "PASS", browser: "PASS" },
    browser: { passed: 5, failed: 0, skipped: 0, axeCriticalOrSerious: 0, rwd: { desktop: "PASS", mobile: "PASS" }, search: "PASS", filters: "PASS", pagination: "PASS", privacy: "PASS", tenant: "PASS", loading: "PASS", error: "PASS", keyboard: "PASS", database: { rows: 55, pageSize: 25 } },
    cleanup: { syntheticRows: "PASS", server: "PASS", container: "PASS", tempRoot: "PASS" },
    screenshots: { desktop: { sha256: "b".repeat(64) }, mobile: { sha256: "c".repeat(64) } },
    safety: { dotenvContentsRead: false, userBrowserProfileRead: false, externalOperations: false, productionOperations: false },
  };
  assert.equal(validateSubmissionsReceipt(safe), true);
  assert.equal(validateSubmissionsReceipt({ ...safe, status: "BLOCKED_OR_FAILED" }), true);
  assert.equal(validateSubmissionsReceipt({ ...safe, workPackage: "G7-53" }), false);
  assert.equal(validateSubmissionsReceipt({ ...safe, browser: { ...safe.browser, privacy: "NOT_RUN" } }), false);
  assert.equal(validateSubmissionsReceipt({ ...safe, browser: { ...safe.browser, database: { rows: 54, pageSize: 25 } } }), false);
  assert.equal(validateSubmissionsReceipt({ ...safe, cleanup: { ...safe.cleanup, container: "FAIL" } }), false);
  assert.equal(validateSubmissionsReceipt({ ...safe, safety: { ...safe.safety, externalOperations: true } }), false);
});

test("G7-53 runner source forbids dotenv, browser profiles, and external operations", () => {
  const source = fs.readFileSync(new URL("./g7-form-builder-browser-qa.mjs", import.meta.url), "utf8");
  assert.equal(assertStaticSafety(source), true);
  assert.equal(assertStaticSafety("require('dotenv').config()"), false);
  assert.equal(assertStaticSafety("chromium.launchPersistentContext('C:/Users/a')"), false);
  assert.equal(assertStaticSafety("const userDataDir = 'C:/Users/a'"), false);
  assert.equal(assertStaticSafety("fetch('https://outside.example')"), false);
});

test("G7-53 runner only promotes screenshots after the entire browser contract passes", () => {
  const source = fs.readFileSync(new URL("./g7-form-builder-browser-qa.mjs", import.meta.url), "utf8");
  assert.match(source, /const tempScreenshots = path\.join\(tempRoot, "screenshots"\)/u);
  assert.match(source, /if \(browserPass\) \{\s*fs\.mkdirSync\(screenshots/u);
  assert.match(source, /screenshot-missing/u);
});

test("G7-53 playwright report summary counts only final test outcomes and sanitizes diagnostics", () => {
  const summary = summarizePlaywrightReport({ suites: [{ title: "g7", specs: [
    { title: "axe", tests: [{ results: [{ status: "failed", error: { message: "AXE_BLOCKING:[{\\\"id\\\":\\\"label\\\"}] C:\\temp" } }] }] },
    { title: "mobile", tests: [{ results: [{ status: "skipped" }] }] },
    { title: "pass", tests: [{ results: [{ status: "passed" }] }] },
  ] }] }, "C:\\temp");
  assert.deepEqual({ passed: summary.passed, failed: summary.failed, skipped: summary.skipped }, { passed: 1, failed: 1, skipped: 1 });
  assert.equal(summary.diagnostics[0]?.classification, "PLAYWRIGHT_AXE_BLOCKING");
  assert.match(summary.diagnostics[0]?.details.join("\n") ?? "", /<temp>/u);
  assert.doesNotMatch(summary.diagnostics[0]?.details.join("\n") ?? "", /C:\\temp/u);
});

test("G7-53 source digest covers the canonical migration inventory deterministically", () => {
  const migrations = canonicalMigrations();
  assert.equal(migrations.length >= 44, true);
  assert.deepEqual(migrations, [...migrations].sort());
  assert.equal(migrations.every((name) => /^\d{12,14}_[a-z0-9_]+$/u.test(name)), true);
  const first = safeSourceDigest();
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(safeSourceDigest(), first);
});

test("G7-53 mirror exclusion rejects generated, secret, and transient paths", () => {
  for (const relativePath of ["", ".git/config", ".next/server", "node_modules/pkg", ".ai-team/state.json", "test-results/a", "playwright-report/a", "tmp/a", ".env", "nested/.env.production"]) {
    assert.equal(ignoredMirrorPath(relativePath), true, relativePath);
  }
  assert.equal(ignoredMirrorPath("src/components/form-builder.tsx"), false);
  assert.equal(ignoredMirrorPath("docs/environment.md"), false);
});

test("G7-53 failure classification is deterministic and fail closed", () => {
  const cases = [
    ["G7_FORM_BUILDER_EXTERNAL_NETWORK_DENIED", "EXTERNAL_NETWORK_DENIED"],
    ["Cannot connect to the Docker daemon", "DOCKER_UNAVAILABLE"],
    ["Another next build process is already running", "NEXT_BUILD_LOCKED"],
    ["Failed to compile", "NEXT_COMPILE_FAILED"],
    ["Failed to collect page data", "NEXT_PAGE_DATA_COLLECTION_FAILED"],
    ["prerender error", "NEXT_PRERENDER_FAILED"],
    ["Type error: invalid value", "NEXT_TYPECHECK_FAILED"],
    ["AXE_BLOCKING:label", "PLAYWRIGHT_AXE_BLOCKING"],
    ["RWD_HORIZONTAL_OVERFLOW:20", "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW"],
    ["strict mode violation", "PLAYWRIGHT_LOCATOR_CONTRACT_FAILED"],
    ["Timeout exceeded", "PLAYWRIGHT_TIMEOUT"],
    ["unexpected failure", "RUNNER_FAILED_UNCLASSIFIED"],
  ];
  for (const [input, expected] of cases) assert.equal(classifyFailure(input), expected);
});

test("G7-53 sanitizer redacts paths, credentials, identities, and long values", () => {
  const tempRoot = path.join(os.tmpdir(), "g7-form-builder-sanitizer-test");
  const output = sanitize(`${tempRoot} postgresql://postgres:password@127.0.0.1/test owner@example.test g7-05-local-synthetic-secret ${"b".repeat(48)}`, tempRoot).join("\n");
  assert.match(output, /<temp>/u);
  assert.match(output, /postgresql:\/\/<redacted>@/u);
  assert.match(output, /<redacted-email>/u);
  assert.match(output, /<synthetic-value>/u);
  assert.doesNotMatch(output, /password|owner@example\.test|b{48}/u);
});

test("G7-53 safe environment uses an explicit allowlist and loopback-only URLs", () => {
  const sentinelName = "G7_FORM_BUILDER_TEST_SENTINEL";
  const previous = process.env[sentinelName];
  process.env[sentinelName] = "must-not-propagate";
  try {
    const env = safeEnvironment({
      tempRoot: path.join(os.tmpdir(), "g7-form-builder-env-test"),
      port: 42345,
      databaseUrl: "postgresql://synthetic@127.0.0.1/test",
      schema: "g7_53_browser_0123456789abcdef",
      screenshotDirectory: path.join(os.tmpdir(), "screenshots"),
      networkGuard: path.join(os.tmpdir(), "guard.cjs"),
      playwrightBrowsersPath: path.join(os.tmpdir(), "browsers"),
    });
    assert.equal(env[sentinelName], undefined);
    assert.equal(env.HOME, undefined);
    assert.equal(env.CODEX_HOME, undefined);
    assert.equal(env.E2E_BASE_URL, "http://127.0.0.1:42345");
    assert.equal(env.G7_FORM_BUILDER_BROWSER_SCHEMA, "g7_53_browser_0123456789abcdef");
    assert.equal(env.PAYMENT_PROVIDER, "demo");
    assert.match(env.NODE_OPTIONS, /^--require=/u);
  } finally {
    if (previous === undefined) delete process.env[sentinelName];
    else process.env[sentinelName] = previous;
  }
});

test("G7-53 container ownership requires exact identity, labels, and data mount", () => {
  const actual = parseContainerInspection("container-id\t/celebratedeal-g7-form-builder-browser-0123456789abcdef\t0123456789abcdef\tg7-05-browser:0123456789abcdef\ttmpfs=/var/lib/postgresql/data\n");
  const expected = {
    id: "container-id",
    name: "celebratedeal-g7-form-builder-browser-0123456789abcdef",
    runId: "0123456789abcdef",
    marker: "g7-05-browser:0123456789abcdef",
  };
  assert.equal(isOwnedContainerInspection(actual, expected), true);
  assert.equal(isOwnedContainerInspection({ ...actual, id: "other" }, expected), false);
  assert.equal(isOwnedContainerInspection({ ...actual, marker: "other" }, expected), false);
  assert.equal(isOwnedContainerInspection({ ...actual, mount: "volume=/var/lib/postgresql/data" }, expected), false);
  assert.equal(isOwnedContainerInspection(null, expected), false);
  assert.equal(parseContainerInspection("too\tfew"), null);
});

test("G7-53 temporary root cleanup requires exact path and marker ownership", () => {
  const runId = crypto.randomBytes(8).toString("hex");
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-g7-form-builder-browser-${runId}`);
  const marker = `g7-05-browser:${runId}`;
  fs.mkdirSync(path.join(tempRoot, "mirror", "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".marker"), "wrong-marker", "utf8");
  assert.equal(removeTempRoot(tempRoot, marker), "CLEANUP_BLOCKED");
  assert.equal(fs.existsSync(tempRoot), true);
  fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
  assert.equal(removeTempRoot(tempRoot, marker), "PASS");
  assert.equal(fs.existsSync(tempRoot), false);
});
