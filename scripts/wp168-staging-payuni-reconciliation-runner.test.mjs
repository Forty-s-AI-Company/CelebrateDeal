import test from "node:test";
import assert from "node:assert/strict";
import { classifyBrokerIdentity, runWp168, validateCandidates, validateReceipt } from "./wp168-staging-payuni-reconciliation-runner.mjs";

const env = {
  WP168_BROKER_TARGET: "preview",
  PAYUNI_ENV: "sandbox",
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
  STAGING_DATABASE_URL: "postgresql://postgres.example-ref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
};

const candidate = {
  reservation_id: "reservation_1",
  reservation_status: "reserved",
  transaction_id: "transaction_1",
  transaction_status: "pending",
  provider_trade_no: "provider_123456",
  order_number: "cd_sandbox_123456",
  synthetic: true,
};

test("accepts only the exact Preview, staging app, Supabase project and Sandbox identity", () => {
  assert.equal(classifyBrokerIdentity(env).ok, true);
  assert.equal(classifyBrokerIdentity({ ...env, WP168_BROKER_TARGET: "production" }).ok, false);
  assert.equal(classifyBrokerIdentity({ ...env, PAYUNI_ENV: "production" }).ok, false);
  assert.equal(classifyBrokerIdentity({ ...env, STAGING_DATABASE_URL: "postgresql://postgres.other:masked@aws-0-us-east-1.pooler.supabase.com/postgres" }).ok, false);
});

test("candidate gate distinguishes zero, one and at least two", () => {
  assert.equal(validateCandidates([]).bucket, "zero");
  assert.equal(validateCandidates([candidate]).ok, true);
  assert.equal(validateCandidates([candidate, candidate]).bucket, "at_least_two");
  assert.equal(validateCandidates([{ ...candidate, synthetic: false }]).ok, false);
});

test("does not query PayUni when the DB candidate gate is empty", async () => {
  let providerCalls = 0;
  const receipt = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [] }),
    queryProvider: async () => { providerCalls += 1; },
  });
  assert.equal(receipt.status, "WP168_EXACT_NO_GO_DATABASE_IDENTITY_OR_RESERVATION_GATE");
  assert.equal(receipt.database.applicationSelects, 1);
  assert.equal(receipt.payuni.queryAttempts, 0);
  assert.equal(providerCalls, 0);
});

test("accepts one matching live reconciliation result", async () => {
  const receipt = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ providerTradeNo: candidate.provider_trade_no, orderNumber: candidate.order_number, status: "refunded" }),
  });
  assert.equal(receipt.status, "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED");
  assert.equal(receipt.database.applicationSelects, 1);
  assert.equal(receipt.payuni.queryAttempts, 1);
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(JSON.stringify(receipt).includes(candidate.order_number), false);
  assert.equal(JSON.stringify(receipt).includes(candidate.provider_trade_no), false);
});

test("fails closed on provider mismatch without retry", async () => {
  const receipt = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ providerTradeNo: "different_123456", orderNumber: candidate.order_number, status: "refunded" }),
  });
  assert.equal(receipt.status, "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH");
  assert.equal(receipt.payuni.queryAttempts, 1);
  assert.equal(receipt.payuni.retries, 0);
});

test("accepts an explicit env-file autoload terminal NO-GO but never a success claim", async () => {
  const receipt = await runWp168({
    env,
    queryDatabase: async () => { throw new Error("NORMALIZED_EXTERNAL_FAILURE"); },
    queryProvider: async () => { throw new Error("MUST_NOT_RUN"); },
  });
  receipt.status = "WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY";
  receipt.broker.environmentFileRead = true;
  receipt.database.identityVerified = false;
  assert.equal(validateReceipt(receipt).ok, true);
  receipt.status = "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED";
  assert.equal(validateReceipt(receipt).ok, false);
});
