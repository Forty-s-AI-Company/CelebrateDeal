import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBrokerArgs,
  canonical,
  classifyEnvironment,
  digest,
  inspectTempBoundary,
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
  STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "postgres.example-ref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
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
  assert.equal(classifyEnvironment({ ...env, STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "postgres.other:masked@aws-0-us-east-1.pooler.supabase.com/postgres" }).ok, false);
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

test("canonical and digest remain deterministic for nested synthetic values", () => {
  const value = { z: 1, nested: { b: 2, a: [true, null] }, a: "x" };
  assert.equal(canonical(value), '{"a":"x","nested":{"a":[true,null],"b":2},"z":1}');
  assert.equal(canonical({ nested: { a: [true, null], b: 2 }, a: "x", z: 1 }), canonical(value));
  assert.match(digest("receipt", canonical(value)), /^sha256:[a-f0-9]{64}$/u);
});

test("temporary boundary accepts a clean outside directory and rejects an env-named descendant", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp170-test-"));
  try {
    const clean = await inspectTempBoundary(temp);
    assert.equal(clean.ok, true);
    assert.equal(clean.outsideWorkspace, true);
    await fsp.writeFile(path.join(temp, ".env.synthetic"), "fixture-name-only\n", { encoding: "utf8", flag: "wx" });
    const contaminated = await inspectTempBoundary(temp);
    assert.equal(contaminated.ok, false);
    assert.equal(contaminated.envPathCount >= 1, true);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("environment identity rejects every unsafe binding family without reading values", () => {
  const cases = [
    ["BROKER_TARGET_NOT_PREVIEW", env, "production"],
    ["PAYUNI_NOT_SANDBOX", { ...env, PAYUNI_ENV: "production" }],
    ["APP_ROUTE_MISMATCH", { ...env, NEXT_PUBLIC_APP_URL: "http://celebrate-deal-staging.carry-digital-nomad.in.net" }],
    ["DB_URL_CLASS_INVALID", { ...env, STAGING_DATABASE_URL: "mysql://postgres.example-ref:masked@db.example-ref.supabase.co/database_test" }],
    ["SUPABASE_IDENTITY_INVALID", { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://not-supabase.example" }],
    ["DB_SUPABASE_PROJECT_MISMATCH", { ...env, STAGING_DATABASE_URL: "postgresql://postgres.other-ref:masked@127.0.0.1:6543/postgres_test" }],
    ["PAYUNI_BINDING_MISSING", { ...env, PAYUNI_HASH_IV: "" }],
    ["ENVIRONMENT_IDENTITY_PARSE_FAILED", { ...env, NEXT_PUBLIC_APP_URL: "not-a-url" }],
  ];
  for (const [reason, candidate, target] of cases) assert.deepEqual(classifyEnvironment(candidate, target), { ok: false, reason });
});

test("candidate validation remains fail closed across type, state, reference and amount buckets", () => {
  assert.deepEqual(validateCandidates(null), { ok: false, bucket: "invalid" });
  assert.equal(validateCandidates([{ ...candidate, reservation_status: "released" }]).bucket, "invalid_state");
  assert.equal(validateCandidates([{ ...candidate, provider_trade_no: "bad!" }]).bucket, "unsafe_reference");
  assert.equal(validateCandidates([{ ...candidate, gross_amount_cents: Number.MAX_SAFE_INTEGER + 1 }]).bucket, "invalid_amount");
});

test("reconciliation stops before provider for unsafe database result and normalizes unknown errors", async () => {
  let providerCalls = 0;
  const notReadOnly = await runReconciliation({
    env,
    queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "off", candidates: [candidate] }),
    queryProvider: async () => { providerCalls += 1; },
  });
  assert.equal(notReadOnly.failure, "TRANSACTION_NOT_READ_ONLY");
  assert.equal(providerCalls, 0);

  const normalized = await runReconciliation({
    env,
    queryDatabase: async () => { throw new Error("provider credentials were not read"); },
    queryProvider: async () => { providerCalls += 1; },
  });
  assert.equal(normalized.failure, "NORMALIZED_EXTERNAL_FAILURE");
  assert.equal(providerCalls, 0);
});

test("reconciliation rejects unsupported provider status after exact identity matching", async () => {
  const receipt = await runReconciliation({
    env,
    queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates: [candidate] }),
    queryProvider: async () => ({ officialSandbox: true, providerTradeNo: candidate.provider_trade_no, orderNumber: candidate.order_number, grossAmountCents: candidate.gross_amount_cents, refundedAmountCents: 0, remainingRefundableAmountCents: candidate.gross_amount_cents, status: "pending" }),
  });
  assert.equal(receipt.status, "WP170_PROVIDER_EXACT_NO_GO");
  assert.equal(receipt.failure, "PROVIDER_STATUS_UNSUPPORTED");
});

test("receipt validator covers success gates and bounded failure families", () => {
  const success = {
    schemaVersion: "wp170-staging-payuni-readonly-reconciliation/v1",
    status: "WP170_READ_ONLY_RECONCILIATION_CONSISTENT",
    freshness: { deploymentMatched: true, preview: true, ready: true, noRedirect: true },
    temp: { cleanupPass: true, envPathCount: 0 },
    broker: { attempts: 1, retries: 0, childValid: true, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false },
    database: { connectionAttempts: 1, readOnlyTransactionAttempts: 1, readOnlyTransactions: 1, applicationSelects: 1, retries: 0, candidateBucket: "one", transactionReadOnly: true },
    payuni: { officialSandbox: true, queryAttempts: 1, retries: 0, redirects: 0, referenceMatched: true, orderMatched: true, amountMatched: true },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0 },
    safety: { rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, environmentValuesPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
  };
  assert.equal(validateReceipt(success).ok, true);
  assert.equal(validateReceipt({ ...success, broker: { ...success.broker, attempts: 2 } }).ok, false);
  assert.equal(validateReceipt({ ...success, database: { ...success.database, retries: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...success, sideEffects: { ...success.sideEffects, refunds: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...success, safety: { ...success.safety, rawProviderResponsePersisted: true } }).ok, false);
  assert.equal(validateReceipt({ ...success, broker: { ...success.broker, environmentEnumerated: true } }).ok, false);
  assert.equal(validateReceipt({ ...success, payuni: { ...success.payuni, queryAttempts: 1 }, database: { ...success.database, candidateBucket: "zero" } }).ok, false);
});

test("freshness and broker parsing reject missing, malformed and unsafe output", () => {
  assert.equal(parseFreshness("", 1).ok, false);
  assert.match(parseFreshness("\u001b[31mid dpl_bad\u001b[0m\nname other\n", 0).deploymentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(parseBrokerOutput("WP170_CHILD_RESULT:not-json", "", 0).childValid, false);
  assert.equal(parseBrokerOutput("WP170_CHILD_RESULT:{}", "", 1).ok, false);
});
