import assert from "node:assert/strict";
import test from "node:test";

import { calculateSoloFounderScore, deriveReadiness } from "./solo-founder-launch-score.mjs";

const allTen = {
  payment_correctness: 10,
  authentication_authorization: 10,
  data_protection: 10,
  production_configuration: 10,
  error_recovery: 10,
  refund_correctness: 10,
  security: 10,
  monitoring: 10,
  backup_recovery: 10,
  customer_facing_policies: 10,
  core_functional_qa: 10,
  production_readiness: 10,
};

test("weighted score totals 100 when every category is complete", () => {
  assert.equal(calculateSoloFounderScore(allTen).total, 100);
});

test("rejects missing, unknown and out-of-range categories", () => {
  const missing = { ...allTen };
  delete missing.monitoring;
  assert.throws(() => calculateSoloFounderScore(missing), /SCORE_CATEGORY_MISMATCH/u);
  assert.throws(() => calculateSoloFounderScore({ ...allTen, extra: 1 }), /SCORE_CATEGORY_MISMATCH/u);
  assert.throws(() => calculateSoloFounderScore({ ...allTen, security: 11 }), /SCORE_OUT_OF_RANGE:security/u);
});

test("keeps engineering, reconciliation, sandbox and production readiness independent", () => {
  assert.deepEqual(deriveReadiness({ engineeringEvidence: true, paymentReconciliationReady: false, sandboxReady: false, productionReady: false }), {
    ENGINEERING_READY: true,
    PAYMENT_RECONCILIATION_READY: false,
    SANDBOX_READY: false,
    PRODUCTION_READY: false,
  });
});
