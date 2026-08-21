import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const handoffPath = "docs/launch/current-release-gate-handoff-20260821.md";
const handoff = fs.readFileSync(handoffPath, "utf8");
const bundlePath = "docs/ai-team/evidence/release-evidence-bundle-current-status-20260821.json";
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const policyMatrixPath = "docs/launch/cat10-policy-review-matrix-20260821.md";
const policyMatrix = fs.readFileSync(policyMatrixPath, "utf8");

test("current release gate handoff stays non-Production and fail-closed", () => {
  for (const requiredText of [
    "READY_FOR_AUTHORIZED_NON_PRODUCTION_EXECUTION",
    "PAYMENT_RECONCILIATION_READY=false",
    "SANDBOX_READY=false",
    "PRODUCTION_READY=false",
    "releaseDecision=NO_GO",
    "Exact staging lineage",
    "Staging migration",
    "Cloudflare Stream",
    "Resend",
    "Sentry",
    "PostHog",
    "Durable rate limit",
    "PayUni Sandbox",
    "Policy／support／owner",
    "WP-196",
    "WP-197",
    "productionOperations=0",
    "sanitized=true",
  ]) {
    assert.match(handoff, new RegExp(requiredText, "u"));
  }

  const sourceMatch = handoff.match(/^Source RC：`([0-9a-f]{7,40})`$/mu);
  assert.ok(sourceMatch, "handoff must declare a short hexadecimal source RC");
  assert.equal(sourceMatch[1], bundle.sourceCommit);
  const policySourceMatch = policyMatrix.match(/^Source RC：`([0-9a-f]{7,40})`$/mu);
  assert.ok(policySourceMatch, "CAT10 policy matrix must declare a short hexadecimal source RC");
  assert.equal(policySourceMatch[1], bundle.sourceCommit);
  assert.match(policyMatrix, /狀態：`PENDING_HUMAN`/u);
  assert.equal(bundle.gates.length, 13);
  assert.ok(bundle.gates.every((gate) => gate.sourceCommit === bundle.sourceCommit));
  assert.match(handoff, /combined coverage `410 files passed／1 skipped`、`3106 passed／1 skipped`/u);
  assert.doesNotMatch(handoff, /3090 passed／1 skipped/u);

  assert.doesNotMatch(handoff, /(?:SANDBOX_READY|PRODUCTION_READY)=true/u);
  assert.doesNotMatch(handoff, /releaseDecision=(?:GO|HOLD)(?:\b|`)/u);
  assert.doesNotMatch(handoff, /(?:password|token|cookie|connection string)\s*[:=]\s*[^`\n]+/iu);
});
