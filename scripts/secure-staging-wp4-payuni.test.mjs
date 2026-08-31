import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FIXED_PREREQUISITE_GAPS,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  createInitialReceipt,
  parseChildOutput,
  validateInvocation,
  validateReceipt,
} from "./secure-staging-wp4-payuni.mjs";

const sha = "146f8db0616fef63451d80f2d8d23a243f58860b";
const safeEnvironment = {
  GITHUB_TOKEN: "present",
  CELEBRATEDEAL_SOURCE_SHA: sha,
  CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner",
};

test("WP4 invocation is fixed-task, exact-source, Preview and staging-only", () => {
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", safeEnvironment).ok, true);
  assert.equal(validateInvocation("arbitrary-command", safeEnvironment).reason, "TASK_NOT_ALLOWLISTED");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_SOURCE_SHA: "main" }).reason, "SOURCE_SHA_INVALID");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_DEPLOYMENT_HOST: "production.example.com" }).reason, "DEPLOYMENT_HOST_INVALID");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, GITHUB_TOKEN: "" }).reason, "REQUIRED_BINDING_MISSING");
});

test("receipt is an explicit no-side-effect prerequisite contract", () => {
  const receipt = createInitialReceipt(sha);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.result, "BLOCKED");
  assert.deepEqual(receipt.prerequisites.requiredSecretBindings, REQUIRED_SECRET_KEYS);
  assert.deepEqual(receipt.prerequisites.requiredConfigBindings, REQUIRED_CONFIG_KEYS);
  assert.deepEqual(receipt.prerequisites.gaps, FIXED_PREREQUISITE_GAPS);
  assert.equal(receipt.purposes.every((purpose) => purpose.status === "NOT_RUN"), true);
  assert.equal(Object.values(receipt.sideEffects).every((count) => count === 0), true);
});

test("receipt rejects fabricated payment, refund, callback, lineage and provider evidence", () => {
  const receipt = createInitialReceipt(sha);
  assert.equal(validateReceipt({ ...receipt, result: "PASS" }).errors.includes("RESULT_MUST_BE_BLOCKED"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, payments: 3 } }).errors.includes("SIDE_EFFECTS_MUST_BE_ZERO"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, refunds: 6 } }).errors.includes("SIDE_EFFECTS_MUST_BE_ZERO"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, callbackReplays: 6 } }).errors.includes("SIDE_EFFECTS_MUST_BE_ZERO"), true);
  assert.equal(validateReceipt({ ...receipt, lineage: { ...receipt.lineage, deploymentReads: 2 } }).errors.includes("LINEAGE_CONTRACT"), true);
  assert.equal(validateReceipt({ ...receipt, purposes: receipt.purposes.map((purpose) => ({ ...purpose, providerStatus: "refunded", status: "PASS" })) }).errors.includes("PURPOSE_MUST_NOT_RUN"), true);
});

test("receipt may prove exact Preview lineage without claiming PayUni execution", () => {
  const receipt = createInitialReceipt(sha);
  receipt.lineage = {
    deploymentReads: 2,
    deploymentMatched: true,
    sourceMatched: true,
    preview: true,
    ready: true,
    healthStatus: 200,
    noRedirect: true,
  };
  receipt.prerequisites.exactPreviewLineage = true;
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(Object.values(receipt.sideEffects).every((count) => count === 0), true);
});

test("sterile child output accepts exactly one canonical blocked receipt", () => {
  const receipt = createInitialReceipt(sha);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 2).ok, true);
  assert.equal(parseChildOutput(`noise\nSECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 2).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 0).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify({ ...receipt, result: "PASS" })}\n`, 2).ok, false);
});

test("runner cannot load provider fixtures, Prisma, or create external payment side effects", () => {
  const source = fs.readFileSync(new URL("./secure-staging-wp4-payuni.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /payuni-fixtures|@prisma\/client|queryPayment|refundPayment|createCheckoutSession/u);
  assert.match(source, /\/api\/health/u);
  assert.doesNotMatch(source, /sandbox-api\.payuni\.com\.tw/u);
  assert.doesNotMatch(source, /Object\.(?:keys|entries)\(process\.env\)/u);
  assert.match(source, /spawnSync\(process\.execPath/u);
  assert.match(source, /PAYUNI_SANDBOX_ONETIME_CARD_NO/u);
  assert.match(source, /FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE/u);
});
