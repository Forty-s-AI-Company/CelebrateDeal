export const SOLO_FOUNDER_SCORE_CATEGORIES = Object.freeze([
  ["payment_correctness", "Payment correctness", 15],
  ["authentication_authorization", "Authentication / authorization", 10],
  ["data_protection", "Data protection", 10],
  ["production_configuration", "Production configuration", 10],
  ["error_recovery", "Error recovery", 8],
  ["refund_correctness", "Refund correctness", 8],
  ["security", "Security", 10],
  ["monitoring", "Monitoring", 7],
  ["backup_recovery", "Backup / recovery", 8],
  ["customer_facing_policies", "Customer-facing policies", 6],
  ["core_functional_qa", "Core functional QA", 5],
  ["production_readiness", "Production readiness", 3],
]);

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateSoloFounderScore(scores) {
  const expected = new Set(SOLO_FOUNDER_SCORE_CATEGORIES.map(([id]) => id));
  const actual = new Set(Object.keys(scores ?? {}));
  const missing = [...expected].filter((id) => !actual.has(id));
  const unknown = [...actual].filter((id) => !expected.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`SCORE_CATEGORY_MISMATCH:${[...missing, ...unknown].join(",")}`);
  }

  const breakdown = {};
  let total = 0;
  for (const [id, label, weight] of SOLO_FOUNDER_SCORE_CATEGORIES) {
    const score = scores[id];
    if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error(`SCORE_OUT_OF_RANGE:${id}`);
    const weighted = round((score / 10) * weight);
    breakdown[id] = { label, weight, score, weighted };
    total += weighted;
  }
  return { total: round(total), breakdown };
}

export function deriveReadiness({ engineeringEvidence, paymentReconciliationReady, sandboxReady, productionReady }) {
  return {
    ENGINEERING_READY: engineeringEvidence === true,
    PAYMENT_RECONCILIATION_READY: paymentReconciliationReady === true,
    SANDBOX_READY: sandboxReady === true,
    PRODUCTION_READY: productionReady === true,
  };
}
