import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const handoffPath = "docs/launch/current-release-gate-handoff-20260821.md";
const handoff = fs.readFileSync(handoffPath, "utf8");

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

  assert.doesNotMatch(handoff, /(?:SANDBOX_READY|PRODUCTION_READY)=true/u);
  assert.doesNotMatch(handoff, /releaseDecision=(?:GO|HOLD)(?:\b|`)/u);
  assert.doesNotMatch(handoff, /(?:password|token|cookie|connection string)\s*[:=]\s*[^`\n]+/iu);
});
