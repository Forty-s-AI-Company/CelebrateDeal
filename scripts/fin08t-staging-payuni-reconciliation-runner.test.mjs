import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TARGET_KEYS, buildBrokerArgs, canonical, classifyEnvironment, cleanup, digest, initialReceipt, parseInspectJson, probeIsolation, providerTransaction, queryProvider, sterileEnv, validateReceipt } from "./fin08t-staging-payuni-reconciliation-runner.mjs";

const safe = {
  DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  DIRECT_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  STAGING_DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  PAYUNI_ENV: "sandbox", PAYUNI_MERCHANT_ID: "synthetic-merchant", PAYUNI_HASH_KEY: "x".repeat(32), PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net", NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08T accepts only READY Preview metadata", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
});

test("FIN-08T classifies all nine bindings and rejects production or mismatched DB identity", () => {
  const facts = classifyEnvironment(safe);
  assert.equal(TARGET_KEYS.length, 9);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.app, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.db, true);
  assert.equal(facts.supabase, true);
  assert.equal(facts.production, false);
  assert.equal(classifyEnvironment({ ...safe, DIRECT_URL: "postgresql://other@other.example.test/db" }).db, false);
  assert.equal(classifyEnvironment({ ...safe, PAYUNI_ENV: "production" }).sandbox, false);
});

test("FIN-08T isolation terminal is strict but does not require zero parent names", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08T_TERMINAL_NO_GO_ISOLATION";
  receipt.isolation.beforeCount = 4;
  receipt.isolation.afterCount = 1;
  receipt.sideEffects.providerQueries = 0;
  receipt.sideEffects.databaseConnections = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, databaseConnections: 1 } }).ok, false);
});

test("FIN-08T success receipt requires zero replay writes and no score claim", () => {
  const receipt = initialReceipt();
  receipt.status = "FIN08T_SANDBOX_RECONCILIATION_VERIFIED";
  receipt.isolation.afterCount = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, replay: { ...receipt.replay, databaseWrites: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, scoreImpact: { ...receipt.scoreImpact, applied: true } }).ok, false);
});

test("FIN-08T broker args are Preview-only and absolute", () => {
  assert.throws(() => buildBrokerArgs("tsx", "C:\\tsconfig.json", "C:\\temp"), /ABSOLUTE_PATH_REQUIRED/u);
  const args = buildBrokerArgs("C:\\tsx.mjs", "C:\\tsconfig.json", "C:\\temp");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
});

test("FIN-08T canonical, digest and sterile environment helpers are deterministic", async () => {
  const value = { z: 1, nested: { b: 2, a: [true, null] }, a: "x" };
  assert.equal(canonical(value), '{"a":"x","nested":{"a":[true,null],"b":2},"z":1}');
  assert.equal(canonical({ a: "x", nested: { a: [true, null], b: 2 }, z: 1 }), canonical(value));
  assert.match(digest("receipt", canonical(value)), /^sha256:[a-f0-9]{64}$/u);
  const sterile = sterileEnv({ PATH: "synthetic-path", DATABASE_URL: "synthetic-database", SystemRoot: "synthetic-root" });
  assert.equal(sterile.PATH, "synthetic-path");
  assert.equal(sterile.SystemRoot, "synthetic-root");
  assert.equal(Object.hasOwn(sterile, "DATABASE_URL"), false);
  const isolation = await probeIsolation();
  assert.equal(isolation.childCount, 0);
  assert.equal(isolation.coordinatorCount, 0);
  assert.equal(isolation.childExit, 0);
  assert.equal(isolation.coordinatorExit, 0);
});

test("FIN-08T parsing and environment classification reject malformed boundaries", () => {
  const uidReady = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", state: "READY", uid: "synthetic-uid" });
  assert.equal(parseInspectJson(uidReady, 0).ok, true);
  assert.equal(parseInspectJson(uidReady, 1).ok, false);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY" }), 0).identityPresent, false);
  assert.equal(parseInspectJson("not-json", 0).ok, false);
  assert.equal(classifyEnvironment({ ...safe, NEXT_PUBLIC_APP_URL: "https://user:pass@celebrate-deal-staging.carry-digital-nomad.in.net" }).app, false);
  assert.equal(classifyEnvironment({ ...safe, STAGING_DATABASE_URL: "mysql://synthetic@db.projectref.supabase.co/db" }).db, false);
  assert.equal(classifyEnvironment({ ...safe, NEXT_PUBLIC_SUPABASE_URL: "https://not-supabase.example" }).supabase, false);
  assert.equal(classifyEnvironment({ ...safe, NEXT_PUBLIC_APP_URL: "not-a-url" }).app, false);
  assert.equal(classifyEnvironment({ ...safe, PAYUNI_ENV: "production" }).production, true);
  assert.equal(classifyEnvironment({}).requiredPresent, false);
});

test("FIN-08T receipt safety rejects isolation, replay, side-effect and sensitive families", () => {
  const base = { ...initialReceipt(), status: "FIN08T_TERMINAL_NO_GO_CANDIDATE" };
  base.isolation.afterCount = 0;
  assert.equal(validateReceipt(base).ok, true);
  const mutations = [
    (receipt) => { receipt.safety.dotenvRead = true; },
    (receipt) => { receipt.safety.valuesPersisted = true; },
    (receipt) => { receipt.isolation.afterCount = 1; },
    (receipt) => { receipt.scoreImpact.applied = true; },
    (receipt) => { receipt.sideEffects.providerQueries = 2; },
    (receipt) => { receipt.sideEffects.refunds = 1; },
    (receipt) => { receipt.replay.auditWrites = 1; },
    (receipt) => { receipt.provider = { orderNumber: "https://forbidden.example" }; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(base);
    mutate(invalid);
    assert.equal(validateReceipt(invalid).ok, false);
  }
  const isolation = structuredClone(base);
  isolation.status = "FIN08T_TERMINAL_NO_GO_ISOLATION";
  isolation.isolation.afterCount = 1;
  assert.equal(validateReceipt(isolation).ok, true);
});

test("FIN-08T provider projection, allowlist and cleanup stay bounded", async () => {
  const row = { transaction_id: "synthetic-transaction", vendor_id: "synthetic-vendor", provider_name: "payuni", provider_trade_no: "synthetic-reference", order_number: "synthetic-order", gross_amount_cents: "1250", transaction_status: "partially_refunded", refunded_amount_cents: "250" };
  assert.deepEqual(providerTransaction(row), { id: "synthetic-transaction", vendorId: "synthetic-vendor", providerName: "payuni", providerTradeNo: "synthetic-reference", orderNumber: "synthetic-order", paymentMode: "platform", grossAmountCents: 1250, gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: 1250, currency: "TWD", status: "partially_refunded", refundedAmountCents: 250, refundReason: null, refundedAt: null, occurredAt: new Date(0), metadata: { synthetic: true }, createdAt: new Date(0) });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200 });
    assert.deepEqual(await queryProvider(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); return { status: "refunded" }; } }), { result: { status: "refunded" }, attempts: 1, redirects: 0 });
    await assert.rejects(() => queryProvider(row, { queryPayment: async () => { await fetch("https://evil.example/api/trade/query"); } }), /FIN08T_PROVIDER_ALLOWLIST/u);
    globalThis.fetch = async () => ({ status: 302 });
    await assert.rejects(() => queryProvider(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); } }), /FIN08T_PROVIDER_REDIRECT/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08t-test-"));
  assert.equal((await cleanup(temp)).pass, true);
  assert.equal((await cleanup(temp)).pass, true);
});
