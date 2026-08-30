import test from "node:test";
import assert from "node:assert/strict";
import { canonical, classifyBrokerIdentity, digest, runWp168, validateCandidates, validateReceipt } from "./wp168-staging-payuni-reconciliation-runner.mjs";

const env = {
  WP168_BROKER_TARGET: "preview",
  PAYUNI_ENV: "sandbox",
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
  STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "postgres.example-ref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
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
  assert.equal(classifyBrokerIdentity({ ...env, STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "postgres.other:masked@aws-0-us-east-1.pooler.supabase.com/postgres" }).ok, false);
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

test("canonical and digest are stable for nested synthetic receipt fields", () => {
  const value = { z: 1, nested: { b: 2, a: [true, null] }, a: "x" };
  assert.equal(canonical(value), '{"a":"x","nested":{"a":[true,null],"b":2},"z":1}');
  assert.equal(canonical({ a: "x", nested: { a: [true, null], b: 2 }, z: 1 }), canonical(value));
  assert.match(digest("receipt", canonical(value)), /^sha256:[a-f0-9]{64}$/u);
});

test("broker identity rejects malformed app, database and Supabase boundaries", () => {
  const cases = [
    { ...env, NEXT_PUBLIC_APP_URL: "http://celebrate-deal-staging.carry-digital-nomad.in.net" },
    { ...env, STAGING_DATABASE_URL: "mysql://postgres.example-ref:masked@db.example-ref.supabase.co/database_test" },
    { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://not-supabase.example" },
    { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://example-ref.supabase.co" },
    { ...env, STAGING_DATABASE_URL: "postgresql://postgres.other-ref:masked@127.0.0.1:6543/postgres_test" },
    { ...env, NEXT_PUBLIC_APP_URL: "not-a-url" },
  ];
  const reasons = cases.map((candidateEnv) => classifyBrokerIdentity(candidateEnv).reason);
  assert.deepEqual(reasons, [
    "APP_ROUTE_MISMATCH",
    "DB_URL_CLASS_INVALID",
    "SUPABASE_PROJECT_IDENTITY_INVALID",
    "SUPABASE_PROJECT_IDENTITY_INVALID",
    "DB_SUPABASE_PROJECT_MISMATCH",
    "BROKER_IDENTITY_PARSE_FAILED",
  ]);
});

test("candidate validation rejects non-array and unsafe reference inputs", () => {
  assert.deepEqual(validateCandidates(null), { ok: false, bucket: "invalid" });
  assert.equal(validateCandidates([{ ...candidate, order_number: "bad!" }]).bucket, "unsafe_reference");
  assert.equal(validateCandidates([{ ...candidate, transaction_status: "paid" }]).bucket, "invalid_state");
});

test("read-only and provider status gates fail closed without retries", async () => {
  let providerCalls = 0;
  const notReadOnly = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "off", candidates: [candidate] }),
    queryProvider: async () => { providerCalls += 1; },
  });
  assert.equal(notReadOnly.failure, "TRANSACTION_NOT_READ_ONLY");
  assert.equal(notReadOnly.payuni.queryAttempts, 0);
  assert.equal(providerCalls, 0);

  const unsupported = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ providerTradeNo: candidate.provider_trade_no, orderNumber: candidate.order_number, status: "pending" }),
  });
  assert.equal(unsupported.status, "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH");
  assert.equal(unsupported.failure, "PROVIDER_RECONCILIATION_MISMATCH");
  assert.equal(unsupported.payuni.retries, 0);
});

test("unexpected database and provider errors are normalized without inventing success", async () => {
  const databaseError = await runWp168({
    env,
    queryDatabase: async () => { throw new Error("database response contained a secret"); },
    queryProvider: async () => { throw new Error("MUST_NOT_RUN"); },
  });
  assert.equal(databaseError.failure, "NORMALIZED_EXTERNAL_FAILURE");
  assert.equal(databaseError.status, "WP168_EXACT_NO_GO_DATABASE_IDENTITY_OR_RESERVATION_GATE");

  const providerError = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => { throw new Error("network was unavailable"); },
  });
  assert.equal(providerError.failure, "NORMALIZED_EXTERNAL_FAILURE");
  assert.equal(providerError.status, "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH");
  assert.equal(providerError.payuni.queryAttempts, 1);
});

test("receipt safety rejects sensitive status text and bounded violations", async () => {
  const receipt = await runWp168({
    env,
    queryDatabase: async () => ({ databaseIdentity: "postgres", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ providerTradeNo: candidate.provider_trade_no, orderNumber: candidate.order_number, status: "postgresql://forbidden" }),
  });
  assert.equal(receipt.status, "WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY");
  assert.equal(receipt.failure, "RECEIPT_SAFETY_VALIDATION_FAILED");
  assert.equal(receipt.quality.strictReadback, "FAIL");

  assert.equal(validateReceipt({ ...receipt, database: { ...receipt.database, applicationSelects: 2 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, payuni: { ...receipt.payuni, retries: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, refunds: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, rawIdentifiersPersisted: true } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, broker: { ...receipt.broker, environmentValuesReadByAgent: true } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, broker: { ...receipt.broker, environmentFileRead: true } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, status: "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED" }).ok, false);
});
