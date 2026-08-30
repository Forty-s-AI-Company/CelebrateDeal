import assert from "node:assert/strict";
import test from "node:test";

import {
  HARD_BLOCKER_PROVENANCE,
  classifyRequirement,
  validateHardBlocker,
} from "./launch-governance.mjs";

test("requires complete provenance before a requirement can block release", () => {
  assert.deepEqual(validateHardBlocker({
    source: "PayUni Sandbox reconciliation",
    reason: "Provider identity must match the local order",
    risk_if_missing: "Incorrect payment state could be shown to a buyer",
    provenance: "EXTERNAL_PROVIDER",
  }), { ok: true, errors: [] });

  const invalid = validateHardBlocker({ source: "AI Team preference", reason: "More approvals feel safer" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.includes("PROVENANCE_NOT_RELEASE_CRITICAL"), true);
});

test("downgrades enterprise preference without deleting the requirement", () => {
  const result = classifyRequirement({
    classification: "HARD_BLOCKER",
    provenance: "ENTERPRISE_BEST_PRACTICE",
  });
  assert.equal(result.classification, "WARNING");
  assert.equal(result.releaseBlocking, false);
  assert.match(result.migrationReason, /provenance/u);
});

test("keeps every approved provenance value explicit", () => {
  assert.deepEqual(HARD_BLOCKER_PROVENANCE, [
    "EXTERNAL_PROVIDER",
    "LEGAL_REGULATION",
    "TRACKED_PROJECT_REQUIREMENT",
    "ACCEPTED_SECURITY_DECISION",
    "DIRECT_PRODUCTION_RISK",
  ]);
});

