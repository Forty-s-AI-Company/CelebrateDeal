import assert from "node:assert/strict";
import test from "node:test";

import { buildSyntheticFixture, loadSuiteManifest, parseVitestJson } from "./wp121-disposable-qa-runner.mjs";

const manifest = loadSuiteManifest({
  schemaVersion: "celebratedeal-ai-team-wp121-suite-manifest/v1",
  requiredSuites: [
    "suite-a.test.ts",
    "suite-b.test.ts",
    "suite-c.test.ts",
    "suite-d.test.ts",
    "suite-e.test.mjs",
    "suite-f.test.mjs",
  ],
});

test("accepts historical 117-test result without a fixed total gate", () => {
  const result = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 117 }), { manifest });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.testCounts, { total: 117, passed: 117, failed: 0, skipped: 0 });
});

test("accepts current 124-test result without a fixed total gate", () => {
  const result = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 124 }), { manifest });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.testCounts, { total: 124, passed: 124, failed: 0, skipped: 0 });
});

test("fails closed for failed, skipped, and non-zero results", () => {
  const failed = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 123, failed: 1 }), { manifest, exitCode: 1 });
  const skipped = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 123, skipped: 1 }), { manifest });
  assert.equal(failed.status, "BLOCKED_OR_FAILED");
  assert.equal(skipped.status, "BLOCKED_OR_FAILED");
});

test("fails closed when a required suite is missing", () => {
  const result = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites.slice(0, -1), passed: 117 }), { manifest });
  assert.equal(result.status, "BLOCKED_OR_FAILED");
  assert.deepEqual(result.missingSuites, ["suite-f.test.mjs"]);
});

test("fails closed for malformed output and count disagreement", () => {
  assert.throws(() => parseVitestJson("{}", { manifest }), /missing testResults/);
  const fixture = buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 117 });
  fixture.numPassedTests = 116;
  assert.throws(() => parseVitestJson(fixture, { manifest }), /do not match/);
});

test("preserves the explicit zero-skipped policy", () => {
  const result = parseVitestJson(buildSyntheticFixture({ suiteNames: manifest.requiredSuites, passed: 117, skipped: 1 }), { manifest });
  assert.equal(result.testCounts.skipped, 1);
  assert.equal(result.status, "BLOCKED_OR_FAILED");
});
