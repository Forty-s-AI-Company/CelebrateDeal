import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStaticSafety,
  sourceDigestPaths,
  summarizePlaywrightReport,
  validateReceipt,
} from "./g7-interaction-roles-browser-qa.mjs";
import { readFileSync } from "node:fs";

test("G7-06 receipt rejects incomplete or unsafe evidence", () => {
  const receipt = {
    schemaVersion: "celebratedeal-g7-06-interaction-roles-browser-qa/v1",
    workPackage: "G7-06",
    status: "PASS",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:01:00.000Z",
    sourceDigest: "a".repeat(64),
    commands: [{ name: "playwright", exitCode: 0 }],
    browser: { passed: 4, failed: 0, skipped: 0 },
    cleanup: { syntheticRows: "PASS", server: "PASS", container: "PASS", tempRoot: "PASS" },
    safety: { dotenvContentsRead: false, mirrorExcludesDotenv: true, loopbackOnly: true, postgresTmpfs: true, committedMigrationsOnly: true, userBrowserProfileRead: false, externalOperations: false, productionOperations: false },
    screenshots: { desktop: { sha256: "b".repeat(64) }, mobile: { sha256: "c".repeat(64) } },
  };
  assert.equal(validateReceipt(receipt), true);
  assert.equal(validateReceipt({ ...receipt, workPackage: "G7-05" }), false);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, dotenvContentsRead: true } }), false);
  assert.equal(validateReceipt({ ...receipt, screenshots: {} }), false);
});

test("G7-06 static safety forbids dotenv, persistent profiles, and external browser URLs", () => {
  assert.equal(assertStaticSafety("import fs from 'node:fs';\nconst base = 'http://127.0.0.1:3000';"), true);
  assert.equal(assertStaticSafety("import 'dotenv/config';"), false);
  assert.equal(assertStaticSafety("browserType.launchPersistentContext('/profile');"), false);
  assert.equal(assertStaticSafety("const remote = 'https://example.test';"), false);
});

test("G7-06 source digest inventory includes all interaction and public-live boundaries", () => {
  for (const required of [
    "prisma/schema.prisma",
    "src/app/actions.ts",
    "src/lib/auth.ts",
    "src/lib/csrf.ts",
    "src/lib/interaction-role.ts",
    "src/lib/interaction-event.ts",
    "src/lib/interaction-timeline.ts",
    "src/components/interaction-roles-workbench.tsx",
    "src/components/interaction-script-form.tsx",
    "src/components/live-playback.tsx",
    "src/app/(viewer)/live/[slug]/page.tsx",
  ]) assert.ok(sourceDigestPaths.includes(required), required);
});

test("G7-06 Playwright summary preserves failed diagnostics", () => {
  const report = { suites: [{ title: "chromium", specs: [{ title: "mobile", tests: [{ results: [{ status: "failed", error: { message: "RWD_HORIZONTAL_OVERFLOW: 12" } }] }] }, { title: "desktop", tests: [{ results: [{ status: "passed" }] }] }] }] };
  const summary = summarizePlaywrightReport(report, "C:/tmp/g7-06");
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.diagnostics[0].classification, "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW");
});

test("G7-06 pending probe uses a stable locator while its accessible name changes", () => {
  const runner = readFileSync(new URL("./g7-interaction-roles-browser-qa.mjs", import.meta.url), "utf8");
  assert.ok(runner.includes('data-testid="pending-probe-submit"'));
  assert.ok(runner.includes('getByTestId("pending-probe-submit")'));
  assert.ok(runner.includes('toHaveAttribute("aria-busy", "true")'));
});

test("G7-06 canonical Axe field is synchronized before acceptance", () => {
  const runner = readFileSync(new URL("./g7-interaction-roles-browser-qa.mjs", import.meta.url), "utf8");
  assert.ok(runner.includes("receipt.browser.axeCriticalOrSerious = receipt.browser.axe?.criticalOrSerious ?? -1"));
  assert.ok(runner.includes("receipt.browser.axeCriticalOrSerious === 0"));
});
