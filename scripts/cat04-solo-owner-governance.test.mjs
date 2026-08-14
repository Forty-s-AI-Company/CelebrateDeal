import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCat04Reconciliation, validateCat04Authorization } from "./cat04-solo-owner-governance.mjs";

const sharedOwnerAuthorization = {
  stagingOwnerRef: "holder:solo-founder",
  payUniOwnerRef: "holder:solo-founder",
  sameHumanMultipleRoles: true,
};

const consistent = {
  environmentIdentity: true,
  providerAccountIdentity: true,
  providerEnvironmentIdentity: true,
  nonProduction: true,
  providerEvidence: {
    kind: "READ_ONLY_QUERY",
    queryType: "READ_ONLY",
    bounded: true,
    auditable: true,
    attemptCount: 2,
    providerEnvironment: "sandbox-test-account",
    timestamp: "2026-08-13T00:00:00Z",
    resultClassification: "MATCHED",
  },
  orderIdentityVerified: true,
  signatureVerified: true,
  idempotencySafe: true,
  productionSecretExposed: false,
  rawPaymentDataPersisted: false,
  rawProviderPayloadPersisted: false,
  matches: {
    orderIdentity: "MATCHED",
    providerReference: "MATCHED",
    amount: "MATCHED",
    paymentStatus: "MATCHED",
    refundStatus: "MATCHED",
    callbackLocalState: "MATCHED",
  },
  refundRecordConsistent: true,
};

test("allows optional shared owner metadata without requiring an authorization record", () => {
  assert.deepEqual(validateCat04Authorization(sharedOwnerAuthorization), { ok: true, errors: [] });
  assert.deepEqual(validateCat04Authorization({ environment: "preview", providerEnvironment: "test" }), { ok: true, errors: [] });
});

test("accepts a complete outcome using an existing transaction and bounded read-only retry", () => {
  assert.deepEqual(evaluateCat04Reconciliation(consistent), { status: "PAYMENT_RECONCILIATION_READY", blockers: [] });
});

test("does not make freshness, staging name, exactly-once or fixed receipt shape a blocker", () => {
  const withoutLegacyFlowFields = { ...consistent };
  delete withoutLegacyFlowFields.freshTransaction;
  delete withoutLegacyFlowFields.freshLineage;
  delete withoutLegacyFlowFields.stagingOnly;
  delete withoutLegacyFlowFields.authorizationRecordRef;
  assert.deepEqual(evaluateCat04Reconciliation(withoutLegacyFlowFields), { status: "PAYMENT_RECONCILIATION_READY", blockers: [] });
});

test("accepts equivalent provider-issued evidence without a query-attempt constraint", () => {
  const result = evaluateCat04Reconciliation({
    ...consistent,
    providerEvidence: {
      kind: "PROVIDER_ISSUED_RECEIPT",
      providerEnvironment: "sandbox-test-account",
      timestamp: "2026-08-13T00:00:00Z",
      resultClassification: "MATCHED",
    },
  });
  assert.deepEqual(result, { status: "PAYMENT_RECONCILIATION_READY", blockers: [] });
});

test("fails closed for every unknown or mismatched outcome field", () => {
  for (const field of ["environmentIdentity", "providerAccountIdentity", "providerEnvironmentIdentity", "orderIdentityVerified", "signatureVerified", "idempotencySafe"]) {
    const result = evaluateCat04Reconciliation({ ...consistent, [field]: false });
    assert.equal(result.status, "BLOCKED");
  }
  for (const field of ["orderIdentity", "providerReference", "amount", "paymentStatus", "refundStatus", "callbackLocalState"]) {
    const result = evaluateCat04Reconciliation({ ...consistent, matches: { ...consistent.matches, [field]: "UNKNOWN" } });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.blockers.includes(`RECONCILIATION_UNVERIFIABLE:${field}`), true);
  }
});

test("fails closed for unsafe provider evidence, production boundary or sensitive persistence", () => {
  assert.equal(evaluateCat04Reconciliation({ ...consistent, providerEvidence: { ...consistent.providerEvidence, queryType: "WRITE" } }).blockers.includes("PROVIDER_QUERY_UNSAFE"), true);
  assert.equal(evaluateCat04Reconciliation({ ...consistent, nonProduction: false }).blockers.includes("PRODUCTION_BOUNDARY_INVALID"), true);
  assert.equal(evaluateCat04Reconciliation({ ...consistent, sensitiveDataExposed: true }).blockers.includes("SENSITIVE_DATA_EXPOSED"), true);
});

test("does not treat a missing second human as a CAT04 failure", () => {
  assert.equal(validateCat04Authorization({ ...sharedOwnerAuthorization, sameHumanMultipleRoles: true }).ok, true);
});
