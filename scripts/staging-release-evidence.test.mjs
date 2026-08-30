import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_RELEASE_EVIDENCE_SCHEMA,
  createStagingReleaseReceipt,
  validateStagingReleaseReceipt,
} from "./staging-release-evidence.mjs";

const sourceCommit = "5607910";

function completeFacts(overrides = {}) {
  return {
    sourceCommit,
    runId: "staging-release-synthetic-01",
    executedAtUtc: "2026-08-21T00:00:00.000Z",
    authorizationRecordRef: "ticket-staging-01",
    environmentClass: "staging",
    nonProduction: true,
    components: {
      lineage: { result: "PASS", sourceCommit, evidenceRef: "opaque:staging-lineage-01" },
      migration: { result: "PASS", sourceCommit, evidenceRef: "opaque:staging-migration-01" },
      recovery: { result: "PASS", sourceCommit, evidenceRef: "opaque:staging-recovery-01" },
      rollback: { result: "PASS", sourceCommit, evidenceRef: "opaque:staging-rollback-01" },
    },
    sideEffects: {
      databaseReads: 4,
      databaseWrites: 2,
      migrationWrites: 1,
      backupWrites: 1,
      restoreWrites: 1,
      deploymentOperations: 2,
      productionOperations: 0,
    },
    ...overrides,
  };
}

test("accepts a complete current-RC staging release aggregate", () => {
  const receipt = createStagingReleaseReceipt(completeFacts());

  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.sourceCommit, sourceCommit);
  assert.equal(receipt.components.rollback.result, "PASS");
  assert.equal(receipt.sideEffects.productionOperations, 0);
  assert.equal(validateStagingReleaseReceipt(receipt), true);
});

test("fails closed when authorization, environment or non-Production identity is missing", () => {
  const receipt = createStagingReleaseReceipt(completeFacts({
    authorizationRecordRef: "",
    environmentClass: "unknown",
    nonProduction: false,
  }));

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(validateStagingReleaseReceipt(receipt), true);
});

test("fails closed when a component is still not proven", () => {
  const receipt = createStagingReleaseReceipt(completeFacts({
    components: {
      ...completeFacts().components,
      recovery: { result: "NOT_PROVEN", sourceCommit: "", evidenceRef: "" },
    },
  }));

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.components.recovery.sourceCommit, "unknown");
  assert.equal(validateStagingReleaseReceipt(receipt), true);
});

test("preserves a failed staging component as FAILED", () => {
  const receipt = createStagingReleaseReceipt(completeFacts({
    components: {
      ...completeFacts().components,
      migration: { result: "FAILED", sourceCommit, evidenceRef: "opaque:staging-migration-01" },
    },
  }));

  assert.equal(receipt.result, "FAILED");
  assert.equal(validateStagingReleaseReceipt(receipt), true);
});

test("rejects component source lineage drift", () => {
  const receipt = createStagingReleaseReceipt(completeFacts({
    components: {
      ...completeFacts().components,
      rollback: { result: "PASS", sourceCommit: "318cd48", evidenceRef: "opaque:staging-rollback-old" },
    },
  }));

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(validateStagingReleaseReceipt(receipt), false);
});

test("rejects the legacy schema and invalid source formats", () => {
  const receipt = createStagingReleaseReceipt(completeFacts());

  assert.equal(validateStagingReleaseReceipt({ ...receipt, schemaVersion: "celebratedeal-staging-release-evidence/v0" }), false);
  assert.equal(validateStagingReleaseReceipt({ ...receipt, sourceCommit: "560791G" }), false);
  assert.equal(validateStagingReleaseReceipt({ ...receipt, sourceCommit: "5607910", components: { ...receipt.components, lineage: { ...receipt.components.lineage, sourceCommit: "560791a".toUpperCase() } } }), false);
});

test("rejects tampered PASS receipts and production operations", () => {
  const receipt = createStagingReleaseReceipt(completeFacts());

  assert.equal(validateStagingReleaseReceipt({
    ...receipt,
    sideEffects: { ...receipt.sideEffects, productionOperations: 1 },
  }), false);
  assert.equal(validateStagingReleaseReceipt({
    ...receipt,
    components: { ...receipt.components, rollback: { ...receipt.components.rollback, result: "BLOCKED" } },
  }), false);
});

test("never accepts raw artifact references or secret-shaped receipt text", () => {
  const receipt = createStagingReleaseReceipt(completeFacts({
    components: {
      ...completeFacts().components,
      recovery: { result: "NOT_PROVEN", sourceCommit: "", evidenceRef: "https://example.invalid/raw" },
    },
  }));

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.components.recovery.evidenceRef, "unknown");
  assert.equal(validateStagingReleaseReceipt(receipt), true);
  assert.equal(validateStagingReleaseReceipt({ ...receipt, authorizationRecordRef: "Bearer secret" }), false);
});

test("value-free blocked receipts remain valid with unknown source lineage", () => {
  const receipt = createStagingReleaseReceipt({
    runId: "staging-release-blocked-01",
    executedAtUtc: "2026-08-21T00:00:00.000Z",
    authorizationRecordRef: "",
    sourceCommit: "",
    environmentClass: "staging",
    nonProduction: true,
  });

  assert.equal(receipt.schemaVersion, STAGING_RELEASE_EVIDENCE_SCHEMA);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.sourceCommit, "unknown");
  assert.equal(validateStagingReleaseReceipt(receipt), true);
});
