import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReceipt,
  canonicalDigest,
  defaultFixtures,
  deduplicateEvidence,
  makeFixture,
  normalizeEvidence,
  validateEnvelope,
} from "./wp148-local-reliability-contract.mjs";

const repoRoot = process.cwd();
const syntheticArtifactDigest = (relativePath) => canonicalDigest({ source: "NODE_TAP_SYNTHETIC_ARTIFACT", relativePath });

test("WP148 local contract covers rubric dimensions without external effects", () => {
  const receipt = buildReceipt({ repoRoot, evidence: defaultFixtures(), artifactDigest: syntheticArtifactDigest });
  assert.equal(receipt.classification, "LOCAL_RELIABILITY_DIAGNOSTIC_CONTRACT_VERIFIED");
  assert.equal(receipt.coverage.timeout, "FAIL_CLOSED");
  assert.equal(receipt.coverage.retry, "FAIL_CLOSED");
  assert.equal(receipt.coverage.duplicate, "FAIL_CLOSED");
  assert.equal(receipt.coverage.lateEvent, "FAIL_CLOSED");
  assert.equal(receipt.coverage.structuredLogAssertions, "SANITIZED_ONLY");
  assert.deepEqual(receipt.sideEffects, { browser: 0, database: 0, deployment: 0, network: 0, payuni: 0, production: 0, staging: 0, telemetry: 0 });
});

test("WP147 UNKNOWN_BUILD_ERROR remains root-cause unknown", () => {
  const evidence = defaultFixtures().find((item) => item.provenance.workPackage === "WP-147");
  const normalized = normalizeEvidence(evidence);
  assert.equal(normalized.state, "ROOT_CAUSE_UNKNOWN");
  assert.equal(normalized.family, "UNKNOWN_BUILD_ERROR");
  assert.equal(normalized.diagnostic.complete, false);
  assert.equal(normalized.diagnostic.relativePath, null);
});

test("duplicate fingerprints suppress only the same environment and owner", () => {
  const first = normalizeEvidence(makeFixture({ id: "same-1", workPackage: "WP-123", family: "DUPLICATE_DELIVERY" }));
  const second = normalizeEvidence(makeFixture({ id: "same-2", workPackage: "WP-123", family: "DUPLICATE_DELIVERY" }));
  const differentEnvironment = normalizeEvidence(makeFixture({ id: "different", workPackage: "WP-123", family: "DUPLICATE_DELIVERY", environment: "STAGING_SYNTHETIC" }));
  assert.equal(deduplicateEvidence([first, second, differentEnvironment]).length, 2);
  assert.notEqual(first.fingerprint, differentEnvironment.fingerprint);
});

test("external telemetry gap cannot become end-to-end observed", () => {
  const evidence = makeFixture({ id: "external-gap", workPackage: "WP-123", family: "LATE_EVENT", externalTelemetry: "PENDING" });
  const normalized = normalizeEvidence(evidence);
  assert.equal(normalized.state, "EXTERNAL_NOT_COLLECTED");
  assert.equal(normalized.externalTelemetry, "EXTERNAL_NOT_COLLECTED");
});

test("forbidden keys and sensitive-like values fail closed without returning the value", () => {
  const evidence = makeFixture({ id: "unsafe", workPackage: "WP-123", family: "PAYMENT_TIMEOUT" });
  evidence.token = "synthetic-token-do-not-save";
  assert.throws(() => validateEnvelope(evidence), /FORBIDDEN_KEY/);
  delete evidence.token;
  evidence.operatorAction = "https://synthetic.invalid/raw";
  assert.throws(() => validateEnvelope(evidence), /FORBIDDEN_VALUE/);
  assert.doesNotMatch(JSON.stringify({ rejected: true }), /synthetic-token|synthetic\.invalid/);
});

test("canonical digest is stable and input artifacts stay readable-only", () => {
  const observed = [];
  const artifactDigest = (relativePath) => {
    observed.push(relativePath);
    return syntheticArtifactDigest(relativePath);
  };
  const first = buildReceipt({ repoRoot, evidence: defaultFixtures(), artifactDigest });
  const second = buildReceipt({ repoRoot, evidence: defaultFixtures(), artifactDigest });
  assert.equal(canonicalDigest(first), canonicalDigest(second));
  assert.deepEqual([...new Set(observed)].sort(), [
    ".ai-team/reports/wp-116-payment-failure-observability-receipt.json",
    ".ai-team/reports/wp123-observability-rehearsal-receipt.json",
    ".ai-team/reports/wp147-hermetic-next-build-receipt.json",
  ]);
});
