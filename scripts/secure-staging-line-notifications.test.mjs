import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { TASK, runLineStagingValidation, validateInvocation, validateReceipt } from "./secure-staging-line-notifications.mjs";

const source = {
  STAGING_DATABASE_URL: "postgresql://staging_user@staging.invalid/postgres",
  CSRF_SECRET: "x".repeat(32), CRON_SECRET: "y".repeat(32),
  LINE_STAGING_MESSAGING_CHANNEL_ID: "123", LINE_STAGING_MESSAGING_CHANNEL_SECRET: "s".repeat(32),
  LINE_STAGING_MESSAGING_ACCESS_TOKEN: "t".repeat(64), LINE_STAGING_USER_ID: "U".repeat(33),
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1",
  SECURE_RECEIPT_PATH: "/tmp/runner/celebratedeal-secure-receipts/line-notifications-e2e-receipt.json",
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
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: "" }), { ok: true, reason: null });
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: JSON.stringify([{ kid: "d2611a", key: Buffer.alloc(32, 5).toString("base64url"), active: true }, { kid: "legacy" }]) }), { ok: true, reason: null });
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: "[]" }), { ok: false, reason: "DATA_ENCRYPTION_KEYRING_INVALID" });
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

test("stops before any database or cron request unless the alias attests the exact Preview", async () => {
  for (const failure of [
    async () => { throw new Error("ALIAS_ATTESTATION_SHA_MISMATCH"); },
    async () => { throw new Error("ALIAS_ATTESTATION_UNREACHABLE"); },
    async () => ({ host: "preview.vercel.app" }),
  ]) {
    const receipt = await runLineStagingValidation(source, { verifyShaOnProtectedMasterImpl: async () => true, verifyAliasAttestationImpl: failure });
    assert.equal(receipt.result, "BLOCKED");
    assert.match(receipt.failureCode, /^ALIAS_ATTESTATION_[A-Z_]+$/u);
    assert.equal(receipt.sideEffects.cronCalls, 0);
    assert.equal(receipt.cleanup.attempted, false);
    assert.equal(receipt.checks.isolatedDatabase, false);
  }
  let received = null;
  await runLineStagingValidation(source, {
    verifyShaOnProtectedMasterImpl: async () => true,
    verifyAliasAttestationImpl: async (input) => { received = input; throw new Error("ALIAS_ATTESTATION_HOST_MISMATCH"); },
  });
  assert.deepEqual(received, { sourceSha: source.CELEBRATEDEAL_SOURCE_SHA, previewHost: source.CELEBRATEDEAL_DEPLOYMENT_HOST });
});

test("cron requests address the attested alias, never the firewalled Preview host", () => {
  const runner = fs.readFileSync(new URL("./secure-staging-line-notifications.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /https:\/\/\$\{source\.CELEBRATEDEAL_DEPLOYMENT_HOST\}/u);
  assert.match(runner, /fetch\(`https:\/\/\$\{operationHost\}\/api\/cron\/line-notifications`/u);
});

test("a non-master SHA is BLOCKED before alias attestation, even if the alias would attest", async () => {
  let attested = false;
  let checked = null;
  const receipt = await runLineStagingValidation({ ...source, GITHUB_TOKEN: "read-only-workflow-token" }, {
    verifyShaOnProtectedMasterImpl: async (sha, token) => { checked = { sha, token }; throw new Error("SOURCE_NOT_ON_PROTECTED_MASTER"); },
    verifyAliasAttestationImpl: async () => { attested = true; return { host: "celebrate-deal-staging.carry-digital-nomad.in.net" }; },
  });
  assert.deepEqual(checked, { sha: source.CELEBRATEDEAL_SOURCE_SHA, token: "read-only-workflow-token" });
  assert.equal(attested, false);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureCode, "SOURCE_NOT_ON_PROTECTED_MASTER");
  assert.equal(receipt.sideEffects.cronCalls, 0);
  assert.equal(receipt.cleanup.attempted, false);
  // Without the read-only token the shared gate fails closed.
  const tokenless = await runLineStagingValidation(source, { verifyAliasAttestationImpl: async () => { attested = true; return {}; } });
  assert.equal(tokenless.failureCode, "PROTECTED_MASTER_CHECK_FAILED");
  assert.equal(attested, false);
});
