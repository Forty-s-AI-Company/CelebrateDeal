import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrokerArgs,
  classifyEnvironment,
  parseBrokerOutput,
  parseFreshness,
  runReconciliation,
  validateCandidates,
  validateReceipt,
} from "./wp170-staging-payuni-readonly-reconciliation-runner.mjs";

const env = {
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "synthetic-merchant",
  PAYUNI_HASH_KEY: "x".repeat(32),
  PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
  STAGING_DATABASE_URL: "postgresql://postgres.example-ref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
};

const candidate = {
  reservation_status: "reserved",
  transaction_id: "transaction_1",
  provider_name: "payuni",
  provider_trade_no: "provider_123456",
  order_number: "cd_sandbox_123456",
  gross_amount_cents: 168000,
  currency: "TWD",
  transaction_status: "pending",
  synthetic: true,
};

test("broker argv gives the TSX CLI an absolute project tsconfig", () => {
  const args = buildBrokerArgs(
    "C:\\runtime\\node.exe",
    "C:\\workspace\\node_modules\\tsx\\dist\\cli.mjs",
    "C:\\workspace\\tsconfig.json",
    "C:\\workspace\\scripts\\runner.mjs",
    "C:\\Temp\\wp170",
  );
  assert.deepEqual(args.slice(7, 12), [
    "C:\\runtime\\node.exe",
    "C:\\workspace\\node_modules\\tsx\\dist\\cli.mjs",
    "--tsconfig",
    "C:\\workspace\\tsconfig.json",
    "C:\\workspace\\scripts\\runner.mjs",
  ]);
});

test("freshness accepts only the exact WP-167 Ready Preview deployment", () => {
  const output = "id dpl_CguykaCpikDEFjLWKUZrkPwFygbL\nname celebrate-deal-staging\ntarget preview\nstatus Ready\n";
  assert.equal(parseFreshness(output, 0).ok, true);
  assert.equal(parseFreshness(output.replace("preview", "production"), 0).ok, false);
  assert.equal(parseFreshness(output.replace("Ready", "Error"), 0).ok, false);
  assert.equal(parseFreshness(output.replace("FygbL", "Other"), 0).ok, false);
});

test("environment identity fails closed for Production and project mismatch", () => {
  assert.equal(classifyEnvironment(env).ok, true);
  assert.equal(classifyEnvironment(env, "production").ok, false);
  assert.equal(classifyEnvironment({ ...env, PAYUNI_ENV: "production" }).ok, false);
  assert.equal(classifyEnvironment({ ...env, STAGING_DATABASE_URL: "postgresql://postgres.other:masked@aws-0-us-east-1.pooler.supabase.com/postgres" }).ok, false);
});

test("candidate matrix permits exactly one valid synthetic PayUni pending row", () => {
  assert.equal(validateCandidates([]).bucket, "zero");
  assert.equal(validateCandidates([candidate]).ok, true);
  assert.equal(validateCandidates([candidate, candidate]).bucket, "ambiguous");
  assert.equal(validateCandidates([{ ...candidate, synthetic: false }]).ok, false);
  assert.equal(validateCandidates([{ ...candidate, gross_amount_cents: 0 }]).ok, false);
});

test("zero and ambiguous candidates never call PayUni", async () => {
  for (const candidates of [[], [candidate, candidate]]) {
    let calls = 0;
    const receipt = await runReconciliation({
      env,
      queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates }),
      queryProvider: async () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal(receipt.payuni.queryAttempts, 0);
  }
});

test("matching provider-ahead state is classified as divergence, not consistency", async () => {
  const receipt = await runReconciliation({
    env,
    queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ officialSandbox: true, providerTradeNo: candidate.provider_trade_no, orderNumber: candidate.order_number, grossAmountCents: 168000, refundedAmountCents: 168000, remainingRefundableAmountCents: 0, status: "refunded" }),
  });
  receipt.freshness = { deploymentMatched: true, preview: true, ready: true, noRedirect: true };
  receipt.temp = { cleanupPass: true, envPathCount: 0 };
  receipt.broker = { attempts: 1, retries: 0, childValid: true, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false };
  assert.equal(receipt.status, "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED");
  assert.equal(receipt.reconciliation.providerAhead, true);
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(JSON.stringify(receipt).includes(candidate.order_number), false);
  assert.equal(JSON.stringify(receipt).includes(candidate.provider_trade_no), false);
  const childLine = `WP170_CHILD_RESULT:${JSON.stringify({ schema: "wp170-child/v1", cwdMatched: true, receipt: { ...receipt, freshness: {}, temp: {}, broker: {} } })}`;
  assert.equal(parseBrokerOutput(childLine, "", 0).ok, true);
});

test("reference or amount mismatch fails closed without retry", async () => {
  const receipt = await runReconciliation({
    env,
    queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ officialSandbox: true, providerTradeNo: "different_123456", orderNumber: candidate.order_number, grossAmountCents: 1, refundedAmountCents: 0, remainingRefundableAmountCents: 1, status: "paid" }),
  });
  assert.equal(receipt.status, "WP170_PROVIDER_EXACT_NO_GO");
  assert.equal(receipt.payuni.queryAttempts, 1);
  assert.equal(receipt.payuni.retries, 0);
});

test("broker parser rejects autoload, assignments and duplicate child results", () => {
  const base = { schema: "wp170-child/v1", cwdMatched: true, receipt: { schemaVersion: "wp170-staging-payuni-readonly-reconciliation/v1", status: "WP170_FRESHNESS_EXACT_NO_GO", broker: { attempts: 0, retries: 0, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false }, database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, applicationSelects: 0, retries: 0, candidateBucket: "not_run" }, payuni: { queryAttempts: 0, retries: 0, redirects: 0 }, sideEffects: { databaseWrites: 0 }, safety: { rawDatabaseRowsPersisted: false } } };
  const line = `WP170_CHILD_RESULT:${JSON.stringify(base)}`;
  assert.equal(parseBrokerOutput(line, "", 0).ok, true);
  assert.equal(parseBrokerOutput(`Loaded env from .env.local\n${line}`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(`PAYUNI_ENV=sandbox\n${line}`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(`${line}\n${line}`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(line, "", -1).ok, false);
});

test("receipt validator rejects URLs, raw identifiers and side effects", () => {
  const safe = { schemaVersion: "wp170-staging-payuni-readonly-reconciliation/v1", status: "WP170_FRESHNESS_EXACT_NO_GO", broker: { attempts: 0, retries: 0, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false }, database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, applicationSelects: 0, retries: 0, candidateBucket: "not_run" }, payuni: { queryAttempts: 0, retries: 0, redirects: 0 }, sideEffects: { databaseWrites: 0 }, safety: { rawDatabaseRowsPersisted: false } };
  assert.equal(validateReceipt(safe).ok, true);
  assert.equal(validateReceipt({ ...safe, debug: "https://example.com" }).ok, false);
  assert.equal(validateReceipt({ ...safe, orderNumber: "raw-order" }).ok, false);
  assert.equal(validateReceipt({ ...safe, sideEffects: { databaseWrites: 1 } }).ok, false);
});
