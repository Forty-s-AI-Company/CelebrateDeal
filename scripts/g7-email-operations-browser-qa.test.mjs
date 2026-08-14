import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertStaticSafety, canonicalMigrations, classifyFailure, ignoredMirrorPath, isOwnedContainerInspection, mergeBrowserObservations, parseContainerInspection, removeTempRoot, safeEnvironment, safeSourceDigest, sanitize, validateReceipt } from "./g7-email-operations-browser-qa.mjs";

function receipt() { return { schemaVersion: "celebratedeal-g7-55-email-operations-browser-qa/v1", runId: "0123456789abcdef", workPackage: "G7-55", status: "PASS", startedAt: "2026-08-10T00:00:00.000Z", finishedAt: "2026-08-10T00:01:00.000Z", sourceDigest: "a".repeat(64), commands: [{ name: "synthetic", exitCode: 0 }], expected: { canonicalMigrations: 53, emailDeliveries: 55, pageSize: 25, browserTests: 5 }, phases: { mirror: "PASS", prismaGenerate: "PASS", prismaValidate: "PASS", prismaDeploy: "PASS", prismaStatus: "PASS", nextBuild: "PASS", server: "PASS", browser: "PASS" }, browser: { passed: 5, failed: 0, skipped: 0, axeCriticalOrSerious: 0, pageSize: 25, search: "PASS", filters: "PASS", pagination: "PASS", privacy: "PASS", requeue: "PASS", providerRejected: "PASS", pending: "PASS", csrf: "PASS", keyboard: "PASS", tenantIsolation: "PASS", rwd: { desktop: "PASS", mobile: "PASS" } }, cleanup: { syntheticRows: "PASS", server: "PASS", container: "PASS", tempRoot: "PASS" }, safety: { dotenvContentsRead: false, userBrowserProfileRead: false, externalOperations: false, productionOperations: false }, screenshots: { desktop: { sha256: "b".repeat(64) }, mobile: { sha256: "c".repeat(64) } } }; }

test("G7-55 receipt fails closed for migration, privacy, durable requeue, cleanup, or screenshot gaps", () => {
  const safe = receipt(); assert.equal(validateReceipt(safe), true);
  for (const value of [{ ...safe, workPackage: "G7-54" }, { ...safe, expected: { ...safe.expected, canonicalMigrations: 52 } }, { ...safe, expected: { ...safe.expected, emailDeliveries: 54 } }, { ...safe, browser: { ...safe.browser, requeue: "NOT_RUN" } }, { ...safe, browser: { ...safe.browser, tenantIsolation: "FAIL" } }, { ...safe, safety: { ...safe.safety, externalOperations: true } }, { ...safe, screenshots: {} }]) assert.equal(validateReceipt(value), false);
});

test("G7-55 source attests canonical migrations, no-dotenv mirror, loopback guard, local cache and full email contract", () => {
  const source = fs.readFileSync(new URL("./g7-email-operations-browser-qa.mjs", import.meta.url), "utf8");
  assert.equal(canonicalMigrations().length, 53); assert.match(safeSourceDigest(), /^[a-f0-9]{64}$/u); assert.equal(assertStaticSafety(source), true);
  for (const text of ["EmailDelivery", "55", "/messages/deliveries", "aria-busy=true", "provider_rejected", "createEmailRecipientHash", "manualRetryCount", "liveReminderFailedId", "observation-", "mergeBrowserObservations", "PLAYWRIGHT_BROWSERS_PATH", "NPM_CONFIG_OFFLINE", "receipt-exists-no-overwrite", ".HostConfig.Tmpfs", "G7_EMAIL_OPERATIONS_EXTERNAL_NETWORK_DENIED"]) assert.equal(source.includes(text), true, text);
  for (const unsafe of ["require('dotenv')", "launchPersistentContext", "fetch('https://outside.example')"]) assert.equal(assertStaticSafety(unsafe), false);
});

test("G7-55 environment is allowlisted, non-production, and loopback-only", () => {
  const sentinel = "G7_55_SENTINEL"; const prior = process.env[sentinel]; process.env[sentinel] = "not-propagated";
  try { const env = safeEnvironment({ tempRoot: path.join(os.tmpdir(), "g7-55-env"), port: 45678, databaseUrl: "postgresql://synthetic@127.0.0.1/test", schema: "g7_55_browser_0123456789abcdef", screenshotDirectory: "screenshots", networkGuard: "guard.cjs", playwrightBrowsersPath: "cache" }); assert.equal(env[sentinel], undefined); assert.equal(env.HOME, undefined); assert.equal(env.E2E_BASE_URL, "http://127.0.0.1:45678"); assert.equal(env.G7_EMAIL_OPERATIONS_BROWSER_SCHEMA, "g7_55_browser_0123456789abcdef"); assert.equal(env.NPM_CONFIG_OFFLINE, "true"); assert.match(env.NODE_OPTIONS, /^--require=/u); } finally { if (prior === undefined) delete process.env[sentinel]; else process.env[sentinel] = prior; }
});

test("G7-55 sanitizes diagnostics and classifies failures deterministically", () => {
  const temp = path.join(os.tmpdir(), "g7-55-sanitize"); const output = sanitize(`${temp} postgresql://postgres:password@127.0.0.1/test owner@example.test ${"a".repeat(48)}`, temp).join("\n"); assert.match(output, /<temp>|<redacted-email>/u); assert.doesNotMatch(output, /password|owner@example\.test/u);
  const diagnosticLines = sanitize(Array.from({ length: 70 }, (_, index) => `line-${index}`).join("\n"), temp); assert.equal(diagnosticLines.length, 70); assert.equal(diagnosticLines.at(-1), "line-69");
  assert.equal(classifyFailure("G7_EMAIL_OPERATIONS_EXTERNAL_NETWORK_DENIED"), "EXTERNAL_NETWORK_DENIED"); assert.equal(classifyFailure("AXE_BLOCKING"), "PLAYWRIGHT_AXE_BLOCKING"); assert.equal(classifyFailure("unknown"), "RUNNER_FAILED_UNCLASSIFIED");
});

test("G7-55 merges per-test observations without losing completed evidence after worker restart", () => {
  const defaults = { axeCriticalOrSerious: 0, pageSize: 0, search: "NOT_RUN", filters: "NOT_RUN", pagination: "NOT_RUN", privacy: "NOT_RUN", requeue: "NOT_RUN", providerRejected: "NOT_RUN", pending: "NOT_RUN", csrf: "NOT_RUN", keyboard: "NOT_RUN", tenantIsolation: "NOT_RUN", rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" } };
  const merged = mergeBrowserObservations([
    { ...defaults, pageSize: 25, pagination: "PASS", rwd: { desktop: "PASS", mobile: "NOT_RUN" } },
    { ...defaults, search: "PASS", privacy: "PASS" },
    { ...defaults, keyboard: "PASS", rwd: { desktop: "NOT_RUN", mobile: "PASS" } },
  ]);
  assert.equal(merged.pageSize, 25);
  assert.equal(merged.pagination, "PASS");
  assert.equal(merged.search, "PASS");
  assert.equal(merged.privacy, "PASS");
  assert.equal(merged.keyboard, "PASS");
  assert.deepEqual(merged.rwd, { desktop: "PASS", mobile: "PASS" });
});

test("G7-55 cleanup is confined to the exact labelled disposable resources", () => {
  const runId = crypto.randomBytes(8).toString("hex"); const name = `celebratedeal-g7-email-operations-browser-${runId}`; const marker = `g7-55-browser:${runId}`; const actual = parseContainerInspection(`id\t/${name}\t${runId}\t${marker}\t{"/var/lib/postgresql/data":""}`); assert.equal(isOwnedContainerInspection(actual, { id: "id", name, runId, marker }), true); assert.equal(isOwnedContainerInspection({ ...actual, marker: "wrong" }, { id: "id", name, runId, marker }), false);
  const tempRoot = path.join(os.tmpdir(), name); fs.mkdirSync(tempRoot, { recursive: true }); fs.writeFileSync(path.join(tempRoot, ".marker"), marker); assert.equal(removeTempRoot(tempRoot, marker), "PASS"); assert.equal(ignoredMirrorPath("nested/.env.local"), true); assert.equal(ignoredMirrorPath("src/app/page.tsx"), false);
});
