import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { TASK, validateInvocation, validateReceipt } from "./secure-staging-line-notifications.mjs";

const source = {
  STAGING_DATABASE_URL: "postgresql://staging_user@staging.invalid/postgres",
  CSRF_SECRET: "x".repeat(32), CRON_SECRET: "y".repeat(32),
  LINE_STAGING_MESSAGING_CHANNEL_ID: "123", LINE_STAGING_MESSAGING_CHANNEL_SECRET: "s".repeat(32),
  LINE_STAGING_MESSAGING_ACCESS_TOKEN: "t".repeat(64), LINE_STAGING_USER_ID: "U".repeat(33),
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1",
  LINE_STAGING_DATABASE_IDENTITY_SHA256: crypto.createHash("sha256").update(["staging.invalid", "5432", "/postgres", "staging_user", "public"].join("\n")).digest("hex"),
};

function passingReceipt() {
  return {
    schemaVersion: "celebratedeal-line-notifications-e2e/v1", task: TASK, result: "PASS",
    sourceCommit: "a".repeat(40), runRefHash: `sha256:${"b".repeat(64)}`,
    checks: { isolatedDatabase: true, runtimeDatabaseBound: true, invalidBearerRejected: true, invalidBearerNoWrite: true, validBearerAccepted: true, materializedCount: 1, sentCount: 1, deliveryStatus: "sent", attemptCount: 1, sentAtPresent: true, idempotencyProbePassed: true, tenantIsolationPassed: true },
    sideEffects: { cronCalls: 3, logicalLinePushes: 1, budgetExceeded: false },
    cleanup: { attempted: true, verified: true, remainingOwnedRows: 0 },
    safety: { sanitized: true, productionOperations: 0, deployments: 0, aliasMutations: 0 },
    failureCode: null,
  };
}

test("accepts only fixed bindings and an exact Preview host", () => {
  assert.deepEqual(validateInvocation(source), { ok: true, reason: null });
  assert.equal(validateInvocation({ ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "attacker.example" }).ok, false);
  assert.equal(validateInvocation({ ...source, CRON_SECRET: "" }).ok, false);
  assert.equal(validateInvocation({ ...source, LINE_STAGING_DATABASE_IDENTITY_SHA256: "0".repeat(64) }).ok, false);
  assert.equal(validateInvocation({ ...source, STAGING_DATABASE_URL: `${source.STAGING_DATABASE_URL}?schema=production` }).ok, false);
});

test("canonical receipt enforces cleanup and side-effect budgets", () => {
  assert.deepEqual(validateReceipt(passingReceipt()), { ok: true, errors: [] });
  assert.equal(validateReceipt({ ...passingReceipt(), cleanup: { attempted: true, verified: false, remainingOwnedRows: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...passingReceipt(), sideEffects: { cronCalls: 4, logicalLinePushes: 2, budgetExceeded: true } }).ok, false);
  assert.equal(validateReceipt({ ...passingReceipt(), checks: { ...passingReceipt().checks, invalidBearerNoWrite: false } }).ok, false);
  assert.equal(validateReceipt(passingReceipt(), { sourceCommit: "c".repeat(40), runId: "1", runAttempt: "1" }).ok, false);
});

test("receipt rejects secrets, database URLs, bearer values and extra fields", () => {
  const databaseCanary = `${"post"}gresql://${"user"}:${"pass"}@db.invalid/postgres`;
  for (const failureCode of ["Bearer abc", databaseCanary, "LINE_STAGING_USER_ID"]) {
    assert.equal(validateReceipt({ ...passingReceipt(), result: "FAILED", failureCode }).ok, false);
  }
  assert.equal(validateReceipt({ ...passingReceipt(), rawResponse: {} }).ok, false);
});
