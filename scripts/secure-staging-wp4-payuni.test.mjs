import assert from "node:assert/strict";
import test from "node:test";

import { createInitialReceipt, parseChildOutput, queryProviderCandidate, replayCallbacks, validateInvocation, validateReceipt } from "./secure-staging-wp4-payuni.mjs";

const sha = "146f8db0616fef63451d80f2d8d23a243f58860b";
const safeEnvironment = {
  STAGING_DATABASE_URL: ["postgresql:", "//", "postgres.projectref:masked", "@", "region.pooler.supabase.com:5432/postgres"].join(""),
  GITHUB_TOKEN: "present",
  PAYUNI_MERCHANT_ID: "present",
  PAYUNI_HASH_KEY: "present",
  PAYUNI_HASH_IV: "present",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
  CELEBRATEDEAL_SOURCE_SHA: sha,
  CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner",
};

test("WP4 invocation is fixed-task, exact-source, Preview and staging-only", () => {
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", safeEnvironment).ok, true);
  assert.equal(validateInvocation("arbitrary-command", safeEnvironment).reason, "TASK_NOT_ALLOWLISTED");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_SOURCE_SHA: "main" }).reason, "SOURCE_SHA_INVALID");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, CELEBRATEDEAL_DEPLOYMENT_HOST: "production.example.com" }).reason, "DEPLOYMENT_HOST_INVALID");
  const nonStagingDatabase = ["postgresql:", "//", "postgres:masked", "@", "production.example.com:5432/postgres"].join("");
  assert.equal(validateInvocation("wp4-payuni-sandbox-reconciliation", { ...safeEnvironment, STAGING_DATABASE_URL: nonStagingDatabase }).reason, "STAGING_DATABASE_IDENTITY_INVALID");
});

test("canonical receipt enforces bounded side effects, secret safety and incomplete PASS drift", () => {
  const blocked = createInitialReceipt(sha);
  assert.equal(validateReceipt(blocked).ok, true);
  assert.equal(validateReceipt({ ...blocked, sideEffects: { ...blocked.sideEffects, refunds: 7 } }).ok, false);
  assert.equal(validateReceipt({ ...blocked, sideEffects: { ...blocked.sideEffects, payments: 4 } }).ok, false);
  assert.equal(validateReceipt({ ...blocked, sideEffects: { ...blocked.sideEffects, providerWrites: 10 } }).ok, false);
  assert.equal(validateReceipt({ ...blocked, sideEffects: { ...blocked.sideEffects, deployments: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...blocked, failureCategory: "https://unsafe.example" }).ok, false);
  assert.equal(validateReceipt({ ...blocked, result: "PASS" }).errors.includes("PASS_GATE_INCOMPLETE"), true);
});

test("canonical PASS requires exact lineage and the full bounded Sandbox attempt matrix", () => {
  const receipt = createInitialReceipt(sha);
  receipt.result = "PASS";
  receipt.lineage = { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true };
  receipt.environment = { requiredBindingsPresent: true, payuniSandbox: true, stagingDatabaseMatched: true, productionDetected: false };
  receipt.purposes = receipt.purposes.map((purpose) => ({
    ...purpose,
    candidateCount: 2,
    localStatus: "paid",
    providerStatus: "paid",
    referenceMatched: true,
    orderMatched: true,
    amountMatched: true,
    refundMatched: true,
    projectionMatched: true,
    duplicateSideEffectsAbsent: true,
    outOfOrderFailClosed: true,
    overRefundRejected: true,
    failureOrCancellationObserved: true,
    status: "PASS",
  }));
  receipt.reconciliation = { callbackConsistency: true, duplicateRejected: true, outOfOrderFailClosed: true, overRefundRejected: true, allPurposesMatched: true };
  receipt.sideEffects = {
    ...receipt.sideEffects,
    databaseConnections: 1,
    databaseReads: 4,
    databaseWrites: 30,
    providerQueries: 3,
    providerWrites: 9,
    transactionsCreated: 6,
    payments: 3,
    refunds: 6,
    callbackReplays: 6,
  };
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(validateReceipt({ ...receipt, lineage: { ...receipt.lineage, noRedirect: false } }).errors.includes("PASS_GATE_INCOMPLETE"), true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, payments: 0 } }).errors.includes("PASS_GATE_INCOMPLETE"), true);
});

test("callback replay uses one exact Return and Notify request without following redirects", async () => {
  const calls = [];
  const row = {
    order_number: "CD-SYNTHETIC-001",
    provider_trade_no: "SANDBOX-TRADE-001",
    gross_amount_cents: 10_000,
    paid_webhook_count: 1,
    refunded_webhook_count: 1,
    paid_webhook_event_id: "event-paid-001",
    refunded_webhook_event_id: "event-refunded-001",
  };
  const source = { ...safeEnvironment };
  const result = await replayCallbacks(row, () => "signed-body", source, async (url, init) => {
    calls.push({ url: String(url), init });
    const isReturn = new URL(url).searchParams.get("source") === "return";
    return { status: isReturn ? 303 : 200, headers: new Headers(isReturn ? { location: `https://${source.CELEBRATEDEAL_DEPLOYMENT_HOST}/checkout/result?payment=updated` } : {}) };
  });
  assert.deepEqual(result, { attempts: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.init.redirect === "manual" && call.init.method === "POST"), true);
  await assert.rejects(replayCallbacks({ ...row, paid_webhook_count: 2 }, () => "signed-body", source, async () => ({ status: 200, headers: new Headers() })), /CALLBACK_EVIDENCE_NOT_EXACT/u);
});

test("provider query permits one exact Sandbox query and rejects arbitrary egress", async () => {
  const row = { transaction: {} };
  const response = { status: 200, headers: new Headers() };
  const provider = { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); return {}; } };
  assert.equal((await queryProviderCandidate(row, provider, async () => response)).attempts, 1);
  await assert.rejects(
    queryProviderCandidate(row, { queryPayment: async () => { await fetch("https://example.com/api/trade/query"); } }, async () => response),
    /PAYUNI_SANDBOX_ALLOWLIST_REJECTED/u,
  );
  await assert.rejects(
    queryProviderCandidate(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); } }, async () => response),
    /PROVIDER_QUERY_BUDGET_EXCEEDED/u,
  );
});

test("sterile child output accepts exactly one canonical sanitized receipt", () => {
  const receipt = createInitialReceipt(sha);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 2).ok, true);
  assert.equal(parseChildOutput(`noise\nSECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 2).ok, false);
  assert.equal(parseChildOutput(`SECURE_WP4_RESULT:${JSON.stringify(receipt)}\nSECURE_WP4_RESULT:${JSON.stringify(receipt)}\n`, 2).ok, false);
});
